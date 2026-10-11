"""SQLite local authority adapter, replaceable behind AuthorityStore."""
from .authority import instant, stamp
from .contracts import BASE, canonical, loads
from .domain import Problem, envelope, reseal


class SQLiteAuthorityStore:
    def __init__(self, repository):
        self.repository, self.contracts = repository, repository.contracts
        with repository.transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS authority_migrations(version INTEGER PRIMARY KEY)")
            versions = [row[0] for row in db.execute("SELECT version FROM authority_migrations ORDER BY version")]
            if not versions:
                db.execute("CREATE TABLE controller_authorities(run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id), owner_id TEXT NOT NULL REFERENCES principals(principal_id), document TEXT NOT NULL, last_observed_at TEXT NOT NULL)")
                db.execute("INSERT INTO authority_migrations VALUES(1)")
            elif versions != [1]:
                raise ValueError("Explicit authority migration required")

    def create(self, owner, project, run, attempt, instance, scope, observed, expires):
        stamp(observed)
        if expires <= observed:
            raise ValueError("Lease expiry must follow observation")
        for value in (run, attempt, instance):
            self.contracts.validate_ref(BASE+"schemas/defs.schema.json#/$defs/id", value)
        with self.repository.transaction() as db:
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
            db.execute("INSERT INTO controller_authorities VALUES(?,?,?,?,?)", (run, project, owner.principal_id, canonical(document).decode(), stamp(observed)))
            return document

    def _checked(self, db, owner, record, observed):
        self.contracts.validate("controller-authority-record", record)
        self.repository._project(db, owner, record["project_id"])
        payload = record["payload"]
        row = db.execute("SELECT project_id,owner_id,document,last_observed_at FROM controller_authorities WHERE run_id=?", (payload["run_id"],)).fetchone()
        if row is None or row[0] != record["project_id"] or row[1] != owner.principal_id:
            raise Problem("NOT_FOUND")
        stored = self.contracts.validate("controller-authority-record", loads(row[2]))
        if stored != record or stored["integrity"]["status"] != "VERIFIED" or payload["lease_expires_at"] is None:
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
            db.execute("UPDATE controller_authorities SET document=?,last_observed_at=? WHERE run_id=?", (canonical(stored).decode(), stamp(observed), record["payload"]["run_id"]))
            return stored

    def publish(self, owner, record, clock, writer):
        with self.repository.transaction() as db:
            self._checked(db, owner, record, clock())
            result = writer(db)
            observed = clock()
            self._checked(db, owner, record, observed)
            db.execute("UPDATE controller_authorities SET last_observed_at=? WHERE run_id=?", (stamp(observed), record["payload"]["run_id"]))
            return result

