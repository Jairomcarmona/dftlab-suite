"""Real SQLite contention, recovery and ownership; no engine or scheduler."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import sqlite3
import unittest

import test_submissions as fixtures
from dftlab_platform.artifact_storage import SQLiteArtifactIndex
from dftlab_platform.artifacts import LocalArtifactStore
from dftlab_platform.authority import utcnow
from dftlab_platform.budgets import MAX_AMOUNT, UNIT, SQLiteBudgetHolds
from dftlab_platform.checkpoints import SQLiteCheckpointStore
from dftlab_platform.contracts import resource_json
from dftlab_platform.domain import Problem, identifier
from dftlab_platform.storage import SQLiteRepository


class Budgets(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.Submissions()
        self.fixture.setUp()
        self.repo, self.owner, self.project = self.fixture.repo, self.fixture.owner, self.fixture.project
        self.now = utcnow()
        self.clock = lambda: self.now
        self.budgets = SQLiteBudgetHolds(self.repo, clock=self.clock)
        self.account = self.budgets.register(self.owner, self.project, 100, self.now+timedelta(seconds=60))

    def tearDown(self):
        self.fixture.tearDown()

    def operation(self, *, budget=None, owner=None, project=None, plan=None):
        plan = plan or self.fixture.plan
        with self.repo._connection() as db:
            revision = db.execute("SELECT revision FROM resources WHERE resource_id=?", (plan,)).fetchone()[0]
        request = resource_json("fixtures/operation-request/valid/submit-run.json")
        request.update(project_id=project or self.project, budget_ref=budget or self.account.budget_id, idempotency_key=identifier(), target={"kind": "PLAN", "id": plan, "expected_revision": revision})
        request["payload"]["plan_id"] = plan
        operation = self.repo.accept(owner or self.owner, request)[0]
        claimed = self.repo.claim("processor")
        self.assertEqual(claimed["record_id"], operation["record_id"])
        return claimed

    def reserve(self, operation, quantity=60, **kwargs):
        return self.budgets.reserve(kwargs.get("owner", self.owner), kwargs.get("budget", self.account.budget_id), operation["record_id"], kwargs.get("revision", operation["payload"]["revision"]), kwargs.get("processor", "processor"), quantity)

    def reject(self, callback, *args, **kwargs):
        with self.assertRaises(Problem):
            callback(*args, **kwargs)

    def test_concurrent_operations_cannot_overspend_and_remain_distinct(self):
        operations = [self.operation() for _ in range(8)]
        def reserve(operation):
            try:
                return self.reserve(operation)
            except Problem:
                return None
        with ThreadPoolExecutor(max_workers=8) as pool:
            holds = [h for h in pool.map(reserve, operations) if h]
        self.assertEqual(len(holds), 1)
        self.assertEqual(self.budgets.get(self.owner, self.account.budget_id), (self.account, 60))
        self.assertEqual(holds[0].unit, UNIT)
        self.assertEqual(holds[0].request_hash, self.repo.operation(self.owner, holds[0].operation_id)["payload"]["request_hash"])

    def test_same_operation_retries_have_one_identity_after_restart(self):
        operation = self.operation()
        with ThreadPoolExecutor(max_workers=8) as pool:
            holds = list(pool.map(lambda _: self.reserve(operation), range(8)))
        self.assertEqual(len({hold.reservation_id for hold in holds}), 1)
        restarted = SQLiteBudgetHolds(SQLiteRepository(self.repo.path), clock=self.clock)
        self.assertEqual(restarted.reserve(self.owner, self.account.budget_id, operation["record_id"], 999, "new-reader", 60), holds[0])
        self.reject(self.reserve, operation, 61)
        self.assertEqual(restarted.get(self.owner, self.account.budget_id)[1], 60)

    def test_expiration_and_unknown_outcome_do_not_release_holds(self):
        first = self.operation()
        hold = self.reserve(first)
        second = self.operation()
        self.repo.recover()
        self.now += timedelta(seconds=61)
        self.assertEqual(self.reserve(first), hold)
        self.reject(self.reserve, second, 40)
        self.assertEqual(self.budgets.get(self.owner, self.account.budget_id)[1], 60)

    def test_expired_budget_rejects_new_claim_even_when_capacity_free(self):
        operation = self.operation()
        self.now += timedelta(seconds=60)
        self.reject(self.reserve, operation, 1)
        self.assertEqual(self.budgets.get(self.owner, self.account.budget_id)[1], 0)

    def test_owner_project_and_original_budget_binding(self):
        operation = self.operation()
        self.reject(self.reserve, operation, owner=self.fixture.other)
        self.reject(self.budgets.get, self.fixture.other, self.account.budget_id)
        alternative = self.budgets.register(self.owner, self.project, 100, self.now+timedelta(seconds=60))
        self.reject(self.reserve, operation, budget=alternative.budget_id)
        another = self.repo.create_project(self.owner, {"name": "Other", "idempotency_key": identifier()})[0]["project_id"]
        plan = identifier()
        with self.repo.transaction() as db:
            db.execute("INSERT INTO resources VALUES(?,?,?,1,NULL)", (plan, "PLAN", another))
        foreign = self.operation(project=another, plan=plan)
        self.reject(self.reserve, foreign)
        self.assertEqual(self.budgets.get(self.owner, self.account.budget_id)[1], 0)

    def test_processor_revision_and_pending_state_rejected(self):
        operation = self.operation()
        self.reject(self.reserve, operation, processor="wrong")
        self.reject(self.reserve, operation, revision=1)
        self.assertEqual(self.budgets.get(self.owner, self.account.budget_id)[1], 0)

    def test_no_implicit_rank_unit_conversion_or_unsafe_quantities(self):
        operation = self.operation()
        for quantity in (True, False, 0, -1, 1.0, float("nan"), float("inf"), "60", MAX_AMOUNT+1):
            self.reject(self.reserve, operation, quantity)
            self.reject(self.budgets.register, self.owner, self.project, quantity, self.now+timedelta(seconds=60))
        for unit in ("core-hour", "MPI_rank_second", "USD", "cpu_second", None):
            self.reject(self.budgets.register, self.owner, self.project, 10, self.now+timedelta(seconds=60), unit=unit)

    def test_checkpoint_preserves_holds_without_reopening_admission(self):
        operation = self.operation()
        hold = self.reserve(operation)
        artifacts = LocalArtifactStore(self.fixture.root/"artifacts", SQLiteArtifactIndex(self.repo))
        checkpoints = SQLiteCheckpointStore(self.repo, artifacts)
        pins = resource_json("fixtures/recovery-checkpoint/valid/sqlite.json")["payload"]["engine_versions"]
        pins.append({"engine": "hubbardflow", "distribution": "hubbardflow", "version": "fixture", "commit": None, "distribution_sha256": None})
        packet = self.fixture.root/"packet"
        record = checkpoints.create(self.owner, self.project, packet, pins)
        restored = checkpoints.restore(packet, record["integrity"]["digest"], self.fixture.root/"restored")
        new = SQLiteBudgetHolds(restored.repository, clock=self.clock)
        self.assertEqual(new.get(self.owner, self.account.budget_id), (self.account, 60))
        self.assertEqual(new.reserve(self.owner, self.account.budget_id, operation["record_id"], 999, "reader", 60), hold)
        self.reject(new.register, self.owner, self.project, 100, self.now+timedelta(seconds=60))
        self.assertEqual(restored.repository.operation(self.owner, operation["record_id"])["payload"]["state"], "OUTCOME_UNKNOWN")

    def test_expiry_after_insert_rolls_back_clock_and_hold(self):
        operation = self.operation()
        ticks = iter((self.now, self.now+timedelta(seconds=60)))
        self.budgets.clock = lambda: next(ticks)
        self.reject(self.reserve, operation)
        self.assertEqual(self.budgets.get(self.owner, self.account.budget_id)[1], 0)
        self.budgets.clock = self.clock
        self.assertEqual(self.reserve(operation).amount, 60)

    def test_durable_clock_floor_rejects_rollback_in_new_instance(self):
        self.reserve(self.operation())
        operation = self.operation()
        self.now -= timedelta(seconds=1)
        restarted = SQLiteBudgetHolds(SQLiteRepository(self.repo.path), clock=self.clock)
        self.reject(restarted.reserve, self.owner, self.account.budget_id, operation["record_id"], operation["payload"]["revision"], "processor", 40)
        self.assertEqual(restarted.get(self.owner, self.account.budget_id)[1], 60)

    def test_changed_original_request_fails_closed(self):
        operation = self.operation()
        self.reserve(operation)
        with self.repo.transaction() as db:
            db.execute("UPDATE operations SET request_hash=? WHERE operation_id=?", ("0"*64, operation["record_id"]))
        self.reject(self.reserve, operation)

    def test_insert_failure_rolls_back_without_consuming_capacity(self):
        operation = self.operation()
        with self.repo.transaction() as db:
            db.execute("CREATE TRIGGER interrupted_hold BEFORE INSERT ON budget_holds BEGIN SELECT RAISE(ABORT,'synthetic disk failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.reserve(operation)
        self.assertEqual(self.budgets.get(self.owner, self.account.budget_id)[1], 0)
        with self.repo.transaction() as db:
            db.execute("DROP TRIGGER interrupted_hold")
        self.assertEqual(self.reserve(operation).amount, 60)
