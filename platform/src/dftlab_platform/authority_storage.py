"""SQLite local authority adapter, replaceable behind AuthorityStore."""
from .authority import instant, stamp
from .contracts import BASE, canonical, loads
from .domain import Problem, envelope, reseal


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


def migrate_authority_v2(repository):
    """Explicitly migrate v1 authority rows to generation-keyed storage.

    Stored documents are copied verbatim. A document outside generation 1
    cannot be inferred from the v1 table and aborts the whole transaction.
    """
    with repository.transaction() as db:
        db.execute("CREATE TABLE IF NOT EXISTS authority_migrations(version INTEGER PRIMARY KEY)")
        versions = [row[0] for row in db.execute("SELECT version FROM authority_migrations ORDER BY version")]
        if versions == [1, 2]:
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

    def publish(self, owner, record, clock, writer):
        with self.repository.transaction() as db:
            self._checked(db, owner, record, clock())
            result = writer(db)
            observed = clock()
            self._checked(db, owner, record, observed)
            db.execute(
                "UPDATE controller_authorities SET last_observed_at=? WHERE run_id=? AND generation=?",
                (stamp(observed), record["payload"]["run_id"], record["payload"]["generation"]),
            )
            return result
