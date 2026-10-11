"""Registered readonly native quiescence and packet file inventory helpers.

No engine internals, numeric validation, permission toggle or takeover. An
operator registers original roots/refs and a qualified positive terminal check.
The original kernel lock inode must exist and be free; lease expiry alone never
proves quiescence. These callbacks are not deserialized from HTTP or a packet.
"""
from contextlib import contextmanager, ExitStack
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path, PurePosixPath
import re

from .contracts import canonical, loads
from .domain import Problem


@contextmanager
def original_guard(path):
    """Lock the retained inode without creating/replacing a missing guard."""
    import stat
    from .checkpoints import checked_path
    path = checked_path(path)
    before = path.stat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size < 1:
        raise Problem("PRECONDITION_FAILED")
    descriptor = os.open(path, os.O_RDWR | getattr(os, "O_NOFOLLOW", 0))
    try:
        information = os.fstat(descriptor)
        if (information.st_dev, information.st_ino) != (before.st_dev, before.st_ino):
            raise Problem("PRECONDITION_FAILED")
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise Problem("PRECONDITION_FAILED") from None
        current = checked_path(path).stat()
        if current.st_nlink != 1 or (current.st_dev, current.st_ino) != (information.st_dev, information.st_ino):
            raise Problem("PRECONDITION_FAILED")
        yield information.st_dev, information.st_ino
    finally:
        os.close(descriptor)


@dataclass(frozen=True)
class NativeCheckpointRegistration:
    project_id: str
    run_id: str
    root: Path
    native_ref: dict
    quiescence_evidence: tuple[dict, ...]
    verify: object  # readonly positive terminal/native check: None or exception
    read_cursor: object  # public native reader; original opaque end cursor


@dataclass(frozen=True)
class FrozenNativeSnapshot:
    registration: NativeCheckpointRegistration
    cursor: str
    guard: Path
    guard_identity: tuple

    def verify(self):
        from .checkpoints import checked_path
        information = checked_path(self.guard).stat()
        if information.st_nlink != 1 or (information.st_dev, information.st_ino) != self.guard_identity:
            raise Problem("PRECONDITION_FAILED")
        if self.registration.verify(self.registration.root) is not None or self.registration.read_cursor(self.registration.root) != self.cursor:
            raise Problem("PRECONDITION_FAILED")


def native_run_ids(db):
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    values = set(db.execute("SELECT project_id,resource_id FROM resources WHERE kind='RUN'"))
    if "controller_authorities" in tables:
        values.update(db.execute("SELECT project_id,run_id FROM controller_authorities"))
    if "scheduler_dispatches" in tables:
        values.update(db.execute("SELECT o.project_id,s.run_id FROM scheduler_dispatches s JOIN operations o ON s.operation_id=o.operation_id"))
    return tuple(sorted(values))


class LocalNativeQuiescenceSource:
    """Freezes one registered native namespace while SQLite/bytes are copied.

    Original retained authority is never renewed, replaced or removed. No root
    with an unresolved submission or active controller can use this source.
    Expired authority + free lock still needs positive qualified evidence.
    """
    def __init__(self, repository, registrations, lock_directory):
        from .checkpoints import checked_path
        self.repository = repository
        self.directory = checked_path(lock_directory)
        if not self.directory.is_dir() or (os.name != "nt" and (self.directory.stat().st_uid != os.getuid() or self.directory.stat().st_mode & 0o077)):
            raise Problem("PRECONDITION_FAILED")
        self.registrations = {}
        for value in registrations:
            key = (value.project_id, value.run_id)
            if key in self.registrations:
                raise ValueError("Duplicate registered native run")
            self.registrations[key] = NativeCheckpointRegistration(**{**value.__dict__, "root": checked_path(value.root), "native_ref": deepcopy(value.native_ref), "quiescence_evidence": tuple(deepcopy(value.quiescence_evidence))})

    @contextmanager
    def freeze(self, owner, expected):
        from .checkpoints import checked_path
        if tuple(sorted(self.registrations)) != expected:
            raise Problem("PRECONDITION_FAILED")
        with ExitStack() as locks:
            frozen = []
            for project, run in expected:
                registered = self.registrations[(project, run)]
                with self.repository._connection() as db:
                    self.repository._project(db, owner, project)
                    row = db.execute("SELECT owner_id,document FROM controller_authorities WHERE project_id=? AND run_id=?", (project, run)).fetchone()
                    if row is None or row[0] != owner.principal_id:
                        raise Problem("PRECONDITION_FAILED")
                    record = self.repository.contracts.validate("controller-authority-record", loads(row[1]))
                    payload = record["payload"]
                    if record["project_id"] != project or payload["run_id"] != run or record["integrity"]["status"] != "VERIFIED" or payload["automatic_takeover"] != "DISABLED" or payload["lease_expires_at"] is None or datetime.fromisoformat(payload["lease_expires_at"].replace("Z", "+00:00")) > datetime.now(timezone.utc):
                        raise Problem("PRECONDITION_FAILED")
                key = hashlib.sha256(canonical([project, run])).hexdigest()
                path = checked_path(self.directory/(key+".lock"))
                if not path.is_file() or path.stat().st_nlink != 1:
                    raise Problem("PRECONDITION_FAILED")  # never recreate a lost guard inode
                identity = locks.enter_context(original_guard(path))
                self.repository.contracts.validate("native-contract-ref", registered.native_ref)
                if registered.native_ref["engine"] != "qraft" or registered.native_ref["contract"] != "siestaflow.run-lock@1.0" or registered.native_ref["verification"]["status"] != "VERIFIED" or not registered.quiescence_evidence:
                    raise Problem("PRECONDITION_FAILED")
                for reference in registered.quiescence_evidence:
                    self.repository.contracts.validate("artifact-ref", reference)
                if registered.verify(registered.root) is not None:
                    raise Problem("PRECONDITION_FAILED")
                cursor = registered.read_cursor(registered.root)
                if not isinstance(cursor, str) or not 1 <= len(cursor) <= 4096:
                    raise Problem("PRECONDITION_FAILED")
                frozen.append(FrozenNativeSnapshot(registered, cursor, path, identity))
            yield tuple(frozen)


def relative_native_path(value):
    if not isinstance(value, str) or "\\" in value or ":" in value:
        raise Problem("PRECONDITION_FAILED")
    path = PurePosixPath(value)
    if not value or path.is_absolute() or any(part in {"", ".", ".."} for part in value.split("/")):
        raise Problem("PRECONDITION_FAILED")
    return Path(*path.parts)


def inventory_native(root, max_files, max_bytes):
    from .checkpoints import checked_path, file_hash
    root = checked_path(root)
    if not root.is_dir():
        raise Problem("PRECONDITION_FAILED")
    directories, files, size = [], [], 0
    for directory, children, names in os.walk(root, followlinks=False):
        parent = checked_path(directory)
        for name in sorted(children):
            path = checked_path(parent/name)
            relative = path.relative_to(root).as_posix()
            relative_native_path(relative)
            directories.append(relative)
        for name in sorted(names):
            path = checked_path(parent/name)
            relative = path.relative_to(root).as_posix()
            relative_native_path(relative)
            count, sha = file_hash(path, max_bytes)
            size += count
            if len(files)+len(directories)+1 > max_files or size > max_bytes:
                raise Problem("PAYLOAD_TOO_LARGE")
            files.append({"path": relative, "size_bytes": count, "sha256": sha})
        if len(directories)+len(files) > max_files:
            raise Problem("PAYLOAD_TOO_LARGE")
    return sorted(directories), sorted(files, key=lambda value: value["path"])


def capture_native(snapshots, owner, artifacts, destination, max_files, max_bytes):
    from .checkpoints import copy_original, sync_directory
    manifests, total, count = [], 0, 0
    for snapshot in snapshots:
        registered = snapshot.registration
        # Native IDs are package identities, not caller-provided paths.
        artifacts._path("blobs", registered.run_id)
        references = [registered.native_ref["artifact"], *registered.quiescence_evidence]
        for reference in references:
            record = artifacts.metadata(owner, reference["artifact_id"])
            if record["project_id"] != registered.project_id or any(record["payload"][key] != reference[key] for key in ("artifact_id", "media_type", "sha256")) or not artifacts.verify(owner, reference["artifact_id"]):
                raise Problem("PRECONDITION_FAILED")
        snapshot.verify()
        dirs, files = inventory_native(registered.root, max_files-count, max_bytes-total)
        lock = next((value for value in files if value["path"] == "run.lock.json"), None)
        if lock is None or lock["sha256"] != registered.native_ref["artifact"]["sha256"]:
            raise Problem("PRECONDITION_FAILED")
        target = destination/registered.run_id
        target.mkdir(mode=0o700)
        for directory in dirs:
            (target/relative_native_path(directory)).mkdir(mode=0o700)
        for value in files:
            path = relative_native_path(value["path"])
            copy_original(registered.root/path, target/path, value["size_bytes"], value["sha256"])
        for directory in reversed(dirs):
            sync_directory(target/relative_native_path(directory))
        sync_directory(target)
        if inventory_native(registered.root, max_files-count, max_bytes-total) != (dirs, files):
            raise Problem("PRECONDITION_FAILED")
        snapshot.verify()
        total += sum(value["size_bytes"] for value in files)
        count += len(files)+len(dirs)
        manifests.append({"run_id": registered.run_id, "project_id": registered.project_id, "native": registered.native_ref,
                          "cursor": snapshot.cursor, "quiescence_evidence": list(registered.quiescence_evidence), "directories": dirs, "files": files})
    sync_directory(destination)
    return manifests, total, count


def check_native_pins(native, pins):
    for item in native:
        reference = item["native"]
        matches = [pin for pin in pins if all(pin[key] == reference[key] for key in ("engine", "distribution", "version", "commit"))]
        if len(matches) != 1:
            raise Problem("PRECONDITION_FAILED")


def validate_native_packet(native, packet, artifacts, contracts, max_files, max_bytes):
    """Validate bounded private v2 inventory before allocating a restore root."""
    from .checkpoints import checked_path
    if not isinstance(native, list) or max_files < 0 or max_bytes < 0:
        raise Problem("PRECONDITION_FAILED")
    seen, total, count = set(), 0, 0
    for item in native:
        if not isinstance(item, dict) or set(item) != {"run_id", "project_id", "native", "cursor", "quiescence_evidence", "directories", "files"}:
            raise Problem("PRECONDITION_FAILED")
        artifacts._path("blobs", item["run_id"])
        contracts.validate_ref("https://dftlab.invalid/contracts/schemas/defs.schema.json#/$defs/id", item["project_id"])
        key = (item["project_id"], item["run_id"])
        if key in seen or any(old[1] == item["run_id"] for old in seen):
            raise Problem("PRECONDITION_FAILED")
        seen.add(key)
        reference = contracts.validate("native-contract-ref", item["native"])
        if reference["engine"] != "qraft" or reference["contract"] != "siestaflow.run-lock@1.0" or reference["verification"]["status"] != "VERIFIED" or not isinstance(item["cursor"], str) or not 1 <= len(item["cursor"]) <= 4096:
            raise Problem("PRECONDITION_FAILED")
        if not isinstance(item["quiescence_evidence"], list) or not item["quiescence_evidence"]:
            raise Problem("PRECONDITION_FAILED")
        for evidence in (reference["artifact"], *item["quiescence_evidence"]):
            contracts.validate("artifact-ref", evidence)
        dirs, files = item["directories"], item["files"]
        if not isinstance(dirs, list) or not isinstance(files, list):
            raise Problem("PRECONDITION_FAILED")
        paths = set()
        for directory in dirs:
            relative_native_path(directory)
            if directory in paths:
                raise Problem("PRECONDITION_FAILED")
            paths.add(directory)
        for value in files:
            if not isinstance(value, dict) or set(value) != {"path", "size_bytes", "sha256"}:
                raise Problem("PRECONDITION_FAILED")
            relative_native_path(value["path"])
            if value["path"] in paths or type(value["size_bytes"]) is not int or value["size_bytes"] < 0 or not isinstance(value["sha256"], str) or re.fullmatch(r"[0-9a-f]{64}", value["sha256"]) is None:
                raise Problem("PRECONDITION_FAILED")
            paths.add(value["path"])
        total += sum(value["size_bytes"] for value in files)
        count += len(files)+len(dirs)
        if total > max_bytes or count > max_files:
            raise Problem("PAYLOAD_TOO_LARGE")
        root = checked_path(packet/"native"/item["run_id"])
        if inventory_native(root, max_files, max_bytes) != (dirs, files):
            raise Problem("PRECONDITION_FAILED")
        lock = next((value for value in files if value["path"] == "run.lock.json"), None)
        if lock is None or lock["sha256"] != reference["artifact"]["sha256"]:
            raise Problem("PRECONDITION_FAILED")
    if native and {path.name for path in checked_path(packet/"native").iterdir()} != {item["run_id"] for item in native}:
        raise Problem("PRECONDITION_FAILED")
    return tuple(sorted(seen))


def restore_native(native, packet, destination, store, owner, verifier):
    """Copy originals then require a registered public-engine verifier.

    verifier(owner, manifest, root, store) is readonly and returns None or
    raises. It must verify native locks/identity and the original event cursor;
    it is supplied by the operator, never code or a permission from a packet.
    Original authority is retained and the service stays in RECOVERY.
    """
    from .checkpoints import copy_original, sync_directory
    (destination/"native").mkdir(mode=0o700)
    for item in native:
        for reference in (item["native"]["artifact"], *item["quiescence_evidence"]):
            record = store.metadata(owner, reference["artifact_id"])
            if record["project_id"] != item["project_id"] or any(record["payload"][key] != reference[key] for key in ("artifact_id", "media_type", "sha256")) or not store.verify(owner, reference["artifact_id"]):
                raise Problem("PRECONDITION_FAILED")
        root = destination/"native"/item["run_id"]
        root.mkdir(mode=0o700)
        for directory in item["directories"]:
            (root/relative_native_path(directory)).mkdir(mode=0o700)
        for value in item["files"]:
            path = relative_native_path(value["path"])
            copy_original(packet/"native"/item["run_id"]/path, root/path, value["size_bytes"], value["sha256"])
        for directory in reversed(item["directories"]):
            sync_directory(root/relative_native_path(directory))
        sync_directory(root)
        if verifier(owner, deepcopy(item), root, store) is not None:
            raise Problem("PRECONDITION_FAILED")
    sync_directory(destination/"native")
