"""SQLite adapter for rebuildable projections and bounded event replay."""
from .contracts import canonical, loads
from .domain import Principal, Problem, reseal


class SQLiteReadModels:
    def __init__(self, repository):
        self.repository = repository
        with repository.transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS projection_migrations(version INTEGER PRIMARY KEY)")
            versions = [row[0] for row in db.execute("SELECT version FROM projection_migrations")]
            if not versions:
                db.execute("CREATE TABLE run_events(run_id TEXT NOT NULL REFERENCES resources(resource_id), sequence INTEGER NOT NULL, document TEXT NOT NULL, PRIMARY KEY(run_id,sequence))")
                db.execute("INSERT INTO projection_migrations VALUES(1)")
            elif versions != [1]:
                raise ValueError("Explicit projection migration required")

    def _target(self, db, owner, kind, resource_id):
        row = db.execute("SELECT project_id,revision,document FROM resources WHERE resource_id=? AND kind=?", (resource_id, kind)).fetchone()
        if not row:
            raise Problem("NOT_FOUND")
        self.repository._project(db, owner, row[0])
        return {"id": resource_id, "kind": kind, "project_id": row[0], "revision": row[1], "document": row[2]}

    def target(self, owner, kind, resource_id):
        with self.repository._connection() as db:
            value = self._target(db, owner, kind, resource_id)
            value.pop("document")
            return value

    def get(self, owner, kind, resource_id):
        with self.repository._connection() as db:
            target = self._target(db, owner, kind, resource_id)
            if target["document"] is None:
                raise Problem("NOT_FOUND")
            schema = {"RUN": "run-projection", "RESUME_PLAN": "resume-plan"}[kind]
            document = self.repository.contracts.validate(schema, loads(target["document"]))
            if kind == "RUN" and document["payload"]["source_revision"] != target["revision"]:
                # The projection may lag accepted commands. Only this platform
                # field changes; native evidence, dimensions and cursor do not.
                document["payload"]["source_revision"] = target["revision"]
                reseal(document)
            return self.repository.contracts.validate(schema, document)

    def put(self, owner, kind, record, expected_revision=None):
        """Trusted adapter/test seam, deliberately not an HTTP write endpoint."""
        schema, id_field, revision_field = {"RUN": ("run-projection", "run_id", "source_revision"), "RESUME_PLAN": ("resume-plan", "resume_plan_id", "plan_revision")}[kind]
        self.repository.contracts.validate(schema, record)
        payload = record["payload"]
        with self.repository.transaction() as db:
            self.repository._project(db, owner, record["project_id"])
            existing = db.execute("SELECT project_id,revision,kind FROM resources WHERE resource_id=?", (payload[id_field],)).fetchone()
            if existing:
                if existing[0] != record["project_id"] or existing[2] != kind:
                    raise Problem("NOT_FOUND")
                if existing[1] != expected_revision or payload[revision_field] <= existing[1]:
                    raise Problem("REVISION_CONFLICT")
                db.execute("UPDATE resources SET revision=?,document=? WHERE resource_id=?", (payload[revision_field], canonical(record).decode(), payload[id_field]))
            elif expected_revision is not None:
                raise Problem("REVISION_CONFLICT")
            else:
                db.execute("INSERT INTO resources VALUES(?,?,?,?,?)", (payload[id_field], kind, record["project_id"], payload[revision_field], canonical(record).decode()))

    def append_event(self, owner, event):
        """Retain observations; this method never overwrites a run projection."""
        self.repository.contracts.validate("event-record", event)
        if len(canonical(event)) > 256*1024:
            raise Problem("PAYLOAD_TOO_LARGE")
        with self.repository.transaction() as db:
            target = self._target(db, owner, "RUN", event["run_id"])
            if event["project_id"] != target["project_id"] or event["stream_id"] != event["run_id"]:
                raise Problem("VALIDATION_FAILED")
            existing = db.execute("SELECT document FROM run_events WHERE run_id=? AND sequence=?", (event["run_id"], event["sequence"])).fetchone()
            encoded = canonical(event).decode()
            if existing:
                if existing[0] != encoded:
                    raise Problem("PRECONDITION_FAILED")
                return
            previous = db.execute("SELECT COALESCE(MAX(sequence),0) FROM run_events WHERE run_id=?", (event["run_id"],)).fetchone()[0]
            if event["sequence"] <= previous:
                raise Problem("PRECONDITION_FAILED")
            db.execute("INSERT INTO run_events VALUES(?,?,?)", (event["run_id"], event["sequence"], encoded))

    def replay(self, owner, run_id, after, limit):
        projection = self.get(owner, "RUN", run_id)  # authorize before cursors
        cursor = projection["payload"]["snapshot_cursor"] if after is None else after
        prefix, separator, suffix = cursor.rpartition(":")
        if not separator or prefix != run_id or not suffix.isdecimal() or len(suffix) > 16:
            raise Problem("CURSOR_EXPIRED")
        sequence = int(suffix)
        if not 1 <= limit <= 500:
            raise Problem("VALIDATION_FAILED")
        with self.repository._connection() as db:
            bounds = db.execute("SELECT MIN(sequence),MAX(sequence) FROM run_events WHERE run_id=?", (run_id,)).fetchone()
            snapshot = projection["payload"]["snapshot_cursor"]
            if bounds[0] is None:
                if cursor != snapshot:
                    raise Problem("CURSOR_EXPIRED")
                return {"events": [], "next_cursor": cursor}
            # The projection snapshot is an explicit replay boundary. Imported
            # evidence can start beyond it; unknown/expired cursors resync.
            if cursor != snapshot and (sequence < bounds[0]-1 or sequence > bounds[1]):
                raise Problem("CURSOR_EXPIRED")
            events, size = [], 0
            for row in db.execute("SELECT document FROM run_events WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT ?", (run_id, sequence, limit)):
                size += len(row[0].encode("utf-8"))
                if size > 8*1024**2:
                    break
                events.append(self.repository.contracts.validate("event-record", loads(row[0])))
        return {"events": events, "next_cursor": f"{run_id}:{events[-1]['sequence']}" if events else cursor}
