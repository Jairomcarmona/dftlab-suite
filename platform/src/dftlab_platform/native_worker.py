"""Registered allocation-local controller host; never HTTP or admission policy.

The operator verifies original package bytes and scheduler context before this
host is called. QRAFT owns its DAG, allocation, launches, shutdown and results.
Both installed engines remain mandatory. No automatic replacement/resume.
"""
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import re
from collections.abc import Mapping
from threading import Event, Thread

from .domain import Problem
from .hf1_capability import CAPABILITY as HF1_CAPABILITY


_QRAFT_RESUME_REFUSALS = {
    "RESUME_EVIDENCE_INVALID",
    "RESUME_INPUTS_CHANGED",
    "RESUME_STATUS_UNRECOGNIZED",
    "CHECKPOINT_IDENTITY_MISMATCH",
    "LEDGER_CHECKPOINT_INCONSISTENT",
    "SETTLED_FAILURE_PRESENT",
    "SETTLED_EVIDENCE_INVALID",
}


@dataclass(frozen=True)
class RegisteredNativeRun:
    root: Path
    project_id: str
    run_id: str
    workflow_id: str
    attempt_id: str
    profile: dict
    workflow_digest: str
    run_digest: str
    profile_digest: str
    probe: dict
    verify_package: object  # trusted callback, None or exception
    authorize_allocation: object  # trusted callback, None or exception
    generation: int = 1


@dataclass(frozen=True)
class RegisteredNativeExtensions:
    """Operator-only code registration, bound to an original native lock.

    Never reconstructed from an API request, discovery entry point or plugin
    metadata. Registration does not qualify or announce a runtime capability.
    """
    workflow_digest: str
    bindings: tuple[tuple[str, str], ...]
    register: object  # QRAFT's public registry callback
    verify: object  # installed plugin/source identity recheck, None or exception


class NativeWorker:
    """A dedicated installed process, not a thread in the API process.

    No numeric success maps to scientific PASS. A publication callback is a
    trusted SQL writer; authority checks before/after share its transaction.
    Raw native files are not authoritative publication just by existing.
    """
    def __init__(self, engines, repository, manager, *, lease_seconds=30, heartbeat_seconds=5,
                 native_extension_capabilities=(), native_extensions_factory=None):
        if type(lease_seconds) is not int or not 1 <= lease_seconds <= 300 or not 0 < heartbeat_seconds < lease_seconds:
            raise ValueError("Bounded lease and heartbeat required")
        if (not isinstance(native_extension_capabilities, tuple)
                or any(type(item) is not str or not item or len(item) > 256 for item in native_extension_capabilities)
                or len(set(native_extension_capabilities)) != len(native_extension_capabilities)
                or (native_extensions_factory is not None and not callable(native_extensions_factory))):
            raise ValueError("Operator native extension allowlist required")
        self.engines, self.repository, self.manager = engines, repository, manager
        self.lease_seconds, self.heartbeat_seconds = lease_seconds, heartbeat_seconds
        self.native_extension_capabilities = native_extension_capabilities
        self.native_extensions_factory = native_extensions_factory

    def verify(self, owner, registered, environment, extensions=None):
        self.repository.project(owner, registered.project_id)
        root = Path(registered.root).absolute()
        if root.resolve() != root or not root.is_dir() or any(path.is_symlink() or (os.name == "nt" and path.is_junction()) for path in (root, *root.parents)):
            raise Problem("PRECONDITION_FAILED")
        for value in (registered.workflow_digest, registered.run_digest, registered.profile_digest):
            if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
                raise Problem("PRECONDITION_FAILED")
        if registered.verify_package() is not None:
            raise Problem("PRECONDITION_FAILED")
        api = self.engines.qraft
        inspected = api.RunInspector().inspect(root)
        run_envelope, run = api.load_run_lock(root/"run.lock.json")
        workflow_envelope, workflow = api.load_workflow_lock(root/"workflow.lock.json")
        if inspected.status != "PREPARED_RUN_VERIFIED" or (run.run_id, run.project_id, run.workflow_id) != (registered.run_id, registered.project_id, registered.workflow_id):
            raise Problem("PRECONDITION_FAILED")
        if (workflow.project_id, workflow.workflow_id) != (registered.project_id, registered.workflow_id) or workflow_envelope.content_sha256 != registered.workflow_digest or run_envelope.content_sha256 != registered.run_digest or run.workflow_lock_sha256 != registered.workflow_digest or run.execution_profile_sha256 != registered.profile_digest or run.execution_profile_id != registered.profile["profile_id"]:
            raise Problem("PRECONDITION_FAILED")
        if extensions is not None:
            if type(extensions) is not RegisteredNativeExtensions or extensions.workflow_digest != registered.workflow_digest or type(extensions.bindings) is not tuple or not 1 <= len(extensions.bindings) <= 64 or not callable(extensions.register) or not callable(extensions.verify):
                raise Problem("PRECONDITION_FAILED")
            bindings = {}
            for binding in extensions.bindings:
                if type(binding) is not tuple or len(binding) != 2 or any(type(value) is not str or not 1 <= len(value) <= 256 for value in binding) or binding[0] in bindings:
                    raise Problem("PRECONDITION_FAILED")
                bindings[binding[0]] = binding[1]
            declared = {task.task_id: task.capability_id for task in workflow.tasks}
            if any(declared.get(task) != capability for task, capability in bindings.items()) or extensions.verify() is not None:
                raise Problem("PRECONDITION_FAILED")
        if "PYTHONPATH" in environment or str(environment.get("SLURM_JOB_ID", "")).isdigit() is False or Path(environment.get("SLURM_SUBMIT_DIR", "")).absolute().resolve() != root:
            raise Problem("PRECONDITION_FAILED")
        probe = self.repository.contracts.validate("runtime-probe-receipt", registered.probe)
        payload = probe["payload"]
        observed, valid_until = (datetime.fromisoformat(payload[key].replace("Z", "+00:00")) for key in ("observed_at", "valid_until"))
        current = datetime.now(timezone.utc)
        if probe["integrity"]["status"] != "VERIFIED" or probe["project_id"] != registered.project_id or payload["profile"] != registered.profile or not observed <= current < valid_until:
            raise Problem("PRECONDITION_FAILED")
        if registered.authorize_allocation() is not None:
            raise Problem("PRECONDITION_FAILED")
        return root

    @staticmethod
    def _controller_resume_verdict(result, required_bindings, registered, result_sha256):
        """Extract only QRAFT's exact public controller-attempt outcomes.

        Missing or generic BLOCKED results remain unclassified. Admission then
        fails closed because no durable verdict row exists for that generation.
        """
        task_ids = [task_id for task_id, capability in required_bindings
                    if capability == HF1_CAPABILITY]
        attempts = getattr(result, "attempts", None)
        if len(task_ids) != 1 or not isinstance(attempts, Mapping):
            return None
        task_id = task_ids[0]
        attempt = attempts.get(task_id)
        if attempt is None:
            return None
        expected_attempt = f"attempt-{registered.generation:04d}"
        if (getattr(attempt, "node_id", None) != task_id
                or getattr(attempt, "attempt_id", None) != expected_attempt):
            return None
        node_result = getattr(attempt, "result", None)
        technical = getattr(node_result, "technical_validation", None)
        execution_state = getattr(node_result, "execution_state", None)
        status = getattr(technical, "status", None)
        classification = getattr(technical, "classification", None)
        exit_code = getattr(attempt, "exit_code", None)
        if (exit_code == 75 and execution_state == "BLOCKED" and status == "BLOCKED"
                and classification in _QRAFT_RESUME_REFUSALS):
            decision, reason = "REFUSE", classification
        elif (exit_code == 0 and execution_state == "COMPLETED" and status == "PASS"):
            decision, reason = "NO_REFUSAL", None
        elif (exit_code != 75 and execution_state == "INTERRUPTED"
                and status == "BLOCKED" and classification == "INTERRUPTED"):
            decision, reason = "NO_REFUSAL", None
        else:
            return None
        return {
            "run_id": registered.run_id,
            "generation": registered.generation,
            "attempt_id": expected_attempt,
            "decision": decision,
            "reason": reason,
            "result_sha256": result_sha256,
        }

    def run(self, owner, registered, *, environment=None, publication, extensions=None):
        environment = dict(os.environ if environment is None else environment)
        # Preserve original caller data; trust boundaries do not accept aliases.
        registered = RegisteredNativeRun(**{**registered.__dict__, "profile": deepcopy(registered.profile), "probe": deepcopy(registered.probe)})
        if type(registered.generation) is not int or not 1 <= registered.generation <= 3:
            raise Problem("PRECONDITION_FAILED")
        root = self.verify(owner, registered, environment, extensions)
        api = self.engines.qraft
        workflow_envelope, workflow = api.load_workflow_lock(root/"workflow.lock.json")
        required_bindings = tuple(sorted(
            (task.task_id, task.capability_id) for task in workflow.tasks
            if task.capability_id in self.native_extension_capabilities
        ))
        if required_bindings:
            if extensions is None:
                if self.native_extensions_factory is None:
                    raise Problem("PRECONDITION_FAILED")
                # Only operator-installed code can create these callbacks.
                # The factory is bound to QRAFT's verified lock digest and the
                # exact task/capability pairs parsed from that lock.
                extensions = self.native_extensions_factory(
                    registered=registered, root=root,
                    workflow_digest=workflow_envelope.content_sha256,
                    bindings=required_bindings,
                )
            if (type(extensions) is not RegisteredNativeExtensions
                    or extensions.workflow_digest != workflow_envelope.content_sha256
                    or extensions.bindings != required_bindings):
                raise Problem("PRECONDITION_FAILED")
        shutdown = api.ShutdownRequest()
        with self.manager.controller(owner, registered.project_id, registered.run_id, registered.attempt_id,
                                      generation=registered.generation, seconds=self.lease_seconds) as authority:
            stopped, failures = Event(), []
            def heartbeat():
                while not stopped.wait(self.heartbeat_seconds):
                    try:
                        authority.renew(self.lease_seconds)
                    except BaseException as error:
                        failures.append(type(error).__name__)
                        shutdown.request("AUTHORITY_LOST")
                        return
            thread = Thread(target=heartbeat, name="dftlab-native-authority", daemon=False)
            thread.start()
            try:
                plugin_arguments = {} if extensions is None else {"register_capabilities": extensions.register, "capability_bindings": dict(extensions.bindings)}
                # Recheck under the original kernel guard, immediately before
                # QRAFT creates its fresh registry and freezes original bindings.
                self.verify(owner, registered, environment, extensions)
                controller = api.CanonicalController.from_file(root/"campaign.yaml", root=root, environment=environment, shutdown=shutdown,
                                                              authority_check=authority.authority_check, authority_generation=str(authority.record["payload"]["generation"]), **plugin_arguments)
                status = controller.run(install_signal_handlers=True)
                if failures or controller.result is None:
                    raise Problem("PRECONDITION_FAILED")
                self.verify(owner, registered, environment, extensions)
                # The public native serializer preserves every result dimension.
                original = self.engines.qraft_contracts().canonical_json(controller.result).encode("utf-8")
                result_sha256 = hashlib.sha256(original).hexdigest()
                resume_verdict = self._controller_resume_verdict(
                    controller.result, required_bindings, registered, result_sha256,
                )
                native_status = status.value
                summary = {"native_status": native_status, "runtime_result_bytes_sha256": result_sha256,
                           "project_id": registered.project_id, "run_id": registered.run_id, "workflow_id": registered.workflow_id,
                           "native_workflow_digest": registered.workflow_digest, "native_run_digest": registered.run_digest,
                           "native_profile_digest": registered.profile_digest, "scientific_assessment": "NOT_ESTABLISHED"}
                # The callback stages/fsyncs raw bytes before its SQL writer;
                # only the writer runs inside the authority transaction.
                writer = publication(summary, original)
                if not callable(writer):
                    raise Problem("PRECONDITION_FAILED")
                if resume_verdict is None:
                    authority.publish(writer)
                else:
                    authority.publish(writer, resume_verdict=resume_verdict)
                return summary
            except BaseException:
                shutdown.request("WORKER_FAILED")
                raise
            finally:
                # Keep heartbeat and kernel lock until native run/shutdown has
                # returned. A retained SQL authority never permits replacement.
                stopped.set()
                thread.join()
