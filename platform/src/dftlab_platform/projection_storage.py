"""SQLite adapter for rebuildable projections, aggregate reads and event replay."""
import base64
import hashlib
import hmac
import secrets
import time

from .contracts import canonical, loads
from .domain import Principal, Problem, identifier, now, reseal


class SQLiteReadModels:
    CURSOR_SECONDS = 24 * 60 * 60
    SCHEMAS = {
        "CAMPAIGN": "campaign",
        "PLAN": "plan",
        "RUN": "run-projection",
        "VALIDATION_RECEIPT": "validation-receipt",
        "RESUME_PLAN": "resume-plan",
    }
    LIST_KINDS = {"CAMPAIGN": "CAMPAIGN", "PLAN": "PLAN", "RUN": "RUN", "OPERATION": "OPERATION"}

    def __init__(self, repository, *, clock=time.time, cursor_seconds=CURSOR_SECONDS):
        self.repository = repository
        self.clock = clock
        if type(cursor_seconds) is not int or cursor_seconds < 1:
            raise ValueError("Invalid list cursor retention")
        self.cursor_seconds = cursor_seconds
        with repository.transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS projection_migrations(version INTEGER PRIMARY KEY)")
            versions = [row[0] for row in db.execute("SELECT version FROM projection_migrations")]
            if not versions:
                db.execute("CREATE TABLE run_events(run_id TEXT NOT NULL REFERENCES resources(resource_id), sequence INTEGER NOT NULL, document TEXT NOT NULL, PRIMARY KEY(run_id,sequence))")
                db.execute("INSERT INTO projection_migrations VALUES(1)")
            elif versions != [1]:
                raise ValueError("Explicit projection migration required")
            db.execute("CREATE TABLE IF NOT EXISTS projection_cursor_keys(singleton INTEGER PRIMARY KEY CHECK(singleton=1), secret BLOB NOT NULL)")
            db.execute("INSERT OR IGNORE INTO projection_cursor_keys VALUES(1,?)", (secrets.token_bytes(32),))

    def _cursor_key(self):
        with self.repository._connection() as db:
            row = db.execute("SELECT secret FROM projection_cursor_keys WHERE singleton=1").fetchone()
        if row is None or not isinstance(row[0], bytes) or len(row[0]) != 32:
            raise Problem("PRECONDITION_FAILED")
        return row[0]

    @staticmethod
    def _encode_cursor(document, key):
        raw = canonical(document)
        signature = hmac.new(key, raw, hashlib.sha256).digest()
        encoded = base64.urlsafe_b64encode(raw).rstrip(b"=") + b"." + base64.urlsafe_b64encode(signature).rstrip(b"=")
        if len(encoded) > 4096:
            raise Problem("PRECONDITION_FAILED")
        return encoded.decode("ascii")

    def _decode_cursor(self, value, key, scope):
        try:
            if not isinstance(value, str) or not 1 <= len(value) <= 4096:
                raise ValueError
            encoded, signed = value.split(".", 1)
            raw = base64.b64decode(encoded + "="*((4-len(encoded)%4)%4), altchars=b"-_", validate=True)
            signature = base64.b64decode(signed + "="*((4-len(signed)%4)%4), altchars=b"-_", validate=True)
            if len(signature) != 32 or not hmac.compare_digest(signature, hmac.new(key, raw, hashlib.sha256).digest()):
                raise ValueError
            document = loads(raw)
            if canonical(document) != raw or not isinstance(document, dict) or set(document) != {"scope", "watermark", "after", "expires_at"}:
                raise ValueError
            if document["scope"] != scope or type(document["watermark"]) is not int or document["watermark"] < 0:
                raise ValueError
            after = document["after"]
            if not isinstance(after, list) or len(after) != 2 or any(not isinstance(part, str) or not part for part in after):
                raise ValueError
            if type(document["expires_at"]) is not int:
                raise ValueError
        except (ValueError, TypeError, UnicodeError, RecursionError):
            raise Problem("VALIDATION_FAILED") from None
        if self.clock() >= document["expires_at"]:
            raise Problem("CURSOR_EXPIRED")
        return document

    @staticmethod
    def _current_document(contracts, kind, revision, raw):
        if raw is None:
            raise Problem("NOT_FOUND")
        schema = SQLiteReadModels.SCHEMAS[kind]
        document = contracts.validate(schema, loads(raw))
        if kind == "RUN" and document["payload"]["source_revision"] != revision:
            document["payload"]["source_revision"] = revision
            reseal(document)
        elif kind in {"CAMPAIGN", "PLAN"} and document["payload"]["revision"] != revision:
            document["payload"]["revision"] = revision
            reseal(document)
        return contracts.validate(schema, document)

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
            return self._current_document(self.repository.contracts, kind, target["revision"], target["document"])

    def list(self, owner: Principal, kind: str, resource_id: str, *, limit=50, cursor=None, action=None, state=None):
        """List one authorized project aggregate with an insertion-stable cursor."""
        if kind not in self.LIST_KINDS or type(limit) is not int or not 1 <= limit <= 200:
            raise Problem("VALIDATION_FAILED")
        campaign_id = None
        if kind == "PLAN":
            target = self.target(owner, "CAMPAIGN", resource_id)
            project_id = target["project_id"]
            campaign_id = resource_id
        else:
            project_id = resource_id
            self.repository.project(owner, project_id)
        if kind != "OPERATION" and (action is not None or state is not None):
            raise Problem("VALIDATION_FAILED")
        if kind == "OPERATION":
            actions = {"VALIDATE_INPUT", "CREATE_CAMPAIGN", "CREATE_PLAN", "PREPARE_PACKAGE", "SUBMIT_RUN", "CANCEL_RUN", "RECONCILE_RUN", "CREATE_RESUME_PLAN", "EXECUTE_RESUME_PLAN"}
            states = {"PENDING", "RUNNING", "SUCCEEDED", "FAILED", "REJECTED", "CANCELLED", "OUTCOME_UNKNOWN"}
            if action is not None and action not in actions or state is not None and state not in states:
                raise Problem("VALIDATION_FAILED")
        scope = {"owner": owner.principal_id, "kind": kind, "project": project_id,
                 "campaign": campaign_id, "action": action, "state": state}
        key = self._cursor_key()
        with self.repository._connection() as db:
            db.execute("BEGIN")
            self.repository._project(db, owner, project_id)
            table = "operations" if kind == "OPERATION" else "resources"
            watermark = db.execute(f"SELECT COALESCE(MAX(rowid),0) FROM {table}").fetchone()[0]
            after = ["", ""]
            if cursor is not None:
                decoded = self._decode_cursor(cursor, key, scope)
                watermark, after = decoded["watermark"], decoded["after"]
            if kind == "OPERATION":
                rows = db.execute("SELECT rowid,operation_id,document FROM operations WHERE owner_id=? AND project_id=? AND rowid<=? ORDER BY rowid", (owner.principal_id, project_id, watermark)).fetchall()
                values = []
                for rowid, operation_id, raw in rows:
                    document = self.repository._operation_document(raw)
                    payload = document["payload"]
                    if action is not None and payload["action"] != action or state is not None and payload["state"] != state:
                        continue
                    created = document["created_at"]
                    if [created, operation_id] > after:
                        values.append((created, operation_id, document))
                values.sort(key=lambda item: (item[0], item[1]))
            else:
                rows = db.execute("SELECT rowid,resource_id,revision,document FROM resources WHERE project_id=? AND kind=? AND rowid<=? ORDER BY rowid", (project_id, kind, watermark)).fetchall()
                values = []
                for rowid, resource_id, revision, raw in rows:
                    if raw is None:
                        continue
                    document = self._current_document(self.repository.contracts, kind, revision, raw)
                    if kind == "PLAN" and document["payload"]["campaign_id"] != campaign_id:
                        continue
                    created = document["created_at"]
                    if [created, resource_id] > after:
                        values.append((created, resource_id, document))
                values.sort(key=lambda item: (item[0], item[1]))
        page = values[:limit]
        next_cursor = None
        if len(values) > limit:
            last = page[-1]
            next_cursor = self._encode_cursor({"scope": scope, "watermark": watermark,
                                               "after": [last[0], last[1]],
                                               "expires_at": int(self.clock())+self.cursor_seconds}, key)
        return {"items": [item[2] for item in page], "next_cursor": next_cursor}

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

    def create_run(self, owner, record, operation_id, attempt_id):
        """Persist the first RUN snapshot and attempt event in one transaction."""
        self.repository.contracts.validate("run-projection", record)
        payload = record["payload"]
        run_id = payload["run_id"]
        if (payload["source_revision"] != 1 or payload["snapshot_cursor"] != f"{run_id}:0"
                or payload["current_attempt_id"] != attempt_id):
            raise Problem("PRECONDITION_FAILED")
        event = {
            "event_id": identifier(), "stream_id": run_id, "sequence": 1,
            "occurred_at": now(), "recorded_at": now(), "type": "run.attempt_created",
            "schema_version": "0.1.0", "project_id": record["project_id"],
            "operation_id": operation_id, "run_id": run_id, "attempt_id": attempt_id,
            "payload": {"run_id": run_id, "attempt_id": attempt_id, "resume_plan_id": None},
            "evidence_refs": [],
        }
        self.repository.contracts.validate("event-record", event)
        with self.repository.transaction() as db:
            self.repository._project(db, owner, record["project_id"])
            if db.execute("SELECT 1 FROM resources WHERE resource_id=?", (run_id,)).fetchone():
                raise Problem("PRECONDITION_FAILED")
            db.execute("INSERT INTO resources VALUES(?,?,?,?,?)",
                       (run_id, "RUN", record["project_id"], 1, canonical(record).decode()))
            db.execute("INSERT INTO run_events VALUES(?,?,?)", (run_id, 1, canonical(event).decode()))
        return record

    def update_run(self, owner, record, expected_revision, operation_id, changed_dimensions, evidence_refs=()):
        """CAS a RUN snapshot together with its projection_updated event."""
        self.repository.contracts.validate("run-projection", record)
        payload = record["payload"]
        run_id, revision = payload["run_id"], payload["source_revision"]
        if (type(expected_revision) is not int or revision != expected_revision + 1
                or not isinstance(changed_dimensions, (list, tuple)) or not changed_dimensions
                or len(set(changed_dimensions)) != len(changed_dimensions)):
            raise Problem("PRECONDITION_FAILED")
        with self.repository.transaction() as db:
            target = self._target(db, owner, "RUN", run_id)
            previous = self.repository.contracts.validate(
                "run-projection", loads(target["document"])
            )
            if (target["project_id"] != record["project_id"] or target["revision"] != expected_revision
                    or payload["snapshot_cursor"] != previous["payload"]["snapshot_cursor"]):
                raise Problem("REVISION_CONFLICT")
            sequence = db.execute("SELECT COALESCE(MAX(sequence),0)+1 FROM run_events WHERE run_id=?", (run_id,)).fetchone()[0]
            event = {
                "event_id": identifier(), "stream_id": run_id, "sequence": sequence,
                "occurred_at": now(), "recorded_at": now(), "type": "run.projection_updated",
                "schema_version": "0.1.0", "project_id": record["project_id"],
                "operation_id": operation_id, "run_id": run_id,
                "attempt_id": payload["current_attempt_id"],
                "payload": {"run_id": run_id, "source_revision": revision,
                            "changed_dimensions": list(changed_dimensions)},
                "evidence_refs": list(evidence_refs),
            }
            self.repository.contracts.validate("event-record", event)
            db.execute("UPDATE resources SET revision=?,document=? WHERE resource_id=? AND kind='RUN'",
                       (revision, canonical(record).decode(), run_id))
            db.execute("INSERT INTO run_events VALUES(?,?,?)", (run_id, sequence, canonical(event).decode()))
        return record

    def publish_run_artifact(self, owner, run_id, operation_id, attempt_id, reference):
        """Link a verified artifact to the run stream without changing its snapshot."""
        self.repository.contracts.validate("artifact-ref", reference)
        with self.repository.transaction() as db:
            return self.publish_run_artifact_in(db, owner, run_id, operation_id, attempt_id, reference)

    def publish_run_artifact_in(self, db, owner, run_id, operation_id, attempt_id, reference):
        """Add a run artifact event inside a caller's fenced SQL transaction."""
        self.repository.contracts.validate("artifact-ref", reference)
        target = self._target(db, owner, "RUN", run_id)
        sequence = db.execute("SELECT COALESCE(MAX(sequence),0)+1 FROM run_events WHERE run_id=?", (run_id,)).fetchone()[0]
        event = {
            "event_id": identifier(), "stream_id": run_id, "sequence": sequence,
            "occurred_at": now(), "recorded_at": now(), "type": "artifact.committed",
            "schema_version": "0.1.0", "project_id": target["project_id"],
            "operation_id": operation_id, "run_id": run_id, "attempt_id": attempt_id,
            "payload": {"artifact": reference}, "evidence_refs": [reference],
        }
        self.repository.contracts.validate("event-record", event)
        db.execute("INSERT INTO run_events VALUES(?,?,?)", (run_id, sequence, canonical(event).decode()))
        return event

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
