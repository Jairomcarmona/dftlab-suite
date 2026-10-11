"""Terminal proof adversaries with synthetic public native API and commands."""
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import re
from types import SimpleNamespace
import unittest

from dftlab_platform.contracts import canonical
from dftlab_platform.domain import Problem
from dftlab_platform.runtime_probe import Observation, ProbeFailure
from dftlab_platform.terminal_evidence import LocalTerminalSigner, SlurmTerminalCollector
from test_slurm import Slurm


@dataclass(frozen=True)
class Job:
    job_id: str
    cluster: str
    remote_user: str


@dataclass(frozen=True)
class NativeEvidence:
    run_id: str
    workflow_lock_sha256: str
    run_lock_sha256: str
    job: Job
    state: str
    observed_at: str
    expires_at: str
    signer_id: str
    signature: str
    active_allocation_absent: bool
    source: str = "sacct"
    schema_version: str = "1.0"

    @staticmethod
    def timestamp(value):
        return datetime.fromisoformat(value.replace("Z", "+00:00"))

    def signed_bytes(self):
        payload = asdict(self)
        del payload["signature"]
        # Deliberately unlike platform JCS: the signer must use the native API.
        return b"synthetic-native-serialization\n"+canonical(payload)


class History:
    def __init__(self, fixture, timestamp):
        self.calls = []
        self.output = f"123|fixture({fixture.site.uid})|synthetic-cluster|COMPLETED|{timestamp}|{timestamp}\n"
        self.code, self.after = 0, lambda: None

    def run(self, argv, *, cwd, environment):
        self.calls.append((argv, cwd, dict(environment)))
        self.after()
        return Observation(self.output, self.code)


class TerminalEvidence(unittest.TestCase):
    def setUp(self):
        self.fixture = Slurm()
        self.fixture.setUp()
        self.port = self.fixture.prepare_identity()
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
        base = self.fixture.commands.patch
        self.fixture.commands.patch = lambda output: re.sub(r"SubmitTime=\S+", "SubmitTime="+timestamp, base(output)).replace("JobState=RUNNING", f"JobState=COMPLETED StartTime={timestamp} EndTime={timestamp} NumCPUs=8 NumTasks=4 CPUs/Task=1 ReqTRES=cpu=4,mem=512M AllocTRES=cpu=8,node=1")
        self.history = History(self.fixture, timestamp)
        self.workflow = SimpleNamespace(workflow_id="native-workflow", project_id=self.fixture.intent["project_id"])
        self.run = SimpleNamespace(run_id=self.fixture.package.run_id, project_id=self.workflow.project_id, workflow_id=self.workflow.workflow_id, workflow_lock_sha256="1"*64)
        self.api = SimpleNamespace(TerminalSchedulerEvidence=NativeEvidence, SchedulerJobIdentity=Job,
                                   load_run_lock=lambda path: (SimpleNamespace(content_sha256="2"*64), self.run),
                                   load_workflow_lock=lambda path: (SimpleNamespace(content_sha256="1"*64), self.workflow))
        self.engines = SimpleNamespace(qraft=self.api)
        self.signer = LocalTerminalSigner(self.api, "fixture-signer", b"synthetic-private-test-key-00000001")

    def tearDown(self):
        self.fixture.tearDown()

    def collector(self, **kwargs):
        return SlurmTerminalCollector(self.engines, self.port, self.fixture.site.scontrol, self.signer, history_commands=self.history, **kwargs)

    def observe(self, **kwargs):
        return self.collector(**kwargs).observe(self.fixture.intent, "123")

    def rejected(self, **kwargs):
        with self.assertRaises((Problem, ProbeFailure)):
            self.observe(**kwargs)

    def test_original_native_signature_history_binding_and_real_allocation_counts(self):
        result = self.observe()
        self.assertTrue(self.signer.verify(result.native))
        self.assertEqual((result.requested_cpus, result.allocated_cpus), (4, 8))
        self.assertEqual(result.cluster_binding, "EXPLICIT_HISTORY_CLUSTER")
        self.assertEqual(result.native.workflow_lock_sha256, "1"*64)
        self.assertEqual(result.native.run_lock_sha256, "2"*64)
        expected = hmac.new(b"synthetic-private-test-key-00000001", result.native.signed_bytes(), hashlib.sha256).hexdigest()
        self.assertEqual(expected, result.native.signature)
        self.assertEqual(len(result.observations), 5)
        self.assertTrue(all(observation["output"] for observation in self.fixture.evidence))
        self.assertFalse(any("--parsable" in argv for argv, _, _ in self.fixture.commands.calls))
        self.assertTrue(all("--completion" in argv for argv, _, _ in self.history.calls))

    def test_empty_denied_duplicate_and_other_job_user_cluster_state_are_not_terminal(self):
        original = self.history.output
        for output, code in (("", 0), (original, 1), (original+original, 0), (original.replace("123|", "124|"), 0),
                             (original.replace("fixture(", "other("), 0), (original.replace("synthetic-cluster", "other-cluster"), 0),
                             (original.replace("COMPLETED", "RUNNING"), 0), (original.replace("COMPLETED", "FAILED"), 0)):
            self.history.output, self.history.code = output, code
            self.rejected()

    def test_raw_unknown_cluster_requires_registered_local_protocol_and_is_retained(self):
        self.history.output = self.history.output.replace("synthetic-cluster", "unknown")
        self.rejected()
        result = self.observe(allow_unknown_cluster=True)
        self.assertEqual(result.cluster_binding, "REGISTERED_SAME_SITE_CONTEXT_ATTESTATION")
        self.assertEqual(result.native.job.cluster, "synthetic-cluster")
        self.assertIn("|unknown|", next(item["output"] for item in self.fixture.evidence if item["command"] == "terminal-history"))

    def test_history_civil_timezone_and_interval_must_match_current_allocation(self):
        # Actual filetxt history stores civil strings; client TZ alone cannot fix them.
        original = self.history.output
        parts = original.strip().split("|")
        for index in (4, 5):
            parts[index] = (datetime.fromisoformat(parts[index])-timedelta(hours=6)).isoformat()
        self.history.output = "|".join(parts)+"\n"
        self.rejected()
        self.assertTrue(self.signer.verify(self.observe(completion_timezone=timezone(timedelta(hours=-6))).native))
        # Deliberate wrong interval on one column, not an old job ID alone.
        parts = original.strip().split("|")
        parts[4] = "1990-01-01T00:00:00"
        self.history.output = "|".join(parts)+"\n"
        self.rejected()

    def test_requeue_context_rotation_after_history_cannot_mint_proof(self):
        original = self.fixture.commands.patch
        for update in (lambda value: value.replace("JobState=COMPLETED", "JobState=RUNNING"),
                       lambda value: value.replace("NumCPUs=8", "NumCPUs=4"),
                       lambda value: value.replace("JobId=123", "JobId=124")):
            self.fixture.commands.patch = original
            self.history.after = lambda update=update: setattr(self.fixture.commands, "patch", lambda value: update(original(value)))
            self.rejected()

    def test_signature_tamper_other_key_expiry_future_and_clock_rollback_fail(self):
        native = self.observe().native
        self.assertFalse(self.signer.verify(replace(native, run_id="other-run")))
        self.assertFalse(self.signer.verify(replace(native, signature="0"*64)))
        self.assertFalse(LocalTerminalSigner(self.api, "fixture-signer", b"another-private-test-key-000000001").verify(native))
        expired = NativeEvidence.timestamp(native.expires_at)+timedelta(seconds=1)
        self.signer.clock = lambda: expired
        self.assertFalse(self.signer.verify(native))
        self.signer.clock = lambda: NativeEvidence.timestamp(native.observed_at)+timedelta(seconds=1)
        self.assertFalse(self.signer.verify(native))  # cannot resurrect on backward UTC
        future = replace(native, observed_at=(expired+timedelta(seconds=1)).isoformat(), expires_at=(expired+timedelta(seconds=31)).isoformat())
        future = self.signer.sign(future)
        fresh_signer = LocalTerminalSigner(self.api, "fixture-signer", b"synthetic-private-test-key-00000001", clock=lambda: expired)
        self.assertFalse(fresh_signer.verify(future))

    def test_corrupt_raw_observation_binary_and_native_identity_fail(self):
        capture = self.port.evidence_writer
        self.port.evidence_writer = lambda intent, observation: {**capture(intent, observation), "sha256": "0"*64}
        self.rejected()
        self.port.evidence_writer = capture
        self.workflow.project_id = "foreign-project"
        self.rejected()
        self.workflow.project_id = self.fixture.intent["project_id"]
        self.fixture.binary.write_bytes(b"changed binary")
        self.rejected()

    def test_nonterminal_missing_fields_duplicate_fields_and_resource_disagreement_fail(self):
        original = self.fixture.commands.patch
        for modify in (lambda value: value.replace("JobState=COMPLETED", "JobState=COMPLETING"),
                       lambda value: value.replace(" EndTime=", " UnknownEnd="),
                       lambda value: value+" JobState=COMPLETED",
                       lambda value: value.replace("NumCPUs=8", "NumCPUs=4"),
                       lambda value: value.replace("AllocTRES=cpu=8", "AllocTRES=cpu=8,cpu=8")):
            self.fixture.commands.patch = lambda value, modify=modify: modify(original(value))
            self.rejected()


if __name__ == "__main__":
    unittest.main()
