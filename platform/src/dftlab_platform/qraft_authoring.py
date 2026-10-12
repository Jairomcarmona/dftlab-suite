"""Installed public authoring port with authorized, byte-preserving artifacts.

Recipe registration belongs to the service operator, not to an HTTP payload.
Sources are artifact references, never client-controlled host paths. This port
prepares and inspects; it does not submit, admit, run or qualify science.
"""
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import os
from pathlib import Path, PurePosixPath
import tempfile
from typing import Callable, Mapping

from .contracts import Contracts, loads
from .domain import Principal, Problem, envelope, identifier, now, reseal
from .engines import NativePlan, QraftAuthoring
from .local_runtime import private_directory


NATIVE_SCOPE = "Preflight nativo de autoría registrada; no acredita admisión, entorno ni validez científica."
CONTROLLER_SCOPE = "Verificación de transporte del paquete del controlador; sin validación nativa de entradas SIESTA; no acredita admisión, entorno ni validez científica."


@dataclass(frozen=True)
class AuthoringRecipe:
    policy: object
    fragments: tuple
    sources: Mapping[str, dict]
    profile_id: str


@dataclass(frozen=True)
class AuthoringProfile:
    profile_id: str
    revision: int
    artifact: dict


class CapturingValidator:
    """RunPreparer parses; its public validator hook supplies the opaque model."""
    def __init__(self, validator):
        self.validator, self.reports = validator, []

    def validate(self, document, **kwargs):
        report = self.validator.validate(document, **kwargs)
        self.reports.append(report)
        return report


class QraftArtifactAuthoring:
    def __init__(self, engines, artifacts, recipes: Mapping[tuple[str, str], Callable[[Principal, dict], AuthoringRecipe]],
                 profiles: Mapping[str, AuthoringProfile], workspace: Path, *, artifact_limit=8*1024**2,
                 controller_adapter_factory=None):
        if type(artifact_limit) is not int or not 1 <= artifact_limit <= 8*1024**2:
            raise ValueError("Invalid authoring artifact limit")
        self.engines, self.artifacts, self.recipes, self.profiles = engines, artifacts, dict(recipes), dict(profiles)
        self.workspace = private_directory(workspace)
        if controller_adapter_factory is not None and not callable(controller_adapter_factory):
            raise ValueError("Trusted controller adapter factory required")
        self.controller_adapter_factory = controller_adapter_factory
        self.limit, self.contracts = artifact_limit, Contracts()
        self.adapter = QraftAuthoring(engines)
        self.core = engines.qraft_contracts()

    @contextmanager
    def _scratch(self):
        # TemporaryDirectory cleans only a newly allocated owned scratch tree.
        # Persistent artifacts/orphans are retained by ArtifactStore policy.
        with tempfile.TemporaryDirectory(prefix="authoring-", dir=self.workspace) as directory:
            yield Path(directory)

    def _data(self, owner, project, reference):
        self.contracts.validate("artifact-ref", reference)
        record = self.artifacts.metadata(owner, reference["artifact_id"])
        data = record["payload"]
        if record["project_id"] != project or record["integrity"]["status"] != "VERIFIED" or data["integrity_state"] != "VERIFIED" or data["sha256"] != reference["sha256"] or data["media_type"] != reference["media_type"]:
            raise Problem("PRECONDITION_FAILED")
        if data["size_bytes"] > self.limit:
            raise Problem("PAYLOAD_TOO_LARGE")
        result = bytearray()
        for chunk in self.artifacts.stream(owner, reference["artifact_id"]):
            if len(result)+len(chunk) > self.limit:
                raise Problem("PAYLOAD_TOO_LARGE")
            result.extend(chunk)
        if len(result) != data["size_bytes"] or hashlib.sha256(result).hexdigest() != reference["sha256"]:
            raise Problem("PRECONDITION_FAILED")
        return bytes(result)

    def _store(self, owner, project, data, kind, media_type):
        if len(data) > self.limit:
            raise Problem("PAYLOAD_TOO_LARGE")
        upload = self.artifacts.stage(owner, {"project_id": project, "kind": kind, "media_type": media_type,
                                             "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "idempotency_key": identifier()})
        for start in range(0, len(data), 65536):
            end = min(len(data), start+65536)
            self.artifacts.write(owner, upload["upload_id"], start, end-1, len(data), data[start:end])
        return self.artifacts.commit(owner, upload["upload_id"])

    @staticmethod
    def _artifact(record):
        return {key: record["payload"][key] for key in ("artifact_id", "sha256", "media_type")}

    @staticmethod
    def _write(path, data):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with path.open("xb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())

    def _sources(self, owner, project, root, sources):
        if not isinstance(sources, Mapping) or not 1 <= len(sources) <= 64:
            raise Problem("PRECONDITION_FAILED")
        total = 0
        for name, reference in sources.items():
            if not isinstance(name, str) or "\\" in name or ":" in name or "\x00" in name:
                raise Problem("PRECONDITION_FAILED")
            path = PurePosixPath(name)
            if path.is_absolute() or not path.parts or any(part in {".", ".."} for part in name.split("/")) or str(path) != name or len(path.parts) > 4:
                raise Problem("PRECONDITION_FAILED")
            data = self._data(owner, project, reference)
            total += len(data)
            if total > 4*self.limit:
                raise Problem("PAYLOAD_TOO_LARGE")
            self._write(root/path, data)

    def _profile(self, owner, project, profile_id, root):
        profile = self.profiles.get(profile_id)
        if profile is None or profile.profile_id != profile_id or type(profile.revision) is not int or profile.revision < 1:
            raise Problem("ENGINE_UNAVAILABLE")
        data = self._data(owner, project, profile.artifact)
        # Identity binding only; grammar and native digest belong to RunPreparer.
        document = loads(data)
        if not isinstance(document, dict) or document.get("profile_id") != profile_id:
            raise Problem("PRECONDITION_FAILED")
        destination = root/"profile.json"
        self._write(destination, data)
        return destination

    def _controller_task_adapters(self, owner, workflow, source_root, profile, run_id, supplied=None):
        capability = "dftlab.engine.hubbardflow.hf1"
        controller_tasks = [task for task in workflow.tasks if task.capability_id == capability]
        if not controller_tasks:
            return supplied
        if len(controller_tasks) != 1 or self.controller_adapter_factory is None or supplied is not None:
            raise Problem("ENGINE_UNAVAILABLE")
        # This factory is installed by the operator, never supplied by an API
        # request or native lock. It receives QRAFT's verified workflow and
        # immutable resolved source paths.
        adapters = self.controller_adapter_factory(
            owner=owner, workflow=workflow, source_root=source_root,
            profile=profile, run_id=run_id,
        )
        if (not isinstance(adapters, dict) or set(adapters) != {capability}
                or any(not callable(adapter) for adapter in adapters.values())):
            raise Problem("PRECONDITION_FAILED")
        return adapters

    def _recipe(self, owner, bundle):
        if bundle["intent"] is None:
            return None
        intent = bundle["intent"]["run_intent"]
        protocol = intent["payload"]["protocol"]
        resolve = self.recipes.get((protocol["protocol_id"], protocol["version"]))
        if resolve is None:
            return None
        recipe = resolve(owner, bundle)
        if not isinstance(recipe, AuthoringRecipe) or not isinstance(recipe.fragments, tuple) or not recipe.fragments:
            raise Problem("PRECONDITION_FAILED")
        return recipe

    def _compile(self, owner, bundle, snapshot, recipe, root):
        source = root/"source"
        source.mkdir(mode=0o700)
        self._sources(owner, bundle["draft"]["project_id"], source, recipe.sources)
        return self.adapter.compile(bundle["intent"]["run_intent"], recipe.policy, recipe.fragments,
                                    source_root=source, lock_path=root/"workflow.lock.json",
                                    authoring_metadata={"dftlab.authoring": {"version": "0.1.0", "snapshot": snapshot, "sources": dict(recipe.sources)}})

    def _native_ref(self, owner, project, native_bytes, contract, native_digest, kind):
        record = self._store(owner, project, native_bytes, kind, "application/json")
        pin = self.engines.lock["engines"]["qraft"]
        reference = {"engine": "qraft", "distribution": pin["distribution"], "version": pin["declared_version"], "commit": pin["commit"],
                     "contract": contract, "digest": {"algorithm": "qraft.content-sha256-v1", "value": native_digest},
                     "artifact": self._artifact(record), "verification": {"status": "VERIFIED", "verified_at": now()}}
        self.contracts.validate("native-contract-ref", reference)
        return reference

    def validate(self, owner, bundle, snapshot):
        project = bundle["draft"]["project_id"]
        recipe = self._recipe(owner, bundle)
        diagnostics, refs, inputs, policies = [], [], [snapshot], []
        decision, scope, controller_only = "BLOCKED", NATIVE_SCOPE, False
        if recipe is None:
            diagnostics.append({"code": "AUTHORING_PROTOCOL_UNAVAILABLE", "severity": "BLOCKING", "rule_kind": "HARD_RULE",
                                "message": "No hay protocolo registrado para este borrador.", "location": None})
        else:
            inputs.extend(recipe.sources.values())
            with self._scratch() as root:
                plan = self._compile(owner, bundle, snapshot, recipe, root)
                profile = self._profile(owner, project, recipe.profile_id, root)
                capture = CapturingValidator(self.engines.qraft.SiestaContextualValidator())
                run_id = identifier()
                # A workflow with a controller capability needs the operator's
                # adapter here too, or QRAFT rejects the unknown capability.
                adapters = self._controller_task_adapters(
                    owner, self.engines.qraft.load_workflow_lock(plan.lock_path)[1], root/"source", profile, run_id)
                try:
                    self.adapter.prepare(plan, expected_native_digest=plan.native_digest, profile=profile,
                                         output_root=root/"packages", run_id=run_id, validator=capture,
                                         task_adapters=adapters)
                except ValueError:
                    # A captured negative native report is evidence. A parser,
                    # storage or preparation failure without one is uncertainty.
                    if not capture.reports or not any(report.status.value in {"FAIL", "BLOCKED"} for report in capture.reports):
                        raise
                if not capture.reports and adapters is not None:
                    # Controller bundles carry their FDF inside a ZIP, so QRAFT's
                    # SIESTA validator never runs. Preparing with the verified
                    # adapter proved transport only; say so, never ACCEPTED.
                    controller_only = True
                    scope = CONTROLLER_SCOPE
                    diagnostics.append({"code": "CONTROLLER_BUNDLE_TRANSPORT_ONLY", "severity": "WARNING", "rule_kind": "HEURISTIC",
                                        "message": "El paquete se verificó por el adaptador del controlador; no hay validación nativa de entradas SIESTA.", "location": None})
                elif not capture.reports:
                    raise Problem("PRECONDITION_FAILED")
                statuses = [report.status.value for report in capture.reports]
                if any(state not in {"PASS", "REVIEW", "FAIL", "BLOCKED"} for state in statuses):
                    raise Problem("PRECONDITION_FAILED")
                decision = ("ACCEPTED_WITH_WARNINGS" if controller_only
                            else "BLOCKED" if any(state in {"FAIL", "BLOCKED"} for state in statuses)
                            else "ACCEPTED_WITH_WARNINGS" if "REVIEW" in statuses else "ACCEPTED")
                for report in capture.reports:
                    # Public native serializer computes and verifies native
                    # envelope bytes/digest. Platform JCS never replaces it.
                    native = self.core.ContractEnvelope.create(self.core.VALIDATION_REPORT, producer=report.produced_by,
                                                               payload=self.core.canonical_primitive(report))
                    ref = self._native_ref(owner, project, self.core.canonical_json(native.to_dict()).encode("utf-8"),
                                           str(native.contract), native.content_sha256, "qraft.validation-report")
                    refs.append(ref)
                    inputs.append(ref["artifact"])
                    policy = {"policy_id": "qraft.siesta-native-ruleset", "version": self.engines.lock["engines"]["qraft"]["declared_version"], "digest": report.ruleset_sha256}
                    if policy not in policies:
                        policies.append(policy)
                    for finding in report.findings:
                        state = finding.status.value
                        if state not in {"PASS", "REVIEW", "FAIL", "BLOCKED"}:
                            raise Problem("PRECONDITION_FAILED")
                        diagnostics.append({"code": finding.code, "severity": "BLOCKING" if state in {"FAIL", "BLOCKED"} else "WARNING" if state == "REVIEW" else "INFO",
                                            "rule_kind": "HEURISTIC" if finding.evidence_class.value == "HEURISTIC_REVIEW" else "HARD_RULE",
                                            "message": "Diagnóstico de QRAFT; los detalles originales están en el reporte nativo.", "location": None})
        receipt = envelope("validation-receipt", project, {"validator": {"name": "dftlab.qraft-authoring", "version": "0.1.0"},
                           "authority": "AUTHORITATIVE", "input_refs": inputs, "policies": policies, "diagnostics": diagnostics,
                           "decision": decision, "overrides": [], "scope": scope})
        receipt["native_contract_refs"] = refs
        reseal(receipt)
        return self.contracts.validate("validation-receipt", receipt)

    def compile(self, owner, bundle, receipt, snapshot):
        recipe = self._recipe(owner, bundle)
        if recipe is None:
            raise Problem("ENGINE_UNAVAILABLE")
        if any(reference not in receipt["payload"]["input_refs"] for reference in recipe.sources.values()):
            raise Problem("PRECONDITION_FAILED")
        with self._scratch() as root:
            plan = self._compile(owner, bundle, snapshot, recipe, root)
            return self._native_ref(owner, bundle["draft"]["project_id"], plan.lock_path.read_bytes(),
                                    "siestaflow.workflow-lock@1.0", plan.native_digest, "qraft.workflow-lock")

    def prepare(self, owner, native_plan, profile_id, *, task_adapters=None):
        metadata = self.artifacts.metadata(owner, native_plan["artifact"]["artifact_id"])
        project = metadata["project_id"]
        with self._scratch() as root:
            lock = root/"workflow.lock.json"
            data = self._data(owner, project, native_plan["artifact"])
            self._write(lock, data)
            native, workflow = self.engines.qraft.load_workflow_lock(lock)
            if native.content_sha256 != native_plan["digest"]["value"] or workflow.project_id != project:
                raise Problem("PRECONDITION_FAILED")
            binding = self.core.canonical_primitive(workflow.metadata.get("dftlab.authoring"))
            if not isinstance(binding, Mapping) or set(binding) != {"version", "snapshot", "sources"} or binding["version"] != "0.1.0":
                raise Problem("PRECONDITION_FAILED")
            self._data(owner, project, binding["snapshot"])
            source = root/"source"
            source.mkdir(mode=0o700)
            self._sources(owner, project, source, binding["sources"])
            plan = NativePlan(workflow.workflow_id, project, source, lock, native.content_sha256, hashlib.sha256(data).hexdigest())
            profile = self._profile(owner, project, profile_id, root)
            run_id = identifier()
            task_adapters = self._controller_task_adapters(
                owner, workflow, source, profile, run_id, supplied=task_adapters,
            )
            prepared, _ = self.adapter.prepare(plan, expected_native_digest=native.content_sha256, profile=profile,
                                               output_root=root/"packages", run_id=run_id,
                                               task_adapters=task_adapters)
            archive = Path(prepared.zip_path)
            if archive.stat().st_size > self.limit:
                raise Problem("PAYLOAD_TOO_LARGE")
            return self._store(owner, project, archive.read_bytes(), "qraft.run-package", "application/zip")
