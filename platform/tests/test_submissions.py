"""Synthetic scheduler boundary plus real crash processes; never sbatch/SIESTA."""
from concurrent.futures import ThreadPoolExecutor
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from threading import Lock
import unittest

from dftlab_platform.contracts import canonical, resource_json
from dftlab_platform.domain import Processor, Problem, envelope, identifier, now, reseal
from dftlab_platform.storage import SQLiteRepository
from dftlab_platform.submissions import BINDINGS, DurableSubmissions
from dftlab_platform.submission_storage import SQLiteSubmissionLedger


class SchedulerFixture:
    def __init__(self, repository):
        self.repo, self.jobs, self.calls, self.finds = repository, {}, 0, 0
        self.lose_ack = False
        self.change = lambda receipt: None
        self.lock = Lock()

    def receipt(self, intent, status):
        payload = {key: copy.deepcopy(intent["payload"][key]) for key in BINDINGS}
        payload.update(status=status, job={"job_id": "synthetic-1", "cluster": "synthetic-cluster",
                                         "remote_user": "synthetic-user", "submitted_at": intent["payload"]["recorded_at"]}, evidence=[])
        receipt = envelope("submission-receipt", intent["project_id"], payload)
        self.change(receipt)
        reseal(receipt)
        return receipt

    def submit(self, intent):
        # Assert the real SQL write-ahead/dispatch boundary at the instant the
        # external port is entered, not merely after handler completion.
        with self.repo._connection() as db:
            self.assert_intent = self.repo._effect_intent(db, intent["payload"]["operation_id"])
            phase = db.execute("SELECT phase FROM scheduler_dispatches WHERE operation_id=?", (intent["payload"]["operation_id"],)).fetchone()[0]
        if self.assert_intent != intent or phase != "DISPATCH_STARTED":
            raise AssertionError("External effect preceded its committed intent")
        with self.lock:
            self.calls += 1
            self.jobs[intent["payload"]["attempt_token"]] = copy.deepcopy(intent)
        if self.lose_ack:
            raise TimeoutError("synthetic lost ack")
        return self.receipt(intent, "ACCEPTED")

    def find(self, intent):
        self.finds += 1
        if self.jobs.get(intent["payload"]["attempt_token"]) != intent:
            return None
        return self.receipt(intent, "RECONCILED_FOUND")


class Submissions(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.repo = SQLiteRepository(self.root/"state.sqlite")
        self.owner, self.other = [self.repo.ensure_principal(name) for name in ("owner", "other")]
        self.project = self.repo.create_project(self.owner, {"name": "Synthetic submit", "idempotency_key": "submission-project-01"})[0]["project_id"]
        self.plan = identifier()
        with self.repo.transaction() as db:
            db.execute("INSERT INTO resources VALUES(?,?,?,1,NULL)", (self.plan, "PLAN", self.project))
        self.ledger = SQLiteSubmissionLedger(self.repo)
        self.scheduler = SchedulerFixture(self.repo)
        self.gateway = DurableSubmissions(self.repo, self.ledger, self.scheduler)
        self.intents = {}

    def tearDown(self):
        self.temporary.cleanup()

    def accept(self):
        with self.repo._connection() as db:
            revision = db.execute("SELECT revision FROM resources WHERE resource_id=?", (self.plan,)).fetchone()[0]
        request = resource_json("fixtures/operation-request/valid/submit-run.json")
        request.update(project_id=self.project, target={"kind": "PLAN", "id": self.plan, "expected_revision": revision}, idempotency_key=identifier())
        request["payload"]["plan_id"] = self.plan
        return self.repo.accept(self.owner, request)[0]

    def intent(self, operation):
        payload = copy.deepcopy(resource_json("fixtures/effect-intent/valid/submit.json")["payload"])
        payload.update(operation_id=operation["record_id"], run_id=identifier(), attempt_id=identifier(), attempt_token=identifier(), recorded_at=now())
        value = envelope("effect-intent", self.project, payload)
        self.intents[operation["record_id"]] = value
        return value

    def process(self):
        processor = Processor(self.repo)
        processor.handlers["SUBMIT_RUN"] = lambda operation, request: self.gateway.perform(operation, processor.processor_id, self.intent(operation))
        self.assertTrue(processor.once())

    def test_concurrent_gateway_calls_dispatch_once_after_committed_intent(self):
        pending = self.accept()
        operation = self.repo.claim("synthetic-processor")
        intent = self.intent(operation)
        def perform(_):
            try:
                return self.gateway.perform(operation, "synthetic-processor", intent)
            except Problem:
                return None
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(perform, range(12)))
        self.assertTrue(any(result is not None for result in results))
        self.assertEqual(self.scheduler.calls, 1)
        _, phase, receipt = self.ledger.snapshot(self.owner, pending["record_id"])
        self.assertEqual(phase, "ACKNOWLEDGED")
        self.assertEqual(receipt["payload"]["status"], "ACCEPTED")
        with self.assertRaises(Problem):
            self.ledger.snapshot(self.other, pending["record_id"])

    def test_lost_ack_empty_query_stays_unknown_then_found_resolves_without_resubmit(self):
        pending = self.accept()
        self.scheduler.lose_ack = True
        self.process()
        operation_id = pending["record_id"]
        unknown = self.repo.operation(self.owner, operation_id)
        self.assertEqual(unknown["payload"]["state"], "OUTCOME_UNKNOWN")
        self.assertEqual(unknown["payload"]["result"]["receipt"]["payload"]["status"], "SUBMISSION_UNKNOWN")
        jobs, self.scheduler.jobs = self.scheduler.jobs, {}
        self.assertEqual(self.gateway.reconcile(self.owner, operation_id), unknown)
        self.scheduler.jobs = jobs
        resolved = self.gateway.reconcile(self.owner, operation_id)
        self.assertEqual(resolved["payload"]["state"], "SUCCEEDED")
        self.assertEqual(resolved["payload"]["result"]["receipt"]["payload"]["status"], "RECONCILED_FOUND")
        self.assertEqual(self.scheduler.calls, 1)
        self.assertIsNone(self.repo.claim("new-worker"))

    def test_durable_ack_lost_operation_commit_recovers_without_lifecycle_claim(self):
        pending = self.accept()
        operation = self.repo.claim("synthetic-processor")
        intent = self.intent(operation)
        self.gateway.perform(operation, "synthetic-processor", intent)
        self.assertEqual(self.repo.recover(), 1)
        resolved = self.gateway.reconcile(self.owner, pending["record_id"])
        self.assertEqual(resolved["payload"]["state"], "SUCCEEDED")
        self.assertEqual(self.scheduler.calls, 1)
        self.assertEqual(self.scheduler.finds, 0)
        self.assertNotIn("science", resolved["payload"]["result"])

    def test_second_operation_for_same_native_run_rolls_back_intent_and_reservation(self):
        self.accept()
        operation = self.repo.claim("synthetic-processor")
        first = self.intent(operation)
        self.gateway.perform(operation, "synthetic-processor", first)
        second_pending = self.accept()
        second = self.repo.claim("synthetic-second")
        duplicate = self.intent(second)
        duplicate["payload"]["run_id"] = first["payload"]["run_id"]
        reseal(duplicate)
        with self.assertRaises(Problem):
            self.gateway.perform(second, "synthetic-second", duplicate)
        with self.repo._connection() as db:
            self.assertIsNone(self.repo._effect_intent(db, second_pending["record_id"]))
            self.assertEqual(db.execute("SELECT count(*) FROM scheduler_dispatches").fetchone()[0], 1)
        self.assertEqual(self.scheduler.calls, 1)

    def test_wrong_receipt_and_modified_intent_cannot_confirm_ack_or_resubmit(self):
        pending = self.accept()
        self.scheduler.change = lambda receipt: receipt["payload"].update(attempt_token=identifier())
        self.process()
        operation = self.repo.operation(self.owner, pending["record_id"])
        self.assertEqual(operation["payload"]["state"], "OUTCOME_UNKNOWN")
        intent, phase, receipt = self.ledger.snapshot(self.owner, pending["record_id"])
        self.assertEqual((phase, receipt), ("DISPATCH_STARTED", None))
        changed = copy.deepcopy(intent)
        changed["payload"]["package_ref"]["sha256"] = "0"*64
        reseal(changed)
        with self.assertRaises(Problem):
            self.ledger.start(changed)
        with self.assertRaises(Problem):
            self.ledger.start(intent)
        self.assertEqual(self.scheduler.calls, 1)

    def test_real_crash_before_intent_after_intent_and_after_external_port(self):
        script = """
import json,os,sys
from pathlib import Path
from dftlab_platform.contracts import loads
from dftlab_platform.domain import Principal
from dftlab_platform.storage import SQLiteRepository
from dftlab_platform.submission_storage import SQLiteSubmissionLedger
from dftlab_platform.submissions import DurableSubmissions
repo=SQLiteRepository(Path(sys.argv[1])); ledger=SQLiteSubmissionLedger(repo)
owner=Principal(sys.argv[2]); operation=repo.operation(owner,sys.argv[3]); intent=loads(Path(sys.argv[4]).read_bytes())
if sys.argv[6]=='before': os._exit(71)
if sys.argv[6]=='reserved':
 ledger.reserve(operation['record_id'],operation['payload']['revision'],'crash-processor',intent)
 os._exit(72)
class Port:
 def submit(self,value):
  with open(sys.argv[5],'xb') as stream:
   stream.write(json.dumps(value).encode());stream.flush();os.fsync(stream.fileno())
  os._exit(73)
DurableSubmissions(repo,ledger,Port()).perform(operation,'crash-processor',intent)
"""
        for phase, code in (("before", 71), ("reserved", 72), ("dispatched", 73)):
            with self.subTest(phase=phase):
                pending = self.accept()
                operation = self.repo.claim("crash-processor")
                intent = self.intent(operation)
                path, jobs = self.root/(phase+".json"), self.root/(phase+"-external.json")
                path.write_bytes(canonical(intent))
                result = subprocess.run([sys.executable, "-I", "-c", script, str(self.repo.path), self.owner.principal_id,
                                         pending["record_id"], str(path), str(jobs), phase], capture_output=True, timeout=20)
                self.assertEqual(result.returncode, code, result.stderr.decode(errors="replace"))
                self.assertEqual(self.repo.recover(), 1)
                self.assertIsNone(self.repo.claim("new-worker"))
                unknown = self.repo.operation(self.owner, pending["record_id"])
                self.assertEqual(unknown["payload"]["state"], "OUTCOME_UNKNOWN")
                if phase == "before":
                    with self.repo._connection() as db:
                        self.assertIsNone(self.repo._effect_intent(db, pending["record_id"]))
                    self.assertFalse(jobs.exists())
                else:
                    original, stored_phase, _ = self.ledger.snapshot(self.owner, pending["record_id"])
                    self.assertEqual(original, intent)
                    self.assertEqual(stored_phase, "RESERVED" if phase == "reserved" else "DISPATCH_STARTED")
                    self.assertEqual(jobs.exists(), phase == "dispatched")
                    if phase == "reserved":
                        self.assertEqual(self.gateway.reconcile(self.owner, pending["record_id"]), unknown)
                    else:
                        self.scheduler.jobs[intent["payload"]["attempt_token"]] = json.loads(jobs.read_bytes())
                        self.assertEqual(self.gateway.reconcile(self.owner, pending["record_id"])["payload"]["state"], "SUCCEEDED")
                self.assertEqual(self.scheduler.calls, 0)  # reconciliation only


if __name__ == "__main__":
    unittest.main()
