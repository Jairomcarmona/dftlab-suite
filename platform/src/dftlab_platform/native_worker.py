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
from threading import Event, Thread

from .domain import Problem


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
    def __init__(self, engines, repository, manager, *, lease_seconds=30, heartbeat_seconds=5):
        if type(lease_seconds) is not int or not 1 <= lease_seconds <= 300 or not 0 < heartbeat_seconds < lease_seconds:
            raise ValueError("Bounded lease and heartbeat required")
        self.engines, self.repository, self.manager = engines, repository, manager
        self.lease_seconds, self.heartbeat_seconds = lease_seconds, heartbeat_seconds

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

    def run(self, owner, registered, *, environment=None, publication, extensions=None):
        environment = dict(os.environ if environment is None else environment)
        # Preserve original caller data; trust boundaries do not accept aliases.
        registered = RegisteredNativeRun(**{**registered.__dict__, "profile": deepcopy(registered.profile), "probe": deepcopy(registered.probe)})
        root = self.verify(owner, registered, environment, extensions)
        api = self.engines.qraft
        shutdown = api.ShutdownRequest()
        with self.manager.controller(owner, registered.project_id, registered.run_id, registered.attempt_id, seconds=self.lease_seconds) as authority:
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
                native_status = status.value
                summary = {"native_status": native_status, "runtime_result_bytes_sha256": hashlib.sha256(original).hexdigest(),
                           "project_id": registered.project_id, "run_id": registered.run_id, "workflow_id": registered.workflow_id,
                           "native_workflow_digest": registered.workflow_digest, "native_run_digest": registered.run_digest,
                           "native_profile_digest": registered.profile_digest, "scientific_assessment": "NOT_ESTABLISHED"}
                # The callback stages/fsyncs raw bytes before its SQL writer;
                # only the writer runs inside the authority transaction.
                writer = publication(summary, original)
                if not callable(writer):
                    raise Problem("PRECONDITION_FAILED")
                authority.publish(writer)
                return summary
            except BaseException:
                shutdown.request("WORKER_FAILED")
                raise
            finally:
                # Keep heartbeat and kernel lock until native run/shutdown has
                # returned. A retained SQL authority never permits replacement.
                stopped.set()
                thread.join()
