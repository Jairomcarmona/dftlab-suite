"""SQLite adapter. WAL is only for one local service, never shared filesystems."""
from __future__ import annotations
from contextlib import contextmanager
import ctypes
import json
import os
from pathlib import Path
import sqlite3

from .contracts import BASE, Contracts, canonical, digest, loads, resource_json
from .domain import Principal, Problem, envelope, identifier, now, reseal, transition_guard

MIGRATION_1 = """
CREATE TABLE principals (principal_id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE);
CREATE TABLE projects (project_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES principals(principal_id), document TEXT NOT NULL);
CREATE TABLE project_keys (owner_id TEXT NOT NULL, idem_key TEXT NOT NULL, request_hash TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(project_id), PRIMARY KEY(owner_id, idem_key));
CREATE TABLE resources (resource_id TEXT PRIMARY KEY, kind TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(project_id), revision INTEGER NOT NULL, document TEXT);
CREATE TABLE operations (operation_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(project_id), idem_key TEXT NOT NULL, request_hash TEXT NOT NULL, document TEXT NOT NULL, request TEXT NOT NULL, UNIQUE(owner_id, project_id, idem_key));
CREATE TABLE outbox (operation_id TEXT PRIMARY KEY REFERENCES operations(operation_id), processor_id TEXT, claimed_at TEXT);
CREATE TABLE events (event_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id), sequence INTEGER NOT NULL, document TEXT NOT NULL, UNIQUE(project_id, sequence));
CREATE INDEX operations_project ON operations(project_id);
"""


def local_database(path: Path) -> Path:
    path = path.expanduser().absolute()
    if path.is_symlink():
        raise ValueError("SQLite path must not be a symlink")
    path = path.resolve()
    if os.name == "nt":
        if str(path).startswith("\\\\") or ctypes.windll.kernel32.GetDriveTypeW(path.anchor) == 4:
            raise ValueError("SQLite requires local storage")
    elif Path("/proc/mounts").exists():
        mounts = []
        for line in Path("/proc/mounts").read_text().splitlines():
            parts = line.split()
            mount = Path(parts[1].replace("\\040", " "))
            if path.is_relative_to(mount):
                mounts.append((len(str(mount)), parts[2]))
        if mounts and max(mounts)[1] in {"nfs", "nfs4", "cifs", "smbfs", "fuse.sshfs", "9p", "drvfs"}:
            raise ValueError("SQLite requires local storage")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError("SQLite path must not be a symlink")
    return path.resolve()


class SQLiteRepository:
    def __init__(self, path: Path):
        self.path = local_database(path)
        self.contracts = Contracts()
        with self._connection() as connection:
            if connection.execute("PRAGMA journal_mode=WAL").fetchone()[0].lower() != "wal":
                raise ValueError("SQLite WAL unavailable")
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY)")
            versions = [r[0] for r in connection.execute("SELECT version FROM migrations ORDER BY version")]
            if not versions:
                for statement in MIGRATION_1.split(";"):
                    if statement.strip():
                        connection.execute(statement)
                connection.execute("INSERT INTO migrations(version) VALUES(1)")
            elif versions != [1]:
                raise ValueError("Unsupported database version; explicit migration required")
            connection.execute("CREATE TABLE IF NOT EXISTS effect_migrations(version INTEGER PRIMARY KEY)")
            effects = [r[0] for r in connection.execute("SELECT version FROM effect_migrations ORDER BY version")]
            if not effects:
                connection.execute("CREATE TABLE effect_intents(operation_id TEXT PRIMARY KEY REFERENCES operations(operation_id), document TEXT NOT NULL)")
                connection.execute("INSERT INTO effect_migrations VALUES(1)")
            elif effects != [1]:
                raise ValueError("Explicit effect migration required")
            connection.execute("CREATE TABLE IF NOT EXISTS product_migrations(version INTEGER PRIMARY KEY)")
            products = [r[0] for r in connection.execute("SELECT version FROM product_migrations ORDER BY version")]
            if not products:
                connection.execute("CREATE TABLE operation_products(operation_id TEXT PRIMARY KEY REFERENCES operations(operation_id), processor_id TEXT NOT NULL, kind TEXT NOT NULL, product_id TEXT NOT NULL UNIQUE REFERENCES resources(resource_id), revision INTEGER NOT NULL, document TEXT NOT NULL, document_hash TEXT NOT NULL)")
                connection.execute("INSERT INTO product_migrations VALUES(1)")
            elif products != [1]:
                raise ValueError("Explicit product migration required")
            connection.execute("CREATE TABLE IF NOT EXISTS recovery_migrations(version INTEGER PRIMARY KEY)")
            recovery = [row[0] for row in connection.execute("SELECT version FROM recovery_migrations ORDER BY version")]
            if not recovery:
                connection.execute("CREATE TABLE instance_recovery(singleton INTEGER PRIMARY KEY CHECK(singleton=1), mode TEXT NOT NULL CHECK(mode IN ('LIVE','RECOVERY')), checkpoint TEXT)")
                connection.execute("INSERT INTO instance_recovery VALUES(1,'LIVE',NULL)")
                connection.execute("INSERT INTO recovery_migrations VALUES(1)")
            elif recovery != [1]:
                raise ValueError("Explicit recovery migration required")
            connection.commit()
        if os.name != "nt":
            self.path.chmod(0o600)

    @contextmanager
    def _connection(self):
        connection = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA synchronous=FULL")
        try:
            yield connection
        finally:
            connection.close()

    @contextmanager
    def transaction(self):
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                yield connection
                connection.commit()
            except BaseException:
                connection.rollback()
                raise

    def ensure_principal(self, handle: str) -> Principal:
        with self.transaction() as db:
            row = db.execute("SELECT principal_id FROM principals WHERE handle=?", (handle,)).fetchone()
            if row:
                return Principal(row[0])
            principal = Principal(identifier())
            db.execute("INSERT INTO principals VALUES(?,?)", (principal.principal_id, handle))
            return principal

    def _execution_ready(self, db):
        row = db.execute("SELECT mode,checkpoint FROM instance_recovery WHERE singleton=1").fetchone()
        if row is None or row[0] != "LIVE" or row[1] is not None:
            raise Problem("PRECONDITION_FAILED")

    def require_execution_ready(self):
        """Internal guard, never a client toggle or an automatic recovery exit."""
        with self._connection() as db:
            self._execution_ready(db)

    def restored_checkpoint(self):
        with self._connection() as db:
            row = db.execute("SELECT mode,checkpoint FROM instance_recovery WHERE singleton=1").fetchone()
            if row is None or row[0] not in {"LIVE", "RECOVERY"}:
                raise Problem("PRECONDITION_FAILED")
            if row[0] == "LIVE":
                self._execution_ready(db)
                return None
            return self.contracts.validate("recovery-checkpoint", loads(row[1]))

    def _project(self, db, principal: Principal, project_id: str) -> dict:
        row = db.execute("SELECT document,owner_id FROM projects WHERE project_id=?", (project_id,)).fetchone()
        if row is None or row[1] != principal.principal_id:
            # Same diagnostic: inaccessible identifiers are not an oracle.
            raise Problem("NOT_FOUND")
        return loads(row[0])

    def project(self, principal: Principal, project_id: str) -> dict:
        with self._connection() as db:
            return self._project(db, principal, project_id)

    def list_projects(self, principal: Principal) -> list[dict]:
        with self._connection() as db:
            return [loads(r[0]) for r in db.execute("SELECT document FROM projects WHERE owner_id=? ORDER BY project_id", (principal.principal_id,))]

    def create_project(self, principal: Principal, body: dict) -> tuple[dict, bool]:
        self.contracts.validate_ref(self.contracts.api_ref("createProject"), body)
        hashed = digest(body)
        with self.transaction() as db:
            row = db.execute("SELECT request_hash,project_id FROM project_keys WHERE owner_id=? AND idem_key=?", (principal.principal_id, body["idempotency_key"])).fetchone()
            if row:
                if row[0] != hashed:
                    raise Problem("IDEMPOTENCY_KEY_REUSED")
                return self._project(db, principal, row[1]), False
            project = {"project_id": identifier(), "name": body["name"], "revision": 1, "owner_principal_id": principal.principal_id, "created_at": now()}
            self.contracts.validate_ref(self.contracts.api_ref("createProject", status=201), project)
            db.execute("INSERT INTO projects VALUES(?,?,?)", (project["project_id"], principal.principal_id, canonical(project).decode()))
            db.execute("INSERT INTO resources VALUES(?,?,?,1,NULL)", (project["project_id"], "PROJECT", project["project_id"]))
            db.execute("INSERT INTO project_keys VALUES(?,?,?,?)", (principal.principal_id, body["idempotency_key"], hashed, project["project_id"]))
            return project, True

    def _event(self, db, operation: dict, source: str, destination: str) -> str:
        payload = operation["payload"]
        project = operation["project_id"]
        sequence = db.execute("SELECT COALESCE(MAX(sequence),0)+1 FROM events WHERE project_id=?", (project,)).fetchone()[0]
        event = {"event_id": identifier(), "stream_id": project, "sequence": sequence, "occurred_at": now(), "recorded_at": now(), "type": "operation.state_changed", "schema_version": "0.1.0", "project_id": project, "operation_id": payload["operation_id"], "run_id": None, "attempt_id": None, "payload": {"operation_id": payload["operation_id"], "from": source, "to": destination, "revision": payload["revision"]}, "evidence_refs": []}
        if source == destination:
            # Creation is not a self-transition. Consumers may ignore future
            # event types while retaining the durable stream and cursor.
            event["type"] = "operation.accepted"
            event["payload"] = {"operation_id": payload["operation_id"], "revision": payload["revision"]}
        self.contracts.validate("event-record", event)
        db.execute("INSERT INTO events VALUES(?,?,?,?)", (event["event_id"], project, sequence, canonical(event).decode()))
        return f"{project}:{sequence}"

    def accept(self, principal: Principal, request: dict) -> tuple[dict, bool]:
        self.contracts.validate("operation-request", request)
        if request["action"] == "VALIDATE_INPUT":
            self.contracts.validate_ref(BASE+"schemas/operation-request.schema.json#/$defs/validate_input_payload", request["payload"])
        targets = {"VALIDATE_INPUT": "PROJECT", "CREATE_CAMPAIGN": "PROJECT", "CREATE_PLAN": "CAMPAIGN", "PREPARE_PACKAGE": "PLAN", "SUBMIT_RUN": "PLAN", "CANCEL_RUN": "RUN", "RECONCILE_RUN": "RUN", "CREATE_RESUME_PLAN": "RUN", "EXECUTE_RESUME_PLAN": "RESUME_PLAN"}
        if request["target"]["kind"] != targets[request["action"]]:
            raise Problem("VALIDATION_FAILED")
        hashed = digest(request)
        with self.transaction() as db:
            self._project(db, principal, request["project_id"])
            row = db.execute("SELECT request_hash,document FROM operations WHERE owner_id=? AND project_id=? AND idem_key=?", (principal.principal_id, request["project_id"], request["idempotency_key"])).fetchone()
            if row:
                if row[0] != hashed:
                    raise Problem("IDEMPOTENCY_KEY_REUSED")
                return self._operation_document(row[1]), False
            if request["action"] in {"SUBMIT_RUN", "EXECUTE_RESUME_PLAN"}:
                self._execution_ready(db)
            target = request["target"]
            row = db.execute("SELECT revision,kind FROM resources WHERE resource_id=? AND project_id=?", (target["id"], request["project_id"])).fetchone()
            if row is None or row[1] != target["kind"]:
                raise Problem("NOT_FOUND")
            if row[0] != target["expected_revision"]:
                raise Problem("REVISION_CONFLICT")
            op_id = identifier()
            timestamp = now()
            payload = {"operation_id": op_id, "action": request["action"], "state": "PENDING", "revision": 1, "request_hash": hashed, "idempotency_key": request["idempotency_key"], "idempotency_scope": {"owner_principal_id": principal.principal_id, "project_id": request["project_id"]}, "owner_principal_id": principal.principal_id, "accepted_at": timestamp, "updated_at": timestamp, "target_refs": [{"kind": target["kind"], "id": target["id"], "revision": row[0]}], "result": None, "error": None, "event_cursor": "pending", "key_retention": {"effects_alive": True, "retain_until": None}}
            operation = envelope("operation-record", request["project_id"], payload, record_id=op_id)
            payload["event_cursor"] = self._event(db, operation, "PENDING", "PENDING")
            reseal(operation)
            self.contracts.validate("operation-record", operation)
            db.execute("INSERT INTO operations VALUES(?,?,?,?,?,?,?)", (op_id, principal.principal_id, request["project_id"], request["idempotency_key"], hashed, canonical(operation).decode(), canonical(request).decode()))
            db.execute("INSERT INTO outbox(operation_id) VALUES(?)", (op_id,))
            db.execute("UPDATE resources SET revision=revision+1 WHERE resource_id=?", (target["id"],))
            if target["kind"] == "PROJECT":
                project = self._project(db, principal, target["id"])
                project["revision"] += 1
                db.execute("UPDATE projects SET document=? WHERE project_id=?", (canonical(project).decode(), target["id"]))
            return operation, True

    def operation(self, principal: Principal, operation_id: str) -> dict:
        with self._connection() as db:
            row = db.execute("SELECT document,project_id,owner_id FROM operations WHERE operation_id=?", (operation_id,)).fetchone()
            if row is None or row[2] != principal.principal_id:
                raise Problem("NOT_FOUND")
            self._project(db, principal, row[1])
            return self._operation_document(row[0])

    def complete_local(self, operation_id, revision, processor_id, products):
        """Product + SUCCEEDED + event + outbox removal in one transaction.

        Files must have been staged durably by the handler before this call.
        This trusted port cannot run a handler, send a job or infer absence.
        """
        from .local_effects import validate_products
        with self.transaction() as db:
            row = db.execute("SELECT document,request FROM operations WHERE operation_id=?", (operation_id,)).fetchone()
            if not row:
                raise Problem("NOT_FOUND")
            operation = self._operation_document(row[0])
            refs = validate_products(self.contracts, operation, products)
            product = products[0]
            request = loads(row[1])
            if product.kind == "CAMPAIGN":
                if {"name": product.document["name"], "drafts": product.document["drafts"]} != request["payload"]:
                    raise Problem("PRECONDITION_FAILED")
            if product.kind == "RESUME_PLAN" and (product.document["payload"]["run_id"] != request["target"]["id"] or product.document["payload"]["from_attempt_id"] != request["payload"]["from_attempt_id"]):
                raise Problem("PRECONDITION_FAILED")
            encoded = canonical(product.document).decode()
            previous = db.execute("SELECT processor_id,kind,product_id,revision,document,document_hash FROM operation_products WHERE operation_id=?", (operation_id,)).fetchone()
            if previous:
                # A lost local acknowledgement may repeat the commit call,
                # but cannot overwrite a document or complete another claim.
                if previous != (processor_id, product.kind, product.product_id, product.revision, encoded, digest(product.document)) or operation["payload"]["state"] != "SUCCEEDED" or operation["payload"]["revision"] != revision+1:
                    raise Problem("PRECONDITION_FAILED")
                return operation
            claim = db.execute("SELECT processor_id FROM outbox WHERE operation_id=?", (operation_id,)).fetchone()
            if operation["payload"]["state"] != "RUNNING" or operation["payload"]["revision"] != revision:
                raise Problem("REVISION_CONFLICT")
            if not claim or claim[0] != processor_id or db.execute("SELECT 1 FROM resources WHERE resource_id=?", (product.product_id,)).fetchone():
                raise Problem("PRECONDITION_FAILED")
            db.execute("INSERT INTO resources VALUES(?,?,?,?,?)", (product.product_id, product.kind, operation["project_id"], product.revision, encoded))
            db.execute("INSERT INTO operation_products VALUES(?,?,?,?,?,?,?)", (operation_id, processor_id, product.kind, product.product_id, product.revision, encoded, digest(product.document)))
            return self._transition(db, operation, revision, "SUCCEEDED", result={"product_refs": refs}, processor_id=processor_id)

    def local_products(self, principal, operation_id):
        """Authorized immutable evidence lookup, not a public read endpoint."""
        from .local_effects import LocalProduct, validate_products
        with self._connection() as db:
            row = db.execute("SELECT document,owner_id,project_id FROM operations WHERE operation_id=?", (operation_id,)).fetchone()
            if not row or row[1] != principal.principal_id:
                raise Problem("NOT_FOUND")
            self._project(db, principal, row[2])
            operation = self._operation_document(row[0])
            product = db.execute("SELECT p.kind,p.product_id,p.revision,p.document,p.document_hash,r.project_id,r.kind FROM operation_products p JOIN resources r ON p.product_id=r.resource_id WHERE p.operation_id=?", (operation_id,)).fetchone()
            if not product:
                return ()
            document = loads(product[3])
            if digest(document) != product[4] or product[5] != operation["project_id"] or product[6] != product[0]:
                raise Problem("PRECONDITION_FAILED")
            values = (LocalProduct(product[0], product[1], product[2], document),)
            validate_products(self.contracts, operation, values)
            return values

    def local_product(self, owner, kind, product_id):
        """Private application lookup, with the same authorized immutable read.

        Current aggregate revisions can advance after accepting commands. Their
        source product stays the original confirmed snapshot, not a UI cache.
        """
        with self._connection() as db:
            row = db.execute("SELECT operation_id FROM operation_products WHERE kind=? AND product_id=?", (kind, product_id)).fetchone()
        if row is None:
            raise Problem("NOT_FOUND")
        values = self.local_products(owner, row[0])
        if len(values) != 1 or values[0].kind != kind or values[0].product_id != product_id:
            raise Problem("PRECONDITION_FAILED")
        return values[0]

    def _operation_document(self, raw: str) -> dict:
        return self.contracts.validate("operation-record", loads(raw))

    def request_for_processor(self, operation_id: str, processor_id: str) -> dict:
        with self._connection() as db:
            row = db.execute("SELECT o.request FROM operations o JOIN outbox b ON o.operation_id=b.operation_id WHERE o.operation_id=? AND b.processor_id=?", (operation_id, processor_id)).fetchone()
            if row is None:
                raise Problem("PRECONDITION_FAILED")
            return self.contracts.validate("operation-request", loads(row[0]))

    def claim(self, processor_id: str) -> dict | None:
        with self.transaction() as db:
            row = operation = None
            for candidate in db.execute("SELECT o.operation_id,o.document FROM outbox b JOIN operations o ON b.operation_id=o.operation_id WHERE b.processor_id IS NULL ORDER BY o.operation_id"):
                value = self._operation_document(candidate[1])
                if value["payload"]["action"] in {"SUBMIT_RUN", "EXECUTE_RESUME_PLAN"}:
                    try:
                        self._execution_ready(db)
                    except Problem:
                        continue  # retained, not rejected or silently dispatched
                row, operation = candidate, value
                break
            if row is None:
                return None
            if operation["payload"]["state"] != "PENDING":
                raise ValueError("Outbox and operation disagree; recovery required")
            db.execute("UPDATE outbox SET processor_id=?,claimed_at=? WHERE operation_id=? AND processor_id IS NULL", (processor_id, now(), row[0]))
            return self._transition(db, operation, 1, "RUNNING", processor_id=processor_id)

    def _transition(self, db, operation: dict, revision: int, destination: str, *, result=None, error=None, no_effect=False, processor_id=None) -> dict:
        payload = operation["payload"]
        if payload["revision"] != revision:
            raise Problem("REVISION_CONFLICT")
        if processor_id is not None:
            row = db.execute("SELECT processor_id FROM outbox WHERE operation_id=?", (payload["operation_id"],)).fetchone()
            if not row or row[0] != processor_id:
                raise Problem("PRECONDITION_FAILED")
        intent = self._effect_intent(db, payload["operation_id"])
        if destination == "OUTCOME_UNKNOWN" and intent:
            fields = {key: intent["payload"][key] for key in ("operation_id", "attempt_token", "package_ref", "profile", "scheduler", "authority_generation")}
            receipt = envelope("submission-receipt", operation["project_id"], {**fields, "status": "SUBMISSION_UNKNOWN", "job": None, "evidence": []}, contracts=self.contracts)
            result = {**(result or {}), "receipt": receipt}
        transition_guard(operation, destination, result, error, no_effect=no_effect, effect_intent=intent)
        local_actions = resource_json("transitions/operation-transitions.json")["effect_classes"]["LOCAL_ATOMIC"]["actions"]
        if destination == "FAILED" and payload["action"] in local_actions and db.execute("SELECT 1 FROM operation_products WHERE operation_id=?", (payload["operation_id"],)).fetchone():
            raise Problem("PRECONDITION_FAILED")
        if destination == "SUCCEEDED" and payload["action"] in local_actions:
            product = db.execute("SELECT kind,product_id,revision,document,document_hash FROM operation_products WHERE operation_id=?", (payload["operation_id"],)).fetchone()
            if not product or digest(loads(product[3])) != product[4]:
                raise Problem("PRECONDITION_FAILED")
            refs = [{"kind": product[0], "id": product[1], "revision": product[2]}]
            actual = result.get("receipt", {}).get("payload", {}).get("product_refs") if payload["state"] == "OUTCOME_UNKNOWN" else result.get("product_refs")
            if actual != refs:
                raise Problem("PRECONDITION_FAILED")
        source = payload["state"]
        payload.update(state=destination, revision=revision+1, updated_at=now(), result=result, error=error)
        payload["key_retention"]["effects_alive"] = destination in {"PENDING", "RUNNING", "OUTCOME_UNKNOWN"}
        payload["event_cursor"] = self._event(db, operation, source, destination)
        reseal(operation)
        self.contracts.validate("operation-record", operation)
        db.execute("UPDATE operations SET document=? WHERE operation_id=?", (canonical(operation).decode(), payload["operation_id"]))
        if destination in resource_json("transitions/operation-transitions.json")["terminal"]:
            db.execute("DELETE FROM outbox WHERE operation_id=?", (payload["operation_id"],))
        return operation

    def transition(self, operation_id: str, revision: int, destination: str, **options) -> dict:
        with self.transaction() as db:
            row = db.execute("SELECT document FROM operations WHERE operation_id=?", (operation_id,)).fetchone()
            if row is None:
                raise Problem("NOT_FOUND")
            return self._transition(db, self._operation_document(row[0]), revision, destination, **options)

    def recover(self) -> int:
        # Only at exclusive service startup. Claims cannot be taken over while
        # a previous processor may still be alive. Local effects stay unknown.
        count = 0
        with self.transaction() as db:
            for row in db.execute("SELECT document FROM operations").fetchall():
                operation = loads(row[0])
                self.contracts.validate("operation-record", operation)
                if operation["payload"]["state"] == "RUNNING":
                    self._transition(db, operation, operation["payload"]["revision"], "OUTCOME_UNKNOWN")
                    count += 1
        return count

    def _effect_intent(self, db, operation_id):
        row = db.execute("SELECT document FROM effect_intents WHERE operation_id=?", (operation_id,)).fetchone()
        return self.contracts.validate("effect-intent", loads(row[0])) if row else None

    def persist_effect_intent(self, operation_id, revision, processor_id, document):
        with self.transaction() as db:
            return self._persist_effect_intent(db, operation_id, revision, processor_id, document)

    def _persist_effect_intent(self, db, operation_id, revision, processor_id, document):
        """Trusted processor write-ahead boundary, never a client HTTP endpoint."""
        self._execution_ready(db)
        self.contracts.validate("effect-intent", document)
        if document["integrity"]["status"] != "VERIFIED":
            raise Problem("PRECONDITION_FAILED")
        row = db.execute("SELECT o.document,o.request,b.processor_id FROM operations o JOIN outbox b ON o.operation_id=b.operation_id WHERE o.operation_id=?", (operation_id,)).fetchone()
        if not row or row[2] != processor_id:
            raise Problem("PRECONDITION_FAILED")
        operation, request = self._operation_document(row[0]), loads(row[1])
        payload, intent = operation["payload"], document["payload"]
        if payload["state"] != "RUNNING" or payload["revision"] != revision or intent["operation_id"] != operation_id or intent["action"] != payload["action"] or document["project_id"] != operation["project_id"]:
            raise Problem("PRECONDITION_FAILED")
        if request.get("profile_ref") is not None and intent["profile"]["profile_id"] != request["profile_ref"]:
            raise Problem("PRECONDITION_FAILED")
        if payload["action"] == "EXECUTE_RESUME_PLAN":
            target = db.execute("SELECT document FROM resources WHERE resource_id=? AND kind='RESUME_PLAN' AND project_id=?", (request["target"]["id"], operation["project_id"])).fetchone()
            if not target or target[0] is None:
                raise Problem("PRECONDITION_FAILED")
            resume = self.contracts.validate("resume-plan", loads(target[0]))
            if resume["payload"]["run_id"] != intent["run_id"]:
                raise Problem("PRECONDITION_FAILED")
        previous = self._effect_intent(db, operation_id)
        if previous:
            if previous != document:
                raise Problem("PRECONDITION_FAILED")
            return previous
        db.execute("INSERT INTO effect_intents VALUES(?,?)", (operation_id, canonical(document).decode()))
        return document

    def events(self, principal: Principal, project_id: str, after: int = 0) -> list[dict]:
        with self._connection() as db:
            self._project(db, principal, project_id)
            return [loads(r[0]) for r in db.execute("SELECT document FROM events WHERE project_id=? AND sequence>? ORDER BY sequence LIMIT 1000", (project_id, after))]

    def checkpoint(self, destination: Path) -> None:
        destination = Path(destination).absolute()
        if destination.exists() or destination == self.path:
            raise ValueError("Checkpoint destination must be new")
        # Reserve before writing, so a competing backup cannot clobber it.
        with destination.open("xb"):
            pass
        with self._connection() as source:
            target = sqlite3.connect(destination)
            try:
                source.backup(target)
            finally:
                target.close()
        if os.name != "nt":
            destination.chmod(0o600)
