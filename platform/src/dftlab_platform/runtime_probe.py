"""Trusted local worker observation; no submission, admission or science gate.

Settings are operator configuration, never an HTTP request. MPI ranks are a
requested allocation, not a claim of a completed MPI execution. Raw observations
remain private; only the original RuntimeProbeReceipt crosses the contract port.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import tempfile
import threading
from typing import Protocol

from .domain import envelope
from .local_runtime import private_directory


class ProbeFailure(ValueError):
    """Deliberately excludes command output, paths and imported values."""


@dataclass(frozen=True)
class Observation:
    output: str
    returncode: int


class CommandPort(Protocol):
    def run(self, argv: tuple[str, ...], *, cwd: Path, environment: dict[str, str]) -> Observation: ...


class BoundedCommands:
    """No shell/stdin. Bounds elapsed time and combined output, kills only ours.

    POSIX commands get a new session, so timeout also kills their descendants.
    Windows only supports direct diagnostic children; it is not a Windows HPC
    process supervisor. SLURM probing is exclusively a POSIX worker operation.
    """
    def __init__(self, timeout: float = 10, limit: int = 262144):
        if not 0 < timeout <= 30 or not 0 < limit <= 1048576:
            raise ValueError("Invalid diagnostic bounds")
        self.timeout, self.limit = timeout, limit

    def run(self, argv, *, cwd, environment):
        child = subprocess.Popen(argv, cwd=cwd, env=environment, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 start_new_session=os.name != "nt",
                                 creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        data = bytearray()
        overflow = threading.Event()
        def stop():
            try:
                if os.name != "nt":
                    os.killpg(child.pid, signal.SIGKILL)
                else:
                    child.kill()
            except ProcessLookupError:
                pass
        def read():
            try:
                while block := child.stdout.read1(8192):
                    remaining = self.limit - len(data)
                    data.extend(block[:remaining])
                    if len(block) > remaining:
                        overflow.set()
                        stop()
                        break
            except (OSError, ValueError):
                overflow.set()
        reader = threading.Thread(target=read, daemon=True)
        reader.start()
        failed = False
        try:
            child.wait(timeout=self.timeout)
            reader.join(timeout=self.timeout)
            if reader.is_alive():
                failed = True
                stop()
                reader.join(timeout=1)
        except subprocess.TimeoutExpired:
            failed = True
            stop()
        except BaseException:
            # A caller interruption must not leave its diagnostic child alive.
            stop()
            raise
        finally:
            child.wait(timeout=5)
            reader.join(timeout=1)
            # Do not block closing a stream whose reader still owns its lock.
            if not reader.is_alive():
                child.stdout.close()
        if failed or overflow.is_set():
            raise ProbeFailure("Diagnostic exceeded its bounds")
        try:
            return Observation(data.decode("utf-8", errors="strict"), child.returncode)
        except UnicodeError:
            raise ProbeFailure("Diagnostic encoding invalid") from None


@dataclass(frozen=True)
class Binary:
    path: Path
    sha256: str

    def verified(self) -> Path:
        # Operator may pin a system alias (mpirun -> orterun). Hash its resolved
        # regular file, and recheck the alias as well after every diagnostic.
        path = Path(self.path)
        if not path.is_absolute() or not re.fullmatch(r"[0-9a-f]{64}", self.sha256):
            raise ProbeFailure("Invalid binary pin")
        resolved = path.resolve(strict=True)
        info = resolved.stat()
        if not stat.S_ISREG(info.st_mode) or not os.access(resolved, os.X_OK):
            raise ProbeFailure("Executable unavailable")
        if os.name != "nt" and info.st_mode & 0o022:
            raise ProbeFailure("Executable is group or world writable")
        hashed = hashlib.sha256()
        with resolved.open("rb") as stream:
            while block := stream.read(262144):
                hashed.update(block)
        if hashed.hexdigest() != self.sha256:
            raise ProbeFailure("Executable pin mismatch")
        return resolved


@dataclass(frozen=True)
class ProbeSettings:
    profile_id: str
    revision: int
    profile_sha256: str
    executable: Binary
    mpi: Binary | None
    sinfo: Binary
    scontrol: Binary
    sbatch: Binary
    partition: str
    node: str
    ranks: int
    threads_per_rank: int
    memory_mb: int
    workspace: Path
    expected_version: str = "5.4.2"
    ttl_seconds: int = 900

    def validate(self):
        if not self.profile_id or type(self.revision) is not int or self.revision < 1:
            raise ProbeFailure("Invalid profile identity")
        if not re.fullmatch(r"[0-9a-f]{64}", self.profile_sha256):
            raise ProbeFailure("Invalid profile byte digest")
        for value in (self.partition, self.node):
            if not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", value):
                raise ProbeFailure("Invalid scheduler selector")
        if any(type(value) is not int or value < 1 for value in (self.ranks, self.threads_per_rank, self.memory_mb)):
            raise ProbeFailure("Invalid allocation request")
        if not self.mpi and self.ranks != 1:
            raise ProbeFailure("Serial allocation cannot request MPI ranks")
        if type(self.ttl_seconds) is not int or not 1 <= self.ttl_seconds <= 900:
            raise ProbeFailure("Invalid observation lifetime")


@dataclass(frozen=True)
class ProbeResult:
    receipt: dict
    evidence: dict


def _fields(output: str) -> dict[str, str]:
    result = {}
    for key, value in re.findall(r"(?:^|\s)([A-Za-z][A-Za-z0-9_]*)=([^\s]+)", output):
        if key in result:
            raise ProbeFailure("Ambiguous scheduler observation")
        result[key] = value
    return result


def _storage_checks(root: Path) -> list[dict]:
    # private_directory rejects shared/WSL Windows mounts for local SQLite state.
    # This narrow local qualification does not qualify remote HPC filesystems.
    root = Path(root).absolute()
    if root.resolve() != root:
        raise ProbeFailure("Workspace traverses a link")
    private_directory(root)
    with tempfile.TemporaryDirectory(prefix="probe-", dir=root) as directory:
        source, destination = Path(directory)/"before", Path(directory)/"after"
        marker = os.urandom(32)
        with source.open("xb") as stream:
            stream.write(marker)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(source, destination)
        if destination.read_bytes() != marker or source.exists():
            raise ProbeFailure("Storage roundtrip failed")
        if os.name != "nt":
            descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    return [{"check": code, "result": "PASS"} for code in
            ("PRIVATE_LOCAL_STORAGE", "FILE_FSYNC", "ATOMIC_RENAME")] + [
                {"check": "DIRECTORY_FSYNC", "result": "PASS" if os.name != "nt" else "NOT_ESTABLISHED"}]


class SlurmRuntimeProbe:
    """Pinned POSIX observations. No sbatch invocation or MPI rank launch."""
    def __init__(self, commands: CommandPort | None = None):
        if commands is None and os.name == "nt":
            raise ProbeFailure("SLURM diagnostics require a POSIX worker")
        self.commands = commands or BoundedCommands()

    def observe(self, project_id: str, settings: ProbeSettings) -> ProbeResult:
        settings.validate()
        observed = datetime.now(timezone.utc)
        pins = {"siesta": settings.executable, "sinfo": settings.sinfo,
                "scontrol": settings.scontrol, "sbatch": settings.sbatch}
        if settings.mpi:
            pins["mpi"] = settings.mpi
        # Check every pin before allowing the first execution.
        resolved = {name: pin.verified() for name, pin in pins.items()}
        checks = _storage_checks(settings.workspace)
        environment = {"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C",
                       "OMP_NUM_THREADS": str(settings.threads_per_rank), "OPENBLAS_NUM_THREADS": "1"}
        observations = {}
        with tempfile.TemporaryDirectory(prefix="diagnostics-", dir=settings.workspace) as temporary:
            def run(name, *args):
                # Preserve argv[0] semantics of operator-pinned aliases, e.g.
                # mpirun -> orterun. Resolving a path verifies bytes; it must not
                # silently change which invocation mode a binary receives.
                value = self.commands.run((str(pins[name].path), *args), cwd=Path(temporary), environment=environment)
                if value.returncode != 0:
                    raise ProbeFailure("Diagnostic command failed")
                if pins[name].verified() != resolved[name]:
                    raise ProbeFailure("Executable changed during observation")
                observations[name+":"+" ".join(args)] = value.output
                return value.output
            siesta = run("siesta", "--version")
            if not re.search(r"^Version\s*:\s*"+re.escape(settings.expected_version)+r"\s*$", siesta, re.M):
                raise ProbeFailure("Unexpected SIESTA version")
            parallel = re.search(r"Parallelisations\s*:\s*([^\r\n]+)", siesta, re.I)
            mpi_build = bool(parallel and re.search(r"\bMPI\b", parallel[1], re.I))
            if mpi_build != bool(settings.mpi):
                raise ProbeFailure("Executable and launcher disagree")
            if settings.mpi:
                mpi_output = run("mpi", "--version")
                if "Open MPI" not in mpi_output or not re.search(r"\d+\.\d+\.\d+", mpi_output):
                    raise ProbeFailure("Unrecognized MPI launcher")
            scheduler_version = run("scontrol", "--version")
            if not re.fullmatch(r"slurm(?:-wlm)?\s+\d+\.\d+\.\d+\s*", scheduler_version):
                raise ProbeFailure("Unrecognized scheduler")
            status = run("sinfo", "--noheader", "--partition="+settings.partition, "--format=%P|%a")
            if not any(line.strip().split("|") == [settings.partition+suffix, "up"]
                       for line in status.splitlines() for suffix in ("", "*")):
                raise ProbeFailure("Partition unavailable")
            partition = _fields(run("scontrol", "--oneliner", "show", "partition", settings.partition))
            node = _fields(run("scontrol", "--oneliner", "show", "node", settings.node))
            if partition.get("PartitionName") != settings.partition or partition.get("State") != "UP":
                raise ProbeFailure("Partition identity mismatch")
            # Narrow qualification: one explicitly observed node. Never infer
            # membership by expanding/comparing a potentially ambiguous hostlist.
            if partition.get("Nodes") != settings.node or node.get("NodeName") != settings.node:
                raise ProbeFailure("Node membership not established")
            if node.get("State") != "IDLE":
                raise ProbeFailure("Requested node is not idle")
            try:
                available = int(node["CPUTot"]) - int(node["CPUAlloc"])
                memory = int(node["RealMemory"]) - int(node["AllocMem"])
            except (KeyError, ValueError):
                raise ProbeFailure("Resource capacity not established") from None
            if available < settings.ranks*settings.threads_per_rank or memory < settings.memory_mb:
                raise ProbeFailure("Requested allocation exceeds observed capacity")
        # Hash all files again: earlier binaries may change during later calls.
        if any(pin.verified() != resolved[name] for name, pin in pins.items()):
            raise ProbeFailure("Executable changed during observation")
        checks += [{"check": "PARTITION_NODE_CAPACITY", "result": "PASS"},
                   {"check": "MPI_RANK_EXECUTION", "result": "NOT_ESTABLISHED"},
                   {"check": "MODULES_REQUIRED", "result": "NOT_ESTABLISHED"}]
        timestamp = lambda value: value.isoformat(timespec="microseconds").replace("+00:00", "Z")
        receipt = envelope("runtime-probe-receipt", project_id, {
            "profile": {"profile_id": settings.profile_id, "revision": settings.revision},
            "executable": {"name": "siesta", "version": settings.expected_version,
                           "build": "mpi" if mpi_build else "serial", "sha256": settings.executable.sha256},
            "launcher": {"kind": "openmpi" if settings.mpi else "serial", "mpi": mpi_build,
                         "ranks": settings.ranks, "threads_per_rank": settings.threads_per_rank},
            "capabilities": ["MPI_BINARY_AVAILABLE"] if mpi_build else ["SERIAL_BINARY_AVAILABLE"],
            "storage_checks": checks, "observed_at": timestamp(observed),
            "valid_until": timestamp(observed+timedelta(seconds=settings.ttl_seconds))})
        evidence = {"receipt_id": receipt["record_id"], "receipt_digest": receipt["integrity"]["digest"],
                    "profile_sha256": settings.profile_sha256,
                    "binary_pins": {name: {"path": str(resolved[name]), "sha256": pin.sha256}
                                    for name, pin in pins.items()},
                    "observations": observations, "module_commands": [],
                    "submission_performed": False, "scientific_assessment": "NOT_ESTABLISHED"}
        return ProbeResult(receipt, evidence)
