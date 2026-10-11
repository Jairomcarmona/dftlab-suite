"""Pinned installation and native identity adversaries, no installed motors."""
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from zipfile import ZipFile

from dftlab_platform.contracts import resource_json
from dftlab_platform.domain import Problem, envelope
from dftlab_platform.engines import PinnedEngines, QraftAuthoring, engine_lock


class Engines(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.site = self.root/"site"
        self.wheels = self.root/"wheels"
        self.wheels.mkdir()
        self.lock = {"engines": {}}
        self.imported = []
        self.apis = {}
        for name in ("qraft", "hubbardflow"):
            folder = self.site/name
            folder.mkdir(parents=True)
            (folder/"__init__.py").write_bytes(b"# synthetic installation fixture\n")
            wheel = self.wheels/(name+"-1.0-py3-none-any.whl")
            with ZipFile(wheel, "w") as archive:
                archive.write(folder/"__init__.py", name+"/__init__.py")
            self.lock["engines"][name] = {"module": name, "distribution": name, "declared_version": "1.0", "commit": "1"*40, "targets": {"fixture": {"wheel": {"file": wheel.name, "bytes": wheel.stat().st_size, "sha256": hashlib.sha256(wheel.read_bytes()).hexdigest()}}}, "public_api": {"module": name+".api", "version": "1.0", "required_symbols": ["fixture_public_method"]}}
            self.apis[name+".api"] = SimpleNamespace(API_VERSION="1.0", __all__=["fixture_public_method"], fixture_public_method=lambda: None, __file__=str(folder/"__init__.py"))

    def tearDown(self):
        self.directory.cleanup()

    def load(self):
        distribution = lambda name: SimpleNamespace(version="1.0", locate_file=lambda path: self.site/path)
        def importer(name):
            self.imported.append(name)
            return self.apis[name]
        return PinnedEngines(self.wheels, lock=self.lock, target="fixture", distribution=distribution, importer=importer)

    def problem(self, code, call, *args, **kwargs):
        with self.assertRaises(Problem) as caught:
            call(*args, **kwargs)
        self.assertEqual(caught.exception.code, code)

    def test_both_sources_checked_before_first_import(self):
        result = self.load()
        self.assertEqual(self.imported, ["qraft.api", "hubbardflow.api"])
        self.assertEqual(result.evidence["qraft"]["commit"], "1"*40)
        self.imported.clear()
        (self.site/"hubbardflow/__init__.py").write_bytes(b"tampered")
        self.problem("ENGINE_UNAVAILABLE", self.load)
        self.assertEqual(self.imported, [])

    def test_wheel_mutation_missing_mandatory_motor_and_extra_source_rejected(self):
        wheel = self.wheels/self.lock["engines"]["qraft"]["targets"]["fixture"]["wheel"]["file"]
        original = wheel.read_bytes()
        wheel.write_bytes(original+b"modified")
        self.problem("ENGINE_UNAVAILABLE", self.load)
        self.assertEqual(self.imported, [])
        wheel.write_bytes(original)
        (self.site/"qraft/unexpected.py").write_bytes(b"# unexpected import target")
        self.problem("ENGINE_UNAVAILABLE", self.load)
        self.assertEqual(self.imported, [])
        (self.site/"qraft/unexpected.py").unlink()
        del self.lock["engines"]["hubbardflow"]
        self.problem("ENGINE_UNAVAILABLE", self.load)
        self.assertEqual(self.imported, [])

    def test_api_version_symbol_and_import_location_rejected(self):
        self.apis["qraft.api"].API_VERSION = "2.0"
        self.problem("ENGINE_UNAVAILABLE", self.load)
        self.apis["qraft.api"].API_VERSION = "1.0"
        self.apis["qraft.api"].__all__ = []
        self.problem("ENGINE_UNAVAILABLE", self.load)
        self.apis["qraft.api"].__all__ = ["fixture_public_method"]
        self.apis["qraft.api"].__file__ = str(self.root/"foreign-checkout/api.py")
        self.problem("ENGINE_UNAVAILABLE", self.load)

    def test_public_core_serializer_origin_version_and_exports(self):
        loaded = self.load()
        required = ["CORE_CONTRACT_VERSION", "ContractEnvelope", "VALIDATION_REPORT", "canonical_primitive", "canonical_json"]
        core = SimpleNamespace(__file__=str(self.site/"qraft/__init__.py"), __all__=required,
                               **{name: "1.0" if name == "CORE_CONTRACT_VERSION" else lambda: None for name in required})
        self.apis["qraft.contracts"] = core
        self.assertIs(loaded.qraft_contracts(), core)
        core.CORE_CONTRACT_VERSION = "2.0"
        self.problem("ENGINE_UNAVAILABLE", loaded.qraft_contracts)
        core.CORE_CONTRACT_VERSION = "1.0"
        core.__file__ = str(self.root/"foreign-core/__init__.py")
        self.problem("ENGINE_UNAVAILABLE", loaded.qraft_contracts)
        core.__file__ = str(self.site/"qraft/__init__.py")
        core.__all__ = []
        self.problem("ENGINE_UNAVAILABLE", loaded.qraft_contracts)

    def test_original_lock_bundled_with_mandatory_facades(self):
        lock = engine_lock()
        self.assertEqual(set(lock["engines"]), {"qraft", "hubbardflow"})
        self.assertEqual(lock["engines"]["qraft"]["public_api"]["module"], "qraft.api")
        self.assertEqual(lock["engines"]["hubbardflow"]["public_api"]["module"], "hubbardflow.api")

    def authoring(self):
        calls = []
        native = "2"*64  # opaque engine-owned fixture value; NOT a JCS digest
        body = resource_json("fixtures/run-intent/valid/promoted-to-draft.json")["payload"]
        intent = envelope("run-intent", "fixture-project", body)
        identity = {"workflow_id": body["intent_id"], "project_id": "fixture-project"}
        class Composer:
            def compose(self, native_intent, policy, fragments):
                calls.append(("compose", native_intent))
                return {"fixture": True}
        class Compiler:
            def compile_mapping(self, value, *, source_root):
                calls.append(("compile", source_root))
                return SimpleNamespace(valid=True)
        def writer(compilation, path):
            path.write_bytes(json.dumps({"payload": identity, "content_sha256": native}).encode())
            return native
        def loader(path):
            value = json.loads(path.read_bytes())
            return SimpleNamespace(content_sha256=value["content_sha256"]), SimpleNamespace(**value["payload"])
        class Preparer:
            def prepare(self, request):
                calls.append(("prepare", request))
                request.output_root.mkdir(exist_ok=True)
                archive = request.output_root/"fixture.zip"
                archive.write_bytes(b"opaque fixture package bytes")
                return SimpleNamespace(execution_authorized=False, submission_performed=False, workflow_lock_sha256=native, run_id=request.run_id, package_path=str(request.output_root), zip_path=str(archive), zip_sha256=hashlib.sha256(archive.read_bytes()).hexdigest(), validation_status="REVIEW")
        api = SimpleNamespace(WorkflowComposer=Composer, WorkflowCompiler=Compiler, write_workflow_lock=writer, load_workflow_lock=loader, RunPreparer=Preparer, RunPreparationRequest=lambda **fields: SimpleNamespace(**fields), RunInspector=lambda: SimpleNamespace(inspect=lambda path: SimpleNamespace(status="PREPARED_RUN_VERIFIED")))
        adapter = QraftAuthoring(SimpleNamespace(qraft=api, hubbardflow=object()))
        policy = SimpleNamespace(execution_authorized=False, recipe_id=body["protocol"]["protocol_id"], recipe_version=body["protocol"]["version"])
        return adapter, intent, policy, calls

    def test_native_digest_identity_and_review_are_not_rewritten(self):
        adapter, intent, policy, calls = self.authoring()
        plan = adapter.compile(intent, policy, [object()], source_root=self.root, lock_path=self.root/"workflow.lock.json")
        self.assertEqual(plan.native_digest, "2"*64)
        self.assertNotEqual(plan.file_sha256, plan.native_digest)
        self.assertEqual(plan.intent_id, intent["payload"]["intent_id"])
        self.assertEqual(calls[0][1].sha256, intent["integrity"]["digest"])
        result, _ = adapter.prepare(plan, expected_native_digest=plan.native_digest, profile=self.root/"profile.json", output_root=self.root/"package", run_id="fixture-run")
        self.assertEqual(result.validation_status, "REVIEW")
        self.assertEqual([value[0] for value in calls], ["compose", "compile", "prepare"])

    def test_plan_tamper_expected_digest_and_policy_mismatch_prevent_preparation(self):
        adapter, intent, policy, calls = self.authoring()
        policy.recipe_version = "99.0.0"
        self.problem("PRECONDITION_FAILED", adapter.compile, intent, policy, [], source_root=self.root, lock_path=self.root/"unused.json")
        self.assertEqual(calls, [])
        policy.recipe_version = intent["payload"]["protocol"]["version"]
        policy.execution_authorized = True
        self.problem("PRECONDITION_FAILED", adapter.compile, intent, policy, [], source_root=self.root, lock_path=self.root/"unused.json")
        policy.execution_authorized = False
        plan = adapter.compile(intent, policy, [], source_root=self.root, lock_path=self.root/"workflow.lock.json")
        options = {"expected_native_digest": "3"*64, "profile": self.root/"profile.json", "output_root": self.root/"package", "run_id": "fixture-run"}
        self.problem("REVISION_CONFLICT", adapter.prepare, plan, **options)
        options["expected_native_digest"] = plan.native_digest
        plan.lock_path.write_bytes(plan.lock_path.read_bytes()+b" ")
        self.problem("REVISION_CONFLICT", adapter.prepare, plan, **options)
        self.assertEqual([value[0] for value in calls], ["compose", "compile"])

    def test_package_ack_with_wrong_original_bytes_is_rejected(self):
        adapter, intent, policy, _ = self.authoring()
        plan = adapter.compile(intent, policy, [], source_root=self.root, lock_path=self.root/"workflow.lock.json")
        original = adapter.engines.qraft.RunPreparer
        class BadPreparer:
            def prepare(self, request):
                result = original().prepare(request)
                Path(result.zip_path).write_bytes(b"tampered after native packaging")
                return result
        adapter.engines.qraft.RunPreparer = BadPreparer
        self.problem("PRECONDITION_FAILED", adapter.prepare, plan, expected_native_digest=plan.native_digest, profile=self.root/"profile.json", output_root=self.root/"package", run_id="fixture-run")
