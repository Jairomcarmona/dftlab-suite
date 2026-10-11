"""Atomicity of fixture products; no engines, jobs or scientific assessment."""
from concurrent.futures import ThreadPoolExecutor
import copy
from dataclasses import replace
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from dftlab_platform.contracts import canonical, resource_json
from dftlab_platform.domain import Processor, Problem, envelope, identifier, now, reseal
from dftlab_platform.local_effects import LocalEffect, LocalProduct
from dftlab_platform.storage import SQLiteRepository


class LocalProducts(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name)/"state.sqlite"
        self.repo = SQLiteRepository(self.path)
        self.owner = self.repo.ensure_principal("fixture-owner")
        self.other = self.repo.ensure_principal("other-owner")
        self.project = self.repo.create_project(self.owner, {"name": "Atomic", "idempotency_key": "atomic-project-001"})[0]["project_id"]

    def tearDown(self):
        self.directory.cleanup()

    def prepare(self, action="VALIDATE_INPUT", *, claim=True):
        filenames = {"VALIDATE_INPUT": "validate-input", "CREATE_CAMPAIGN": "create-campaign", "CREATE_PLAN": "create-plan", "PREPARE_PACKAGE": "prepare-package"}
        if action == "CREATE_RESUME_PLAN":
            request = {"action": action, "target": {"kind": "RUN", "id": "run-1", "expected_revision": 1}, "payload": {"from_attempt_id": "att-1", "reason": "fixture"}}
        else:
            request = resource_json("fixtures/operation-request/valid/"+filenames[action]+".json")
        request.update(project_id=self.project, idempotency_key=identifier())
        target = request["target"]
        if target["kind"] == "PROJECT":
            target.update(id=self.project, expected_revision=self.repo.project(self.owner, self.project)["revision"])
        else:
            with self.repo.transaction() as db:
                db.execute("INSERT INTO resources VALUES(?,?,?,?,NULL)", (target["id"], target["kind"], self.project, target["expected_revision"]))
        op = self.repo.accept(self.owner, request)[0]
        if claim:
            op = self.repo.claim("worker-fixture")
        product_id = identifier()
        if action == "CREATE_CAMPAIGN":
            product = LocalProduct("CAMPAIGN", product_id, 1, {"campaign_id": product_id, "project_id": self.project, "revision": 1, **request["payload"]})
        elif action == "CREATE_PLAN":
            product = LocalProduct("PLAN", product_id, 1, resource_json("fixtures/native-contract-ref/valid/qraft-workflow-lock.json"))
        else:
            schema, path, kind = {
                "VALIDATE_INPUT": ("validation-receipt", "validation-receipt/valid/heuristic-override", "VALIDATION_RECEIPT"),
                "PREPARE_PACKAGE": ("artifact-record", "artifact-record/valid/siesta-output", "PACKAGE"),
                "CREATE_RESUME_PLAN": ("resume-plan", "resume-plan/valid/partial-reuse", "RESUME_PLAN"),
            }[action]
            payload = resource_json("fixtures/"+path+".json")["payload"]
            if kind == "PACKAGE":
                payload.update(artifact_id=product_id, kind="qraft.run-package")
            if kind == "RESUME_PLAN":
                payload["resume_plan_id"] = product_id
            document = envelope(schema, self.project, payload, record_id=product_id)
            product = LocalProduct(kind, product_id, 1, document)
        return op, request, product

    def assertProblem(self, code, function, *args, **options):
        with self.assertRaises(Problem) as caught:
            function(*args, **options)
        self.assertEqual(caught.exception.code, code)

    def test_all_local_actions_commit_product_event_and_status_together(self):
        for action in ("VALIDATE_INPUT", "CREATE_CAMPAIGN", "CREATE_PLAN", "PREPARE_PACKAGE", "CREATE_RESUME_PLAN"):
            with self.subTest(action=action):
                op, request, product = self.prepare(action)
                completed = self.repo.complete_local(op["record_id"], 2, "worker-fixture", (product,))
                self.assertEqual(completed["payload"]["state"], "SUCCEEDED")
                self.assertEqual(self.repo.local_products(self.owner, op["record_id"]), (product,))
                self.assertEqual(self.repo.accept(self.owner, request), (completed, False))
                self.assertIsNone(self.repo.claim("another-worker"))
                self.assertEqual(self.repo.events(self.owner, self.project)[-1]["payload"]["to"], "SUCCEEDED")
                with self.repo._connection() as db:
                    self.assertEqual(db.execute("SELECT count(*) FROM outbox").fetchone()[0], 0)

    def test_lost_ack_concurrent_identical_commit_is_exactly_once(self):
        op, _, product = self.prepare()
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: SQLiteRepository(self.path).complete_local(op["record_id"], 2, "worker-fixture", (product,)), range(8)))
        self.assertTrue(all(value == results[0] for value in results))
        self.assertEqual(len(self.repo.events(self.owner, self.project)), 3)
        restarted = SQLiteRepository(self.path)
        self.assertEqual(restarted.recover(), 0)
        self.assertEqual(restarted.local_products(self.owner, op["record_id"]), (product,))
        self.assertProblem("PRECONDITION_FAILED", restarted.complete_local, op["record_id"], 2, "foreign-worker", (product,))

    def test_wrong_claim_revision_project_and_product_leave_no_product(self):
        op, _, product = self.prepare()
        self.assertProblem("PRECONDITION_FAILED", self.repo.complete_local, op["record_id"], 2, "foreign-worker", (product,))
        self.assertProblem("REVISION_CONFLICT", self.repo.complete_local, op["record_id"], 1, "worker-fixture", (product,))
        self.assertProblem("PRECONDITION_FAILED", self.repo.complete_local, op["record_id"], 2, "worker-fixture", (replace(product, kind="PLAN"),))
        wrong = copy.deepcopy(product.document)
        wrong = envelope("validation-receipt", "other-project", wrong["payload"], record_id=product.product_id)
        self.assertProblem("PRECONDITION_FAILED", self.repo.complete_local, op["record_id"], 2, "worker-fixture", (replace(product, document=wrong),))
        self.assertEqual(self.repo.local_products(self.owner, op["record_id"]), ())
        self.assertProblem("NOT_FOUND", self.repo.local_products, self.other, op["record_id"])
        self.assertProblem("PRECONDITION_FAILED", self.repo.transition, op["record_id"], 2, "SUCCEEDED", result={"product_refs": [{"kind": product.kind, "id": product.product_id, "revision": 1}]})

    def test_event_failure_rolls_back_product_and_success(self):
        op, _, product = self.prepare()
        def fail(*args):
            raise RuntimeError("fixture stream failure")
        self.repo._event = fail
        with self.assertRaises(RuntimeError):
            self.repo.complete_local(op["record_id"], 2, "worker-fixture", (product,))
        self.assertEqual(self.repo.local_products(self.owner, op["record_id"]), ())
        self.assertEqual(self.repo.operation(self.owner, op["record_id"])["payload"]["state"], "RUNNING")
        with self.repo._connection() as db:
            self.assertIsNone(db.execute("SELECT 1 FROM resources WHERE resource_id=?", (product.product_id,)).fetchone())
            self.assertEqual(db.execute("SELECT count(*) FROM outbox").fetchone()[0], 1)

    def test_process_death_during_sql_and_after_commit_has_no_half_product(self):
        for boundary in ("inside", "after"):
            with self.subTest(boundary=boundary):
                op, _, product = self.prepare()
                data = Path(self.directory.name)/"fixture.json"
                data.write_bytes(canonical({"op": op["record_id"], "product": {"kind": product.kind, "product_id": product.product_id, "revision": product.revision, "document": product.document}}))
                code = """
import json, os, sys
from pathlib import Path
from dftlab_platform.local_effects import LocalProduct
from dftlab_platform.storage import SQLiteRepository
data=json.loads(Path(sys.argv[2]).read_bytes())
repo=SQLiteRepository(Path(sys.argv[1]))
if sys.argv[3]=='inside':
    repo._event=lambda *args: os._exit(73)
repo.complete_local(data['op'], 2, 'worker-fixture', (LocalProduct(**data['product']),))
os._exit(74)
"""
                result = subprocess.run([sys.executable, "-I", "-c", code, str(self.path), str(data), boundary], capture_output=True, timeout=20)
                self.assertEqual(result.returncode, 73 if boundary == "inside" else 74, result.stderr.decode(errors="replace"))
                restarted = SQLiteRepository(self.path)
                values = restarted.local_products(self.owner, op["record_id"])
                self.assertEqual(values, () if boundary == "inside" else (product,))
                self.assertEqual(restarted.operation(self.owner, op["record_id"])["payload"]["state"], "RUNNING" if boundary == "inside" else "SUCCEEDED")
                if boundary == "inside":
                    self.assertEqual(restarted.recover(), 1)
                    self.assertEqual(restarted.operation(self.owner, op["record_id"])["payload"]["state"], "OUTCOME_UNKNOWN")
                    self.assertIsNone(restarted.claim("replacement"))

    def test_processor_requires_local_effect_not_uncommitted_success_dict(self):
        op, _, product = self.prepare(claim=False)
        handler = lambda operation, request: LocalEffect((product,))
        self.assertTrue(Processor(self.repo, {"VALIDATE_INPUT": handler}).once())
        self.assertEqual(self.repo.operation(self.owner, op["record_id"])["payload"]["state"], "SUCCEEDED")
        op, _, _ = self.prepare(claim=False)
        self.assertTrue(Processor(self.repo, {"VALIDATE_INPUT": lambda operation, request: {"ok": True}}).once())
        self.assertEqual(self.repo.operation(self.owner, op["record_id"])["payload"]["state"], "OUTCOME_UNKNOWN")
        self.assertEqual(self.repo.local_products(self.owner, op["record_id"]), ())

    def test_native_digest_original_and_product_snapshot_survive_target_mutation(self):
        op, _, product = self.prepare("CREATE_PLAN")
        self.repo.complete_local(op["record_id"], 2, "worker-fixture", (product,))
        with self.repo.transaction() as db:
            db.execute("UPDATE resources SET revision=revision+1 WHERE resource_id=?", (product.product_id,))
        self.assertEqual(self.repo.local_products(self.owner, op["record_id"]), (product,))
        self.assertEqual(product.document["digest"]["algorithm"], "qraft.content-sha256-v1")
        self.assertEqual(self.repo.complete_local(op["record_id"], 2, "worker-fixture", (product,))["payload"]["state"], "SUCCEEDED")
        changed = copy.deepcopy(product.document)
        changed["digest"]["value"] = "0"*64
        self.assertProblem("PRECONDITION_FAILED", self.repo.complete_local, op["record_id"], 2, "worker-fixture", (replace(product, document=changed),))

    def test_product_corruption_is_detected(self):
        op, _, product = self.prepare("CREATE_CAMPAIGN")
        self.repo.complete_local(op["record_id"], 2, "worker-fixture", (product,))
        changed = copy.deepcopy(product.document)
        changed["name"] = "damaged"
        with self.repo.transaction() as db:
            db.execute("UPDATE operation_products SET document=? WHERE operation_id=?", (json.dumps(changed), op["record_id"]))
        self.assertProblem("PRECONDITION_FAILED", self.repo.local_products, self.owner, op["record_id"])

    def test_resolution_consults_product_not_only_receipt(self):
        op, _, product = self.prepare()
        completed = self.repo.complete_local(op["record_id"], 2, "worker-fixture", (product,))
        # Controlled legacy inconsistency, not reachable through the new
        # atomic port. This does NOT qualify a full checkpoint/restore.
        completed["payload"].update(state="OUTCOME_UNKNOWN", revision=4, result=None)
        completed["payload"]["key_retention"]["effects_alive"] = True
        reseal(completed)
        with self.repo.transaction() as db:
            db.execute("UPDATE operations SET document=? WHERE operation_id=?", (canonical(completed).decode(), op["record_id"]))
        def receipt(finding, state, refs):
            return envelope("operation-resolution-receipt", self.project, {"operation_id": op["record_id"], "action": "VALIDATE_INPUT", "effect_class": "LOCAL_ATOMIC", "finding": finding, "resulting_state": state, "product_refs": refs, "recovered_at": now(), "evidence": []})
        absent = receipt("LOCAL_EFFECT_ABSENT", "FAILED", [])
        self.assertProblem("PRECONDITION_FAILED", self.repo.transition, op["record_id"], 4, "FAILED", result={"receipt": absent}, error=Problem("OPERATION_INTERRUPTED").document())
        wrong = receipt("LOCAL_EFFECT_COMMITTED", "SUCCEEDED", [{"kind": product.kind, "id": product.product_id, "revision": 2}])
        self.assertProblem("PRECONDITION_FAILED", self.repo.transition, op["record_id"], 4, "SUCCEEDED", result={"receipt": wrong})
        found = receipt("LOCAL_EFFECT_COMMITTED", "SUCCEEDED", [{"kind": product.kind, "id": product.product_id, "revision": 1}])
        resolved = self.repo.transition(op["record_id"], 4, "SUCCEEDED", result={"receipt": found})
        self.assertEqual(resolved["payload"]["state"], "SUCCEEDED")
