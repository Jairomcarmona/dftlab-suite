"""SQLite local authority adapter, replaceable behind AuthorityStore."""
import re

from .authority import instant, stamp
from .contracts import BASE, canonical, loads
from .domain import Problem, envelope, reseal
from .generation_admission import evaluate_generation_admission

MAX_ATTEMPTS = 3
_RESUME_REFUSALS = {
    "RESUME_EVIDENCE_INVALID",
    "RESUME_INPUTS_CHANGED",
    "RESUME_STATUS_UNRECOGNIZED",
    "CHECKPOINT_IDENTITY_MISMATCH",
    "LEDGER_CHECKPOINT_INCONSISTENT",
    "SETTLED_FAILURE_PRESENT",
    "SETTLED_EVIDENCE_INVALID",
}


def _create_controller_resume_verdicts(db):
    db.execute(
        "CREATE TABLE IF NOT EXISTS controller_resume_verdicts("
        "run_id TEXT NOT NULL, generation INTEGER NOT NULL, attempt_id TEXT NOT NULL, "
        "decision TEXT NOT NULL CHECK(decision IN ('REFUSE','NO_REFUSAL')), "
        "reason TEXT, result_sha256 TEXT NOT NULL, "
        "CHECK((decision='REFUSE' AND reason IN ("
        "'RESUME_EVIDENCE_INVALID','RESUME_INPUTS_CHANGED','RESUME_STATUS_UNRECOGNIZED',"
        "'CHECKPOINT_IDENTITY_MISMATCH','LEDGER_CHECKPOINT_INCONSISTENT',"
        "'SETTLED_FAILURE_PRESENT','SETTLED_EVIDENCE_INVALID')) OR "
        "(decision='NO_REFUSAL' AND reason IS NULL)), "
        "PRIMARY KEY(run_id,generation), "
        "FOREIGN KEY(run_id,generation) REFERENCES controller_authorities(run_id,generation))"
    )


def _create_authority_v2(db):
    db.execute(
        "CREATE TABLE controller_authorities("
        "run_id TEXT NOT NULL, generation INTEGER NOT NULL CHECK(generation >= 1), "
        "project_id TEXT NOT NULL REFERENCES projects(project_id), "
        "owner_id TEXT NOT NULL REFERENCES principals(principal_id), document TEXT NOT NULL, "
        "last_observed_at TEXT NOT NULL, retired INTEGER NOT NULL DEFAULT 0 CHECK(retired IN (0,1)), "
        "PRIMARY KEY(run_id,generation))"
    )
    db.execute(
        "CREATE UNIQUE INDEX controller_authorities_one_active_run "
        "ON controller_authorities(run_id) WHERE retired=0"
    )
    _create_controller_resume_verdicts(db)


def migrate_authority_v2(repository):
    """Explicitly migrate v1 authority rows to generation-keyed storage.

    Stored documents are copied verbatim. A document outside generation 1
    cannot be inferred from the v1 table and aborts the whole transaction.
    """
    with repository.transaction() as db:
        db.execute("CREATE TABLE IF NOT EXISTS authority_migrations(version INTEGER PRIMARY KEY)")
        versions = [row[0] for row in db.execute("SELECT version FROM authority_migrations ORDER BY version")]
        if versions == [1, 2]:
            _create_controller_resume_verdicts(db)
            return False
        if versions != [1]:
            raise ValueError("Explicit authority migration required")

        rows = db.execute(
            "SELECT run_id,project_id,owner_id,document,last_observed_at FROM controller_authorities ORDER BY run_id"
        ).fetchall()
        migrated = []
        for run_id, project_id, owner_id, document, last_observed_at in rows:
            record = repository.contracts.validate("controller-authority-record", loads(document))
            payload = record["payload"]
            if type(payload["generation"]) is not int or payload["generation"] != 1:
                raise ValueError("Authority v2 migration requires every legacy document to be generation 1")
            if payload["run_id"] != run_id or record["project_id"] != project_id:
                raise ValueError("Authority v2 migration found a mismatched legacy row")
            retired = int(payload["lease_expires_at"] is None)
            migrated.append((run_id, 1, project_id, owner_id, document, last_observed_at, retired))

        db.execute("ALTER TABLE controller_authorities RENAME TO controller_authorities_v1")
        _create_authority_v2(db)
        db.executemany(
            "INSERT INTO controller_authorities"
            "(run_id,generation,project_id,owner_id,document,last_observed_at,retired) "
            "VALUES(?,?,?,?,?,?,?)",
            migrated,
        )
        db.execute("DROP TABLE controller_authorities_v1")
        db.execute("INSERT INTO authority_migrations(version) VALUES(2)")
        return True


class SQLiteAuthorityStore:
    def __init__(self, repository):
        self.repository, self.contracts = repository, repository.contracts
        with repository.transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS authority_migrations(version INTEGER PRIMARY KEY)")
            versions = [row[0] for row in db.execute("SELECT version FROM authority_migrations ORDER BY version")]
            if not versions:
                _create_authority_v2(db)
                db.executemany("INSERT INTO authority_migrations(version) VALUES(?)", ((1,), (2,)))
            elif versions == [1]:
                raise ValueError("Explicit authority migration required")
            elif versions != [1, 2]:
                raise ValueError("Explicit authority migration required")
            _create_controller_resume_verdicts(db)

    def create(self, owner, project, run, attempt, instance, scope, observed, expires):
        stamp(observed)
        if expires <= observed:
            raise ValueError("Lease expiry must follow observation")
        for value in (run, attempt, instance):
            self.contracts.validate_ref(BASE+"schemas/defs.schema.json#/$defs/id", value)
        with self.repository.transaction() as db:
            self.repository._execution_ready(db)
            self.repository._project(db, owner, project)
            # No auto takeover even if expiry passed or the owner crashed.
            # Terminal proof and a future explicit recovery port are required.
            if db.execute("SELECT 1 FROM controller_authorities WHERE run_id=?", (run,)).fetchone():
                raise Problem("PRECONDITION_FAILED")
            document = envelope("controller-authority-record", project,
                                {"run_id": run, "attempt_id": attempt, "owner_instance_id": instance,
                                 "generation": 1, "fencing": {"mechanism": "SITE_LOCK", "checked_at": "NONE"},
                                 "automatic_takeover": "DISABLED", "site_scope": scope,
                                 "lease_expires_at": stamp(expires), "validity_evidence": [], "termination_evidence": []},
                                contracts=self.contracts)
            document["created_at"] = stamp(observed)
            reseal(document)
            self.contracts.validate("controller-authority-record", document)
            db.execute(
                "INSERT INTO controller_authorities"
                "(run_id,generation,project_id,owner_id,document,last_observed_at,retired) "
                "VALUES(?,1,?,?,?,?,0)",
                (run, project, owner.principal_id, canonical(document).decode(), stamp(observed)),
            )
            return document

    def create_generation(self, owner, project, run, attempt, instance, scope, observed, expires, generation):
        """Create an explicitly admitted next generation under the same run lock.

        The legacy `create` call remains the generation-one local-authority
        entry point. Later generations are admitted only when their durable
        dispatch has started and the prior generation is already retired.
        """
        if type(generation) is not int or generation < 2 or generation > MAX_ATTEMPTS:
            raise Problem("PRECONDITION_FAILED")
        stamp(observed)
        if expires <= observed:
            raise ValueError("Lease expiry must follow observation")
        for value in (run, attempt, instance):
            self.contracts.validate_ref(BASE+"schemas/defs.schema.json#/$defs/id", value)
        with self.repository.transaction() as db:
            self.repository._execution_ready(db)
            self.repository._project(db, owner, project)
            rows = db.execute(
                "SELECT generation,document,retired FROM controller_authorities WHERE run_id=? ORDER BY generation",
                (run,),
            ).fetchall()
            generations = []
            for number, document, retired in rows:
                record = self.contracts.validate("controller-authority-record", loads(document))
                if record["project_id"] != project or record["payload"]["generation"] != number:
                    raise Problem("PRECONDITION_FAILED")
                generations.append({
                    "generation": number,
                    "attempt_id": record["payload"]["attempt_id"],
                    "retired": bool(retired),
                    "proof": None,
                    "plan_revision": 1,
                    "verdict": None,
                })
            dispatches = []
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if "scheduler_dispatches" in tables and "effect_intents" in tables:
                candidates = db.execute(
                    "SELECT operation_id,generation,phase FROM scheduler_dispatches "
                    "WHERE run_id=? ORDER BY generation",
                    (run,),
                ).fetchall()
                for operation_id, number, phase in candidates:
                    intent = self.repository._effect_intent(db, operation_id)
                    if intent is not None and intent["payload"]["attempt_id"] == attempt:
                        if (intent["payload"]["run_id"] != run
                                or intent["payload"]["authority_generation"] != number):
                            raise Problem("PRECONDITION_FAILED")
                        dispatches.append({"generation": number, "phase": phase})
            case = {
                "generations": generations,
                "dispatches": dispatches,
                "request": {"kind": "AUTHORITY_CREATE", "generation": generation},
                "resume_plan": None,
            }
            if evaluate_generation_admission(MAX_ATTEMPTS, case)["decision"] != "ADMIT":
                raise Problem("PRECONDITION_FAILED")
            document = envelope("controller-authority-record", project,
                                {"run_id": run, "attempt_id": attempt, "owner_instance_id": instance,
                                 "generation": generation, "fencing": {"mechanism": "SITE_LOCK", "checked_at": "NONE"},
                                 "automatic_takeover": "DISABLED", "site_scope": scope,
                                 "lease_expires_at": stamp(expires), "validity_evidence": [], "termination_evidence": []},
                                contracts=self.contracts)
            document["created_at"] = stamp(observed)
            reseal(document)
            self.contracts.validate("controller-authority-record", document)
            db.execute(
                "INSERT INTO controller_authorities"
                "(run_id,generation,project_id,owner_id,document,last_observed_at,retired) "
                "VALUES(?,?,?,?,?,?,0)",
                (run, generation, project, owner.principal_id, canonical(document).decode(), stamp(observed)),
            )
            return document

    def _checked(self, db, owner, record, observed):
        self.repository._execution_ready(db)
        self.contracts.validate("controller-authority-record", record)
        self.repository._project(db, owner, record["project_id"])
        payload = record["payload"]
        row = db.execute(
            "SELECT project_id,owner_id,document,last_observed_at,retired FROM controller_authorities "
            "WHERE run_id=? AND generation=?",
            (payload["run_id"], payload["generation"]),
        ).fetchone()
        if row is None or row[0] != record["project_id"] or row[1] != owner.principal_id:
            raise Problem("NOT_FOUND")
        latest = db.execute(
            "SELECT MAX(generation) FROM controller_authorities WHERE run_id=?",
            (payload["run_id"],),
        ).fetchone()[0]
        if latest != payload["generation"]:
            raise Problem("PRECONDITION_FAILED")
        stored = self.contracts.validate("controller-authority-record", loads(row[2]))
        if stored != record or stored["integrity"]["status"] != "VERIFIED" or payload["lease_expires_at"] is None or row[4] != 0:
            raise Problem("PRECONDITION_FAILED")
        # A backward wall clock must not resurrect an old record. Heartbeats
        # advance an internal clock floor; monotonic expiry is checked too.
        if observed < instant(row[3]) or observed >= instant(payload["lease_expires_at"]):
            raise Problem("PRECONDITION_FAILED")
        return stored

    def check(self, owner, record, observed):
        with self.repository._connection() as db:
            self._checked(db, owner, record, observed)

    def renew(self, owner, record, observed, expires):
        if expires <= observed:
            raise ValueError("Lease expiry must follow observation")
        with self.repository.transaction() as db:
            stored = self._checked(db, owner, record, observed)
            stored["payload"]["lease_expires_at"] = stamp(expires)
            reseal(stored)
            self.contracts.validate("controller-authority-record", stored)
            db.execute(
                "UPDATE controller_authorities SET document=?,last_observed_at=? WHERE run_id=? AND generation=?",
                (canonical(stored).decode(), stamp(observed), record["payload"]["run_id"], record["payload"]["generation"]),
            )
            return stored

    def publish(self, owner, record, clock, writer, *, resume_verdict=None):
        with self.repository.transaction() as db:
            self._checked(db, owner, record, clock())
            result = writer(db)
            if resume_verdict is not None:
                verdict = dict(resume_verdict) if isinstance(resume_verdict, dict) else None
                payload = record["payload"]
                if verdict is None or set(verdict) != {
                    "run_id", "generation", "attempt_id", "decision", "reason", "result_sha256",
                }:
                    raise Problem("PRECONDITION_FAILED")
                decision, reason = verdict["decision"], verdict["reason"]
                if (verdict["run_id"] != payload["run_id"]
                        or type(verdict["generation"]) is not int
                        or verdict["generation"] != payload["generation"]
                        or verdict["attempt_id"] != f"attempt-{payload['generation']:04d}"
                        or type(decision) is not str or decision not in {"REFUSE", "NO_REFUSAL"}
                        or (decision == "REFUSE" and (type(reason) is not str or reason not in _RESUME_REFUSALS))
                        or (decision == "NO_REFUSAL" and reason is not None)
                        or type(verdict["result_sha256"]) is not str
                        or re.fullmatch(r"[0-9a-f]{64}", verdict["result_sha256"]) is None):
                    raise Problem("PRECONDITION_FAILED")
                values = (verdict["attempt_id"], verdict["decision"], verdict["reason"], verdict["result_sha256"])
                previous = db.execute(
                    "SELECT attempt_id,decision,reason,result_sha256 FROM controller_resume_verdicts "
                    "WHERE run_id=? AND generation=?",
                    (verdict["run_id"], verdict["generation"]),
                ).fetchone()
                if previous is not None and tuple(previous) != values:
                    raise Problem("PRECONDITION_FAILED")
                if previous is None:
                    db.execute(
                        "INSERT INTO controller_resume_verdicts"
                        "(run_id,generation,attempt_id,decision,reason,result_sha256) VALUES(?,?,?,?,?,?)",
                        (verdict["run_id"], verdict["generation"], *values),
                    )
            observed = clock()
            self._checked(db, owner, record, observed)
            db.execute(
                "UPDATE controller_authorities SET last_observed_at=? WHERE run_id=? AND generation=?",
                (stamp(observed), record["payload"]["run_id"], record["payload"]["generation"]),
            )
            return result
