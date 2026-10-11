"""Bounded local SLURM port for already verified, operator-managed packages.

No shell, no automatic retry, no terminal absence proof. This adapter is not an
admission policy or a scientific validator. No HTTP route/capability is enabled.
Root permissions, site configuration and the native DAG are never modified.
"""
from copy import deepcopy
from dataclasses import dataclass, replace
from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import re
import stat
from typing import Callable, Mapping

from .contracts import BASE, Contracts, canonical
from .domain import Problem, envelope, now, reseal
from .runtime_probe import Binary, BoundedCommands, ProbeFailure
from .storage import local_database


def local_identity():
    if os.name == "nt":
        raise ProbeFailure("Local SLURM requires the POSIX worker")
    import pwd
    return pwd.getpwuid(os.getuid()).pw_name, os.getuid()


@dataclass(frozen=True)
class SlurmSite:
    sbatch: Binary
    scontrol: Binary
    squeue: Binary
    cluster: str
    remote_user: str
    uid: int


@dataclass(frozen=True)
class ManagedSlurmPackage:
    root: Path
    script: Path
    script_sha256: str
    package_ref: dict
    profile: dict
    run_id: str
    authority_generation: int
    verify: Callable[[], None]


class SlurmSchedulerPort:
    def __init__(self, site: SlurmSite, packages: Mapping[str, ManagedSlurmPackage], evidence_writer, authorize_dispatch,
                 *, commands=None, identity=local_identity):
        if re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", site.cluster) is None or re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]{0,127}", site.remote_user) is None or type(site.uid) is not int or site.uid < 0:
            raise ValueError("Explicit local SLURM identity required")
        self.site, self.evidence_writer = site, evidence_writer
        self.authorize_dispatch = authorize_dispatch
        self.packages = {key: replace(value, package_ref=deepcopy(value.package_ref), profile=deepcopy(value.profile)) for key, value in packages.items()}
        self.commands, self.identity, self.contracts = commands or BoundedCommands(), identity, Contracts()
        self.environment = {"PATH": "/usr/bin:/bin", "LC_ALL": "C", "LANG": "C", "TZ": "UTC"}

    def _package(self, intent):
        self.contracts.validate("effect-intent", intent)
        payload = intent["payload"]
        if intent["integrity"]["status"] != "VERIFIED" or payload["action"] != "SUBMIT_RUN" or payload["scheduler"] != "SLURM":
            raise Problem("PRECONDITION_FAILED")
        package = self.packages.get(payload["run_id"])
        if package is None or package.run_id != payload["run_id"] or package.package_ref != payload["package_ref"] or package.profile != payload["profile"] or package.authority_generation != payload["authority_generation"]:
            raise Problem("PRECONDITION_FAILED")
        self.contracts.validate("artifact-ref", package.package_ref)
        self.contracts.validate_ref(BASE+"schemas/submission-receipt.schema.json#/$defs/payload/properties/profile", package.profile)
        if type(package.authority_generation) is not int or package.authority_generation < 1:
            raise Problem("PRECONDITION_FAILED")
        if self.identity() != (self.site.remote_user, self.site.uid):
            raise Problem("PRECONDITION_FAILED")
        root = Path(package.root).absolute()
        if root.resolve() != root or any(char.isspace() for char in str(root)) or not root.is_dir() or any(path.is_symlink() or (os.name == "nt" and path.is_junction()) for path in (root, *root.parents)):
            raise Problem("PRECONDITION_FAILED")
        # Validates local filesystem policy without writing into the package.
        if local_database(root/".slurm-path-check.sqlite").parent != root.resolve():
            raise Problem("PRECONDITION_FAILED")
        if os.name != "nt" and (root.stat().st_uid != self.site.uid or stat.S_IMODE(root.stat().st_mode) & 0o077):
            raise Problem("PRECONDITION_FAILED")
        script = Path(package.script).absolute()
        # A platform worker shim may live beside the original native package;
        # never add it to or rewrite the package's immutable manifest/content.
        if script.resolve() != script or any(char.isspace() for char in str(script)) or not script.resolve().is_relative_to(root.parent.resolve()) or re.fullmatch(r"[A-Za-z0-9_.-]+\.slurm", script.name) is None or any(path.is_symlink() or (os.name == "nt" and path.is_junction()) for path in (script, *script.parents)):
            raise Problem("PRECONDITION_FAILED")
        if script.is_symlink() or not script.is_file() or (os.name != "nt" and script.stat().st_mode & 0o022):
            raise Problem("PRECONDITION_FAILED")
        if script.stat().st_size > 1048576 or re.fullmatch(r"[0-9a-f]{64}", package.script_sha256) is None:
            raise Problem("PRECONDITION_FAILED")
        with script.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != package.script_sha256:
                raise Problem("PRECONDITION_FAILED")
        for binary in (self.site.sbatch, self.site.scontrol, self.site.squeue):
            binary.verified()
        if package.verify() is not None:  # verifier returns None or raises
            raise Problem("PRECONDITION_FAILED")
        return package, root, script

    def _command(self, intent, binary, arguments, root, label):
        executable = binary.verified()
        observation = self.commands.run((str(executable), *arguments), cwd=root, environment=self.environment)
        binary.verified()
        document = {"command": label, "argv": [str(executable), *arguments], "output": observation.output,
                    "returncode": observation.returncode, "observed_at": now()}
        reference = self.evidence_writer(intent, document)
        self.contracts.validate("artifact-ref", reference)
        if reference["media_type"] != "application/json" or reference["sha256"] != hashlib.sha256(canonical(document)).hexdigest():
            raise Problem("PRECONDITION_FAILED")
        if observation.returncode != 0:
            # Nonzero sbatch may be a lost RPC ack, not a proven rejection.
            raise ProbeFailure("Scheduler command did not confirm its outcome")
        return observation.output, reference

    def _site(self, intent, root, evidence):
        output, reference = self._command(intent, self.site.scontrol, ("show", "config"), root, "site-context")
        evidence.append(reference)
        matches = re.findall(r"(?m)^\s*ClusterName\s*=\s*(\S+)\s*$", output)
        if matches != [self.site.cluster]:
            raise Problem("PRECONDITION_FAILED")

    def _job(self, intent, job_id, root, evidence):
        if re.fullmatch(r"[1-9][0-9]*", job_id) is None:
            raise Problem("PRECONDITION_FAILED")
        output, reference = self._command(intent, self.site.scontrol, ("--oneliner", "show", "job", job_id), root, "job-context")
        evidence.append(reference)
        pairs = re.findall(r"(?:^|\s)(JobId|JobName|UserId|Comment|SubmitTime|WorkDir|Command)=(\S+)", output)
        fields = dict(pairs)
        if len(pairs) != len(fields) or set(fields) != {"JobId", "JobName", "UserId", "Comment", "SubmitTime", "WorkDir", "Command"}:
            raise Problem("PRECONDITION_FAILED")
        token = intent["payload"]["attempt_token"]
        package = self.packages[intent["payload"]["run_id"]]
        if fields["JobId"] != job_id or fields["JobName"] != "dftlab-"+token or fields["Comment"] != "dftlab:"+token or fields["UserId"] != f"{self.site.remote_user}({self.site.uid})" or fields["WorkDir"] != str(root) or fields["Command"] != str(Path(package.script).absolute()):
            raise Problem("PRECONDITION_FAILED")
        # This port is one local WSL host: client TZ=UTC and the same clock as
        # slurmctld. Remote clocks/array jobs need their own qualified adapter.
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", fields["SubmitTime"]) is None:
            raise Problem("PRECONDITION_FAILED")
        submitted = datetime.fromisoformat(fields["SubmitTime"]).replace(tzinfo=timezone.utc)
        recorded = datetime.fromisoformat(intent["payload"]["recorded_at"].replace("Z", "+00:00")).replace(microsecond=0)
        if submitted < recorded or submitted > datetime.now(timezone.utc):
            raise Problem("PRECONDITION_FAILED")
        return {"job_id": job_id, "cluster": self.site.cluster, "remote_user": self.site.remote_user,
                "submitted_at": submitted.isoformat().replace("+00:00", "Z")}

    def _receipt(self, intent, status, job, evidence):
        payload = {key: intent["payload"][key] for key in ("operation_id", "attempt_token", "package_ref", "profile", "scheduler", "authority_generation")}
        receipt = envelope("submission-receipt", intent["project_id"], {**payload, "status": status, "job": job, "evidence": evidence}, contracts=self.contracts)
        receipt["native_contract_refs"] = intent["native_contract_refs"]
        reseal(receipt)
        return self.contracts.validate("submission-receipt", receipt)

    def submit(self, intent):
        package, root, script = self._package(intent)
        evidence = []
        self._site(intent, root, evidence)
        token = intent["payload"]["attempt_token"]
        if self.authorize_dispatch(intent) is not None:
            raise Problem("PRECONDITION_FAILED")
        output, reference = self._command(intent, self.site.sbatch,
                                         ("--parsable", "--comment=dftlab:"+token, "--job-name=dftlab-"+token,
                                          "--chdir="+str(root), str(script)), root, "submit")
        evidence.append(reference)
        match = re.fullmatch(r"([1-9][0-9]*)(?:;([A-Za-z0-9_.-]+))?\n?", output)
        if match is None or (match.group(2) is not None and match.group(2) != self.site.cluster):
            raise ProbeFailure("Scheduler acknowledgement is ambiguous")
        job = self._job(intent, match.group(1), root, evidence)
        self._package(intent)  # detect immutable package/pin changes during RPC
        return self._receipt(intent, "ACCEPTED", job, evidence)

    def find(self, intent):
        package, root, _ = self._package(intent)
        evidence = []
        self._site(intent, root, evidence)
        output, reference = self._command(intent, self.site.squeue,
                                         ("--noheader", "--user="+self.site.remote_user, "--format=%i|%u|%k|%j"), root, "find-token")
        evidence.append(reference)
        candidates = []
        token = intent["payload"]["attempt_token"]
        for line in output.splitlines():
            parts = line.strip().split("|")
            if len(parts) != 4:
                raise ProbeFailure("Scheduler observation is ambiguous")
            if parts[2:] == ["dftlab:"+token, "dftlab-"+token]:
                if parts[1] != self.site.remote_user:
                    raise Problem("PRECONDITION_FAILED")
                candidates.append(parts[0])
        if not candidates:
            return None  # not proof of absence or permission to submit again
        if len(candidates) != 1:
            raise ProbeFailure("Scheduler token has multiple candidates")
        job = self._job(intent, candidates[0], root, evidence)
        self._package(intent)
        return self._receipt(intent, "RECONCILED_FOUND", job, evidence)
