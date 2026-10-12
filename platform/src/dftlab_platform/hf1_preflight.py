"""Read-only HF-1 qualification preflight: every host/SLURM/profile precondition at once.

Submits nothing, creates no attempt or descriptor, never edits a profile and
never starts SIESTA. A failed check is reported together with all the others, so
an operator learns the whole list in one pass instead of one blocker per run.
Run it from the installed wheel: python -I -m dftlab_platform.hf1_preflight ...
"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
from zipfile import BadZipFile, ZipFile

from .hf1_bundle import CONTROLLER_TARGETS, inspect_bundle, profile_findings
from .domain import Problem

MIN_PARTITION_SECONDS = 2400
MIN_MEMORY_MB = 2048
MIN_FREE_BYTES = 2 * 1024**3
NETWORK_OR_WINDOWS_FILESYSTEMS = {"9p", "drvfs", "cifs", "smb3", "nfs", "nfs4", "fuse.sshfs", "fuse.drvfs", "virtiofs"}


def _check(identifier, status, detail):
    return {"id": identifier, "status": status, "detail": detail}


def keyed_pairs(text):
    """First occurrence of every Key=Value token in SLURM key/value output."""
    pairs = {}
    for key, value in re.findall(r"(?:^|\s)([A-Za-z][A-Za-z0-9_]*)=(\S*)", text):
        pairs.setdefault(key, value)
    return pairs


def config_pairs(text):
    """`scontrol show config` lines: `Key   = value`."""
    return {key: value.strip() for key, value in re.findall(r"(?m)^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.*)$", text)}


def slurm_seconds(value):
    """MaxTime/TimeLimit as seconds; None means unlimited, False means unparsable."""
    if value in {"UNLIMITED", "INFINITE", "NONE"}:
        return None
    match = re.fullmatch(r"(?:(\d+)-)?(\d+):(\d+):(\d+)", value or "")
    if match is None:
        return False
    days, hours, minutes, seconds = (int(part or 0) for part in match.groups())
    return ((days * 24 + hours) * 60 + minutes) * 60 + seconds


def parse_sinfo_nodes(text):
    nodes = []
    for line in text.splitlines():
        parts = line.strip().split("|")
        if len(parts) == 4 and parts[2].isdigit() and parts[3].isdigit():
            nodes.append({"node": parts[0], "state": parts[1].rstrip("*~#!%$@^-+").lower(), "cpus": int(parts[2]), "memory_mb": int(parts[3])})
    return nodes


def mount_type(path, mountinfo="/proc/self/mountinfo"):
    """Filesystem type of the longest mount point containing path, or None."""
    best, found = "", None
    resolved = str(Path(path).resolve())
    try:
        lines = Path(mountinfo).read_text(errors="replace").splitlines()
    except OSError:
        return None
    for line in lines:
        left, _, right = line.partition(" - ")
        fields = left.split()
        if len(fields) < 5 or not right:
            continue
        point = fields[4].replace("\\040", " ")
        if (resolved == point or resolved.startswith(point.rstrip("/") + "/")) and len(point) > len(best):
            best, found = point, right.split()[0]
    return found


def _run(argv, timeout=20):
    try:
        done = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL,
                              env={"PATH": "/usr/bin:/bin", "LC_ALL": "C", "LANG": "C", "TZ": "UTC"})
    except (OSError, subprocess.TimeoutExpired) as error:
        return None, type(error).__name__
    return done, (done.stdout + done.stderr)


def _sha256(path):
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def host_checks(reserved_cpus):
    checks = []
    ok = platform.python_version() == "3.12.10" and os.name == "posix" and bool(sys.flags.isolated) and "PYTHONPATH" not in os.environ
    checks.append(_check("HOST_PYTHON_ISOLATED_POSIX", "PASS" if ok else "FAIL", f"python {platform.python_version()}, isolated={bool(sys.flags.isolated)}, PYTHONPATH set={'PYTHONPATH' in os.environ}"))
    release = platform.release()
    match = re.match(r"(\d+)\.(\d+)", release)
    new_enough = match is not None and (int(match.group(1)), int(match.group(2))) >= (5, 3)
    checks.append(_check("HOST_KERNEL_PIDFD", "PASS" if new_enough else "FAIL", release))
    try:
        boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        checks.append(_check("HOST_BOOT_ID_READABLE", "PASS", boot))
    except OSError as error:
        checks.append(_check("HOST_BOOT_ID_READABLE", "FAIL", type(error).__name__))
    try:
        descriptor = os.pidfd_open(os.getpid())
        os.close(descriptor)
        flag = ctypes.c_int(-1)
        libc = ctypes.CDLL(None, use_errno=True)
        result = libc.prctl(37, ctypes.byref(flag), 0, 0, 0)  # PR_GET_CHILD_SUBREAPER
        checks.append(_check("HOST_PIDFD_AND_SUBREAPER", "PASS" if result == 0 else "FAIL", f"prctl={result}"))
    except (AttributeError, OSError, TypeError) as error:
        checks.append(_check("HOST_PIDFD_AND_SUBREAPER", "FAIL", type(error).__name__))
    cpus = os.cpu_count() or 0
    checks.append(_check("HOST_CPUS", "PASS" if cpus >= reserved_cpus else "FAIL", f"{cpus} visible, {reserved_cpus} needed"))
    try:
        total = int(re.search(r"MemTotal:\s+(\d+) kB", Path("/proc/meminfo").read_text()).group(1)) // 1024
        checks.append(_check("HOST_MEMORY_MB", "PASS" if total >= MIN_MEMORY_MB else "FAIL", f"{total} MB total, {MIN_MEMORY_MB} needed"))
    except (OSError, AttributeError):
        checks.append(_check("HOST_MEMORY_MB", "FAIL", "unreadable"))
    return checks


def state_checks(state_dir):
    checks = []
    path = Path(state_dir).absolute()
    target = path
    while not target.exists() and target != target.parent:
        target = target.parent
    kind = mount_type(target) if target.exists() else None
    checks.append(_check("STATE_LOCAL_LINUX_FILESYSTEM", "PASS" if kind and kind not in NETWORK_OR_WINDOWS_FILESYSTEMS else "FAIL", f"{target}: {kind}"))
    checks.append(_check("STATE_PATH_NO_WHITESPACE", "PASS" if not any(c.isspace() for c in str(path)) else "FAIL", str(path)))
    if path.exists():
        information = path.stat()
        private = information.st_uid == os.getuid() and not information.st_mode & 0o077
        checks.append(_check("STATE_PRIVATE_OWNER_MODE", "PASS" if private else "FAIL", oct(information.st_mode & 0o777)))
    free = shutil.disk_usage(target).free if target.exists() else 0
    checks.append(_check("STATE_FREE_SPACE", "PASS" if free >= MIN_FREE_BYTES else "FAIL", f"{free // 1024**2} MB free"))
    return checks


def slurm_checks(partition, reserved_cpus):
    checks, tools = [], {}
    for name in ("sbatch", "scontrol", "squeue", "sinfo", "sacct"):
        found = shutil.which(name, path="/usr/bin:/bin:/usr/local/bin")
        tools[name] = found
        checks.append(_check("SLURM_TOOL_" + name.upper(), "PASS" if found else "FAIL", found or "not found"))
    if not tools["scontrol"] or not tools["sinfo"] or not tools["squeue"]:
        return checks
    done, text = _run([tools["scontrol"], "show", "config"])
    config = config_pairs(text) if done and done.returncode == 0 else {}
    checks.append(_check("SLURM_CONFIG_READABLE", "PASS" if config else "FAIL", f"ClusterName={config.get('ClusterName')}"))
    for key in ("ProctrackType", "TaskPlugin", "JobRequeue", "JobCompType", "AccountingStorageType", "SelectType"):
        checks.append(_check("SLURM_CONFIG_" + key.upper(), "INFO", config.get(key, "absent")))
    done, text = _run([tools["scontrol"], "show", "partition", partition])
    fields = keyed_pairs(text) if done and done.returncode == 0 else {}
    limit = slurm_seconds(fields.get("MaxTime", "")) if fields else False
    enough = fields.get("State") == "UP" and limit is not False and (limit is None or limit >= MIN_PARTITION_SECONDS)
    checks.append(_check("SLURM_PARTITION_UP_AND_LONG_ENOUGH", "PASS" if enough else "FAIL", f"State={fields.get('State')} MaxTime={fields.get('MaxTime')} (need >= {MIN_PARTITION_SECONDS} s)"))
    done, text = _run([tools["sinfo"], "-h", "-N", "-p", partition, "-o", "%N|%T|%c|%m"])
    nodes = parse_sinfo_nodes(text) if done and done.returncode == 0 else []
    fits = len(nodes) == 1 and nodes[0]["state"] == "idle" and nodes[0]["cpus"] >= reserved_cpus and nodes[0]["memory_mb"] >= MIN_MEMORY_MB
    checks.append(_check("SLURM_ONE_IDLE_NODE_FITS", "PASS" if fits else "FAIL", json.dumps(nodes)))
    done, text = _run([tools["squeue"], "-h", "-p", partition, "-o", "%i|%u|%T|%j"])
    jobs = [line for line in text.splitlines() if line.strip()] if done and done.returncode == 0 else None
    checks.append(_check("SLURM_PARTITION_QUEUE_EMPTY", "PASS" if jobs == [] else "FAIL", "unreadable" if jobs is None else f"{len(jobs)} job(s) present, none will be touched"))
    return checks


def mpi_checks(siesta, siesta_sha256, reserved_cpus):
    checks = []
    mpirun = shutil.which("mpirun", path="/usr/bin:/bin:/usr/local/bin")
    done, text = _run([mpirun, "--version"]) if mpirun else (None, "")
    checks.append(_check("MPI_OPENMPI_4_1", "PASS" if done and "Open MPI" in text and "4.1." in text else "FAIL", f"{mpirun}: {text.splitlines()[0] if text else 'absent'}"))
    if mpirun:
        host = platform.node() or "localhost"
        done, text = _run([mpirun, "-np", str(reserved_cpus), "--host", f"{host}:{reserved_cpus}", "hostname"], timeout=60)
        checks.append(_check("MPI_SLOTS_WITHOUT_OVERSUBSCRIBE", "PASS" if done and done.returncode == 0 else "INFO", "ok" if done and done.returncode == 0 else text.strip()[:200]))
    if siesta:
        try:
            observed = _sha256(siesta)
            checks.append(_check("SIESTA_PINNED_SHA256", "PASS" if observed == siesta_sha256 else "FAIL", siesta))
        except OSError as error:
            checks.append(_check("SIESTA_PINNED_SHA256", "FAIL", type(error).__name__))
    return checks


def bundle_checks(bundle, bundle_sha256, profile_sha256, reserved_cpus):
    try:
        inspected = inspect_bundle(bundle, expected_sha256=bundle_sha256, expected_profile_sha256=profile_sha256,
                                   reserved_cpus=reserved_cpus, allowed_targets=CONTROLLER_TARGETS)
        return [_check("BUNDLE_CAMPAIGN_PROFILE", "PASS", f"campaign {inspected.campaign_id}, profile target {inspected.profile_target}")]
    except Problem:
        pass
    # Opaque on purpose in the platform; here, name every reason that applies.
    try:
        with ZipFile(bundle) as archive:
            manifest = json.loads(archive.read("campaign.v2.json"))
            profile_bytes = archive.read(manifest["execution_profile_file"])
        reasons = []
        if hashlib.sha256(Path(bundle).read_bytes()).hexdigest() != bundle_sha256:
            reasons.append("BUNDLE_SHA256")
        if hashlib.sha256(profile_bytes).hexdigest() != profile_sha256:
            reasons.append("PROFILE_SHA256")
        reasons.extend(profile_findings(json.loads(profile_bytes), reserved_cpus, CONTROLLER_TARGETS))
        return [_check("BUNDLE_CAMPAIGN_PROFILE", "FAIL", ",".join(reasons) or "OTHER_BUNDLE_RULE (see hf1_bundle.inspect_bundle)")]
    except (OSError, BadZipFile, KeyError, ValueError, TypeError):
        return [_check("BUNDLE_CAMPAIGN_PROFILE", "FAIL", "BUNDLE_UNREADABLE")]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", required=True, type=Path)
    parser.add_argument("--partition", required=True)
    parser.add_argument("--reserved-cpus", type=int, default=4)
    parser.add_argument("--bundle", type=Path)
    parser.add_argument("--bundle-sha256")
    parser.add_argument("--profile-sha256")
    parser.add_argument("--siesta", type=Path)
    parser.add_argument("--siesta-sha256")
    parser.add_argument("--output", type=Path, help="new file; never overwritten")
    arguments = parser.parse_args(argv)
    checks = host_checks(arguments.reserved_cpus) + state_checks(arguments.state_dir)
    checks += slurm_checks(arguments.partition, arguments.reserved_cpus)
    checks += mpi_checks(arguments.siesta, arguments.siesta_sha256, arguments.reserved_cpus)
    if arguments.bundle:
        checks += bundle_checks(arguments.bundle, arguments.bundle_sha256, arguments.profile_sha256, arguments.reserved_cpus)
    report = {"schema": "dftlab.hf1-qualification-preflight@1", "checks": checks,
              "failed": [item["id"] for item in checks if item["status"] == "FAIL"],
              "submission_performed": False, "attempt_created": False, "scientific_assessment": "NOT_ESTABLISHED"}
    text = json.dumps(report, indent=2) + "\n"
    if arguments.output:
        with arguments.output.open("x", encoding="utf-8") as stream:
            stream.write(text)
    print(text, end="")
    return 1 if report["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
