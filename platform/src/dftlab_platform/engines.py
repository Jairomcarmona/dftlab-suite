"""Pinned public engine facade, separate from API, admission and scheduling.

Installation identity is checked before importing either motor. No scientific
policy, workflow resolver or native digest implementation is duplicated here.
"""
from dataclasses import dataclass
import hashlib
from importlib import import_module, metadata, resources
import json
import os
from pathlib import Path, PurePosixPath
import platform
from types import SimpleNamespace
from zipfile import ZipFile

from .contracts import Contracts, digest
from .domain import Problem


def engine_lock():
    return json.loads(resources.files("dftlab_platform").joinpath("resources/engine-versions.lock.json").read_bytes())


def engine_target():
    if platform.machine().lower() not in {"amd64", "x86_64"}:
        raise Problem("ENGINE_UNAVAILABLE")
    if os.name == "nt":
        return "windows_native_x86_64"
    if "microsoft" in platform.release().lower():
        return "wsl2_linux_x86_64"
    # The lock has no generic Linux installation evidence yet.
    raise Problem("ENGINE_UNAVAILABLE")


def verify_installation(engine, target, wheel, distribution):
    """Verify original distribution source/resources; not runtime qualification.

    Installed environments are managed privately by the operator. This is not
    a sandbox against a principal who can rewrite the interpreter or caches.
    """
    expected = engine["targets"].get(target, {}).get("wheel")
    wheel = Path(wheel)
    if not expected or wheel.is_symlink() or not wheel.is_file() or wheel.name != expected["file"]:
        raise Problem("ENGINE_UNAVAILABLE")
    with wheel.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if wheel.stat().st_size != expected["bytes"] or actual != expected["sha256"] or distribution.version != engine["declared_version"]:
        raise Problem("ENGINE_UNAVAILABLE")
    module = engine["module"]
    manifest = {}
    root = Path(distribution.locate_file(module))
    if root.is_symlink() or not root.is_dir():
        raise Problem("ENGINE_UNAVAILABLE")
    root = root.resolve()
    with ZipFile(wheel) as archive:
        for item in archive.infolist():
            path = PurePosixPath(item.filename)
            if path.is_absolute() or ".." in path.parts:
                raise Problem("ENGINE_UNAVAILABLE")
            if not path.parts or path.parts[0] != module or item.is_dir():
                continue
            installed = Path(distribution.locate_file(item.filename))
            if installed.is_symlink() or not installed.resolve().is_relative_to(root) or not installed.is_file():
                raise Problem("ENGINE_UNAVAILABLE")
            original = archive.read(item)
            if installed.stat().st_size != len(original):
                raise Problem("ENGINE_UNAVAILABLE")
            with installed.open("rb") as stream:
                installed_hash = hashlib.file_digest(stream, "sha256").hexdigest()
            if installed_hash != hashlib.sha256(original).hexdigest():
                raise Problem("ENGINE_UNAVAILABLE")
            manifest[item.filename] = installed_hash
    if module+"/__init__.py" not in manifest:
        raise Problem("ENGINE_UNAVAILABLE")
    # Additional source modules/resources can change Python import resolution.
    for installed in root.rglob("*"):
        if "__pycache__" in installed.parts or not installed.is_file():
            continue
        if (PurePosixPath(module)/installed.relative_to(root).as_posix()).as_posix() not in manifest:
            raise Problem("ENGINE_UNAVAILABLE")
    return {"commit": engine["commit"], "wheel_sha256": actual, "source_manifest_sha256": digest(manifest), "target": target}


class PinnedEngines:
    def __init__(self, wheelhouse, *, lock=None, target=None, distribution=metadata.distribution, importer=import_module):
        lock, target = lock or engine_lock(), target or engine_target()
        self.lock, self.target, self.evidence = lock, target, {}
        try:
            roots = {}
            for name in ("qraft", "hubbardflow"):
                engine = lock["engines"][name]
                wheel = Path(wheelhouse)/engine["targets"][target]["wheel"]["file"]
                installed = distribution(engine["distribution"])
                self.evidence[name] = verify_installation(engine, target, wheel, installed)
                roots[name] = Path(installed.locate_file(engine["module"])).resolve()
            # Both are mandatory, including a non-Hubbard single point.
            apis = {}
            for name in ("qraft", "hubbardflow"):
                declared = lock["engines"][name]["public_api"]
                api = importer(declared["module"])
                if not Path(api.__file__).resolve().is_relative_to(roots[name]) or api.API_VERSION != declared["version"] or any(symbol not in api.__all__ or not hasattr(api, symbol) for symbol in declared["required_symbols"]):
                    raise Problem("ENGINE_UNAVAILABLE")
                apis[name] = api
            self.qraft, self.hubbardflow = apis["qraft"], apis["hubbardflow"]
            self._roots, self._importer = roots, importer
        except (OSError, KeyError, ValueError, AttributeError, ImportError, metadata.PackageNotFoundError):
            # No exception detail/paths leak to clients or logs.
            raise Problem("ENGINE_UNAVAILABLE") from None

    def qraft_contracts(self):
        """Pinned public core serialization facade; never implementation imports."""
        try:
            api = self._importer("qraft.contracts")
            required = ("CORE_CONTRACT_VERSION", "ContractEnvelope", "VALIDATION_REPORT", "canonical_primitive", "canonical_json")
            if not Path(api.__file__).resolve().is_relative_to(self._roots["qraft"]) or str(api.CORE_CONTRACT_VERSION) != "1.0" or any(name not in api.__all__ or not hasattr(api, name) for name in required):
                raise Problem("ENGINE_UNAVAILABLE")
            return api
        except (OSError, AttributeError, ImportError, KeyError, ValueError):
            raise Problem("ENGINE_UNAVAILABLE") from None


@dataclass(frozen=True)
class NativePlan:
    intent_id: str
    project_id: str
    source_root: Path
    lock_path: Path
    native_digest: str
    file_sha256: str


class QraftAuthoring:
    def __init__(self, engines, *, contracts=None):
        self.engines, self.contracts = engines, contracts or Contracts()

    def compile(self, intent, policy, fragments, *, source_root, lock_path, authoring_metadata=None):
        self.contracts.validate("run-intent", intent)
        if intent["integrity"]["status"] != "VERIFIED" or policy.execution_authorized is not False:
            raise Problem("PRECONDITION_FAILED")
        if policy.recipe_id != intent["payload"]["protocol"]["protocol_id"] or policy.recipe_version != intent["payload"]["protocol"]["version"]:
            raise Problem("PRECONDITION_FAILED")
        api = self.engines.qraft
        metadata = {"dftlab.run_intent_record_id": intent["record_id"], "dftlab.protocol": intent["payload"]["protocol"]}
        if authoring_metadata is not None:
            # Adapter-owned, versioned metadata inside the existing native
            # metadata extension. The motor computes its own lock digest.
            from .contracts import canonical
            if set(authoring_metadata) != {"dftlab.authoring"} or len(canonical(authoring_metadata)) > 262144:
                raise Problem("PRECONDITION_FAILED")
            metadata.update(authoring_metadata)
        identity = SimpleNamespace(intent_id=intent["payload"]["intent_id"], project_id=intent["project_id"], sha256=intent["integrity"]["digest"], metadata=metadata)
        definition = api.WorkflowComposer().compose(identity, policy, fragments)
        compilation = api.WorkflowCompiler().compile_mapping(definition, source_root=Path(source_root))
        if not compilation.valid:
            raise Problem("VALIDATION_FAILED")
        lock_path = Path(lock_path)
        native = api.write_workflow_lock(compilation, lock_path)
        document = json.loads(lock_path.read_bytes())
        if native != document["content_sha256"] or document["payload"]["workflow_id"] != identity.intent_id or document["payload"]["project_id"] != identity.project_id:
            raise Problem("PRECONDITION_FAILED")
        api.load_workflow_lock(lock_path)  # engine owns semantic/digest checking
        return NativePlan(identity.intent_id, identity.project_id, Path(source_root), lock_path, native, hashlib.sha256(lock_path.read_bytes()).hexdigest())

    def prepare(self, plan, *, expected_native_digest, profile, output_root, run_id, validator=None):
        if expected_native_digest != plan.native_digest or hashlib.sha256(plan.lock_path.read_bytes()).hexdigest() != plan.file_sha256:
            raise Problem("REVISION_CONFLICT")
        api = self.engines.qraft
        envelope, workflow = api.load_workflow_lock(plan.lock_path)
        if envelope.content_sha256 != plan.native_digest or workflow.workflow_id != plan.intent_id or workflow.project_id != plan.project_id:
            raise Problem("PRECONDITION_FAILED")
        # Installed RunPreparer owns the packaged runtime, input hashing and
        # DAG. Never pass a repository_root or implement another compiler.
        preparer = api.RunPreparer() if validator is None else api.RunPreparer(validator=validator)
        result = preparer.prepare(api.RunPreparationRequest(workflow_lock=plan.lock_path, source_root=plan.source_root, execution_profile=Path(profile), output_root=Path(output_root), run_id=run_id))
        if result.execution_authorized is not False or result.submission_performed is not False or result.workflow_lock_sha256 != plan.native_digest or result.run_id != run_id:
            raise Problem("PRECONDITION_FAILED")
        package, archive = Path(result.package_path), Path(result.zip_path)
        if package.is_symlink() or archive.is_symlink() or not package.resolve().is_relative_to(Path(output_root).resolve()) or not archive.resolve().is_relative_to(Path(output_root).resolve()) or not archive.is_file():
            raise Problem("PRECONDITION_FAILED")
        with archive.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != result.zip_sha256:
                raise Problem("PRECONDITION_FAILED")
        inspection = api.RunInspector().inspect(Path(result.package_path))
        if inspection.status != "PREPARED_RUN_VERIFIED":
            raise Problem("PRECONDITION_FAILED")
        return result, inspection
