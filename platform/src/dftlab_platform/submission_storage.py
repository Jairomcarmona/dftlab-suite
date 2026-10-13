"""SQLite dispatch ledger; no retry and no claims of scheduler absence."""
import hashlib
import sqlite3

from .contracts import canonical, loads
from .domain import Problem, now
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
                try:
                    db.execute(
                        "INSERT INTO scheduler_dispatches"
                        "(operation_id,run_id,generation,attempt_token,intent_hash,phase,receipt) "
                        "VALUES(?,?,?,?,?,?,NULL)",
                        (operation_id, stored["payload"]["run_id"], stored["payload"]["authority_generation"],
                         stored["payload"]["attempt_token"], intent_hash(stored), "RESERVED"),
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
