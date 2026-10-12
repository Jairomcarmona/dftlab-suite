"""Bounded immutable transport of an already authored native HF1 campaign.

This is private installed-plugin packaging, not a new client or science schema.
Native LR policies, amplitudes, sites and digests are not interpreted or changed.
Only direct campaign.v2 manifests are accepted; WSL daemon pointers are refused.
"""
from dataclasses import dataclass
import hashlib
import os
from io import BytesIO
from pathlib import Path
import re
import stat
from zipfile import BadZipFile, ZipFile, ZIP_STORED, ZIP_DEFLATED

from .checkpoints import checked_path, open_original, sync_directory
from .contracts import loads
from .domain import Problem
from .native_checkpoints import relative_native_path


MAX_ARCHIVE = 32*1024**2
MAX_BYTES = 256*1024**2
MAX_FILES = 4096


def safe_path(value):
    path = relative_native_path(value)
    for part in path.parts:
        if part.endswith((".", " ")) or re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?", part):
            raise Problem("PRECONDITION_FAILED")
    return path


@dataclass(frozen=True)
class VerifiedHF1Bundle:
    archive: bytes
    sha256: str
    campaign_id: str
    files: tuple[tuple[str, bytes], ...]
    reserved_cpus: int
    profile_target: str = "slurm"


LEGACY_TARGETS = ("slurm",)
CONTROLLER_TARGETS = ("slurm", "local_wsl")


def profile_findings(profile, reserved_cpus, allowed_targets=LEGACY_TARGETS):
    """Every failing campaign-profile condition at once, as stable identifiers.

    Pure and read-only, so a preflight can report all of them in one pass and
    inspect_bundle can keep raising the same opaque PRECONDITION_FAILED.
    """
    if not isinstance(profile, dict):
        return ("PROFILE_NOT_OBJECT",)
    allocation, runtime = profile.get("allocation", {}), profile.get("runtime", {})
    if not isinstance(allocation, dict) or not isinstance(runtime, dict):
        return ("PROFILE_SECTION_NOT_OBJECT",)
    launcher = runtime.get("launcher", {})
    if not isinstance(launcher, dict):
        return ("PROFILE_SECTION_NOT_OBJECT",)
    findings = []
    if profile.get("target") not in allowed_targets:
        findings.append("PROFILE_TARGET")
    if type(allocation.get("nodes")) is not int or allocation["nodes"] != 1:
        findings.append("PROFILE_NODES")
    if type(allocation.get("max_parallel_steps")) is not int or allocation["max_parallel_steps"] != 1:
        findings.append("PROFILE_MAX_PARALLEL_STEPS")
    if type(allocation.get("total_cpus")) is not int or allocation["total_cpus"] != reserved_cpus:
        findings.append("PROFILE_TOTAL_CPUS")
    if launcher.get("kind") != "openmpi":
        findings.append("PROFILE_LAUNCHER_KIND")
    per_node = launcher.get("processes_per_node")
    if type(per_node) is not int or not 1 <= per_node <= reserved_cpus:
        findings.append("PROFILE_PROCESSES_PER_NODE")
    return tuple(findings)


def inspect_bundle(path, *, expected_sha256, expected_profile_sha256, reserved_cpus, allowed_targets=LEGACY_TARGETS):
    if type(reserved_cpus) is not int or not 1 <= reserved_cpus <= 4096 or any(not isinstance(value, str) or re.fullmatch("[a-f0-9]{64}", value) is None for value in (expected_sha256, expected_profile_sha256)):
        raise Problem("PRECONDITION_FAILED")
    with open_original(checked_path(path)) as stream:
        raw = stream.read(MAX_ARCHIVE+1)
    if len(raw) > MAX_ARCHIVE:
        raise Problem("PAYLOAD_TOO_LARGE")
    if hashlib.sha256(raw).hexdigest() != expected_sha256:
        raise Problem("PRECONDITION_FAILED")
    files, names, total = {}, set(), 0
    try:
        with ZipFile(BytesIO(raw)) as archive:
            members = archive.infolist()
            if not 1 <= len(members) <= MAX_FILES:
                raise Problem("PAYLOAD_TOO_LARGE")
            for member in members:
                name = member.filename[:-1] if member.is_dir() else member.filename
                safe_path(name)
                if name in names or member.flag_bits & 1 or member.compress_type not in {ZIP_STORED, ZIP_DEFLATED}:
                    raise Problem("PRECONDITION_FAILED")
                names.add(name)
                kind = stat.S_IFMT(member.external_attr >> 16)
                if kind not in {0, stat.S_IFREG, stat.S_IFDIR} or (member.is_dir() and kind == stat.S_IFREG) or (not member.is_dir() and kind == stat.S_IFDIR):
                    raise Problem("PRECONDITION_FAILED")
                if member.is_dir():
                    if member.file_size:
                        raise Problem("PRECONDITION_FAILED")
                    continue
                total += member.file_size
                if total > MAX_BYTES:
                    raise Problem("PAYLOAD_TOO_LARGE")
                with archive.open(member) as stream:
                    data = stream.read(member.file_size+1)
                if len(data) != member.file_size:
                    raise Problem("PRECONDITION_FAILED")
                files[name] = data
    except (BadZipFile, OSError, RuntimeError, ValueError):
        raise Problem("PRECONDITION_FAILED") from None
    # Refuse a file that shadows an ancestor, before writing anything.
    if any(str(parent).replace("\\", "/") in files for name in names for parent in safe_path(name).parents if str(parent) != "."):
        raise Problem("PRECONDITION_FAILED")
    if "campaign.v2.json" not in files or len(files["campaign.v2.json"]) > 1024**2:
        raise Problem("PRECONDITION_FAILED")
    manifest = loads(files["campaign.v2.json"])
    if not isinstance(manifest, dict) or manifest.get("schema") != "siestaflow.campaign.v2" or not isinstance(manifest.get("campaign_id"), str) or not manifest["campaign_id"] or len(manifest["campaign_id"]) > 256:
        raise Problem("PRECONDITION_FAILED")
    declarations = manifest.get("input_files")
    if not isinstance(declarations, list) or not declarations:
        raise Problem("PRECONDITION_FAILED")
    declared = set()
    for item in declarations:
        if not isinstance(item, dict) or set(item) != {"path", "sha256"} or type(item["path"]) is not str:
            raise Problem("PRECONDITION_FAILED")
        name = item["path"]
        safe_path(name)
        if name in declared or name not in files or hashlib.sha256(files[name]).hexdigest() != item["sha256"]:
            raise Problem("PRECONDITION_FAILED")
        declared.add(name)
    # Start from native authored inputs only; never smuggle old jobs/results,
    # daemon ownership, executable code or an undeclared seed into a fresh run.
    if set(files) != declared | {"campaign.v2.json"}:
        raise Problem("PRECONDITION_FAILED")
    for field in ("execution_profile_file", "lr_config_file", "reference_fdf", "contract_file"):
        if type(manifest.get(field)) is not str or manifest[field] not in declared:
            raise Problem("PRECONDITION_FAILED")
    if hashlib.sha256(files[manifest["execution_profile_file"]]).hexdigest() != expected_profile_sha256:
        # Site/executable/module authority comes from the registered operator,
        # never merely from a uploaded manifest's self-consistent file hashes.
        raise Problem("PRECONDITION_FAILED")
    profile = loads(files[manifest["execution_profile_file"]])
    if profile_findings(profile, reserved_cpus, allowed_targets):
        raise Problem("PRECONDITION_FAILED")
    return VerifiedHF1Bundle(raw, expected_sha256, manifest["campaign_id"], tuple(sorted(files.items())), reserved_cpus, profile["target"])


def materialize_bundle(bundle, destination):
    """New owned namespace only. Retain partial staging on failure for audit."""
    if type(bundle) is not VerifiedHF1Bundle:
        raise Problem("PRECONDITION_FAILED")
    destination = checked_path(destination)
    destination.mkdir(mode=0o700)  # no overlay, mkdir(exist_ok=False)
    for name, data in bundle.files:
        path = destination/safe_path(name)
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with path.open("xb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    for directory in sorted((p for p in destination.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
        sync_directory(directory)
    sync_directory(destination)
    sync_directory(destination.parent)
    return destination/"campaign.v2.json"
