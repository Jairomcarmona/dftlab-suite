"""SQLite adapter for immutable drafts with owner/project scoped idempotency."""
from .contracts import BASE, canonical, digest, loads
from .domain import Problem
from .drafts import materialize


class SQLiteDraftRepository:
    def __init__(self, repository, artifacts):
        self.repository, self.artifacts = repository, artifacts
        self.contracts = repository.contracts
        with repository.transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS draft_migrations(version INTEGER PRIMARY KEY)")
            versions = [row[0] for row in db.execute("SELECT version FROM draft_migrations ORDER BY version")]
            if not versions:
                db.execute("CREATE TABLE drafts(draft_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(project_id), revision INTEGER NOT NULL)")
                db.execute("CREATE TABLE draft_versions(draft_id TEXT NOT NULL REFERENCES drafts(draft_id), revision INTEGER NOT NULL, content TEXT NOT NULL, bundle TEXT NOT NULL, PRIMARY KEY(draft_id,revision))")
                db.execute("CREATE TABLE draft_keys(owner_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(project_id), idem_key TEXT NOT NULL, request_hash TEXT NOT NULL, bundle TEXT NOT NULL, PRIMARY KEY(owner_id,project_id,idem_key))")
                db.execute("INSERT INTO draft_migrations VALUES(1)")
            elif versions != [1]:
                raise ValueError("Explicit draft migration required")

    def _get(self, db, owner, draft_id):
        row = db.execute("SELECT project_id,revision,owner_id FROM drafts WHERE draft_id=?", (draft_id,)).fetchone()
        if row is None or row[2] != owner.principal_id:
            raise Problem("NOT_FOUND")
        self.repository._project(db, owner, row[0])
        version = db.execute("SELECT content,bundle FROM draft_versions WHERE draft_id=? AND revision=?", (draft_id, row[1])).fetchone()
        return row[0], loads(version[0]), self._bundle(loads(version[1]))

    def _bundle(self, bundle):
        self.contracts.validate_ref(self.contracts.api_ref("getDraft", status=200), bundle)
        for name, record in [("draft", bundle["draft"]), ("structure-revision", bundle["structure"])]:
            self.contracts.validate(name, record)
        if bundle["intent"]:
            for key, name in [("run_intent", "run-intent"), ("physical_model", "physical-model"), ("numerical_policy", "numerical-policy")]:
                self.contracts.validate(name, bundle["intent"][key])
        return bundle

    def _repeat(self, db, owner, project, key, hashed):
        row = db.execute("SELECT request_hash,bundle FROM draft_keys WHERE owner_id=? AND project_id=? AND idem_key=?", (owner.principal_id, project, key)).fetchone()
        if row:
            if row[0] != hashed:
                raise Problem("IDEMPOTENCY_KEY_REUSED")
            return self._bundle(loads(row[1]))

    def _save(self, db, owner, project, request, hashed, content, bundle):
        draft = bundle["draft"]["payload"]
        encoded = canonical(self._bundle(bundle)).decode()
        db.execute("INSERT INTO draft_versions VALUES(?,?,?,?)", (draft["draft_id"], draft["revision"], canonical(content).decode(), encoded))
        db.execute("INSERT INTO draft_keys VALUES(?,?,?,?,?)", (owner.principal_id, project, request["idempotency_key"], hashed, encoded))
        return bundle, True

    def create(self, owner, project_id, request):
        self.contracts.validate_ref(self.contracts.api_ref("createDraft"), request)
        hashed = digest({"operation": "createDraft", "request": request})
        # Resolve imported evidence only through the authorized artifact port.
        self.repository.project(owner, project_id)
        with self.repository._connection() as db:
            repeated = self._repeat(db, owner, project_id, request["idempotency_key"], hashed)
            if repeated:
                return repeated, False
        provenance = "PARTIAL" if request["origin"]["kind"] == "LEARNING_PROMOTION" else "UNKNOWN"
        source = request["origin"]["source_artifact"]
        if source:
            record = self.artifacts.metadata(owner, source["artifact_id"])
            payload = record["payload"]
            if record["project_id"] != project_id or payload["sha256"] != source["sha256"] or payload["media_type"] != source["media_type"]:
                raise Problem("NOT_FOUND")
            if payload["integrity_state"] == "VERIFIED" and self.artifacts.verify(owner, source["artifact_id"]):
                provenance = "PARTIAL"
        with self.repository.transaction() as db:
            self.repository._project(db, owner, project_id)
            repeated = self._repeat(db, owner, project_id, request["idempotency_key"], hashed)
            if repeated:
                return repeated, False
            content = {k: v for k, v in request.items() if k != "idempotency_key"}
            bundle = materialize(project_id, content, provenance, contracts=self.contracts)
            db.execute("INSERT INTO drafts VALUES(?,?,?,1)", (bundle["draft"]["payload"]["draft_id"], owner.principal_id, project_id))
            return self._save(db, owner, project_id, request, hashed, content, bundle)

    def revise(self, owner, draft_id, request):
        self.contracts.validate_ref(self.contracts.api_ref("reviseDraft"), request)
        hashed = digest({"operation": "reviseDraft", "draft_id": draft_id, "request": request})
        with self.repository.transaction() as db:
            project, content, previous = self._get(db, owner, draft_id)
            repeated = self._repeat(db, owner, project, request["idempotency_key"], hashed)
            if repeated:
                return repeated, False
            if previous["draft"]["payload"]["revision"] != request["expected_revision"]:
                raise Problem("PRECONDITION_FAILED")
            content.update(request["changes"])
            bundle = materialize(project, content, previous["draft"]["payload"]["provenance_state"], previous, contracts=self.contracts)
            db.execute("UPDATE drafts SET revision=? WHERE draft_id=?", (bundle["draft"]["payload"]["revision"], draft_id))
            return self._save(db, owner, project, request, hashed, content, bundle)

    def get(self, owner, draft_id):
        with self.repository._connection() as db:
            return self._get(db, owner, draft_id)[2]

    def get_revision(self, owner, draft_id, revision):
        """Application port for an accepted command, never a new HTTP endpoint.

        A newer editor revision cannot silently change a queued preflight/plan.
        Both authorization and the selected immutable bundle are checked here.
        """
        self.contracts.validate_ref(BASE+"schemas/defs.schema.json#/$defs/revision", revision)
        with self.repository._connection() as db:
            project, _, _ = self._get(db, owner, draft_id)
            version = db.execute("SELECT bundle FROM draft_versions WHERE draft_id=? AND revision=?", (draft_id, revision)).fetchone()
            if version is None:
                raise Problem("NOT_FOUND")
            bundle = self._bundle(loads(version[0]))
        draft, structure = bundle["draft"], bundle["structure"]
        if draft["payload"]["draft_id"] != draft_id or draft["payload"]["revision"] != revision:
            raise Problem("PRECONDITION_FAILED")
        if draft["payload"]["structure"] != {"structure_id": structure["payload"]["structure_id"], "revision": structure["payload"]["revision"]}:
            raise Problem("PRECONDITION_FAILED")
        records = [draft, structure]
        intent = bundle["intent"]
        if intent is None:
            if draft["payload"]["intent_id"] is not None:
                raise Problem("PRECONDITION_FAILED")
        else:
            run = intent["run_intent"]["payload"]
            if run["intent_id"] != draft["payload"]["intent_id"] or run["draft_id"] != draft_id or run["structure"] != draft["payload"]["structure"] or run["physical_model_ref"] != intent["physical_model"]["record_id"] or run["numerical_policy_ref"] != intent["numerical_policy"]["record_id"]:
                raise Problem("PRECONDITION_FAILED")
            records.extend(intent.values())
        if any(record["project_id"] != project or record["integrity"]["status"] != "VERIFIED" for record in records):
            raise Problem("PRECONDITION_FAILED")
        return bundle

    def list(self, owner, project_id):
        with self.repository._connection() as db:
            self.repository._project(db, owner, project_id)
            ids = [row[0] for row in db.execute("SELECT draft_id FROM drafts WHERE project_id=? AND owner_id=? ORDER BY draft_id", (project_id, owner.principal_id))]
            return [self._get(db, owner, draft_id)[2]["draft"] for draft_id in ids]
