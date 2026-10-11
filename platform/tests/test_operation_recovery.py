"""ADR-016 recovery guards with original fixtures, no scheduler or engines."""
import copy
from pathlib import Path
import tempfile
import unittest

from dftlab_platform.contracts import ContractError, resource_json
from dftlab_platform.domain import Problem, envelope, now, reseal
from dftlab_platform.projection_storage import SQLiteReadModels
from dftlab_platform.storage import SQLiteRepository


class Recovery(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.repo = SQLiteRepository(Path(self.directory.name) / "state.sqlite")
        self.owner = self.repo.ensure_principal("fixture-owner")
        self.project = self.repo.create_project(self.owner, {"name": "Recovery", "idempotency_key": "recovery-project-01"})[0]["project_id"]

    def tearDown(self):
        self.directory.cleanup()

    def problem(self, code, call, *args, **options):
        with self.assertRaises(Problem) as caught:
            call(*args, **options)
        self.assertEqual(caught.exception.code, code)

    def submission(self):
        request = resource_json("fixtures/operation-request/valid/submit-run.json")
        request["project_id"] = self.project
        with self.repo.transaction() as db:
            db.execute("INSERT INTO resources VALUES(?,?,?,3,NULL)", (request["target"]["id"], "PLAN", self.project))
        operation = self.repo.accept(self.owner, request)[0]
        self.repo.claim("fixture-processor")
        return operation["record_id"]

    def intent(self, operation_id):
        source = resource_json("fixtures/effect-intent/valid/submit.json")
        source["payload"]["operation_id"] = operation_id
        return envelope("effect-intent", self.project, source["payload"])

    def resolution(self, operation_id, action, effect_class, finding, state="FAILED"):
        return envelope("operation-resolution-receipt", self.project, {
            "operation_id": operation_id, "action": action, "effect_class": effect_class,
            "finding": finding, "resulting_state": state, "product_refs": [],
            "recovered_at": now(), "evidence": []})

    def test_no_intent_failure_requires_interrupted_error_and_retains_key(self):
        operation_id = self.submission()
        self.repo.recover()
        receipt = self.resolution(operation_id, "SUBMIT_RUN", "EXTERNAL_SUBMISSION", "NO_EFFECT_INTENT")
        self.problem("PRECONDITION_FAILED", self.repo.transition, operation_id, 3, "FAILED", result={"receipt": receipt}, error=Problem("ENGINE_UNAVAILABLE").document())
        failed = self.repo.transition(operation_id, 3, "FAILED", result={"receipt": receipt}, error=Problem("OPERATION_INTERRUPTED").document())
        self.assertEqual(failed["payload"]["state"], "FAILED")
        self.assertIsNone(self.repo.claim("new-processor"))
        original = resource_json("fixtures/operation-request/valid/submit-run.json");original["project_id"] = self.project
        self.assertEqual(self.repo.accept(self.owner, original), (failed, False))

    def test_resume_intent_uses_server_profile_and_binds_resume_run(self):
        resume = resource_json("fixtures/resume-plan/valid/partial-reuse.json")
        resume["project_id"] = self.project
        reads = SQLiteReadModels(self.repo);reads.put(self.owner, "RESUME_PLAN", resume)
        resume_id = resume["payload"]["resume_plan_id"]
        request = {"action": "EXECUTE_RESUME_PLAN", "project_id": self.project, "target": {"kind": "RESUME_PLAN", "id": resume_id, "expected_revision": resume["payload"]["plan_revision"]}, "payload": {"resume_plan_id": resume_id}, "idempotency_key": "execute-resume-key"}
        operation_id = self.repo.accept(self.owner, request)[0]["record_id"]
        self.repo.claim("fixture-processor")
        intent = self.intent(operation_id)
        intent["payload"].update(action="EXECUTE_RESUME_PLAN", run_id=resume["payload"]["run_id"]);reseal(intent)
        wrong = copy.deepcopy(intent);wrong["payload"]["run_id"] = "other-run";reseal(wrong)
        self.problem("PRECONDITION_FAILED", self.repo.persist_effect_intent, operation_id, 2, "fixture-processor", wrong)
        self.assertEqual(self.repo.persist_effect_intent(operation_id, 2, "fixture-processor", intent), intent)
        self.repo.recover()
        self.assertEqual(self.repo.operation(self.owner, operation_id)["payload"]["result"]["receipt"]["payload"]["profile"], intent["payload"]["profile"])

    def test_persisted_intent_cannot_be_replaced_or_resolved_as_absent(self):
        operation_id = self.submission()
        intent = self.intent(operation_id)
        self.problem("PRECONDITION_FAILED", self.repo.persist_effect_intent, operation_id, 2, "other-processor", intent)
        self.assertEqual(self.repo.persist_effect_intent(operation_id, 2, "fixture-processor", intent), intent)
        self.assertEqual(self.repo.persist_effect_intent(operation_id, 2, "fixture-processor", intent), intent)
        changed = copy.deepcopy(intent);changed["payload"]["authority_generation"] += 1;reseal(changed)
        self.problem("PRECONDITION_FAILED", self.repo.persist_effect_intent, operation_id, 2, "fixture-processor", changed)
        self.problem("PRECONDITION_FAILED", self.repo.transition, operation_id, 2, "FAILED", no_effect=True, result={"no_effect": True}, error=Problem("ENGINE_UNAVAILABLE").document())
        restarted = SQLiteRepository(self.repo.path)
        self.assertEqual(restarted.recover(), 1)
        unknown = restarted.operation(self.owner, operation_id)
        receipt = unknown["payload"]["result"]["receipt"]
        self.assertEqual(receipt["payload"]["status"], "SUBMISSION_UNKNOWN")
        for field in ("package_ref", "profile", "attempt_token", "scheduler", "authority_generation"):
            self.assertEqual(receipt["payload"][field], intent["payload"][field])
        false_absence = self.resolution(operation_id, "SUBMIT_RUN", "EXTERNAL_SUBMISSION", "NO_EFFECT_INTENT")
        self.problem("PRECONDITION_FAILED", restarted.transition, operation_id, 3, "FAILED", result={"receipt": false_absence}, error=Problem("OPERATION_INTERRUPTED").document())
        self.assertIsNone(restarted.claim("new-processor"))
        self.problem("PRECONDITION_FAILED", restarted.persist_effect_intent, operation_id, 3, "fixture-processor", intent)

    def test_reconciled_submission_must_bind_all_intent_fields(self):
        operation_id = self.submission()
        self.repo.persist_effect_intent(operation_id, 2, "fixture-processor", self.intent(operation_id))
        self.repo.recover()
        receipt = resource_json("fixtures/submission-receipt/valid/accepted.json")
        receipt["project_id"] = self.project;receipt["payload"]["operation_id"] = operation_id
        receipt["integrity"]["status"] = "VERIFIED";reseal(receipt)
        self.problem("PRECONDITION_FAILED", self.repo.transition, operation_id, 3, "SUCCEEDED", result={"receipt": receipt})
        receipt["payload"]["status"] = "RECONCILED_FOUND";reseal(receipt)
        for field, value in (("attempt_token", "00000000-0000-0000-0000-000000000001"), ("authority_generation", 2), ("scheduler", "LOCAL_SUPERVISOR")):
            changed = copy.deepcopy(receipt);changed["payload"][field] = value;reseal(changed)
            self.problem("PRECONDITION_FAILED", self.repo.transition, operation_id, 3, "SUCCEEDED", result={"receipt": changed})
        for field, key, value in (("profile", "revision", 3), ("package_ref", "sha256", "0"*64)):
            changed = copy.deepcopy(receipt);changed["payload"][field][key] = value;reseal(changed)
            self.problem("PRECONDITION_FAILED", self.repo.transition, operation_id, 3, "SUCCEEDED", result={"receipt": changed})
        succeeded = self.repo.transition(operation_id, 3, "SUCCEEDED", result={"receipt": receipt})
        self.assertEqual(succeeded["payload"]["state"], "SUCCEEDED")

    def test_local_and_idempotent_resolution_classes_are_not_interchangeable(self):
        projection = resource_json("fixtures/run-projection/valid/ssh-lost-unknown.json")
        projection["project_id"] = self.project
        reads = SQLiteReadModels(self.repo);reads.put(self.owner, "RUN", projection)
        request = {"action": "CANCEL_RUN", "project_id": self.project, "target": {"kind": "RUN", "id": projection["payload"]["run_id"], "expected_revision": projection["payload"]["source_revision"]}, "payload": {"reason": "fixture cancellation"}, "idempotency_key": "cancel-request-0001"}
        operation = self.repo.accept(self.owner, request)[0]
        self.repo.claim("processor");self.repo.recover()
        receipt = self.resolution(operation["record_id"], "CANCEL_RUN", "EXTERNAL_IDEMPOTENT", "IDEMPOTENT_EFFECT_UNCONFIRMED")
        wrong_class = self.resolution(operation["record_id"], "VALIDATE_INPUT", "LOCAL_ATOMIC", "LOCAL_EFFECT_ABSENT")
        self.problem("PRECONDITION_FAILED", self.repo.transition, operation["record_id"], 3, "FAILED", result={"receipt": wrong_class}, error=Problem("OPERATION_INTERRUPTED").document())
        wrong = copy.deepcopy(receipt);wrong["payload"]["operation_id"] = "other-operation";reseal(wrong)
        self.problem("PRECONDITION_FAILED", self.repo.transition, operation["record_id"], 3, "FAILED", result={"receipt": wrong}, error=Problem("OPERATION_INTERRUPTED").document())
        self.assertEqual(self.repo.transition(operation["record_id"], 3, "FAILED", result={"receipt": receipt}, error=Problem("OPERATION_INTERRUPTED").document())["payload"]["state"], "FAILED")

    def test_reconciled_absence_requires_evidence_and_interrupted_error(self):
        operation_id = self.submission()
        self.repo.persist_effect_intent(operation_id, 2, "fixture-processor", self.intent(operation_id))
        self.repo.recover()
        receipt = resource_json("fixtures/submission-receipt/valid/accepted.json")
        receipt["project_id"] = self.project
        receipt["payload"].update(operation_id=operation_id, status="RECONCILED_ABSENT_WITH_EVIDENCE", job=None)
        receipt["integrity"]["status"] = "VERIFIED";reseal(receipt)
        with self.assertRaises(ContractError):
            self.repo.transition(operation_id, 3, "FAILED", result={"receipt": receipt}, error=Problem("OPERATION_INTERRUPTED").document())
        receipt["payload"]["evidence"] = [{"artifact_id": "scheduler-query-fixture", "sha256": "0"*64, "media_type": "application/json"}];reseal(receipt)
        self.problem("PRECONDITION_FAILED", self.repo.transition, operation_id, 3, "FAILED", result={"receipt": receipt}, error=Problem("ENGINE_UNAVAILABLE").document())
        self.assertEqual(self.repo.transition(operation_id, 3, "FAILED", result={"receipt": receipt}, error=Problem("OPERATION_INTERRUPTED").document())["payload"]["state"], "FAILED")

    def test_run_get_uses_aggregate_revision_without_rewriting_native_evidence(self):
        projection = resource_json("fixtures/run-projection/valid/completed-not-established.json")
        projection["project_id"] = self.project
        reads = SQLiteReadModels(self.repo);reads.put(self.owner, "RUN", projection)
        original = copy.deepcopy(projection)
        request = {"action": "CANCEL_RUN", "project_id": self.project, "target": {"kind": "RUN", "id": projection["payload"]["run_id"], "expected_revision": projection["payload"]["source_revision"]}, "payload": {"reason": "fixture cancellation"}, "idempotency_key": "cancel-request-0001"}
        self.repo.accept(self.owner, request)
        actual = reads.get(self.owner, "RUN", projection["payload"]["run_id"])
        self.assertEqual(actual["payload"]["source_revision"], original["payload"]["source_revision"]+1)
        for key in actual["payload"]:
            if key != "source_revision":
                self.assertEqual(actual["payload"][key], original["payload"][key])
        self.assertEqual(actual["native_contract_refs"], original["native_contract_refs"])
        self.repo.contracts.validate("run-projection", actual)
        with self.repo._connection() as db:
            from dftlab_platform.contracts import loads
            stored = loads(db.execute("SELECT document FROM resources WHERE resource_id=?", (projection["payload"]["run_id"],)).fetchone()[0])
        self.assertEqual(stored, original)

    def test_normative_validate_payload_is_required_at_storage_admission(self):
        request = {"action": "VALIDATE_INPUT", "project_id": self.project, "target": {"kind": "PROJECT", "id": self.project, "expected_revision": 1}, "payload": {}, "idempotency_key": "validate-request-01"}
        for payload in ({}, {"other": True}):
            request["payload"] = payload
            with self.assertRaises(ContractError):
                self.repo.accept(self.owner, request)
        self.assertEqual(self.repo.project(self.owner, self.project)["revision"], 1)


if __name__ == "__main__":
    unittest.main()
