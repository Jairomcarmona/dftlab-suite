"""Adenda 12 generation admission and explicit v2 storage migrations."""

import json
from pathlib import Path
import tempfile
import unittest

from dftlab_platform.authority import stamp, utcnow
from dftlab_platform.authority_storage import migrate_authority_v2
from dftlab_platform.contracts import canonical, resource_json
from dftlab_platform.domain import envelope, identifier, now, reseal
from dftlab_platform.generation_admission import evaluate_generation_admission
from dftlab_platform.storage import SQLiteRepository
from dftlab_platform.submission_storage import intent_hash, migrate_submission_v2
from dftlab_platform.submissions import BINDINGS


def check_generation_admission_matches_the_contract_vectors():
    vectors = resource_json("fixtures/authority-generations/cases.json")
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


def _legacy_dispatch(repository, owner, project, phase, *, generation=1):
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
    payload.update(effect_intent_id=identifier(), operation_id=operation["record_id"], run_id=identifier(),
                   attempt_id=identifier(), attempt_token=identifier(), authority_generation=generation,
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
        db.execute(
            "INSERT INTO scheduler_dispatches VALUES(?,?,?,?,?,?)",
            (operation["record_id"], stored["payload"]["run_id"], stored["payload"]["attempt_token"],
             intent_hash(stored), phase, receipt_text),
        )
        if phase in {"DISPATCH_STARTED", "ACKNOWLEDGED"}:
            db.execute("INSERT INTO scheduler_rpc_entries VALUES(?,?,?)",
                       (operation["record_id"], intent_hash(stored), now()))
    return pending


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

    def test_authority_v2_migration_preserves_documents_and_marks_retirement_idempotently(self):
        check_authority_v2_migration_preserves_documents_and_marks_retirement_idempotently(self.tmp_path)

    def test_authority_v2_migration_aborts_non_v1_documents_without_partial_schema_change(self):
        check_authority_v2_migration_aborts_non_v1_documents_without_partial_schema_change(self.tmp_path)

    def test_submission_v2_migration_preserves_every_phase_receipt_and_rpc_foreign_key(self):
        check_submission_v2_migration_preserves_every_phase_receipt_and_rpc_foreign_key(self.tmp_path)

    def test_submission_v2_migration_aborts_non_v1_intents_without_partial_schema_change(self):
        check_submission_v2_migration_aborts_non_v1_intents_without_partial_schema_change(self.tmp_path)
