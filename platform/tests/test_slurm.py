"""Local site correlation adversaries; fake commands, no SLURM or science."""
from dataclasses import replace
from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import tempfile
import unittest

from dftlab_platform.contracts import canonical, resource_json
from dftlab_platform.domain import Problem, envelope, now
from dftlab_platform.runtime_probe import Binary, Observation, ProbeFailure
from dftlab_platform.slurm import ManagedSlurmPackage, SlurmSchedulerPort, SlurmSite


class Commands:
    def __init__(self, root, script, token):
        self.root, self.script, self.token = root, script, token
        self.calls, self.queue, self.patch = [], "", lambda output: output
        self.ack, self.code = "123;synthetic-cluster\n", 0
        self.config = "ClusterName = synthetic-cluster\n"

    def run(self, argv, *, cwd, environment):
        self.calls.append((argv, cwd, dict(environment)))
        if argv[1:] == ("show", "config"):
            return Observation(self.config, 0)
        if "--parsable" in argv:
            return Observation(self.ack, self.code)
        if "--noheader" in argv:
            return Observation(self.queue, 0)
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
        output = f"JobId=123 JobName=dftlab-{self.token} UserId=fixture(1000) Comment=dftlab:{self.token} SubmitTime={timestamp} WorkDir={self.root} Command={self.script} JobState=RUNNING\n"
        return Observation(self.patch(output), 0)


class Slurm(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.parent = Path(self.temporary.name)
        self.root = self.parent/"package"
        self.root.mkdir(mode=0o700)
        self.script = self.root/"submit.slurm"
        self.script.write_bytes(b"#!/bin/sh\n# synthetic fixture only\n")
        self.binary = self.parent/"synthetic-binary"
        self.binary.write_bytes(b"synthetic executable; never invoked")
        self.binary.chmod(0o700)
        pin = Binary(self.binary, hashlib.sha256(self.binary.read_bytes()).hexdigest())
        self.site = SlurmSite(pin, pin, pin, "synthetic-cluster", "fixture", 1000)
        payload = resource_json("fixtures/effect-intent/valid/submit.json")["payload"]
        payload["recorded_at"] = now()
        self.intent = envelope("effect-intent", "synthetic-project", payload)
        self.verified, self.evidence = 0, []
        def verify():
            self.verified += 1
        self.package = ManagedSlurmPackage(self.root, self.script, hashlib.sha256(self.script.read_bytes()).hexdigest(),
                                           payload["package_ref"], payload["profile"], payload["run_id"], 1, verify)
        self.commands = Commands(self.root, self.script, payload["attempt_token"])

    def tearDown(self):
        self.temporary.cleanup()

    def capture(self, intent, data):
        self.evidence.append(data)
        return {"artifact_id": "synthetic-observation-"+str(len(self.evidence)), "sha256": hashlib.sha256(canonical(data)).hexdigest(), "media_type": "application/json"}

    def port(self, package=None, identity=None):
        return SlurmSchedulerPort(self.site, {self.package.run_id: package or self.package}, self.capture, lambda intent: None,
                                  commands=self.commands, identity=identity or (lambda: ("fixture", 1000)))

    def test_accepted_receipt_preserves_binding_and_actual_job_context(self):
        # On POSIX fake identity UID must match the temporary file owner too.
        if os.name != "nt":
            self.site = replace(self.site, uid=os.getuid())
            self.commands.patch = lambda output: output.replace("fixture(1000)", f"fixture({os.getuid()})")
        port = self.port(identity=lambda: ("fixture", self.site.uid))
        receipt = port.submit(self.intent)
        self.assertEqual(receipt["payload"]["status"], "ACCEPTED")
        self.assertEqual(receipt["payload"]["job"]["job_id"], "123")
        self.assertEqual(receipt["payload"]["package_ref"], self.intent["payload"]["package_ref"])
        self.assertEqual(len(receipt["payload"]["evidence"]), 3)
        self.assertEqual(self.verified, 2)
        submit = self.commands.calls[1][0]
        self.assertIn("--comment=dftlab:"+self.intent["payload"]["attempt_token"], submit)
        self.assertEqual(submit[-1], str(self.script))
        self.assertTrue(all(call[2]["TZ"] == "UTC" for call in self.commands.calls))

    def prepare_identity(self):
        if os.name != "nt":
            self.site = replace(self.site, uid=os.getuid())
        original_uid = self.site.uid
        self.commands.patch = lambda output: output.replace("fixture(1000)", f"fixture({original_uid})")
        return self.port(identity=lambda: ("fixture", self.site.uid))

    def test_empty_queue_never_proves_absence_and_multiple_candidates_are_unknown(self):
        port = self.prepare_identity()
        self.assertIsNone(port.find(self.intent))
        token = self.intent["payload"]["attempt_token"]
        self.commands.queue = f"123|fixture|dftlab:{token}|dftlab-{token}\n"
        self.assertEqual(port.find(self.intent)["payload"]["status"], "RECONCILED_FOUND")
        self.commands.queue += f"124|fixture|dftlab:{token}|dftlab-{token}\n"
        with self.assertRaises(ProbeFailure):
            port.find(self.intent)
        self.assertFalse(any("--parsable" in argv for argv, _, _ in self.commands.calls))

    def test_wrong_cluster_user_workdir_command_time_and_duplicate_field_are_rejected(self):
        port = self.prepare_identity()
        uid = self.site.uid
        modifications = (
            lambda output: output.replace("fixture(1000)", f"other({uid})"),
            lambda output: output.replace("fixture(1000)", f"fixture({uid})").replace(str(self.root), str(self.parent)),
            lambda output: output.replace("fixture(1000)", f"fixture({uid})").replace("Command="+str(self.script), "Command="+str(self.parent/"wrong.slurm")),
            lambda output: output.replace("fixture(1000)", f"fixture({uid})").replace("JobId=123", "JobId=123 JobId=123"),
            lambda output: output.replace("fixture(1000)", f"fixture({uid})").replace("SubmitTime=", "SubmitTime=1990-01-01T00:00:00 Extra="),
        )
        for modification in modifications:
            self.commands.patch = modification
            with self.subTest(modification=modification), self.assertRaises(Problem):
                port.submit(self.intent)
        self.commands.config = "ClusterName = other\n"
        before = sum("--parsable" in argv for argv, _, _ in self.commands.calls)
        with self.assertRaises(Problem):
            port.submit(self.intent)
        self.assertEqual(sum("--parsable" in argv for argv, _, _ in self.commands.calls), before)

    def test_nonzero_or_malformed_ack_remains_ambiguous(self):
        port = self.prepare_identity()
        for output, code in (("accepted but ack unavailable\n", 1), ("123;other\n", 0), ("123\n124\n", 0), ("123\nwarning\n", 0)):
            self.commands.ack, self.commands.code = output, code
            with self.subTest(output=output), self.assertRaises(ProbeFailure):
                port.submit(self.intent)

    def test_script_pin_package_binding_and_evidence_bytes_are_checked(self):
        port = self.prepare_identity()
        self.script.write_bytes(b"modified")
        with self.assertRaises(Problem):
            port.submit(self.intent)
        self.assertEqual(self.commands.calls, [])
        self.script.write_bytes(b"#!/bin/sh\n# synthetic fixture only\n")
        bad = replace(self.package, profile={"profile_id": "other", "revision": 1})
        with self.assertRaises(Problem):
            self.port(bad, lambda: ("fixture", self.site.uid)).submit(self.intent)
        original = self.capture
        def corrupted(intent, document):
            reference = original(intent, document)
            return {**reference, "sha256": "0"*64}
        port.evidence_writer = corrupted
        with self.assertRaises(Problem):
            port.submit(self.intent)
        self.assertFalse(any("--parsable" in argv for argv, _, _ in self.commands.calls))

    def test_path_escape_and_false_verifier_fail_before_external_commands(self):
        self.prepare_identity()
        for package in (replace(self.package, script=self.root/".."/"submit.slurm"),
                        replace(self.package, verify=lambda: False),
                        replace(self.package, authority_generation=True)):
            with self.subTest(package=package), self.assertRaises(Problem):
                self.port(package, lambda: ("fixture", self.site.uid)).submit(self.intent)
        self.assertEqual(self.commands.calls, [])

    def test_denied_rpc_authority_never_enters_sbatch(self):
        port = self.prepare_identity()
        port.authorize_dispatch = lambda intent: False
        with self.assertRaises(Problem):
            port.submit(self.intent)
        self.assertFalse(any("--parsable" in argv for argv, _, _ in self.commands.calls))


if __name__ == "__main__":
    unittest.main()
