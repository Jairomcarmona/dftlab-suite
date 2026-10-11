"""Operator-only, single-owner SQLite/ArtifactStore checkpoint adapter.

The packet codec is private and versioned; RecoveryCheckpoint is the original
public envelope. This first adapter deliberately refuses native runs: their
journals require a qualified quiescence/terminal adapter, not a DB write lock.
No HTTP route, credentials, implicit overwrite, GC or admission reopening.
"""
from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import re
import sqlite3
import stat
from typing import Protocol

from .artifact_storage import SQLiteArtifactIndex
from .artifacts import LocalArtifactStore
from .contracts import BASE, canonical, loads
from .domain import Principal, Problem, envelope, identifier, now
from .local_runtime import private_directory
from .storage import SQLiteRepository


class CheckpointPort(Protocol):
    def create(self, owner: Principal, project: str, destination: Path, engine_versions: list[dict]) -> dict: ...
    def restore(self, packet: Path, expected_digest: str, destination: Path): ...


@dataclass(frozen=True)
class RestoredInstance:
    repository: SQLiteRepository
    artifacts: LocalArtifactStore
    checkpoint: dict


def checked_path(path):
    path = Path(path).absolute()
    if any(item.is_symlink() or (os.name == "nt" and item.is_junction()) for item in (path, *path.parents)):
        raise Problem("PRECONDITION_FAILED")
    return path.resolve()


def sync_directory(path):
    if os.name != "nt":
        descriptor = os.open(path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def write_new(path, data):
    with path.open("xb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    if os.name != "nt":
        path.chmod(0o600)
    sync_directory(path.parent)


def open_original(path):
    path = checked_path(path)
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    information = os.fstat(descriptor)
    if not stat.S_ISREG(information.st_mode) or information.st_nlink != 1:
        os.close(descriptor)
        raise Problem("PRECONDITION_FAILED")
    return os.fdopen(descriptor, "rb")


def file_hash(path, limit):
    hashed, size = hashlib.sha256(), 0
    with open_original(path) as stream:
        while block := stream.read(1024**2):
            size += len(block)
            if size > limit:
                raise Problem("PAYLOAD_TOO_LARGE")
            hashed.update(block)
    return size, hashed.hexdigest()


def copy_original(source, target, size, expected=None):
    """For OPEN uploads copy only the SQL-committed prefix; keep source intact."""
    hashed, remaining = hashlib.sha256(), size
    with target.open("xb") as output:
        if source is not None:
            with open_original(source) as stream:
                while remaining:
                    block = stream.read(min(1024**2, remaining))
                    if not block:
                        raise Problem("PRECONDITION_FAILED")
                    output.write(block)
                    hashed.update(block)
                    remaining -= len(block)
                if expected is not None and stream.read(1):
                    raise Problem("PRECONDITION_FAILED")
        elif size:
            raise Problem("PRECONDITION_FAILED")
        output.flush()
        os.fsync(output.fileno())
    result = hashed.hexdigest()
    if expected is not None and result != expected:
        raise Problem("PRECONDITION_FAILED")
    if os.name != "nt":
        target.chmod(0o600)
    sync_directory(target.parent)
    return result


class SQLiteCheckpointStore:
    """No direct sqlite file copy while live; Backup API under a writer barrier.

    Every ArtifactIndex file mutation is serialized by the same SQL writer
    transaction. A checkpoint therefore retains committed chunks, COMMITTING
    blobs and metadata, including publication crashes, as one recoverable set.
    Packet control artifacts are bootstrap objects outside the snapshotted DB;
    they are not falsely advertised as already indexed by the restored store.
    """
    def __init__(self, repository, artifacts, *, max_files=4096, max_bytes=4*1024**3):
        if artifacts.index.repository.path != repository.path or type(max_files) is not int or max_files < 1 or type(max_bytes) is not int or max_bytes < 1:
            raise ValueError("One bounded local repository/store required")
        self.repository, self.artifacts = repository, artifacts
        self.contracts = repository.contracts
        self.max_files, self.max_bytes = max_files, max_bytes

    @staticmethod
    def _tables(db):
        return {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}

    def _metadata(self, db):
        tables = self._tables(db)
        # Do not claim a complete native checkpoint with absent journals.
        if db.execute("SELECT 1 FROM resources WHERE kind='RUN' LIMIT 1").fetchone():
            raise Problem("PRECONDITION_FAILED")
        for table in ("controller_authorities", "scheduler_dispatches"):
            if table in tables and db.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone():
                raise Problem("PRECONDITION_FAILED")
        revisions = {}
        for table in sorted(tables):
            if table == "migrations" or table.endswith("_migrations"):
                # Table names are discovered locally, not interpolated input.
                if re.fullmatch(r"[a-z_]+", table) is None:
                    raise Problem("PRECONDITION_FAILED")
                revisions[table] = [row[0] for row in db.execute(f'SELECT version FROM "{table}" ORDER BY version')]
        if any(versions != [1] for versions in revisions.values()):
            raise Problem("PRECONDITION_FAILED")
        records = [self.contracts.validate("artifact-record", loads(row[0])) for row in db.execute("SELECT document FROM artifact_records ORDER BY artifact_id")]
        uploads = [loads(row[0]) for row in db.execute("SELECT document FROM uploads ORDER BY upload_id")]
        pending = []
        for op_id, document in db.execute("SELECT operation_id,document FROM operations ORDER BY operation_id"):
            if self.repository._operation_document(document)["payload"]["state"] in {"PENDING", "RUNNING", "OUTCOME_UNKNOWN"}:
                pending.append(op_id)
        return revisions, records, uploads, pending

    def _expected_files(self, records, uploads, root):
        expected = {}
        def add(category, key, size, sha):
            # Reuse the store's UUID policy, without accepting a path as ID.
            self.artifacts._path(category, key)
            value = {"category": category, "id": key, "size_bytes": size, "sha256": sha}
            old = expected.setdefault((category, key), value)
            if old != value:
                raise Problem("PRECONDITION_FAILED")
        for record in records:
            payload = record["payload"]
            if payload["integrity_state"] != "VERIFIED":
                raise Problem("PRECONDITION_FAILED")
            add("blobs", payload["artifact_id"], payload["size_bytes"], payload["sha256"])
        for upload in uploads:
            payload = self.contracts.validate("artifact-record", upload["record"])["payload"]
            received = upload["received_bytes"]
            if type(received) is not int or not 0 <= received <= payload["size_bytes"] or upload["size_bytes"] != payload["size_bytes"]:
                raise Problem("PRECONDITION_FAILED")
            staging = root/"staging"/upload["upload_id"]
            blob = root/"blobs"/payload["artifact_id"]
            if upload["state"] == "OPEN":
                add("staging", upload["upload_id"], received, None)
            elif upload["state"] in {"COMMITTING", "COMMITTED"} and received == payload["size_bytes"]:
                if blob.exists():
                    add("blobs", payload["artifact_id"], received, payload["sha256"])
                elif upload["state"] == "COMMITTED":
                    raise Problem("PRECONDITION_FAILED")
                if staging.exists():
                    add("staging", upload["upload_id"], received, payload["sha256"])
                elif not blob.exists():
                    raise Problem("PRECONDITION_FAILED")
            else:
                raise Problem("PRECONDITION_FAILED")
        if len(expected) > self.max_files or sum(value["size_bytes"] for value in expected.values()) > self.max_bytes:
            raise Problem("PAYLOAD_TOO_LARGE")
        return expected

    def create(self, owner, project, destination, engine_versions):
        self.contracts.validate_ref(BASE+"schemas/recovery-checkpoint.schema.json#/$defs/payload/properties/engine_versions", engine_versions)
        if not {"qraft", "hubbardflow"} <= {pin["engine"] for pin in engine_versions}:
            raise Problem("PRECONDITION_FAILED")
        destination = checked_path(destination)
        if destination.exists() or destination.is_relative_to(self.artifacts.root) or self.artifacts.root.is_relative_to(destination) or self.repository.path.is_relative_to(destination):
            raise Problem("PRECONDITION_FAILED")
        with self.repository.transaction() as db:
            self.repository._project(db, owner, project)
            projects = db.execute("SELECT project_id,owner_id FROM projects ORDER BY project_id").fetchall()
            if any(row[1] != owner.principal_id for row in projects):
                raise Problem("PRECONDITION_FAILED")  # no implicit admin export
            revisions, records, uploads, pending = self._metadata(db)
            expected = self._expected_files(records, uploads, self.artifacts.root)
            for category in ("blobs", "staging"):
                for path in (self.artifacts.root/category).iterdir():
                    if (category, path.name) not in expected:
                        raise Problem("PRECONDITION_FAILED")  # retain orphan; do not silently omit
            destination.mkdir(mode=0o700, parents=False)
            private_directory(destination)  # modifies only our new directory
            objects = destination/"objects"
            objects.mkdir(mode=0o700)
            files = destination/"files"
            for category in ("blobs", "staging"):
                (files/category).mkdir(mode=0o700, parents=True)
            db_id, manifest_id = identifier(), identifier()
            snapshot = objects/db_id
            self.repository.checkpoint(snapshot)
            db_size, db_sha = file_hash(snapshot, self.max_bytes)
            with snapshot.open("r+b") as stream:
                os.fsync(stream.fileno())
            entries = []
            for (category, key), value in sorted(expected.items()):
                source = self.artifacts._path(category, key)
                if not source.exists() and value["size_bytes"] != 0:
                    raise Problem("PRECONDITION_FAILED")
                sha = copy_original(source if source.exists() else None, files/category/key, value["size_bytes"], value["sha256"])
                entries.append({**value, "sha256": sha})
            manifest = {"format": "dftlab.sqlite-artifacts-checkpoint", "version": 1, "scope": "SINGLE_OWNER_INSTANCE",
                        "owner_principal_id": owner.principal_id, "project_ids": [row[0] for row in projects],
                        "schema_revisions": revisions, "artifact_records": records, "files": entries}
            manifest_bytes = canonical(manifest)
            if len(manifest_bytes) > 16*1024**2 or db_size+sum(item["size_bytes"] for item in entries) > self.max_bytes:
                raise Problem("PAYLOAD_TOO_LARGE")
            write_new(objects/manifest_id, manifest_bytes)
            reference = lambda key, sha, media: {"artifact_id": key, "sha256": sha, "media_type": media}
            checkpoint = envelope("recovery-checkpoint", project,
                                  {"db_snapshot": {"method": "SQLITE_BACKUP_API", "artifact": reference(db_id, db_sha, "application/octet-stream"), "schema_revision": canonical(revisions).decode()},
                                   "artifact_manifest": reference(manifest_id, hashlib.sha256(manifest_bytes).hexdigest(), "application/json"),
                                   "journal_cursors": [], "engine_versions": engine_versions, "taken_at": now(), "pending_operation_ids": pending}, contracts=self.contracts)
            sync_directory(objects)
            sync_directory(files)
            # Sole readiness marker, written only after every verified object.
            write_new(destination/"checkpoint.json", canonical(checkpoint))
            sync_directory(destination.parent)
            return checkpoint

    def restore(self, packet, expected_digest, destination):
        packet, destination = checked_path(packet), checked_path(destination)
        if re.fullmatch(r"[0-9a-f]{64}", expected_digest or "") is None or destination.exists() or destination.is_relative_to(packet) or packet.is_relative_to(destination):
            raise Problem("PRECONDITION_FAILED")
        with open_original(packet/"checkpoint.json") as stream:
            checkpoint = self.contracts.validate("recovery-checkpoint", loads(stream.read(16*1024**2+1)))
        payload = checkpoint["payload"]
        if checkpoint["integrity"]["status"] != "VERIFIED" or checkpoint["integrity"]["digest"] != expected_digest or payload["db_snapshot"]["method"] != "SQLITE_BACKUP_API" or payload["journal_cursors"]:
            raise Problem("PRECONDITION_FAILED")
        objects = []
        for reference in (payload["db_snapshot"]["artifact"], payload["artifact_manifest"]):
            self.artifacts._path("blobs", reference["artifact_id"])
            source = packet/"objects"/reference["artifact_id"]
            size, sha = file_hash(source, self.max_bytes)
            if sha != reference["sha256"]:
                raise Problem("PRECONDITION_FAILED")
            objects.append((source, size, sha))
        with open_original(objects[1][0]) as stream:
            manifest = loads(stream.read(16*1024**2+1))
        if set(manifest) != {"format", "version", "scope", "owner_principal_id", "project_ids", "schema_revisions", "artifact_records", "files"} or manifest["format"] != "dftlab.sqlite-artifacts-checkpoint" or manifest["version"] != 1 or manifest["scope"] != "SINGLE_OWNER_INSTANCE" or canonical(manifest["schema_revisions"]).decode() != payload["db_snapshot"]["schema_revision"]:
            raise Problem("PRECONDITION_FAILED")
        if len(manifest["files"]) > self.max_files:
            raise Problem("PAYLOAD_TOO_LARGE")
        seen, total = set(), objects[0][1]
        for item in manifest["files"]:
            if set(item) != {"category", "id", "size_bytes", "sha256"} or item["category"] not in {"blobs", "staging"} or type(item["size_bytes"]) is not int or item["size_bytes"] < 0 or re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) is None:
                raise Problem("PRECONDITION_FAILED")
            self.artifacts._path(item["category"], item["id"])
            key = (item["category"], item["id"])
            if key in seen:
                raise Problem("PRECONDITION_FAILED")
            seen.add(key)
            total += item["size_bytes"]
            if total > self.max_bytes:
                raise Problem("PAYLOAD_TOO_LARGE")
            if file_hash(packet/"files"/item["category"]/item["id"], self.max_bytes) != (item["size_bytes"], item["sha256"]):
                raise Problem("PRECONDITION_FAILED")
        destination.mkdir(mode=0o700, parents=False)
        private_directory(destination)
        state = destination/"state.sqlite"
        copy_original(objects[0][0], state, objects[0][1], objects[0][2])
        # Set recovery before returning/opening an API; never a live restored DB.
        with sqlite3.connect(state) as db:
            db.execute("UPDATE instance_recovery SET mode='RECOVERY',checkpoint=? WHERE singleton=1", (canonical(checkpoint).decode(),))
            if db.execute("SELECT changes()").fetchone()[0] != 1:
                raise Problem("PRECONDITION_FAILED")
        # Gate is already durable even if validation or file copy now fails.
        with sqlite3.connect(state) as db:
            if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)] or db.execute("PRAGMA foreign_key_check").fetchall():
                raise Problem("PRECONDITION_FAILED")
            revisions, records, uploads, pending = self._metadata(db)
            projects = db.execute("SELECT project_id,owner_id FROM projects ORDER BY project_id").fetchall()
            if revisions != manifest["schema_revisions"] or records != manifest["artifact_records"] or pending != payload["pending_operation_ids"] or [row[0] for row in projects] != manifest["project_ids"] or any(row[1] != manifest["owner_principal_id"] for row in projects) or checkpoint["project_id"] not in manifest["project_ids"]:
                raise Problem("PRECONDITION_FAILED")
            # File inventory must be exactly what the snapshotted metadata needs.
            expected = self._expected_files(records, uploads, packet/"files")
            if set(expected) != seen:
                raise Problem("PRECONDITION_FAILED")
            for item in manifest["files"]:
                value = expected[(item["category"], item["id"])]
                if value["size_bytes"] != item["size_bytes"] or (value["sha256"] is not None and value["sha256"] != item["sha256"]):
                    raise Problem("PRECONDITION_FAILED")
        repository = SQLiteRepository(state)
        store = LocalArtifactStore(destination/"artifacts", SQLiteArtifactIndex(repository))
        for item in manifest["files"]:
            copy_original(packet/"files"/item["category"]/item["id"], store._path(item["category"], item["id"]), item["size_bytes"], item["sha256"])
        # Preserve bootstrap objects/manifest outside ArtifactIndex, without
        # fabricating that the old snapshot already indexed their new IDs.
        bootstrap = destination/"checkpoint"
        (bootstrap/"objects").mkdir(mode=0o700, parents=True)
        for source, size, sha in objects:
            copy_original(source, bootstrap/"objects"/source.name, size, sha)
        repository.recover()  # RUNNING -> UNKNOWN, not proof of absent effect
        write_new(bootstrap/"checkpoint.json", canonical(checkpoint))
        sync_directory(destination)
        sync_directory(destination.parent)
        return RestoredInstance(repository, store, checkpoint)
