"""SQLite metadata adapter for the ArtifactIndex port; no files in SQL."""
from .contracts import canonical, digest, loads
from .domain import Principal, Problem, reseal


class SQLiteArtifactIndex:
    def __init__(self, repository):
        self.repository = repository
        with repository.transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS artifact_migrations(version INTEGER PRIMARY KEY)")
            versions = [row[0] for row in db.execute("SELECT version FROM artifact_migrations")]
            if not versions:
                db.execute("CREATE TABLE uploads(upload_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(project_id), idem_key TEXT NOT NULL, request_hash TEXT NOT NULL, document TEXT NOT NULL, UNIQUE(owner_id,project_id,idem_key))")
                db.execute("CREATE TABLE artifact_records(artifact_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(project_id), document TEXT NOT NULL)")
                db.execute("INSERT INTO artifact_migrations VALUES(1)")
            elif versions != [1]:
                raise ValueError("Explicit artifact migration required")

    def stage(self, owner: Principal, request: dict, document: dict, limit: int, quota: int) -> dict:
        with self.repository.transaction() as db:
            self.repository._project(db, owner, request["project_id"])
            row = db.execute("SELECT request_hash,document FROM uploads WHERE owner_id=? AND project_id=? AND idem_key=?", (owner.principal_id, request["project_id"], request["idempotency_key"])).fetchone()
            if row:
                if row[0] != digest(request):
                    raise Problem("IDEMPOTENCY_KEY_REUSED")
                return loads(row[1])
            documents = [loads(row[0]) for row in db.execute("SELECT document FROM uploads WHERE owner_id=?", (owner.principal_id,))]
            # Reserved sizes include completed originals; expiry cannot evade quota.
            if sum(doc["state"] != "COMMITTED" for doc in documents) >= limit:
                raise Problem("RATE_LIMITED")
            if sum(doc["size_bytes"] for doc in documents)+document["size_bytes"] > quota:
                raise Problem("PAYLOAD_TOO_LARGE")
            db.execute("INSERT INTO uploads VALUES(?,?,?,?,?,?)", (document["upload_id"], owner.principal_id, request["project_id"], request["idempotency_key"], digest(request), canonical(document).decode()))
            return document

    def _upload(self, db, owner: Principal, upload_id: str) -> dict:
        row = db.execute("SELECT document,project_id,owner_id FROM uploads WHERE upload_id=?", (upload_id,)).fetchone()
        if not row or row[2] != owner.principal_id:
            raise Problem("NOT_FOUND")
        self.repository._project(db, owner, row[1])
        document = loads(row[0])
        self.repository.contracts.validate("artifact-record", document["record"])
        return document

    def update(self, owner: Principal, upload_id: str, change) -> dict:
        with self.repository.transaction() as db:
            doc = self._upload(db, owner, upload_id)
            change(doc)
            db.execute("UPDATE uploads SET document=? WHERE upload_id=?", (canonical(doc).decode(), upload_id))
            return doc

    def publish(self, owner: Principal, upload_id: str) -> dict:
        with self.repository.transaction() as db:
            doc = self._upload(db, owner, upload_id)
            if doc["state"] != "COMMITTED":
                raise Problem("PRECONDITION_FAILED")
            record = doc["record"]
            record["payload"]["integrity_state"] = "VERIFIED"
            reseal(record)
            self.repository.contracts.validate("artifact-record", record)
            db.execute("INSERT INTO artifact_records VALUES(?,?,?,?) ON CONFLICT(artifact_id) DO NOTHING", (record["payload"]["artifact_id"], owner.principal_id, record["project_id"], canonical(record).decode()))
            return record

    def metadata(self, owner: Principal, artifact_id: str) -> dict:
        with self.repository._connection() as db:
            row = db.execute("SELECT document,project_id,owner_id FROM artifact_records WHERE artifact_id=?", (artifact_id,)).fetchone()
            if not row or row[2] != owner.principal_id:
                raise Problem("NOT_FOUND")
            self.repository._project(db, owner, row[1])
            return self.repository.contracts.validate("artifact-record", loads(row[0]))
