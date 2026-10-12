"""Specialized public QRAFT extension, never a generic command capability.

No scheduler, LR mathematics, scientific gate or native digest algorithm is
implemented here. QRAFT owns controller recovery; the original native worker
receipt and files remain intact. Physical qualification is not established.
"""
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from collections.abc import Mapping
import sys

from .checkpoints import checked_path, write_new
from .contracts import canonical, loads
from .domain import Problem
from .hf1_bundle import CONTROLLER_TARGETS, final_root_findings, inspect_bundle, materialize_bundle, safe_path
from .hf1_controller_entry import STAGE_PLAN
from .native_checkpoints import inventory_native


CAPABILITY = "dftlab.engine.hubbardflow.hf1"
CONTROLLER_RESERVATION = {
    "nodes": 1,
    "inner_launcher": "openmpi",
    "inner_processes_per_node": 4,
    "inner_cpus_per_process": 1,
    "max_concurrent_inner_launches": 1,
}
_TASK_RESOURCE_FIELDS = {
    "nodes", "mpi_processes", "processes_per_node", "cpus_per_process",
    "walltime_seconds",
}


def controller_profile_findings(resources, profile, reserved_cpus):
    """Every failing outer-allocation condition at once, as stable identifiers.

    resources is the workflow task's declaration; profile is QRAFT's outer
    execution profile (the SLURM allocation), not the campaign's own profile.
    """
    if not isinstance(resources, Mapping) or set(resources) != _TASK_RESOURCE_FIELDS:
        return ("TASK_RESOURCE_FIELDS",)
    findings = []
    for name in ("nodes", "mpi_processes", "processes_per_node", "cpus_per_process"):
        if type(resources[name]) is not int or resources[name] != 1:
            findings.append("TASK_" + name.upper())
    if type(resources["walltime_seconds"]) is not int or resources["walltime_seconds"] < 1:
        findings.append("TASK_WALLTIME_SECONDS")
    for name, expected in (("nodes", 1), ("total_cpus", reserved_cpus), ("ntasks", reserved_cpus),
                           ("processes_per_node", reserved_cpus), ("launcher_kind", "openmpi"), ("max_attempts", 3)):
        if getattr(profile, name, None) != expected:
            findings.append("OUTER_" + name.upper())
    if CONTROLLER_RESERVATION["inner_processes_per_node"] != reserved_cpus:
        findings.append("RESERVATION_INNER_PROCESSES")
    return tuple(findings)


@dataclass(frozen=True)
class HF1Classification:
    status: str
    classification: str
    reasons: tuple[str, ...]
    campaign_id: str | None
    native_worker_receipt: dict | None
    scientific_assessment: str = "NOT_ESTABLISHED"
    quantity_kind: str = "U_scalar_charge"


@dataclass(frozen=True)
class HF1Artifact:
    path: str
    sha256: str


class HubbardFlowCampaignCapability:
    """Constructed by qualified operator code, never by deserialized callbacks."""
    def __init__(self, engines, wheelhouse, *, run_id, bundle_sha256, profile_sha256, reserved_cpus, max_seconds, grace_seconds=5):
        self.engines, self.wheelhouse = engines, checked_path(wheelhouse)
        if type(run_id) is not str or not run_id or len(run_id) > 256 or type(max_seconds) is not int or not 1 <= max_seconds <= 3600 or type(grace_seconds) is not int or not 1 <= grace_seconds <= 10:
            raise Problem("PRECONDITION_FAILED")
        self.run_id, self.bundle_sha256, self.profile_sha256 = run_id, bundle_sha256, profile_sha256
        self.reserved_cpus, self.max_seconds, self.grace_seconds = reserved_cpus, max_seconds, grace_seconds
        self._prepared_identity = None
        self._controller_mode = False

    def inspect_input(self, path):
        # The campaign's own profile may target slurm or local_wsl (controller
        # launches use mpirun on the reserved host); the legacy worker path in
        # prepare_task re-requires slurm.
        return inspect_bundle(path, expected_sha256=self.bundle_sha256, expected_profile_sha256=self.profile_sha256, reserved_cpus=self.reserved_cpus, allowed_targets=CONTROLLER_TARGETS)

    def validate_input(self, inspected, **kwargs):
        # Scientific semantics are validated only by the native CLI/engine.
        if inspected.sha256 != self.bundle_sha256 or inspected.reserved_cpus != self.reserved_cpus:
            raise Problem("PRECONDITION_FAILED")
        return HF1Classification("PASS", "HF1_TRANSPORT_VERIFIED", (), inspected.campaign_id, None)

    def prepare_task(self, inspected, workspace, **kwargs):
        workspace = checked_path(workspace)
        if ((self._prepared_identity is not None and not self._controller_mode)
                or type(kwargs.get("task_id")) is not str
                or type(kwargs.get("attempt_id")) is not str or len(kwargs["inputs"]) != 1):
            raise Problem("PRECONDITION_FAILED")
        source = next(iter(kwargs["inputs"].values()))
        original = self.inspect_input(source)
        if original != inspected:
            raise Problem("PRECONDITION_FAILED")
        controller_state_dir = kwargs.get("controller_state_dir")
        if controller_state_dir is None:
            if original.profile_target != "slurm":
                raise Problem("PRECONDITION_FAILED")
            # Retain the existing non-controller worker path for installed
            # consumers that have not opted into the native controller.
            campaign_path = materialize_bundle(original, workspace/"hf1")
        else:
            # QRAFT's supervisor reads a state directory that holds files but no
            # owner.json as tampering, so nothing is staged here on a fresh
            # start: the directory is created empty and dftlab-hf1-controller
            # stages the bundle after QRAFT claims it (ADR-017 Adenda 9). On
            # resume the owned state is only verified in place, never rewritten.
            state_dir = checked_path(controller_state_dir)
            if state_dir.exists():
                if not state_dir.is_dir():
                    raise Problem("PRECONDITION_FAILED")
                if any(state_dir.iterdir()):
                    for name, data in original.files:
                        path = state_dir/safe_path(name)
                        if path.is_symlink() or not path.is_file() or path.read_bytes() != data:
                            raise Problem("PRECONDITION_FAILED")
            else:
                if final_root_findings(original, state_dir):
                    raise Problem("PRECONDITION_FAILED")  # initialized outside its final root (Adenda 10)
                parent = checked_path(state_dir.parent)
                parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                state_dir.mkdir(mode=0o700)
                if checked_path(parent) != parent or checked_path(state_dir) != state_dir:
                    raise Problem("PRECONDITION_FAILED")
            try:
                bundle_relative = PurePosixPath(checked_path(source).relative_to(workspace).as_posix())
            except ValueError:
                raise Problem("PRECONDITION_FAILED") from None
            write_new(workspace/STAGE_PLAN, canonical({
                "schema_version": 1, "bundle": bundle_relative.as_posix(), "bundle_sha256": self.bundle_sha256,
                "profile_sha256": self.profile_sha256, "reserved_cpus": self.reserved_cpus}))
            campaign_path = state_dir/"campaign.v2.json"
            self._controller_mode = True
        if self._controller_mode:
            # HubbardFlow's installed entrypoint consumes the native campaign
            # under QRAFT's persistent controller state directory.
            prepared_path = campaign_path
        else:
            request = {"schema_version": 1, "outer_run_id": self.run_id, "task_id": kwargs["task_id"], "attempt_id": kwargs["attempt_id"], "bundle": str(checked_path(source)), "bundle_sha256": self.bundle_sha256,
                       "profile_sha256": self.profile_sha256, "reserved_cpus": self.reserved_cpus, "wheelhouse": str(self.wheelhouse), "max_seconds": self.max_seconds, "grace_seconds": self.grace_seconds, "campaign_id": original.campaign_id}
            request_path = workspace/"hf1-request.json"
            write_new(request_path, canonical(request))
            prepared_path = request_path
        self._prepared_identity = (kwargs["task_id"], kwargs["attempt_id"], original.campaign_id)
        return prepared_path

    def build_command(self, input_path, **kwargs):
        execution = kwargs["execution_spec"]
        if self._controller_mode:
            if execution.launcher != "controller" or execution.mpi_ranks != 1 or execution.allocated_cpus != 1:
                raise Problem("PRECONDITION_FAILED")
            entrypoint = kwargs.get("controller_entrypoint")
            reservation = kwargs.get("controller_reservation_path")
            state_dir = kwargs.get("controller_state_dir")
            prior_ledgers = kwargs.get("controller_prior_ledgers")
            if not isinstance(entrypoint, (str, Path)) or not isinstance(reservation, str) or not isinstance(state_dir, Path) or not isinstance(prior_ledgers, (list, tuple)):
                raise Problem("PRECONDITION_FAILED")
            reservation_path = safe_path(reservation)
            # QRAFT's canonical attempt layout is work/<task>/attempt-N/.qraft.
            # Derive the persistent campaign path from that bound task identity;
            # never accept an executable or absolute campaign path from inputs.
            parts = reservation_path.parts
            if (len(parts) != 5 or parts[0] != "work" or parts[2].split("-")[0] != "attempt"
                    or parts[3] != ".qraft" or parts[4] != "controller-reservation.json"):
                raise Problem("PRECONDITION_FAILED")
            task_id = parts[1]
            if state_dir.name != task_id:
                raise Problem("PRECONDITION_FAILED")
            arguments = [str(entrypoint), "--qraft-reservation", reservation_path.as_posix(),
                         "--campaign", f"controller-state/{task_id}/campaign.v2.json"]
            for ledger in prior_ledgers:
                relative = safe_path(ledger)
                arguments.extend(("--prior-ledger", relative.as_posix()))
            return tuple(arguments)
        if execution.launcher != "direct" or execution.mpi_ranks != 1 or execution.allocated_cpus != self.reserved_cpus:
            # Reserve all inner CPU capacity while launching exactly one host.
            raise Problem("PRECONDITION_FAILED")
        return (sys.executable, "-I", "-m", "dftlab_platform.hf1_worker", str(checked_path(input_path)))

    def parse_output(self, lines, **kwargs):
        if self._controller_mode:
            outcome = kwargs.get("outcome")
            if outcome is None or type(outcome.exit_code) is not int:
                raise Problem("PRECONDITION_FAILED")
            return {"kind": "dftlab.hf1.controller-output", "schema_version": 1,
                    "exit_code": outcome.exit_code,
                    "terminated_by_controller": bool(outcome.terminated_by_controller)}
        raw = "".join(lines).encode("utf-8")
        if len(raw) > 2*1024**2:
            raise Problem("PAYLOAD_TOO_LARGE")
        if not raw.strip():
            return None
        value = loads(raw)
        if not isinstance(value, dict) or value.get("kind") != "dftlab.hf1.worker-result" or value.get("schema_version") != 1 or type(value.get("schema_version")) is not int or value.get("outer_run_id") != self.run_id or value.get("bundle_sha256") != self.bundle_sha256 or value.get("scientific_assessment") != "NOT_ESTABLISHED" or value.get("quantity_kind") != "U_scalar_charge":
            raise Problem("PRECONDITION_FAILED")
        if self._prepared_identity is None or tuple(value.get(key) for key in ("task_id", "attempt_id", "campaign_id")) != self._prepared_identity:
            raise Problem("PRECONDITION_FAILED")
        return value

    def classify_result(self, parsed, **kwargs):
        if self._controller_mode:
            outcome = kwargs.get("outcome")
            if (not isinstance(parsed, Mapping) or parsed.get("kind") != "dftlab.hf1.controller-output"
                    or parsed.get("schema_version") != 1 or outcome is None
                    or parsed.get("exit_code") != outcome.exit_code):
                raise Problem("PRECONDITION_FAILED")
            status = "BLOCKED" if outcome.terminated_by_controller or outcome.exit_code == 75 else "PASS" if outcome.exit_code == 0 else "FAIL"
            return HF1Classification(status, "HF1_CONTROLLER_" + status,
                                     ("Native HubbardFlow evidence remains authoritative; physical acceptance not established",),
                                     None, None)
        if parsed is None:
            return HF1Classification("REVIEW", "HF1_NATIVE_EVIDENCE_ABSENT", ("No original worker receipt observed",), None, None)
        parsed = self.parse_output([canonical(parsed).decode("utf-8")])
        receipt = parsed.get("native_worker_receipt")
        if receipt is None:
            return HF1Classification("REVIEW", "HF1_NATIVE_EVIDENCE_ABSENT", ("No original worker receipt observed",), parsed["campaign_id"], None)
        native = self.engines.hubbardflow.ApiResult.from_mapping(receipt)
        if native.operation != self.engines.hubbardflow.ApiOperation.WORKER_STATUS or native.to_mapping()["payload"].get("campaign_id") != parsed["campaign_id"]:
            raise Problem("PRECONDITION_FAILED")
        status = "REVIEW"
        if parsed.get("cancel_requested") is True:
            status = "BLOCKED"
        elif native.native_status in {"FAILED", "ERROR"}:
            status = "FAIL"
        elif native.native_status == "COMPLETED" and type(parsed.get("exit_code")) is int and parsed["exit_code"] == 0 and parsed.get("local_children_closed") is True and parsed.get("orphan_observed") is False:
            status = "PASS"  # technical only, never physical U acceptance
        return HF1Classification(status, "HF1_NATIVE_WORKER_"+native.native_status, ("Native receipt preserved; physical acceptance not established",), parsed["campaign_id"], receipt)

    def discover_artifacts(self, workspace, **kwargs):
        _, files = inventory_native(checked_path(workspace), 8192, 300*1024**2)
        return tuple(HF1Artifact(item["path"], item["sha256"]) for item in files)

    def register(self, registry):
        core = self.engines.qraft_contracts()
        required = ("CapabilityDescriptor", "CapabilityKind", "PluginDescriptor", "ContractVersion", "EXECUTION_REQUEST", "EXECUTION_EVIDENCE")
        if any(name not in core.__all__ or not hasattr(core, name) for name in required):
            raise Problem("ENGINE_UNAVAILABLE")
        descriptor = core.CapabilityDescriptor(
            CAPABILITY, core.CapabilityKind.ENGINE, "0.1.0",
            (core.EXECUTION_REQUEST,), (core.EXECUTION_EVIDENCE,), metadata={
                "dftlab.hf1": {"mode": "HF-1", "scope": "one-node"},
                "qraft.controller": {
                    "schema_version": "1.0", "distribution": "dftlab-platform",
                    "entrypoint": "dftlab-hf1-controller",
                    "inner_launchers": ["openmpi"], "resume": "NATIVE_VERIFIED",
                },
            },
        )
        registry.register(core.PluginDescriptor("dftlab.plugin.hubbardflow.hf1", "0.1.0", core.ContractVersion(1, 0), (descriptor,), "dftlab-platform"), {CAPABILITY: self})

    def prepare_controller_task(self, task, *, by_task, artifacts, resolved_sources, profile, protected):
        """Translate one lock-bound HF-1 capability into ADR-017's controller task."""
        if (getattr(task, "capability_id", None) != CAPABILITY
                or not isinstance(task.task_id, str) or not task.task_id
                or getattr(getattr(task, "kind", None), "value", None) != "calculation"
                or task.settings or not isinstance(task.resources, Mapping)
                or set(task.resources) != _TASK_RESOURCE_FIELDS):
            raise Problem("PRECONDITION_FAILED")
        resources = dict(task.resources)
        # Core Contracts workflow resources are positive. The adapter translates
        # their one-rank calculation declaration to the controller's native
        # outer launch shape (nodes=0, mpi_processes=1, cpus_per_process=1).
        if controller_profile_findings(resources, profile, self.reserved_cpus):
            raise Problem("PRECONDITION_FAILED")
        if len(task.inputs) != 1:
            raise Problem("PRECONDITION_FAILED")
        binding = task.inputs[0]
        external_id = getattr(binding, "external_artifact_id", None)
        if not isinstance(external_id, str) or getattr(binding, "source_task_id", None) is not None:
            raise Problem("PRECONDITION_FAILED")
        artifact = artifacts.get(external_id)
        if artifact is None or artifact.artifact_id not in resolved_sources:
            raise Problem("PRECONDITION_FAILED")
        source = checked_path(resolved_sources[artifact.artifact_id])
        if not source.is_file() or getattr(artifact, "sha256", None) != self.bundle_sha256:
            raise Problem("PRECONDITION_FAILED")
        inspected = self.inspect_input(source)
        if inspected.sha256 != artifact.sha256:
            raise Problem("PRECONDITION_FAILED")
        destination = safe_path(binding.destination).as_posix()
        package_source = safe_path(
            (PurePosixPath("protected") / task.task_id / binding.name
             / PurePosixPath(artifact.relative_path).name).as_posix()
        ).as_posix()
        if package_source in protected:
            raise Problem("PRECONDITION_FAILED")
        protected[package_source] = source
        return {
            "task_id": task.task_id, "capability_id": CAPABILITY, "kind": "controller",
            "input": package_source, "input_hashes": {package_source: artifact.sha256},
            "input_destinations": {package_source: destination},
            "required_artifacts": [item.relative_path for item in task.outputs if item.required],
            "optional_artifacts": [item.relative_path for item in task.outputs if not item.required],
            "depends_on": list(task.dependencies), "transfers": [],
            "nodes": 0, "mpi_processes": 1, "cpus_per_process": 1,
            "reservation": dict(CONTROLLER_RESERVATION),
            "estimated_runtime_seconds": resources["walltime_seconds"],
            "max_attempts": profile.max_attempts,
        }

    def native_extensions(self, workflow_digest, bindings):
        """Build operator-owned QRAFT bindings for the verified native workflow lock."""
        from .native_worker import RegisteredNativeExtensions
        values = tuple(sorted(tuple(item) for item in bindings))
        if (not isinstance(workflow_digest, str) or len(workflow_digest) != 64
                or not values or any(capability != CAPABILITY for _, capability in values)):
            raise Problem("PRECONDITION_FAILED")
        def verify_installed():
            self.engines.qraft_contracts()
            if (not self.engines.hubbardflow.__file__
                    or not Path(self.engines.hubbardflow.__file__).resolve().is_relative_to(self.engines._roots["hubbardflow"])):
                raise Problem("ENGINE_UNAVAILABLE")
            return None
        verify_installed()
        return RegisteredNativeExtensions(workflow_digest, values, self.register, verify_installed)
