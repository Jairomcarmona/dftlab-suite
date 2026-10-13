"""SQLite dispatch ledger; no retry and no claims of scheduler absence."""
import hashlib
import re
import sqlite3

from .contracts import canonical, loads
from .domain import Problem, now
from .generation_admission import evaluate_generation_admission
from .submissions import check_receipt


def intent_hash(intent):
    return hashlib.sha256(canonical(intent)).hexdigest()


def _create_submission_v2(db, *, table="scheduler_dispatches"):
    db.execute(
        f"CREATE TABLE {table}("
        "operation_id TEXT PRIMARY KEY REFERENCES operations(operation_id), "
        "run_id TEXT NOT NULL, generation INTEGER NOT NULL CHECK(generation >= 1), "
        "attempt_token TEXT NOT NULL UNIQUE, intent_hash TEXT NOT NULL, "
        "phase TEXT NOT NULL CHECK(phase IN ('RESERVED','DISPATCH_STARTED','ACKNOWLEDGED')), receipt TEXT, "
        "UNIQUE(run_id,generation))"
    )


def _create_dispatch_plan_snapshots(db):
    db.execute(
        "CREATE TABLE IF NOT EXISTS scheduler_dispatch_plan_snapshots("
        "operation_id TEXT PRIMARY KEY REFERENCES scheduler_dispatches(operation_id), "
        "run_id TEXT NOT NULL, generation INTEGER NOT NULL CHECK(generation >= 1), "
        "plan_revision INTEGER NOT NULL CHECK(plan_revision >= 1), "
        "UNIQUE(run_id,generation))"
    )


def _backfill_generation_one_plan_snapshots(db):
    _create_dispatch_plan_snapshots(db)
    db.execute(
        "INSERT OR IGNORE INTO scheduler_dispatch_plan_snapshots"
        "(operation_id,run_id,generation,plan_revision) "
        "SELECT operation_id,run_id,generation,1 FROM scheduler_dispatches WHERE generation=1"
    )


def migrate_submission_v2(repository):
    """Explicitly rebuild v1 dispatch rows with a generation key.

    Intents, receipts, and scheduler RPC records are copied byte-for-byte.
    The generation is read from the stored intent; anything other than 1 is
    not representable by the legacy unique-per-run table and aborts migration.
    """
    with repository.transaction() as db:
        db.execute("CREATE TABLE IF NOT EXISTS submission_migrations(version INTEGER PRIMARY KEY)")
        versions = [row[0] for row in db.execute("SELECT version FROM submission_migrations ORDER BY version")]
        if versions == [1, 2]:
            _backfill_generation_one_plan_snapshots(db)
            return False
        if versions != [1]:
            raise ValueError("Explicit submission migration required")

        rpc_versions = [row[0] for row in db.execute("SELECT version FROM scheduler_rpc_migrations ORDER BY version")]
        if rpc_versions != [1]:
            raise ValueError("Explicit scheduler RPC migration required")
        old_rows = db.execute(
            "SELECT operation_id,run_id,attempt_token,intent_hash,phase,receipt "
            "FROM scheduler_dispatches ORDER BY operation_id"
        ).fetchall()
        migrated = []
        for operation_id, run_id, attempt_token, stored_hash, phase, receipt_text in old_rows:
            intent = repository._effect_intent(db, operation_id)
            if intent is None:
                raise ValueError("Submission v2 migration requires every dispatch to have its stored effect intent")
            payload = intent["payload"]
            generation = payload["authority_generation"]
            if type(generation) is not int or generation != 1:
                raise ValueError("Submission v2 migration requires every legacy intent to be generation 1")
            if (payload["run_id"] != run_id or payload["attempt_token"] != attempt_token
                    or intent_hash(intent) != stored_hash):
                raise ValueError("Submission v2 migration found a mismatched legacy intent")
            receipt = loads(receipt_text) if receipt_text is not None else None
            if (phase == "ACKNOWLEDGED") != (receipt is not None):
                raise ValueError("Submission v2 migration found an inconsistent receipt")
            if receipt is not None:
                check_receipt(repository.contracts, intent, receipt, {"ACCEPTED", "RECONCILED_FOUND"})
            migrated.append((operation_id, run_id, generation, attempt_token, stored_hash, phase, receipt_text))

        rpc_rows = db.execute(
            "SELECT operation_id,intent_hash,entered_at FROM scheduler_rpc_entries ORDER BY operation_id"
        ).fetchall()
        for operation_id, rpc_hash, _entered_at in rpc_rows:
            if not any(row[0] == operation_id and row[4] == rpc_hash for row in migrated):
                raise ValueError("Submission v2 migration found a mismatched scheduler RPC entry")

        _create_submission_v2(db, table="scheduler_dispatches_v2")
        db.execute(
            "CREATE TABLE scheduler_rpc_entries_v2("
            "operation_id TEXT PRIMARY KEY REFERENCES scheduler_dispatches_v2(operation_id), "
            "intent_hash TEXT NOT NULL, entered_at TEXT NOT NULL)"
        )
        db.executemany(
            "INSERT INTO scheduler_dispatches_v2"
            "(operation_id,run_id,generation,attempt_token,intent_hash,phase,receipt) VALUES(?,?,?,?,?,?,?)",
            migrated,
        )
        db.executemany("INSERT INTO scheduler_rpc_entries_v2 VALUES(?,?,?)", rpc_rows)
        db.execute("DROP TABLE scheduler_rpc_entries")
        db.execute("DROP TABLE scheduler_dispatches")
        db.execute("ALTER TABLE scheduler_dispatches_v2 RENAME TO scheduler_dispatches")
        db.execute("ALTER TABLE scheduler_rpc_entries_v2 RENAME TO scheduler_rpc_entries")
        _create_dispatch_plan_snapshots(db)
        db.executemany(
            "INSERT INTO scheduler_dispatch_plan_snapshots"
            "(operation_id,run_id,generation,plan_revision) VALUES(?,?,?,1)",
            ((row[0], row[1], row[2]) for row in migrated),
        )
        db.execute("INSERT INTO submission_migrations(version) VALUES(2)")
        return True


class SQLiteSubmissionLedger:
    def __init__(self, repository):
        self.repository, self.contracts = repository, repository.contracts
        with repository.transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS submission_migrations(version INTEGER PRIMARY KEY)")
            versions = [row[0] for row in db.execute("SELECT version FROM submission_migrations ORDER BY version")]
            if not versions:
                _create_submission_v2(db)
                db.executemany("INSERT INTO submission_migrations(version) VALUES(?)", ((1,), (2,)))
            elif versions == [1]:
                raise ValueError("Explicit submission migration required")
            elif versions != [1, 2]:
                raise ValueError("Explicit submission migration required")
            _backfill_generation_one_plan_snapshots(db)
            db.execute("CREATE TABLE IF NOT EXISTS scheduler_rpc_migrations(version INTEGER PRIMARY KEY)")
            rpc_versions = [row[0] for row in db.execute("SELECT version FROM scheduler_rpc_migrations ORDER BY version")]
            if not rpc_versions:
                db.execute("CREATE TABLE scheduler_rpc_entries(operation_id TEXT PRIMARY KEY REFERENCES scheduler_dispatches(operation_id), intent_hash TEXT NOT NULL, entered_at TEXT NOT NULL)")
                db.execute("INSERT INTO scheduler_rpc_migrations VALUES(1)")
            elif rpc_versions != [1]:
                raise ValueError("Explicit scheduler RPC migration required")

    def _row(self, db, intent):
        self.contracts.validate("effect-intent", intent)
        row = db.execute("SELECT intent_hash,phase,receipt FROM scheduler_dispatches WHERE operation_id=?", (intent["payload"]["operation_id"],)).fetchone()
        stored = self.repository._effect_intent(db, intent["payload"]["operation_id"])
        if row is None or stored != intent or row[0] != intent_hash(intent) or intent["integrity"]["status"] != "VERIFIED":
            raise Problem("PRECONDITION_FAILED")
        receipt = loads(row[2]) if row[2] else None
        if (row[1] == "ACKNOWLEDGED") != (receipt is not None):
            raise Problem("PRECONDITION_FAILED")
        if receipt is not None:
            check_receipt(self.contracts, intent, receipt, {"ACCEPTED", "RECONCILED_FOUND"})
        return row[1], receipt

    def _generation_admission_case(self, db, operation_id, intent):
        """Build L.5 state from the same transaction as the new reservation."""
        payload = intent["payload"]
        run_id = payload["run_id"]
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        authorities = []
        if "controller_authorities" in tables:
            rows = db.execute(
                "SELECT generation,document,retired FROM controller_authorities "
                "WHERE run_id=? ORDER BY generation",
                (run_id,),
            ).fetchall()
            latest_generation = max((row[0] for row in rows), default=0)
            for generation, document, retired in rows:
                record = self.contracts.validate("controller-authority-record", loads(document))
                if (record["project_id"] != intent["project_id"]
                        or record["payload"]["run_id"] != run_id
                        or record["payload"]["generation"] != generation):
                    raise Problem("PRECONDITION_FAILED")
                proof = None
                if "authority_retirements" in tables:
                    columns = {row[1] for row in db.execute("PRAGMA table_info(authority_retirements)")}
                    if {"native_proof", "owner_proof"} <= columns:
                        retirement = db.execute(
                            "SELECT native_proof,owner_proof FROM authority_retirements "
                            "WHERE run_id=? AND generation=?",
                            (run_id, generation),
                        ).fetchone()
                        if retirement is not None:
                            native = loads(retirement[0])
                            terminal_states = {
                                "COMPLETED", "FAILED", "CANCELLED", "TIMEOUT", "NODE_FAIL",
                                "OUT_OF_MEMORY", "PREEMPTED", "BOOT_FAIL", "DEADLINE", "REVOKED",
                            }
                            proof = {
                                "sacct_terminal": (
                                    native.get("source") == "sacct"
                                    and native.get("active_allocation_absent") is True
                                    and native.get("state") in terminal_states
                                ),
                                "owner_proof": retirement[1] or "UNPROVEN",
                            }
                authorities.append({
                    "generation": generation,
                    "attempt_id": record["payload"]["attempt_id"],
                    "retired": bool(retired),
                    "proof": proof,
                    "plan_revision": self._generation_plan_revision(db, run_id, generation),
                    "verdict": (
                        self._generation_verdict(db, run_id, generation)
                        if generation == latest_generation else None
                    ),
                })
        dispatches = []
        if "scheduler_dispatches" in tables:
            dispatches = [
                {"generation": generation, "phase": phase}
                for generation, phase in db.execute(
                    "SELECT generation,phase FROM scheduler_dispatches WHERE run_id=? ORDER BY generation",
                    (run_id,),
                )
            ]
        resume_plan = self._resume_plan_for_operation(db, operation_id, intent)
        return {
            "generations": authorities,
            "dispatches": dispatches,
            "request": {"kind": "DISPATCH_RESERVE", "generation": payload["authority_generation"]},
            "resume_plan": resume_plan,
        }

    def _generation_plan_revision(self, db, run_id, generation):
        """Return the revision snapshotted when this dispatch was reserved."""
        dispatch = db.execute(
            "SELECT operation_id FROM scheduler_dispatches WHERE run_id=? AND generation=?",
            (run_id, generation),
        ).fetchone()
        if dispatch is None:
            return 1
        snapshot = db.execute(
            "SELECT run_id,generation,plan_revision FROM scheduler_dispatch_plan_snapshots "
            "WHERE operation_id=?",
            (dispatch[0],),
        ).fetchone()
        if (snapshot is None or snapshot[0] != run_id or snapshot[1] != generation
                or type(snapshot[2]) is not int or snapshot[2] < 1):
            raise Problem("PRECONDITION_FAILED")
        return snapshot[2]

    @staticmethod
    def _generation_verdict(db, run_id, generation):
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "controller_resume_verdicts" not in tables:
            raise Problem("PRECONDITION_FAILED")
        row = db.execute(
            "SELECT attempt_id,decision,reason,result_sha256 FROM controller_resume_verdicts "
            "WHERE run_id=? AND generation=?",
            (run_id, generation),
        ).fetchone()
        if (row is None or row[0] != f"attempt-{generation:04d}"
                or row[1] not in {"REFUSE", "NO_REFUSAL"}
                or (row[1] == "REFUSE" and not row[2])
                or (row[1] == "NO_REFUSAL" and row[2] is not None)
                or type(row[3]) is not str or re.fullmatch(r"[0-9a-f]{64}", row[3]) is None):
            raise Problem("PRECONDITION_FAILED")
        return "REFUSE" if row[1] == "REFUSE" else None

    def _resume_plan_for_operation(self, db, operation_id, intent):
        operation = db.execute(
            "SELECT request FROM operations WHERE operation_id=?",
            (operation_id,),
        ).fetchone()
        if operation is None:
            raise Problem("PRECONDITION_FAILED")
        request = loads(operation[0])
        if request.get("action") == "SUBMIT_RUN":
            if intent["payload"]["authority_generation"] != 1:
                raise Problem("PRECONDITION_FAILED")
            return None
        if request.get("action") != "EXECUTE_RESUME_PLAN":
            raise Problem("PRECONDITION_FAILED")
        if intent["payload"]["authority_generation"] < 2:
            raise Problem("PRECONDITION_FAILED")
        target = request.get("target", {})
        row = db.execute(
            "SELECT revision,document FROM resources WHERE resource_id=? AND kind='RESUME_PLAN' AND project_id=?",
            (target.get("id"), intent["project_id"]),
        ).fetchone()
        if (row is None or row[1] is None
                or type(row[0]) is not int
                or type(target.get("expected_revision")) is not int
                or row[0] != target["expected_revision"] + 1):
            raise Problem("PRECONDITION_FAILED")
        plan = self.contracts.validate("resume-plan", loads(row[1]))
        if (plan["payload"]["run_id"] != intent["payload"]["run_id"]
                or plan["payload"]["resume_plan_id"] != target.get("id")
                or plan["payload"]["plan_revision"] != target["expected_revision"]):
            raise Problem("PRECONDITION_FAILED")
        return {
            "from_attempt_id": plan["payload"]["from_attempt_id"],
            "plan_revision": plan["payload"]["plan_revision"],
        }

    def reserve(self, operation_id, revision, processor_id, intent):
        # Reservation and original write-ahead EffectIntent share a FULL/WAL
        # transaction. A second operation for the same native run is rejected
        # before either an intent or scheduler effect can be committed for it.
        with self.repository.transaction() as db:
            stored = self.repository._persist_effect_intent(db, operation_id, revision, processor_id, intent)
            existing = db.execute("SELECT 1 FROM scheduler_dispatches WHERE operation_id=?", (operation_id,)).fetchone()
            if existing:
                self._row(db, stored)
            else:
                case = self._generation_admission_case(db, operation_id, stored)
                if evaluate_generation_admission(3, case)["decision"] != "ADMIT":
                    raise Problem("PRECONDITION_FAILED")
                resume_plan = self._resume_plan_for_operation(db, operation_id, stored)
                plan_revision = 1 if resume_plan is None else resume_plan["plan_revision"]
                try:
                    db.execute(
                        "INSERT INTO scheduler_dispatches"
                        "(operation_id,run_id,generation,attempt_token,intent_hash,phase,receipt) "
                        "VALUES(?,?,?,?,?,?,NULL)",
                        (operation_id, stored["payload"]["run_id"], stored["payload"]["authority_generation"],
                         stored["payload"]["attempt_token"], intent_hash(stored), "RESERVED"),
                    )
                    db.execute(
                        "INSERT INTO scheduler_dispatch_plan_snapshots"
                        "(operation_id,run_id,generation,plan_revision) VALUES(?,?,?,?)",
                        (operation_id, stored["payload"]["run_id"],
                         stored["payload"]["authority_generation"], plan_revision),
                    )
                except sqlite3.IntegrityError:
                    raise Problem("PRECONDITION_FAILED") from None
            return stored

    def start(self, intent):
        with self.repository.transaction() as db:
            phase, receipt = self._row(db, intent)
            if phase == "ACKNOWLEDGED":
                return receipt
            if phase != "RESERVED":
                raise Problem("PRECONDITION_FAILED")
            db.execute("UPDATE scheduler_dispatches SET phase='DISPATCH_STARTED' WHERE operation_id=?", (intent["payload"]["operation_id"],))
            return None

    def confirm(self, intent, receipt):
        check_receipt(self.contracts, intent, receipt, {"ACCEPTED", "RECONCILED_FOUND"})
        with self.repository.transaction() as db:
            phase, previous = self._row(db, intent)
            if phase == "RESERVED":
                raise Problem("PRECONDITION_FAILED")
            if previous is not None:
                # Reconciliation may reseal a fresh receipt while keeping the
                # actual job identity/bindings. Never replace that identity.
                if previous["payload"]["job"] != receipt["payload"]["job"]:
                    raise Problem("PRECONDITION_FAILED")
                if previous["payload"]["status"] == "RECONCILED_FOUND":
                    return previous
            db.execute("UPDATE scheduler_dispatches SET phase='ACKNOWLEDGED',receipt=? WHERE operation_id=?", (canonical(receipt).decode(), intent["payload"]["operation_id"]))
            return receipt

    def enter_rpc(self, intent, processor_id):
        """Concrete site's mandatory one-shot authorization before sbatch.

        A caller cannot bypass the durable gateway by presenting an in-memory
        envelope. This commit never authorizes a retry even if no child starts.
        It also requires the exact live processor claim and RUNNING operation.
        """
        with self.repository.transaction() as db:
            self.repository._execution_ready(db)
            phase, _ = self._row(db, intent)
            row = db.execute("SELECT o.document,b.processor_id FROM operations o JOIN outbox b ON o.operation_id=b.operation_id WHERE o.operation_id=?", (intent["payload"]["operation_id"],)).fetchone()
            if phase != "DISPATCH_STARTED" or row is None or row[1] != processor_id or self.repository._operation_document(row[0])["payload"]["state"] != "RUNNING":
                raise Problem("PRECONDITION_FAILED")
            try:
                db.execute("INSERT INTO scheduler_rpc_entries VALUES(?,?,?)", (intent["payload"]["operation_id"], intent_hash(intent), now()))
            except sqlite3.IntegrityError:
                raise Problem("PRECONDITION_FAILED") from None

    def snapshot(self, owner, operation_id):
        self.repository.operation(owner, operation_id)
        with self.repository._connection() as db:
            intent = self.repository._effect_intent(db, operation_id)
            if intent is None:
                raise Problem("NOT_FOUND")
            phase, receipt = self._row(db, intent)
            return intent, phase, receipt
