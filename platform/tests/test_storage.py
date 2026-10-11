"""Durability and authorization checks against the installed repository port."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import copy
from pathlib import Path
import sqlite3
import tempfile
import unittest

from dftlab_platform.contracts import ContractError, Contracts, resource_json
from dftlab_platform.domain import Operations, Principal, Processor, Problem, envelope, identifier, now, reseal
from dftlab_platform.storage import SQLiteRepository


class Storage(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "state.sqlite"
        self.repo = SQLiteRepository(self.path)
        self.alice = self.repo.ensure_principal("alice")
        self.bob = self.repo.ensure_principal("bob")
        self.project = self.repo.create_project(self.alice, {"name": "Science", "idempotency_key": "project-key-00001"})[0]

    def tearDown(self):
        self.directory.cleanup()

    def request(self, key="operation-key-001", revision=1):
        return {"action": "VALIDATE_INPUT", "project_id": self.project["project_id"], "target": {"kind": "PROJECT", "id": self.project["project_id"], "expected_revision": revision}, "payload": {"draft": {"draft_id": "draft-fixture", "revision": 1}}, "idempotency_key": key}

    def assertProblem(self, code, function, *args, **kwargs):
        with self.assertRaises(Problem) as caught:
            function(*args, **kwargs)
        self.assertEqual(caught.exception.code, code)
        Contracts().validate("problem", caught.exception.document())

    def test_principals_projects_and_idempotency_survive_restart(self):
        restarted = SQLiteRepository(self.path)
        self.assertEqual(restarted.ensure_principal("alice"), self.alice)
        same, created = restarted.create_project(self.alice, {"name": "Science", "idempotency_key": "project-key-00001"})
        self.assertFalse(created)
        self.assertEqual(same, self.project)
        other, created = restarted.create_project(self.bob, {"name": "Science", "idempotency_key": "project-key-00001"})
        self.assertTrue(created)
        self.assertNotEqual(other["project_id"], same["project_id"])
        self.assertEqual(restarted.list_projects(self.alice), [self.project])
        self.assertProblem("IDEMPOTENCY_KEY_REUSED", restarted.create_project, self.alice, {"name": "Changed", "idempotency_key": "project-key-00001"})
        self.assertProblem("NOT_FOUND", restarted.project, self.bob, same["project_id"])

    def test_concurrent_retry_is_one_atomic_operation_and_outbox(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: Operations(SQLiteRepository(self.path)).accept(self.alice, self.request()), range(12)))
        self.assertEqual(sum(created for _, created in results), 1)
        ids = {op["payload"]["operation_id"] for op, _ in results}
        self.assertEqual(len(ids), 1)
        with closing(sqlite3.connect(self.path, isolation_level=None)) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM operations").fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT count(*) FROM outbox").fetchone()[0], 1)
        retry, created = self.repo.accept(self.alice, self.request())
        self.assertFalse(created)  # retry still works after the target revision advanced
        Contracts().validate("operation-record", retry)
        self.assertEqual(self.repo.project(self.alice, self.project["project_id"])["revision"], 2)
        self.assertEqual(self.repo.events(self.alice, self.project["project_id"])[0]["type"], "operation.accepted")

    def test_revision_conflict_and_cross_owner_are_side_effect_free(self):
        op = self.repo.accept(self.alice, self.request())[0]
        self.assertProblem("NOT_FOUND", self.repo.accept, self.bob, self.request())
        self.assertProblem("NOT_FOUND", self.repo.operation, self.bob, op["record_id"])
        self.assertProblem("NOT_FOUND", self.repo.events, self.bob, self.project["project_id"])
        self.assertProblem("REVISION_CONFLICT", self.repo.accept, self.alice, self.request("another-operation-key"))
        changed = self.request()
        changed["payload"]["draft"]["revision"] = 2
        self.assertProblem("IDEMPOTENCY_KEY_REUSED", self.repo.accept, self.alice, changed)
        with closing(sqlite3.connect(self.path, isolation_level=None)) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM operations").fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT count(*) FROM events").fetchone()[0], 1)

    def test_crash_mid_effect_is_unknown_and_never_claimed_twice(self):
        original = self.repo.accept(self.alice, self.request())[0]
        claimed = self.repo.claim("processor-one")
        self.assertEqual(claimed["payload"]["state"], "RUNNING")
        self.assertIsNone(self.repo.claim("processor-two"))
        self.assertProblem("PRECONDITION_FAILED", self.repo.request_for_processor, original["record_id"], "processor-two")
        restarted = SQLiteRepository(self.path)
        self.assertEqual(restarted.recover(), 1)
        self.assertEqual(restarted.recover(), 0)
        unknown = restarted.operation(self.alice, original["record_id"])
        self.assertEqual(unknown["payload"]["state"], "OUTCOME_UNKNOWN")
        self.assertTrue(unknown["payload"]["key_retention"]["effects_alive"])
        self.assertIsNone(restarted.claim("processor-three"))
        self.assertProblem("PRECONDITION_FAILED", restarted.transition, original["record_id"], 3, "RUNNING")
        self.assertProblem("PRECONDITION_FAILED", restarted.transition, original["record_id"], 3, "SUCCEEDED", result={"job": "unproven"})
        events = restarted.events(self.alice, self.project["project_id"])
        self.assertEqual([e["sequence"] for e in events], [1, 2, 3])
        self.assertEqual(events[-1]["payload"]["to"], "OUTCOME_UNKNOWN")

    def test_late_callback_cas_and_unknown_reconciliation_use_receipt(self):
        operation = self.repo.accept(self.alice, self.request())[0]
        op_id = operation["record_id"]
        self.repo.claim("processor")
        self.repo.recover()
        self.assertProblem("REVISION_CONFLICT", self.repo.transition, op_id, 2, "SUCCEEDED", result={"confirmed": True}, processor_id="processor")
        receipt = envelope("operation-resolution-receipt", self.project["project_id"], {"operation_id": op_id, "action": "VALIDATE_INPUT", "effect_class": "LOCAL_ATOMIC", "finding": "LOCAL_EFFECT_COMMITTED", "resulting_state": "SUCCEEDED", "product_refs": [{"kind": "VALIDATION_RECEIPT", "id": "fixture-product"}], "recovered_at": now(), "evidence": []})
        self.assertProblem("PRECONDITION_FAILED", self.repo.transition, op_id, 3, "SUCCEEDED", result={"receipt": receipt})
        # A declaration without a committed product cannot resolve success.
        receipt = envelope("operation-resolution-receipt", self.project["project_id"], {"operation_id": op_id, "action": "VALIDATE_INPUT", "effect_class": "LOCAL_ATOMIC", "finding": "LOCAL_EFFECT_ABSENT", "resulting_state": "FAILED", "product_refs": [], "recovered_at": now(), "evidence": []})
        completed = self.repo.transition(op_id, 3, "FAILED", result={"receipt": receipt}, error=Problem("OPERATION_INTERRUPTED").document())
        self.assertEqual(completed["payload"]["state"], "FAILED")
        self.assertFalse(completed["payload"]["key_retention"]["effects_alive"])
        self.assertIsNone(self.repo.claim("processor-next"))

    def test_processor_is_separate_and_absent_handlers_do_not_execute(self):
        operation = self.repo.accept(self.alice, self.request())[0]
        processor = Processor(self.repo)
        self.assertTrue(processor.once())
        self.assertFalse(processor.once())
        completed = self.repo.operation(self.alice, operation["record_id"])
        self.assertEqual(completed["payload"]["state"], "FAILED")
        self.assertEqual(completed["payload"]["error"]["code"], "ENGINE_UNAVAILABLE")
        # A handler exception and malformed success are both uncertain effects.
        for index, handler in enumerate((lambda op, req: 1 / 0, lambda op, req: None)):
            revision = self.repo.project(self.alice, self.project["project_id"])["revision"]
            pending = self.repo.accept(self.alice, self.request(f"handler-key-0000{index}", revision))[0]
            self.assertTrue(Processor(self.repo, {"VALIDATE_INPUT": handler}).once())
            self.assertEqual(self.repo.operation(self.alice, pending["record_id"])["payload"]["state"], "OUTCOME_UNKNOWN")

    def test_checkpoint_and_corruption_are_detected(self):
        operation = self.repo.accept(self.alice, self.request())[0]
        backup = Path(self.directory.name) / "snapshot.sqlite"
        self.repo.checkpoint(backup)
        copied = SQLiteRepository(backup)
        self.assertEqual(copied.operation(self.alice, operation["record_id"]), operation)
        self.assertEqual(copied.claim("restored-processor")["record_id"], operation["record_id"])
        with self.assertRaises(ValueError):
            self.repo.checkpoint(backup)
        damaged = copy.deepcopy(operation)
        damaged["payload"]["revision"] += 1
        with closing(sqlite3.connect(self.path, isolation_level=None)) as db:
            import json
            db.execute("UPDATE operations SET document=?", (json.dumps(damaged),))
        with self.assertRaises(ContractError):
            self.repo.operation(self.alice, operation["record_id"])

    def test_invalid_fixture_cannot_enter_outbox(self):
        manifest = resource_json("fixtures/manifest.json")["fixtures"]
        for fixture in manifest:
            if fixture["schema"] == "operation-request.schema.json" and fixture["expect"] == "invalid":
                with self.assertRaises(ContractError):
                    self.repo.accept(self.alice, resource_json(fixture["path"]))
        with closing(sqlite3.connect(self.path, isolation_level=None)) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM outbox").fetchone()[0], 0)

    def test_event_failure_rolls_back_acceptance_and_revision(self):
        def fail(*args):
            raise RuntimeError("simulated persistent stream failure")
        self.repo._event = fail
        with self.assertRaises(RuntimeError):
            self.repo.accept(self.alice, self.request())
        self.assertEqual(self.repo.project(self.alice, self.project["project_id"])["revision"], 1)
        with closing(sqlite3.connect(self.path, isolation_level=None)) as db:
            for table in ("operations", "outbox", "events"):
                self.assertEqual(db.execute(f"SELECT count(*) FROM {table}").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
