"""Artifact port and local implementation; names and host paths are never IDs."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
import hashlib
import os
from pathlib import Path
import re
import stat
from typing import Callable, Iterator, Protocol

from .contracts import Contracts, digest
from .domain import Principal, Problem, envelope, identifier
from .storage import local_database


class ArtifactIndex(Protocol):
    def stage(self, owner: Principal, request: dict, document: dict, limit: int, quota: int) -> dict: ...
    def update(self, owner: Principal, upload_id: str, change: Callable[[dict], None]) -> dict: ...
    def publish(self, owner: Principal, upload_id: str) -> dict: ...
    def metadata(self, owner: Principal, artifact_id: str) -> dict: ...


class ArtifactStore(Protocol):
    def stage(self, owner: Principal, request: dict) -> dict: ...
    def write(self, owner: Principal, upload_id: str, start: int, end: int, total: int, data: bytes) -> dict: ...
    def commit(self, owner: Principal, upload_id: str) -> dict: ...
    def metadata(self, owner: Principal, artifact_id: str) -> dict: ...
    def stream(self, owner: Principal, artifact_id: str, start: int = 0, end: int | None = None) -> Iterator[bytes]: ...
    def verify(self, owner: Principal, artifact_id: str) -> bool: ...
    def retention(self, owner: Principal, artifact_id: str) -> dict: ...


class LocalArtifactStore:
    def __init__(self, root: Path, index: ArtifactIndex, *, max_size=1024**3, max_chunk=8*1024**2, active_limit=32, quota=4*1024**3):
        root = Path(root).absolute()
        if root.is_symlink():
            raise ValueError("Artifact root must not be a symlink")
        self.root = local_database(root / "location-check").parent
        self.index = index
        self.contracts = Contracts()
        self.max_size, self.max_chunk, self.active_limit, self.quota = max_size, max_chunk, active_limit, quota
        for name in ("staging", "blobs"):
            directory = self.root / name
            if directory.is_symlink():
                raise ValueError("Artifact directory must not be a symlink")
            directory.mkdir(mode=0o700, exist_ok=True)

    def _path(self, category: str, key: str) -> Path:
        if not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", key):
            raise Problem("NOT_FOUND")
        parent = self.root / category
        path = parent / key
        if parent.is_symlink() or parent.resolve() != parent or path.is_symlink():
            raise Problem("PRECONDITION_FAILED")
        return path

    def _open(self, path: Path, flags: int):
        if path.is_symlink():
            raise Problem("PRECONDITION_FAILED")
        descriptor = os.open(path, flags | getattr(os, "O_NOFOLLOW", 0), 0o600)
        information = os.fstat(descriptor)
        if not stat.S_ISREG(information.st_mode) or information.st_nlink != 1:
            os.close(descriptor)
            raise Problem("PRECONDITION_FAILED")
        return os.fdopen(descriptor, "r+b" if flags & os.O_RDWR else "rb")

    @staticmethod
    def _view(document):
        return {key: document[key] for key in ("upload_id", "received_bytes", "size_bytes", "expires_at")}

    def stage(self, owner: Principal, request: dict) -> dict:
        self.contracts.validate_ref(self.contracts.api_ref("createUpload"), request)
        if request["size_bytes"] > self.max_size:
            raise Problem("PAYLOAD_TOO_LARGE")
        upload_id, artifact_id = identifier(), identifier()
        payload = {"artifact_id": artifact_id, "kind": request["kind"], "media_type": request["media_type"], "size_bytes": request["size_bytes"], "sha256": request["sha256"], "integrity_state": "STAGED", "retention_class": "ESSENTIAL", "producer_ref": {"kind": "IMPORT", "id": upload_id}, "input_refs": [], "parser": None, "locator_id": identifier()}
        # Validate stricter ArtifactRecord metadata before allocating disk space.
        record = envelope("artifact-record", request["project_id"], payload)
        document = {"upload_id": upload_id, "received_bytes": 0, "size_bytes": request["size_bytes"], "expires_at": (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat().replace("+00:00", "Z"), "request": request, "state": "OPEN", "record": record}
        document = self.index.stage(owner, request, document, self.active_limit, self.quota)
        # Creation may have crashed before creating its private empty file.
        if document["state"] == "OPEN":
            path = self._path("staging", document["upload_id"])
            try:
                with self._open(path, os.O_RDWR | os.O_CREAT | os.O_EXCL):
                    pass
            except FileExistsError:
                pass
        return self._view(document)

    def write(self, owner: Principal, upload_id: str, start: int, end: int, total: int, data: bytes) -> dict:
        if len(data) > self.max_chunk:
            raise Problem("PAYLOAD_TOO_LARGE")
        if any(type(x) is not int for x in (start, end, total)) or start < 0 or end < start or end-start+1 != len(data) or end >= total:
            raise Problem("RANGE_NOT_SATISFIABLE")
        def change(doc):
            self._live(doc)
            if doc["state"] != "OPEN" or total != doc["size_bytes"] or start > doc["received_bytes"]:
                raise Problem("RANGE_NOT_SATISFIABLE")
            path = self._path("staging", upload_id)
            with self._open(path, os.O_RDWR | os.O_CREAT) as stream:
                committed = doc["received_bytes"]
                if start < committed:
                    stream.seek(start)
                    if end >= committed or stream.read(len(data)) != data:
                        raise Problem("RANGE_NOT_SATISFIABLE")
                    return  # identical lost-ack retry; no appended duplicate
                stream.truncate(committed)  # discard an uncommitted crash tail
                stream.seek(committed)
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            doc["received_bytes"] = end+1
        document = self.index.update(owner, upload_id, change)
        return self._view(document)

    @staticmethod
    def _live(doc):
        if doc["state"] == "OPEN" and datetime.fromisoformat(doc["expires_at"].replace("Z", "+00:00")) <= datetime.now(timezone.utc):
            raise Problem("NOT_FOUND")

    def _check(self, path: Path, record: dict) -> bool:
        try:
            with self._open(path, os.O_RDONLY) as stream:
                expected = record["payload"]
                hashed, size = hashlib.sha256(), 0
                while block := stream.read(1024**2):
                    hashed.update(block)
                    size += len(block)
                return size == expected["size_bytes"] and hashed.hexdigest() == expected["sha256"]
        except FileNotFoundError:
            return False

    def _publish_file(self, source: Path, destination: Path):
        # IDs are reserved before this rename; metadata remains unpublished.
        os.replace(source, destination)
        if os.name != "nt":
            fd = os.open(destination.parent, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)

    def commit(self, owner: Principal, upload_id: str) -> dict:
        def prepare(doc):
            self._live(doc)
            if doc["state"] == "COMMITTED":
                return
            if doc["received_bytes"] != doc["size_bytes"]:
                raise Problem("PRECONDITION_FAILED")
            if doc["state"] == "OPEN":
                if not self._check(self._path("staging", upload_id), doc["record"]):
                    raise Problem("PRECONDITION_FAILED")
                doc["state"] = "COMMITTING"  # persists before any publication
        doc = self.index.update(owner, upload_id, prepare)
        if doc["state"] == "COMMITTED":
            # Includes recovery after bytes committed but index publication lost.
            if not self._check(self._path("blobs", doc["record"]["payload"]["artifact_id"]), doc["record"]):
                raise Problem("PRECONDITION_FAILED")
            return self.index.publish(owner, upload_id)
        def finish(current):
            # Serialized with chunk writes and competing commits by the index.
            if current["state"] == "COMMITTED":
                return
            source = self._path("staging", upload_id)
            target = self._path("blobs", current["record"]["payload"]["artifact_id"])
            if not target.exists():
                if not self._check(source, current["record"]):
                    raise Problem("PRECONDITION_FAILED")
                self._publish_file(source, target)
            if not self._check(target, current["record"]):
                raise Problem("PRECONDITION_FAILED")
            current["state"] = "COMMITTED"
        self.index.update(owner, upload_id, finish)
        # Retried commit repairs the metadata publication after a crash here.
        return self.index.publish(owner, upload_id)

    def metadata(self, owner: Principal, artifact_id: str) -> dict:
        return self.contracts.validate("artifact-record", self.index.metadata(owner, artifact_id))

    def verify(self, owner: Principal, artifact_id: str) -> bool:
        record = self.metadata(owner, artifact_id)
        return self._check(self._path("blobs", record["payload"]["artifact_id"]), record)

    def stream(self, owner: Principal, artifact_id: str, start=0, end=None) -> Iterator[bytes]:
        record = self.metadata(owner, artifact_id)
        size = record["payload"]["size_bytes"]
        end = size-1 if end is None else end
        if type(start) is not int or type(end) is not int or start < 0 or end >= size or (size and end < start) or (not size and (start != 0 or end != -1)):
            raise Problem("RANGE_NOT_SATISFIABLE")
        path = self._path("blobs", record["payload"]["artifact_id"])
        try:
            stream = self._open(path, os.O_RDONLY)
        except FileNotFoundError:
            raise Problem("PRECONDITION_FAILED") from None
        hashed, received = hashlib.sha256(), 0
        while block := stream.read(1024**2):
            hashed.update(block)
            received += len(block)
        if received != size or hashed.hexdigest() != record["payload"]["sha256"]:
            stream.close()
            raise Problem("PRECONDITION_FAILED")
        def blocks():
            try:
                stream.seek(start)
                remaining = end-start+1
                while remaining:
                    block = stream.read(min(1024**2, remaining))
                    if not block:
                        raise Problem("PRECONDITION_FAILED")
                    remaining -= len(block)
                    yield block
            finally:
                stream.close()
        return blocks()

    def retention(self, owner: Principal, artifact_id: str) -> dict:
        record = self.metadata(owner, artifact_id)
        # Imported originals are essential. No GC may remove them as a cache.
        return {"class": record["payload"]["retention_class"], "delete_allowed": False}
