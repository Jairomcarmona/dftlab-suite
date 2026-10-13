"""Adenda 12 generation admission and explicit v2 storage migrations."""

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from importlib.resources import files
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from dftlab_platform.authority import LocalAuthority, stamp, utcnow
from dftlab_platform.authority_storage import SQLiteAuthorityStore, migrate_authority_v2
from dftlab_platform.contracts import canonical, resource_json
from dftlab_platform.domain import Problem, envelope, identifier, now, reseal
from dftlab_platform.generation_admission import evaluate_generation_admission
from dftlab_platform.storage import SQLiteRepository
from dftlab_platform.submission_storage import SQLiteSubmissionLedger, intent_hash, migrate_submission_v2
from dftlab_platform.submissions import BINDINGS
from dftlab_platform.projection_storage import SQLiteReadModels


def check_generation_admission_matches_the_contract_vectors():
    fixture = Path(__file__).resolve().parents[2] / "contracts/fixtures/authority-generations/cases.json"
    raw = (
        fixture.read_bytes()
        if fixture.is_file()
        else files("dftlab_platform").joinpath(
            "resources/contracts/fixtures/authority-generations/cases.json"
        ).read_bytes()
    )
    assert hashlib.sha256(raw).hexdigest() == "539dcfff0c2d84296a0deb75db9b36f2d44f4215b11f1e817be1265899bae8c3"
    vectors = json.loads(raw)
    assert len(vectors["cases"]) == 23
    for case in vectors["cases"]:
        assert evaluate_generation_admission(vectors["max_attempts"], case) == case["expect"], case["name"]


def _legacy_authority_database(path, *, non_v1=False):
    repository = SQLiteRepository(path)
    owner = repository.ensure_principal("authority-migration-owner")
    project = repository.create_project(owner, {
        "name": "authority migration",
        "idempotency_key": "authority-migration-project",
    })[0]["project_id"]
    with repository.transaction() as db:
        db.execute("CREATE TABLE authority_migrations(version INTEGER PRIMARY KEY)")
        db.execute("INSERT INTO authority_migrations VALUES(1)")
        db.execute(
            "CREATE TABLE controller_authorities("
            "run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id), "
            "owner_id TEXT NOT NULL REFERENCES principals(principal_id), document TEXT NOT NULL, "
            "last_observed_at TEXT NOT NULL)"
        )
        for lease in ("2030-01-01T00:00:00.000000Z", None):
            run_id = identifier()
            payload = {
                "run_id": run_id,
                "attempt_id": identifier(),
                "owner_instance_id": identifier(),
                "generation": 2 if non_v1 and lease is None else 1,
                "fencing": {"mechanism": "SITE_LOCK", "checked_at": "NONE"},
                "automatic_takeover": "DISABLED",
                "site_scope": "migration-fixture",
                "lease_expires_at": lease,
                "validity_evidence": [],
                "termination_evidence": [],
            }
            record = envelope("controller-authority-record", project, payload, contracts=repository.contracts)
            record["created_at"] = stamp(utcnow())
            reseal(record)
            repository.contracts.validate("controller-authority-record", record)
            db.execute(
                "INSERT INTO controller_authorities VALUES(?,?,?,?,?)",
                (run_id, project, owner.principal_id, canonical(record).decode(), record["created_at"]),
            )
    return repository


def check_authority_v2_migration_preserves_documents_and_marks_retirement_idempotently(tmp_path):
    repository = _legacy_authority_database(tmp_path / "authority.sqlite")
    with repository._connection() as db:
        before = db.execute(
            "SELECT run_id,project_id,owner_id,document,last_observed_at FROM controller_authorities ORDER BY run_id"
        ).fetchall()

    assert migrate_authority_v2(repository) is True
    with repository._connection() as db:
        after = db.execute(
            "SELECT run_id,generation,project_id,owner_id,document,last_observed_at,retired "
            "FROM controller_authorities ORDER BY run_id"
        ).fetchall()
        versions = [row[0] for row in db.execute("SELECT version FROM authority_migrations ORDER BY version")]
        active_index = db.execute(
            "SELECT sql FROM sqlite_master WHERE type='index' AND name='controller_authorities_one_active_run'"
        ).fetchone()[0]
    assert versions == [1, 2]
    assert [(row[0], row[1], row[2], row[3], row[4], row[5]) for row in after] == [
        (row[0], 1, row[1], row[2], row[3], row[4]) for row in before
    ]
    assert [row[6] for row in after] == [
        int(repository.contracts.validate("controller-authority-record", json.loads(row[3]))["payload"]["lease_expires_at"] is None)
        for row in before
    ]
    assert "whereretired=0" in active_index.lower().replace(" ", "")
    snapshot = (after, versions)
    assert migrate_authority_v2(repository) is False
    with repository._connection() as db:
        assert db.execute(
            "SELECT run_id,generation,project_id,owner_id,document,last_observed_at,retired "
            "FROM controller_authorities ORDER BY run_id"
        ).fetchall() == snapshot[0]


def check_authority_v2_migration_aborts_non_v1_documents_without_partial_schema_change(tmp_path):
    repository = _legacy_authority_database(tmp_path / "authority-non-v1.sqlite", non_v1=True)
    with repository._connection() as db:
        before = db.execute("SELECT run_id,document FROM controller_authorities ORDER BY run_id").fetchall()
    try:
        migrate_authority_v2(repository)
    except ValueError as exc:
        assert "generation 1" in str(exc)
    else:
        raise AssertionError("non-v1 authority document must abort migration")
    with repository._connection() as db:
        assert [row[0] for row in db.execute("SELECT version FROM authority_migrations ORDER BY version")] == [1]
        assert db.execute("SELECT run_id,document FROM controller_authorities ORDER BY run_id").fetchall() == before
        columns = [row[1] for row in db.execute("PRAGMA table_info(controller_authorities)")]
    assert columns == ["run_id", "project_id", "owner_id", "document", "last_observed_at"]


def _create_v1_submission_tables(repository):
    with repository.transaction() as db:
        db.execute("CREATE TABLE submission_migrations(version INTEGER PRIMARY KEY)")
        db.execute("INSERT INTO submission_migrations VALUES(1)")
        db.execute(
            "CREATE TABLE scheduler_dispatches("
            "operation_id TEXT PRIMARY KEY REFERENCES operations(operation_id), run_id TEXT NOT NULL UNIQUE, "
            "attempt_token TEXT NOT NULL UNIQUE, intent_hash TEXT NOT NULL, "
            "phase TEXT NOT NULL CHECK(phase IN ('RESERVED','DISPATCH_STARTED','ACKNOWLEDGED')), receipt TEXT)"
        )
        db.execute("CREATE TABLE scheduler_rpc_migrations(version INTEGER PRIMARY KEY)")
        db.execute("INSERT INTO scheduler_rpc_migrations VALUES(1)")
        db.execute(
            "CREATE TABLE scheduler_rpc_entries("
            "operation_id TEXT PRIMARY KEY REFERENCES scheduler_dispatches(operation_id), "
            "intent_hash TEXT NOT NULL, entered_at TEXT NOT NULL)"
        )


def _legacy_dispatch(repository, owner, project, phase, *, generation=1, run_id=None, attempt_id=None,
                     plan_revision=1):
    plan_id = identifier()
    with repository.transaction() as db:
        db.execute("INSERT INTO resources VALUES(?,?,?,1,NULL)", (plan_id, "PLAN", project))
    request = resource_json("fixtures/operation-request/valid/submit-run.json")
    request.update(project_id=project, target={"kind": "PLAN", "id": plan_id, "expected_revision": 1},
                   idempotency_key=identifier())
    request["payload"]["plan_id"] = plan_id
    pending = repository.accept(owner, request)[0]
    processor_id = "migration-processor-" + identifier()
    operation = repository.claim(processor_id)
    payload = resource_json("fixtures/effect-intent/valid/submit.json")["payload"]
    payload.update(effect_intent_id=identifier(), operation_id=operation["record_id"], run_id=run_id or identifier(),
                   attempt_id=attempt_id or identifier(), attempt_token=identifier(), authority_generation=generation,
                   recorded_at=now())
    intent = envelope("effect-intent", project, payload, contracts=repository.contracts)
    with repository.transaction() as db:
        stored = repository._persist_effect_intent(db, operation["record_id"], operation["payload"]["revision"],
                                                   processor_id, intent)
    receipt_text = None
    if phase == "ACKNOWLEDGED":
        receipt_payload = {key: stored["payload"][key] for key in BINDINGS}
        receipt_payload.update(status="ACCEPTED", job={"job_id": "migration-job", "cluster": "migration-cluster",
                               "remote_user": "migration-user", "submitted_at": stored["payload"]["recorded_at"]}, evidence=[])
        receipt = envelope("submission-receipt", project, receipt_payload, contracts=repository.contracts)
        reseal(receipt)
        repository.contracts.validate("submission-receipt", receipt)
        receipt_text = canonical(receipt).decode()
    with repository.transaction() as db:
        columns = {row[1] for row in db.execute("PRAGMA table_info(scheduler_dispatches)")}
        if "generation" in columns:
            db.execute(
                "INSERT INTO scheduler_dispatches"
                "(operation_id,run_id,generation,attempt_token,intent_hash,phase,receipt) VALUES(?,?,?,?,?,?,?)",
                (operation["record_id"], stored["payload"]["run_id"], generation, stored["payload"]["attempt_token"],
                 intent_hash(stored), phase, receipt_text),
            )
        else:
            db.execute(
                "INSERT INTO scheduler_dispatches VALUES(?,?,?,?,?,?)",
                (operation["record_id"], stored["payload"]["run_id"], stored["payload"]["attempt_token"],
                 intent_hash(stored), phase, receipt_text),
            )
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "scheduler_dispatch_plan_snapshots" in tables:
            db.execute(
                "INSERT INTO scheduler_dispatch_plan_snapshots"
                "(operation_id,run_id,generation,plan_revision) VALUES(?,?,?,?)",
                (operation["record_id"], stored["payload"]["run_id"], generation, plan_revision),
            )
        if phase in {"DISPATCH_STARTED", "ACKNOWLEDGED"}:
            db.execute("INSERT INTO scheduler_rpc_entries VALUES(?,?,?)",
                       (operation["record_id"], intent_hash(stored), now()))
    return pending


def _resume_operation(repository, owner, project, run_id, from_attempt_id, attempt_id, generation, plan_revision):
    plan_id = identifier()
    plan = resource_json("fixtures/resume-plan/valid/partial-reuse.json")
    plan["project_id"] = project
    plan["payload"].update(
        resume_plan_id=plan_id,
        run_id=run_id,
        from_attempt_id=from_attempt_id,
        plan_revision=plan_revision,
    )
    reseal(plan)
    repository.contracts.validate("resume-plan", plan)
    SQLiteReadModels(repository).put(owner, "RESUME_PLAN", plan)
    request = {
        "action": "EXECUTE_RESUME_PLAN",
        "project_id": project,
        "target": {"kind": "RESUME_PLAN", "id": plan_id, "expected_revision": plan_revision},
        "payload": {"resume_plan_id": plan_id},
        "idempotency_key": identifier(),
    }
    repository.accept(owner, request)
    processor = "resume-processor-" + identifier()
    operation = repository.claim(processor)
    payload = resource_json("fixtures/effect-intent/valid/submit.json")["payload"]
    payload.update(
        effect_intent_id=identifier(),
        operation_id=operation["record_id"],
        action="EXECUTE_RESUME_PLAN",
        run_id=run_id,
        attempt_id=attempt_id,
        attempt_token=identifier(),
        authority_generation=generation,
        recorded_at=now(),
    )
    intent = envelope("effect-intent", project, payload, contracts=repository.contracts)
    return processor, operation, intent, plan


def _acknowledge_dispatch(repository, ledger, intent):
    ledger.start(intent)
    payload = {key: intent["payload"][key] for key in BINDINGS}
    payload.update(
        status="ACCEPTED",
        job={"job_id": "generation-fixture-job", "cluster": "generation-fixture",
             "remote_user": "fixture", "submitted_at": intent["payload"]["recorded_at"]},
        evidence=[],
    )
    receipt = envelope("submission-receipt", intent["project_id"], payload, contracts=repository.contracts)
    reseal(receipt)
    ledger.confirm(intent, receipt)


def check_submission_v2_migration_preserves_every_phase_receipt_and_rpc_foreign_key(tmp_path):
    repository = SQLiteRepository(tmp_path / "submission.sqlite")
    owner = repository.ensure_principal("submission-migration-owner")
    project = repository.create_project(owner, {
        "name": "submission migration",
        "idempotency_key": "submission-migration-project",
    })[0]["project_id"]
    _create_v1_submission_tables(repository)
    for phase in ("RESERVED", "DISPATCH_STARTED", "ACKNOWLEDGED"):
        _legacy_dispatch(repository, owner, project, phase)
    with repository._connection() as db:
        before_dispatches = db.execute(
            "SELECT operation_id,run_id,attempt_token,intent_hash,phase,receipt FROM scheduler_dispatches ORDER BY operation_id"
        ).fetchall()
        before_rpc = db.execute("SELECT operation_id,intent_hash,entered_at FROM scheduler_rpc_entries ORDER BY operation_id").fetchall()

    assert migrate_submission_v2(repository) is True
    with repository._connection() as db:
        after_dispatches = db.execute(
            "SELECT operation_id,run_id,generation,attempt_token,intent_hash,phase,receipt "
            "FROM scheduler_dispatches ORDER BY operation_id"
        ).fetchall()
        after_rpc = db.execute("SELECT operation_id,intent_hash,entered_at FROM scheduler_rpc_entries ORDER BY operation_id").fetchall()
        versions = [row[0] for row in db.execute("SELECT version FROM submission_migrations ORDER BY version")]
        rpc_fk = db.execute("PRAGMA foreign_key_list(scheduler_rpc_entries)").fetchall()
        fk_errors = db.execute("PRAGMA foreign_key_check").fetchall()
    assert versions == [1, 2]
    assert [(row[0], row[1], row[3], row[4], row[5], row[6]) for row in after_dispatches] == before_dispatches
    assert {row[2] for row in after_dispatches} == {1}
    assert after_rpc == before_rpc
    assert rpc_fk and rpc_fk[0][2] == "scheduler_dispatches"
    assert fk_errors == []
    snapshot = (after_dispatches, after_rpc)
    assert migrate_submission_v2(repository) is False
    with repository._connection() as db:
        assert db.execute(
            "SELECT operation_id,run_id,generation,attempt_token,intent_hash,phase,receipt "
            "FROM scheduler_dispatches ORDER BY operation_id"
        ).fetchall() == snapshot[0]
        assert db.execute("SELECT operation_id,intent_hash,entered_at FROM scheduler_rpc_entries ORDER BY operation_id").fetchall() == snapshot[1]


def check_submission_v2_migration_aborts_non_v1_intents_without_partial_schema_change(tmp_path):
    repository = SQLiteRepository(tmp_path / "submission-non-v1.sqlite")
    owner = repository.ensure_principal("submission-migration-owner")
    project = repository.create_project(owner, {
        "name": "submission migration",
        "idempotency_key": "submission-migration-project",
    })[0]["project_id"]
    _create_v1_submission_tables(repository)
    _legacy_dispatch(repository, owner, project, "RESERVED", generation=2)
    with repository._connection() as db:
        before = db.execute("SELECT * FROM scheduler_dispatches").fetchall()
    try:
        migrate_submission_v2(repository)
    except ValueError as exc:
        assert "generation 1" in str(exc)
    else:
        raise AssertionError("non-v1 submission intent must abort migration")
    with repository._connection() as db:
        assert [row[0] for row in db.execute("SELECT version FROM submission_migrations ORDER BY version")] == [1]
        assert db.execute("SELECT * FROM scheduler_dispatches").fetchall() == before
        columns = [row[1] for row in db.execute("PRAGMA table_info(scheduler_dispatches)")]
    assert "generation" not in columns


class AuthorityGenerationMigrations(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.tmp_path = Path(temporary.name)

    def test_generation_admission_matches_the_contract_vectors(self):
        check_generation_admission_matches_the_contract_vectors()

    def test_dispatch_reservation_applies_l5_to_persisted_generation_state(self):
        repository = SQLiteRepository(self.tmp_path / "dispatch-admission.sqlite")
        owner = repository.ensure_principal("dispatch-admission-owner")
        project = repository.create_project(owner, {
            "name": "dispatch admission",
            "idempotency_key": "dispatch-admission-project",
        })[0]["project_id"]
        store = SQLiteAuthorityStore(repository)
        ledger = SQLiteSubmissionLedger(repository)
        run_id, attempt_1, attempt_2 = identifier(), identifier(), identifier()
        observed = utcnow()
        store.create(owner, project, run_id, attempt_1, identifier(), "generation-fixture",
                     observed, observed + timedelta(seconds=30))
        _legacy_dispatch(repository, owner, project, "ACKNOWLEDGED", generation=1,
                         run_id=run_id, attempt_id=attempt_1)
        with repository.transaction() as db:
            db.execute(
                "INSERT INTO controller_resume_verdicts"
                "(run_id,generation,attempt_id,decision,reason,result_sha256) VALUES(?,1,?,'NO_REFUSAL',NULL,?)",
                (run_id, "attempt-0001", "a" * 64),
            )
        processor, operation, intent, _ = _resume_operation(
            repository, owner, project, run_id, attempt_1, attempt_2, 2, 2,
        )

        with self.assertRaises(Problem):
            ledger.reserve(operation["record_id"], operation["payload"]["revision"], processor, intent)
        with repository._connection() as db:
            self.assertIsNone(repository._effect_intent(db, operation["record_id"]))
            self.assertEqual(db.execute("SELECT count(*) FROM scheduler_dispatches").fetchone()[0], 1)

    def test_real_reservation_requires_persisted_qraft_verdict_and_uses_dispatch_plan_snapshot(self):
        repository = SQLiteRepository(self.tmp_path / "dispatch-refusal.sqlite")
        owner = repository.ensure_principal("dispatch-refusal-owner")
        project = repository.create_project(owner, {
            "name": "dispatch refusal",
            "idempotency_key": "dispatch-refusal-project",
        })[0]["project_id"]
        store = SQLiteAuthorityStore(repository)
        ledger = SQLiteSubmissionLedger(repository)
        run_id, attempt_1, attempt_2 = identifier(), identifier(), identifier()
        observed = utcnow()
        first = store.create(owner, project, run_id, attempt_1, identifier(), "generation-fixture",
                             observed, observed + timedelta(seconds=60))
        _legacy_dispatch(repository, owner, project, "ACKNOWLEDGED", generation=1,
                         run_id=run_id, attempt_id=attempt_1)
        store.publish(
            owner, first, utcnow, lambda _db: None,
            resume_verdict={"run_id": run_id, "generation": 1, "attempt_id": "attempt-0001",
                            "decision": "NO_REFUSAL", "reason": None, "result_sha256": "a" * 64},
        )

        def retire_for_admission(record, owner_proof):
            retired = json.loads(canonical(record))
            retired["payload"]["lease_expires_at"] = None
            reseal(retired)
            native = {"source": "sacct", "active_allocation_absent": True, "state": "COMPLETED"}
            with repository.transaction() as db:
                db.execute(
                    "CREATE TABLE IF NOT EXISTS authority_retirements("
                    "run_id TEXT NOT NULL,generation INTEGER NOT NULL,native_proof TEXT NOT NULL,"
                    "owner_proof TEXT,PRIMARY KEY(run_id,generation))"
                )
                db.execute(
                    "INSERT INTO authority_retirements(run_id,generation,native_proof,owner_proof) VALUES(?,?,?,?)",
                    (record["payload"]["run_id"], record["payload"]["generation"],
                     canonical(native).decode(), owner_proof),
                )
                db.execute(
                    "UPDATE controller_authorities SET document=?,retired=1 "
                    "WHERE run_id=? AND generation=?",
                    (canonical(retired).decode(), record["payload"]["run_id"], record["payload"]["generation"]),
                )

        retire_for_admission(first, "CLOSED")
        processor_2, operation_2, intent_2, _ = _resume_operation(
            repository, owner, project, run_id, attempt_1, attempt_2, 2, 2,
        )
        ledger.reserve(operation_2["record_id"], operation_2["payload"]["revision"], processor_2, intent_2)
        _acknowledge_dispatch(repository, ledger, intent_2)
        second = store.create_generation(
            owner, project, run_id, attempt_2, identifier(), "generation-fixture",
            utcnow(), utcnow() + timedelta(seconds=60), 2,
        )
        store.publish(
            owner, second, utcnow, lambda _db: None,
            resume_verdict={"run_id": run_id, "generation": 2, "attempt_id": "attempt-0002",
                            "decision": "REFUSE", "reason": "RESUME_INPUTS_CHANGED",
                            "result_sha256": "b" * 64},
        )
        retire_for_admission(second, "OWNER_DEAD_BY_BOOT_CHANGE")

        with repository.transaction() as db:
            db.execute("DELETE FROM controller_resume_verdicts WHERE run_id=? AND generation=2", (run_id,))
        missing_processor, missing_operation, missing_intent, _ = _resume_operation(
            repository, owner, project, run_id, attempt_2, identifier(), 3, 2,
        )
        with self.assertRaises(Problem):
            ledger.reserve(missing_operation["record_id"], missing_operation["payload"]["revision"],
                           missing_processor, missing_intent)
        with repository._connection() as db:
            self.assertIsNone(repository._effect_intent(db, missing_operation["record_id"]))
        with repository.transaction() as db:
            db.execute(
                "INSERT INTO controller_resume_verdicts"
                "(run_id,generation,attempt_id,decision,reason,result_sha256) "
                "VALUES(?,2,'attempt-0002','REFUSE','RESUME_INPUTS_CHANGED',?)",
                (run_id, "b" * 64),
            )

        same_processor, same_operation, same_intent, _ = _resume_operation(
            repository, owner, project, run_id, attempt_2, identifier(), 3, 2,
        )
        with self.assertRaises(Problem):
            ledger.reserve(same_operation["record_id"], same_operation["payload"]["revision"],
                           same_processor, same_intent)
        with repository._connection() as db:
            self.assertIsNone(repository._effect_intent(db, same_operation["record_id"]))
            self.assertEqual(db.execute("SELECT count(*) FROM scheduler_dispatches WHERE run_id=?", (run_id,)).fetchone()[0], 2)

        next_processor, next_operation, next_intent, next_plan = _resume_operation(
            repository, owner, project, run_id, attempt_2, identifier(), 3, 3,
        )
        ledger.reserve(next_operation["record_id"], next_operation["payload"]["revision"],
                       next_processor, next_intent)
        replacement = json.loads(canonical(next_plan))
        replacement["payload"]["plan_revision"] = 5
        reseal(replacement)
        SQLiteReadModels(repository).put(owner, "RESUME_PLAN", replacement, expected_revision=4)
        with repository._connection() as db:
            self.assertEqual(ledger._generation_plan_revision(db, run_id, 3), 3)

    def test_next_authority_generation_requires_started_matching_dispatch_and_fences_prior_owner(self):
        repository = SQLiteRepository(self.tmp_path / "authority-generation.sqlite")
        owner = repository.ensure_principal("authority-generation-owner")
        project = repository.create_project(owner, {
            "name": "authority generation",
            "idempotency_key": "authority-generation-project",
        })[0]["project_id"]
        run_id, attempt_1, attempt_2 = identifier(), identifier(), identifier()
        store = SQLiteAuthorityStore(repository)
        observed = utcnow()
        first = store.create(
            owner, project, run_id, attempt_1, identifier(), "generation-fixture",
            observed, observed + timedelta(seconds=30),
        )
        retired = json.loads(canonical(first))
        retired["payload"]["lease_expires_at"] = None
        reseal(retired)
        with repository.transaction() as db:
            db.execute(
                "UPDATE controller_authorities SET document=?,retired=1 WHERE run_id=? AND generation=1",
                (canonical(retired).decode(), run_id),
            )

        SQLiteSubmissionLedger(repository)
        _legacy_dispatch(repository, owner, project, "RESERVED", generation=2, run_id=run_id, attempt_id=attempt_2)
        with self.assertRaises(Problem) as refused:
            store.create_generation(
                owner, project, run_id, attempt_2, identifier(), "generation-fixture",
                observed, observed + timedelta(seconds=30), 2,
            )
        self.assertEqual(refused.exception.code, "PRECONDITION_FAILED")
        with repository.transaction() as db:
            db.execute("UPDATE scheduler_dispatches SET phase='DISPATCH_STARTED' WHERE run_id=? AND generation=2", (run_id,))
        def create(_):
            try:
                return store.create_generation(
                    owner, project, run_id, attempt_2, identifier(), "generation-fixture",
                    observed, observed + timedelta(seconds=30), 2,
                )
            except Problem as error:
                return error
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(create, range(2)))
        accepted = [result for result in results if isinstance(result, dict)]
        refused = [result for result in results if isinstance(result, Problem)]
        self.assertEqual(len(accepted), 1)
        self.assertEqual(len(refused), 1)
        self.assertEqual(refused[0].code, "PRECONDITION_FAILED")
        second = accepted[0]
        self.assertEqual(second["payload"]["generation"], 2)
        stale_authority = LocalAuthority(
            store, owner, first, lambda: observed, lambda: 0.0, 30.0,
        )
        self.assertFalse(stale_authority.authority_check(SimpleNamespace(
            generation="1", runtime_fingerprint="a" * 64,
        )))
        with self.assertRaises(Problem):
            store.check(owner, first, observed)
        writes = []
        with self.assertRaises(Problem):
            store.publish(owner, first, lambda: observed, lambda db: writes.append("stale"))
        self.assertEqual(writes, [])

    def test_authority_v2_migration_preserves_documents_and_marks_retirement_idempotently(self):
        check_authority_v2_migration_preserves_documents_and_marks_retirement_idempotently(self.tmp_path)

    def test_authority_v2_migration_aborts_non_v1_documents_without_partial_schema_change(self):
        check_authority_v2_migration_aborts_non_v1_documents_without_partial_schema_change(self.tmp_path)

    def test_submission_v2_migration_preserves_every_phase_receipt_and_rpc_foreign_key(self):
        check_submission_v2_migration_preserves_every_phase_receipt_and_rpc_foreign_key(self.tmp_path)

    def test_submission_v2_migration_aborts_non_v1_intents_without_partial_schema_change(self):
        check_submission_v2_migration_aborts_non_v1_intents_without_partial_schema_change(self.tmp_path)
