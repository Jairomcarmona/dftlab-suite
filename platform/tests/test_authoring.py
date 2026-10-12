"""Immutable authorized application flow; synthetic adapter, no engine imports."""
import copy
import hashlib
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from dftlab_platform.artifact_storage import SQLiteArtifactIndex
from dftlab_platform.artifacts import LocalArtifactStore
from dftlab_platform.authoring import AuthoringHandlers
from dftlab_platform.contracts import canonical, resource_json
from dftlab_platform.domain import Processor, Problem, envelope, identifier
from dftlab_platform.draft_storage import SQLiteDraftRepository
from dftlab_platform.engines import engine_lock
from dftlab_platform.qraft_authoring import AuthoringProfile, AuthoringRecipe, QraftArtifactAuthoring
from dftlab_platform.storage import SQLiteRepository


class FixtureAuthoring:
    """Models an installed port's documents, never scientific validation."""
    def __init__(self, store, project):
        self.store, self.project = store, project
        self.receipt_change = lambda value: None
        self.plan_change = lambda value: None
        self.seen = []

    def blob(self, owner, data, kind, media):
        upload = self.store.stage(owner, {"project_id": self.project, "kind": kind, "media_type": media,
                                         "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "idempotency_key": identifier()})
        self.store.write(owner, upload["upload_id"], 0, len(data)-1, len(data), data)
        return self.store.commit(owner, upload["upload_id"])

    @staticmethod
    def ref(record):
        return {key: record["payload"][key] for key in ("artifact_id", "sha256", "media_type")}

    def validate(self, owner, bundle, snapshot):
        self.seen.append(("validate", copy.deepcopy(bundle)))
        payload = copy.deepcopy(resource_json("fixtures/validation-receipt/valid/heuristic-override.json")["payload"])
        payload.update(validator={"name": "synthetic.fixture", "version": "0.1.0"}, input_refs=[snapshot],
                       policies=[], diagnostics=[], overrides=[], decision="ACCEPTED", scope="synthetic adapter binding only; not scientific evidence")
        self.receipt_change(payload)
        return envelope("validation-receipt", self.project, payload)

    def compile(self, owner, bundle, receipt, snapshot):
        self.seen.append(("compile", copy.deepcopy(bundle)))
        record = self.blob(owner, b"synthetic native document fixture", "qraft.workflow-lock", "application/json")
        pin = engine_lock()["engines"]["qraft"]
        reference = {"engine": "qraft", "distribution": pin["distribution"], "version": pin["declared_version"], "commit": pin["commit"],
                     "contract": "siestaflow.workflow-lock@1.0", "digest": {"algorithm": "qraft.content-sha256-v1", "value": "a"*64},
                     "artifact": self.ref(record), "verification": {"status": "VERIFIED", "verified_at": record["created_at"]}}
        self.plan_change(reference)
        return reference

    def prepare(self, owner, native_plan, profile_id):
        self.seen.append(("prepare", profile_id))
        return self.blob(owner, b"synthetic package fixture; not a runnable ZIP", "qraft.run-package", "application/zip")


class AuthoringFixture(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.repo = SQLiteRepository(self.root/"state.sqlite")
        self.owner, self.other = [self.repo.ensure_principal(name) for name in ("owner", "other")]
        self.project = self.repo.create_project(self.owner, {"name": "Synthetic authoring", "idempotency_key": "authoring-project-001"})[0]["project_id"]
        self.store = LocalArtifactStore(self.root/"artifacts", SQLiteArtifactIndex(self.repo))
        self.drafts = SQLiteDraftRepository(self.repo, self.store)
        request = resource_json("fixtures/draft-create-request/valid/promote-template.json")
        request.update(title="Synthetic user authoring fixture", origin={"kind": "USER_AUTHORED", "learning_dataset_id": None, "exported_kind": None, "source_artifact": None})
        self.bundle = self.drafts.create(self.owner, self.project, request)[0]
        self.reference = {"draft_id": self.bundle["draft"]["payload"]["draft_id"], "revision": 1}
        self.native = FixtureAuthoring(self.store, self.project)
        self.handlers = AuthoringHandlers(self.repo, self.drafts, self.store, self.native)
        self.processor = Processor(self.repo, self.handlers.handlers())

    def tearDown(self):
        self.temporary.cleanup()

    def request(self, action, *, target=None, payload=None, profile=None):
        request = resource_json("fixtures/operation-request/valid/"+{"VALIDATE_INPUT": "validate-input", "CREATE_CAMPAIGN": "create-campaign", "CREATE_PLAN": "create-plan", "PREPARE_PACKAGE": "prepare-package"}[action]+".json")
        request.update(project_id=self.project, idempotency_key=identifier())
        if target is None:
            target = {"kind": "PROJECT", "id": self.project, "expected_revision": self.repo.project(self.owner, self.project)["revision"]}
        request["target"] = target
        if payload is None:
            payload = {"draft": self.reference} if action == "VALIDATE_INPUT" else {"name": "Frozen", "drafts": [self.reference]}
        request["payload"] = payload
        if profile:
            request["profile_ref"] = profile
        return request

    def execute(self, request):
        operation = self.repo.accept(self.owner, request)[0]
        self.assertTrue(self.processor.once())
        return self.repo.operation(self.owner, operation["payload"]["operation_id"])

    def product(self, operation):
        self.assertEqual(operation["payload"]["state"], "SUCCEEDED")
        return self.repo.local_products(self.owner, operation["payload"]["operation_id"])[0]

    def validated_campaign(self):
        receipt = self.product(self.execute(self.request("VALIDATE_INPUT")))
        campaign = self.product(self.execute(self.request("CREATE_CAMPAIGN")))
        return receipt, campaign

    def plan_request(self, receipt, campaign):
        return self.request("CREATE_PLAN", target={"kind": "CAMPAIGN", "id": campaign.product_id, "expected_revision": 1},
                            payload={"draft": self.reference, "intent_id": self.bundle["intent"]["run_intent"]["payload"]["intent_id"], "validation_receipt_id": receipt.product_id})

class Authoring(AuthoringFixture):
    def test_four_handlers_confirm_products_without_scientific_or_submit_claim(self):
        receipt, campaign = self.validated_campaign()
        plan = self.product(self.execute(self.plan_request(receipt, campaign)))
        package = self.product(self.execute(self.request("PREPARE_PACKAGE", target={"kind": "PLAN", "id": plan.product_id, "expected_revision": 1},
                                                        payload={"expected_plan_digest": plan.document["digest"]}, profile="profile-fixture")))
        self.assertEqual(package.document, self.store.metadata(self.owner, package.product_id))
        self.assertEqual(plan.document["digest"]["value"], "a"*64)
        self.assertEqual([step[0] for step in self.native.seen], ["validate", "compile", "prepare"])
        self.assertEqual(self.bundle["draft"]["payload"]["scientific_assessment"], "NOT_EVALUATED")
        self.assertIsNone(self.repo.claim("another-processor"))
        self.assertEqual(self.repo.local_product(self.owner, "PLAN", plan.product_id), plan)
        for owner, kind in ((self.other, "PLAN"), (self.owner, "CAMPAIGN")):
            with self.assertRaises(Problem) as caught:
                self.repo.local_product(owner, kind, plan.product_id)
            self.assertEqual(caught.exception.code, "NOT_FOUND")

    def test_new_editor_revision_cannot_change_accepted_input(self):
        request = self.request("VALIDATE_INPUT")
        operation = self.repo.accept(self.owner, request)[0]
        self.drafts.revise(self.owner, self.reference["draft_id"], {"expected_revision": 1, "idempotency_key": identifier(), "changes": {"title": "newer draft"}})
        self.assertTrue(self.processor.once())
        self.product(self.repo.operation(self.owner, operation["payload"]["operation_id"]))
        self.assertEqual(self.native.seen[0][1], self.bundle)
        self.assertEqual(self.drafts.get_revision(self.owner, self.reference["draft_id"], 1), self.bundle)
        with self.assertRaises(Problem):
            self.drafts.get_revision(self.other, self.reference["draft_id"], 1)
        with self.assertRaises(Problem):
            self.drafts.get_revision(self.owner, self.reference["draft_id"], 99)

    def test_plan_rejects_receipt_from_different_revision(self):
        receipt = self.product(self.execute(self.request("VALIDATE_INPUT")))
        self.bundle = self.drafts.revise(self.owner, self.reference["draft_id"], {"expected_revision": 1, "idempotency_key": identifier(), "changes": {"title": "revision 2"}})[0]
        self.reference = {**self.reference, "revision": 2}
        campaign = self.product(self.execute(self.request("CREATE_CAMPAIGN")))
        result = self.execute(self.plan_request(receipt, campaign))
        self.assertEqual(result["payload"]["state"], "OUTCOME_UNKNOWN")
        self.assertEqual(self.repo.local_products(self.owner, result["payload"]["operation_id"]), ())
        self.assertFalse(any(step[0] == "compile" for step in self.native.seen))

    def test_blocked_or_orientative_receipt_does_not_compile(self):
        for changes in ({"decision": "BLOCKED"}, {"authority": "ORIENTATIVE"},
                        {"diagnostics": [{"code": "HARD_FIXTURE", "severity": "BLOCKING", "rule_kind": "HARD_RULE", "message": "Synthetic hard rule", "location": None}]}):
            with self.subTest(changes=changes):
                self.native.receipt_change = lambda payload: payload.update(changes)
                receipt, campaign = self.validated_campaign()
                result = self.execute(self.plan_request(receipt, campaign))
                self.assertEqual(result["payload"]["state"], "OUTCOME_UNKNOWN")
        self.assertFalse(any(step[0] == "compile" for step in self.native.seen))

    def test_native_pin_and_expected_digest_fail_before_prepare(self):
        receipt, campaign = self.validated_campaign()
        self.native.plan_change = lambda reference: reference.update(commit="0"*40)
        result = self.execute(self.plan_request(receipt, campaign))
        self.assertEqual(result["payload"]["state"], "OUTCOME_UNKNOWN")
        self.native.plan_change = lambda reference: None
        receipt, campaign = self.validated_campaign()
        plan = self.product(self.execute(self.plan_request(receipt, campaign)))
        result = self.execute(self.request("PREPARE_PACKAGE", target={"kind": "PLAN", "id": plan.product_id, "expected_revision": 1},
                                           payload={"expected_plan_digest": {"algorithm": "qraft.content-sha256-v1", "value": "b"*64}}, profile="profile-fixture"))
        self.assertEqual(result["payload"]["state"], "OUTCOME_UNKNOWN")
        self.assertFalse(any(step[0] == "prepare" for step in self.native.seen))

    def test_mutating_adapter_cannot_replace_immutable_validation_input(self):
        original = self.native.validate
        def mutated(owner, bundle, snapshot):
            bundle["draft"]["payload"]["title"] = "not the authorized revision"
            return original(owner, bundle, snapshot)
        self.native.validate = mutated
        operation = self.execute(self.request("VALIDATE_INPUT"))
        self.assertEqual(operation["payload"]["state"], "OUTCOME_UNKNOWN")
        self.assertEqual(self.repo.local_products(self.owner, operation["payload"]["operation_id"]), ())
        self.assertEqual(self.drafts.get_revision(self.owner, self.reference["draft_id"], 1), self.bundle)

    def test_missing_snapshot_and_corrupted_source_never_confirm_receipt(self):
        self.native.receipt_change = lambda payload: payload.update(input_refs=[])
        result = self.execute(self.request("VALIDATE_INPUT"))
        self.assertEqual(result["payload"]["state"], "OUTCOME_UNKNOWN")
        self.native.receipt_change = lambda payload: None
        with patch.object(self.store, "verify", return_value=False):
            result = self.execute(self.request("VALIDATE_INPUT"))
        self.assertEqual(result["payload"]["state"], "OUTCOME_UNKNOWN")
        self.assertEqual(self.repo.local_products(self.owner, result["payload"]["operation_id"]), ())


class ArtifactAuthoring(AuthoringFixture):
    """Exercise the concrete byte/provenance boundary with synthetic public ports."""
    def port(self, **kwargs):
        engines = SimpleNamespace(qraft_contracts=lambda: SimpleNamespace(),
                                  qraft=SimpleNamespace(SiestaContextualValidator=lambda: object(),
                                                        load_workflow_lock=lambda path: (None, SimpleNamespace(tasks=(SimpleNamespace(capability_id="siestaflow.engine.siesta"),)))))
        return QraftArtifactAuthoring(engines, self.store, {}, {}, self.root/"scratch", **kwargs)

    def test_source_paths_limits_and_cross_owner_fail_before_materializing(self):
        port = self.port(artifact_limit=16)
        record = self.native.blob(self.owner, b"source bytes", "fixture.source", "text/plain")
        ref = self.native.ref(record)
        for name in ("../outside", "/absolute", "C:/host", "a\\b", "a/./b", "a//b", "a/b/c/d/e", "a\x00b", ""):
            with self.subTest(name=name), port._scratch() as root:
                with self.assertRaises(Problem):
                    port._sources(self.owner, self.project, root, {name: ref})
                self.assertEqual(list(root.iterdir()), [])
        with port._scratch() as root:
            port._sources(self.owner, self.project, root, {"inputs/Si.psml": ref})
            self.assertEqual((root/"inputs/Si.psml").read_bytes(), b"source bytes")
        with self.assertRaises(Problem):
            port._data(self.other, self.project, ref)
        with self.assertRaises(Problem):
            port._data(self.owner, identifier(), ref)
        with self.assertRaises(Problem):
            port._data(self.owner, self.project, {**ref, "sha256": "0"*64})
        with patch.object(self.store, "stream", return_value=iter([b"tampered"])):
            with self.assertRaises(Problem):
                port._data(self.owner, self.project, ref)
        oversized = self.native.blob(self.owner, b"x"*17, "fixture.source", "text/plain")
        with self.assertRaises(Problem) as caught:
            port._data(self.owner, self.project, self.native.ref(oversized))
        self.assertEqual(caught.exception.code, "PAYLOAD_TOO_LARGE")

    def test_profile_registry_is_authorized_and_identity_bound(self):
        port = self.port()
        for data, accepted in ((b'{"profile_id":"registered"}', True), (b'{"profile_id":"other"}', False), (b'[]', False)):
            record = self.native.blob(self.owner, data, "fixture.profile", "application/json")
            port.profiles["registered"] = AuthoringProfile("registered", 1, self.native.ref(record))
            with port._scratch() as root:
                if accepted:
                    self.assertEqual(port._profile(self.owner, self.project, "registered", root).read_bytes(), data)
                else:
                    with self.assertRaises(Problem):
                        port._profile(self.owner, self.project, "registered", root)
        with port._scratch() as root, self.assertRaises(Problem):
            port._profile(self.owner, self.project, "unknown", root)
        port.profiles["registered"] = AuthoringProfile("registered", True, self.native.ref(record))
        with port._scratch() as root, self.assertRaises(Problem):
            port._profile(self.owner, self.project, "registered", root)

    def test_controller_task_adapter_comes_only_from_operator_factory_and_exact_lock_capability(self):
        observed = []
        adapter = lambda *args, **kwargs: {}
        def factory(**kwargs):
            observed.append(kwargs)
            return {"dftlab.engine.hubbardflow.hf1": adapter}
        port = self.port(controller_adapter_factory=factory)
        task = SimpleNamespace(capability_id="dftlab.engine.hubbardflow.hf1")
        workflow = SimpleNamespace(tasks=(task,))
        resolved = {"campaign": b"immutable-source"}
        result = port._controller_task_adapters(self.owner, workflow, resolved, "profile", "run-1")
        self.assertEqual(result, {"dftlab.engine.hubbardflow.hf1": adapter})
        self.assertEqual(observed, [{"owner": self.owner, "workflow": workflow,
                                     "source_root": resolved, "profile": "profile", "run_id": "run-1"}])
        with self.assertRaises(Problem):
            port._controller_task_adapters(self.owner, workflow, resolved, "profile", "run-1",
                                            supplied={"dftlab.engine.hubbardflow.hf1": adapter})
        with self.assertRaises(Problem):
            self.port()._controller_task_adapters(self.owner, workflow, resolved, "profile", "run-1")
        ordinary = SimpleNamespace(tasks=(SimpleNamespace(capability_id="dftlab.engine.other"),))
        self.assertIsNone(port._controller_task_adapters(self.owner, ordinary, resolved, "profile", "run-1"))

    def test_unregistered_protocol_is_blocked_without_engine_work(self):
        port = self.port()
        snapshot = self.handlers._snapshot(self.owner, self.project, self.bundle, identifier())
        receipt = port.validate(self.owner, self.bundle, snapshot)
        self.assertEqual(receipt["payload"]["decision"], "BLOCKED")
        self.assertEqual(receipt["payload"]["input_refs"], [snapshot])
        self.assertEqual(receipt["native_contract_refs"], [])
        self.assertEqual(receipt["payload"]["diagnostics"][0]["code"], "AUTHORING_PROTOCOL_UNAVAILABLE")
        with self.assertRaises(Problem):
            port.compile(self.owner, self.bundle, receipt, snapshot)

    def test_no_report_or_future_native_status_is_uncertainty_not_acceptance(self):
        port = self.port()
        recipe = AuthoringRecipe(object(), (object(),), {}, "registered")
        for state in (None, "FUTURE_STATUS"):
            with self.subTest(state=state), patch.object(port, "_recipe", return_value=recipe), \
                 patch.object(port, "_compile", return_value=SimpleNamespace(native_digest="a"*64, lock_path=self.root/"lock")), \
                 patch.object(port, "_profile", return_value=self.root/"synthetic-profile"):
                def prepare(*args, **kwargs):
                    if state:
                        kwargs["validator"].reports.append(SimpleNamespace(status=SimpleNamespace(value=state)))
                with patch.object(port.adapter, "prepare", side_effect=prepare), self.assertRaises(Problem):
                    port.validate(self.owner, self.bundle, {})
        with patch.object(port, "_recipe", return_value=recipe), \
             patch.object(port, "_compile", return_value=SimpleNamespace(native_digest="a"*64, lock_path=self.root/"lock")), \
             patch.object(port, "_profile", return_value=self.root/"synthetic-profile"), \
             patch.object(port.adapter, "prepare", side_effect=ValueError("synthetic parser failure")), \
             self.assertRaises(ValueError):
            port.validate(self.owner, self.bundle, {})

    def test_controller_workflow_without_native_reports_is_transport_only_never_accepted(self):
        capability = "dftlab.engine.hubbardflow.hf1"
        engines = SimpleNamespace(qraft_contracts=lambda: SimpleNamespace(),
                                  qraft=SimpleNamespace(SiestaContextualValidator=lambda: object(),
                                                        load_workflow_lock=lambda path: (None, SimpleNamespace(tasks=(SimpleNamespace(capability_id=capability),)))))
        seen = []
        port = QraftArtifactAuthoring(engines, self.store, {}, {}, self.root/"scratch",
                                      controller_adapter_factory=lambda **kwargs: seen.append(kwargs) or {capability: lambda *args, **kw: {}})
        recipe = AuthoringRecipe(object(), (object(),), {}, "registered")
        def prepare(*args, **kwargs):
            seen.append(kwargs["task_adapters"])
        with patch.object(port, "_recipe", return_value=recipe), \
             patch.object(port, "_compile", return_value=SimpleNamespace(native_digest="a"*64, lock_path=self.root/"lock")), \
             patch.object(port, "_profile", return_value=self.root/"synthetic-profile"), \
             patch.object(port.adapter, "prepare", side_effect=prepare):
            snapshot = self.handlers._snapshot(self.owner, self.project, self.bundle, identifier())
            receipt = port.validate(self.owner, self.bundle, snapshot)
        payload = receipt["payload"]
        self.assertEqual(payload["decision"], "ACCEPTED_WITH_WARNINGS")
        self.assertEqual([item["code"] for item in payload["diagnostics"]], ["CONTROLLER_BUNDLE_TRANSPORT_ONLY"])
        self.assertIn("sin validación nativa", payload["scope"])
        self.assertEqual(receipt["native_contract_refs"], [])
        self.assertEqual(set(seen[-1]), {capability})
        self.assertEqual(seen[0]["owner"], self.owner)


if __name__ == "__main__":
    unittest.main()
