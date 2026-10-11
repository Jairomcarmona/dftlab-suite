"""Specialized public QRAFT extension, never a generic command capability.

No scheduler, LR mathematics, scientific gate or native digest algorithm is
implemented here. The original native worker receipt and files remain intact.
Initial scope is fresh one-node HF1; compound resume is not advertised yet.
"""
from dataclasses import dataclass
from pathlib import Path
import sys

from .checkpoints import checked_path, write_new
from .contracts import canonical, loads
from .domain import Problem
from .hf1_bundle import inspect_bundle, materialize_bundle
from .native_checkpoints import inventory_native


CAPABILITY = "dftlab.engine.hubbardflow.hf1"


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

    def inspect_input(self, path):
        return inspect_bundle(path, expected_sha256=self.bundle_sha256, expected_profile_sha256=self.profile_sha256, reserved_cpus=self.reserved_cpus)

    def validate_input(self, inspected, **kwargs):
        # Scientific semantics are validated only by the native CLI/engine.
        if inspected.sha256 != self.bundle_sha256 or inspected.reserved_cpus != self.reserved_cpus:
            raise Problem("PRECONDITION_FAILED")
        return HF1Classification("PASS", "HF1_TRANSPORT_VERIFIED", (), inspected.campaign_id, None)

    def prepare_task(self, inspected, workspace, **kwargs):
        workspace = checked_path(workspace)
        if self._prepared_identity is not None or type(kwargs.get("task_id")) is not str or type(kwargs.get("attempt_id")) is not str or len(kwargs["inputs"]) != 1:
            raise Problem("PRECONDITION_FAILED")
        source = next(iter(kwargs["inputs"].values()))
        original = self.inspect_input(source)
        if original != inspected:
            raise Problem("PRECONDITION_FAILED")
        materialize_bundle(original, workspace/"hf1")
        request = {"schema_version": 1, "outer_run_id": self.run_id, "task_id": kwargs["task_id"], "attempt_id": kwargs["attempt_id"], "bundle": str(checked_path(source)), "bundle_sha256": self.bundle_sha256,
                   "profile_sha256": self.profile_sha256, "reserved_cpus": self.reserved_cpus, "wheelhouse": str(self.wheelhouse), "max_seconds": self.max_seconds, "grace_seconds": self.grace_seconds, "campaign_id": original.campaign_id}
        request_path = workspace/"hf1-request.json"
        write_new(request_path, canonical(request))
        self._prepared_identity = (request["task_id"], request["attempt_id"], original.campaign_id)
        return request_path

    def build_command(self, input_path, **kwargs):
        execution = kwargs["execution_spec"]
        if execution.launcher != "direct" or execution.mpi_ranks != 1 or execution.allocated_cpus != self.reserved_cpus:
            # Reserve all inner CPU capacity while launching exactly one host.
            raise Problem("PRECONDITION_FAILED")
        return (sys.executable, "-I", "-m", "dftlab_platform.hf1_worker", str(checked_path(input_path)))

    def parse_output(self, lines, **kwargs):
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
        descriptor = core.CapabilityDescriptor(CAPABILITY, core.CapabilityKind.ENGINE, "0.1.0", (core.EXECUTION_REQUEST,), (core.EXECUTION_EVIDENCE,), metadata={"dftlab.hf1": {"mode": "HF-1", "scope": "fresh-single-node", "resume": "NOT_QUALIFIED", "runtime": "BLOCKED_NATIVE_RESOURCE_CONTRACT"}})
        registry.register(core.PluginDescriptor("dftlab.plugin.hubbardflow.hf1", "0.1.0", core.ContractVersion(1, 0), (descriptor,), "dftlab-platform"), {CAPABILITY: self})

    def prepare_controller_task(self, task, **kwargs):
        """Fail before package mutation until the native resource path exists.

        Pinned QRAFT only accepts siesta or gate tasks. A gate must reserve
        one CPU and zero nodes; HF1 needs a single directly launched host
        reserving its inner capacity. Neither relabeling it as siesta nor
        under-declaring a gate is acceptable. Upstream issue siestaflow#10
        defines the required public extension; this callable is deliberately
        unavailable and cannot create an apparently prepared package.
        """
        raise Problem("ENGINE_UNAVAILABLE")
