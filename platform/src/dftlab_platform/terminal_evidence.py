"""Positive local SLURM completion -> original signed QRAFT terminal evidence.

Private operator port, no HTTP trust toggle or authority retirement. The local
completion reader may need a qualified readonly broker. Empty queues and lost
jobs never prove termination. Keys remain outside artifacts/checkpoints/logs.
"""
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
import hmac
import hashlib
import re
from threading import RLock

from .contracts import canonical
from .domain import Problem, now
from .runtime_probe import BoundedCommands, ProbeFailure


def utcnow():
    return datetime.now(timezone.utc)


class LocalTerminalSigner:
    """Server-side HMAC verifier registered by signer ID, never client input.

    This is local symmetric trust, not a portable third-party signature. Each
    qualified signer has its own private key; a string signer ID is not trust.
    QRAFT defines signed_bytes(), so this class never substitutes platform JCS.
    """
    def __init__(self, api, signer_id, key, *, clock=utcnow):
        if not isinstance(key, bytes) or not 32 <= len(key) <= 128 or not isinstance(signer_id, str) or re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", signer_id) is None:
            raise ValueError("Registered private signing key/identity required")
        self.api, self.signer_id, self._key, self.clock = api, signer_id, key, clock
        self._clock_floor, self._lock = clock(), RLock()
        if self._clock_floor.utcoffset() != timedelta(0):
            raise ValueError("UTC signing clock required")

    def sign(self, evidence):
        if type(evidence) is not self.api.TerminalSchedulerEvidence or evidence.signer_id != self.signer_id:
            raise Problem("PRECONDITION_FAILED")
        signature = hmac.new(self._key, evidence.signed_bytes(), hashlib.sha256).hexdigest()
        return replace(evidence, signature=signature)

    def verify(self, evidence):
        try:
            if type(evidence) is not self.api.TerminalSchedulerEvidence or evidence.signer_id != self.signer_id or re.fullmatch(r"[0-9a-f]{64}", evidence.signature) is None:
                return False
            observed = evidence.timestamp(evidence.observed_at)
            expiry = evidence.timestamp(evidence.expires_at)
            current = self.clock()
            with self._lock:
                if current.utcoffset() != timedelta(0) or current < self._clock_floor:
                    return False
                self._clock_floor = current
                if not observed <= current < expiry or not 0 < (expiry-observed).total_seconds() <= 120:
                    return False
            signature = hmac.new(self._key, evidence.signed_bytes(), hashlib.sha256).hexdigest()
            return hmac.compare_digest(signature, evidence.signature)
        except (ValueError, TypeError, AttributeError, OverflowError):
            return False


@dataclass(frozen=True)
class CollectedTerminal:
    native: object
    observations: tuple[dict, ...]
    cluster_binding: str
    requested_cpus: int
    allocated_cpus: int


class SlurmTerminalCollector:
    """One registered local instance; no SSH, arrays or generic cluster trust.

    completion_timezone describes the producer of filetxt JobComp timestamps,
    which are stored as local wall time and are not changed by client TZ=UTC.
    A raw Cluster=unknown is allowed only in an explicitly registered same-site
    protocol. It remains raw evidence; configured cluster is a separate local
    attestation tied to two complete job-context observations and history.
    """
    TERMINAL = frozenset({"COMPLETED", "FAILED", "CANCELLED", "TIMEOUT", "NODE_FAIL", "OUT_OF_MEMORY", "PREEMPTED", "BOOT_FAIL", "DEADLINE", "REVOKED"})

    def __init__(self, engines, scheduler, sacct, signer, *, history_commands=None,
                 completion_timezone=timezone.utc, allow_unknown_cluster=False, lifetime_seconds=30):
        if type(lifetime_seconds) is not int or not 1 <= lifetime_seconds <= 120 or type(allow_unknown_cluster) is not bool or signer.api is not engines.qraft:
            raise ValueError("Explicit bounded local terminal protocol required")
        self.engines, self.scheduler, self.sacct, self.signer = engines, scheduler, sacct, signer
        self.history_commands = history_commands or BoundedCommands()
        self.completion_timezone, self.allow_unknown_cluster = completion_timezone, allow_unknown_cluster
        self.lifetime_seconds = lifetime_seconds

    @staticmethod
    def fields(output):
        keys = {"JobState", "StartTime", "EndTime", "NumCPUs", "NumTasks", "CPUs/Task", "ReqTRES", "AllocTRES"}
        pairs = re.findall(r"(?:^|\s)(JobState|StartTime|EndTime|NumCPUs|NumTasks|CPUs/Task|ReqTRES|AllocTRES)=(\S+)", output)
        result = dict(pairs)
        if len(pairs) != len(result) or set(result) != keys or result["JobState"] not in SlurmTerminalCollector.TERMINAL:
            raise ProbeFailure("Job context does not prove a terminal allocation")
        return result

    @staticmethod
    def timestamp(value, zone):
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", value) is None:
            raise ProbeFailure("Scheduler timestamp is ambiguous")
        parsed = datetime.fromisoformat(value).replace(tzinfo=zone)
        if parsed.utcoffset() is None:
            raise ProbeFailure("Scheduler timestamp lacks a registered timezone")
        # Ambiguous/gap local civil times are not accepted as history proof.
        if parsed.replace(fold=0).utcoffset() != parsed.replace(fold=1).utcoffset() or parsed.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) != parsed.replace(tzinfo=None):
            raise ProbeFailure("Scheduler civil timestamp is ambiguous")
        return parsed.astimezone(timezone.utc)

    def observe(self, intent, job_id):
        port = self.scheduler
        package, root, _ = port._package(intent)
        evidence = []
        port._site(intent, root, evidence)
        job, output = port._job_context(intent, job_id, root, evidence)
        context = self.fields(output)
        submit = datetime.fromisoformat(job["submitted_at"].replace("Z", "+00:00"))
        start, end = (self.timestamp(context[key], timezone.utc) for key in ("StartTime", "EndTime"))
        if not submit <= start <= end <= utcnow():
            raise ProbeFailure("Terminal interval does not match submission")
        executable = self.sacct.verified()
        argv = (str(executable), "--completion", "--jobs="+job_id, "--noheader", "--parsable2", "--format=JobID,User,Cluster,State,Start,End")
        observed = self.history_commands.run(argv, cwd=root, environment=port.environment)
        self.sacct.verified()
        observation = {"command": "terminal-history", "argv": list(argv), "output": observed.output, "returncode": observed.returncode, "observed_at": now()}
        reference = port.evidence_writer(intent, observation)
        port.contracts.validate("artifact-ref", reference)
        if reference["media_type"] != "application/json" or reference["sha256"] != hashlib.sha256(canonical(observation)).hexdigest():
            raise Problem("PRECONDITION_FAILED")
        evidence.append(reference)
        if observed.returncode != 0:
            raise ProbeFailure("Trusted completion history unavailable")
        rows = [line.strip().split("|") for line in observed.output.splitlines() if line.strip()]
        if len(rows) != 1 or len(rows[0]) != 6:
            raise ProbeFailure("Completion history is absent or ambiguous")
        row = rows[0]
        expected_user = f"{port.site.remote_user}({port.site.uid})"
        if row[0] != job_id or row[1] != expected_user or row[3] != context["JobState"]:
            raise ProbeFailure("Completion history identity/state mismatch")
        if row[2] == port.site.cluster:
            binding = "EXPLICIT_HISTORY_CLUSTER"
        elif row[2] == "unknown" and self.allow_unknown_cluster:
            binding = "REGISTERED_SAME_SITE_CONTEXT_ATTESTATION"
        else:
            raise ProbeFailure("Completion history cluster is unqualified")
        if self.timestamp(row[4], self.completion_timezone) != start or self.timestamp(row[5], self.completion_timezone) != end:
            raise ProbeFailure("Completion history belongs to a different interval")
        # Observe again after history. A requeued job/state/context fails; empty
        # queues have no role in proving terminality or minting this evidence.
        second_job, second_output = port._job_context(intent, job_id, root, evidence)
        if second_job != job or self.fields(second_output) != context:
            raise ProbeFailure("Allocation changed during terminal observation")
        port._site(intent, root, evidence)
        port._package(intent)
        run_envelope, native_run = self.engines.qraft.load_run_lock(root/"run.lock.json")
        workflow_envelope, workflow = self.engines.qraft.load_workflow_lock(root/"workflow.lock.json")
        if (native_run.run_id, native_run.project_id, native_run.workflow_id) != (package.run_id, intent["project_id"], workflow.workflow_id) or workflow.project_id != intent["project_id"] or native_run.workflow_lock_sha256 != workflow_envelope.content_sha256:
            raise Problem("PRECONDITION_FAILED")
        def cpus(value):
            matches = re.findall(r"(?:^|,)cpu=([1-9][0-9]*)(?=,|$)", value)
            if len(matches) != 1:
                raise ProbeFailure("Allocation CPU accounting is ambiguous")
            return int(matches[0])
        requested, allocated = cpus(context["ReqTRES"]), cpus(context["AllocTRES"])
        if not context["NumCPUs"].isdigit() or allocated != int(context["NumCPUs"]) or allocated < requested:
            raise ProbeFailure("Allocation accounting disagrees")
        observed_at = self.signer.clock()
        if observed_at.utcoffset() != timedelta(0):
            raise Problem("PRECONDITION_FAILED")
        stamp = lambda value: value.isoformat().replace("+00:00", "Z")
        native = self.engines.qraft.TerminalSchedulerEvidence(
            run_id=package.run_id, workflow_lock_sha256=workflow_envelope.content_sha256, run_lock_sha256=run_envelope.content_sha256,
            job=self.engines.qraft.SchedulerJobIdentity(job_id, port.site.cluster, port.site.remote_user), state=context["JobState"],
            observed_at=stamp(observed_at), expires_at=stamp(observed_at+timedelta(seconds=self.lifetime_seconds)),
            signer_id=self.signer.signer_id, signature="pending", active_allocation_absent=True)
        native = self.signer.sign(native)
        if not self.signer.verify(native):
            raise Problem("PRECONDITION_FAILED")
        return CollectedTerminal(native, tuple(evidence), binding, requested, allocated)
