"""Hostile worker diagnostics; synthetic executables, no engines or scheduler."""
from dataclasses import replace
from datetime import datetime
import hashlib
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from dftlab_platform.contracts import Contracts
from dftlab_platform.runtime_probe import Binary, BoundedCommands, Observation, ProbeFailure, ProbeSettings, SlurmRuntimeProbe


class Commands:
    def __init__(self):
        self.calls = []
        self.replies = {
            "siesta": "Version : 5.4.2\nParallelisations: MPI\n",
            "mpi": "mpirun (Open MPI) 4.1.6\n",
            "sinfo": "local*|up\n",
            "scontrol:--version": "slurm-wlm 23.11.4\n",
            "scontrol:partition": "PartitionName=local State=UP Nodes=fixture-node\n",
            "scontrol:node": "NodeName=fixture-node State=IDLE CPUTot=12 CPUAlloc=0 RealMemory=6837 AllocMem=0\n"}
        self.hook = lambda: None

    def run(self, argv, *, cwd, environment):
        self.calls.append(argv)
        assert cwd.is_dir()
        assert environment["OMP_NUM_THREADS"] == "1"
        name = Path(argv[0]).name
        key = name if name != "scontrol" else name+":"+("--version" if len(argv) == 2 else argv[3])
        self.hook()
        return Observation(self.replies[key], 0)


class RuntimeProbe(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.pins = {}
        for name in ("siesta", "mpi", "sinfo", "scontrol", "sbatch"):
            path = self.root/name
            path.write_bytes(b"synthetic diagnostic pin; never executed")
            path.chmod(0o700)
            self.pins[name] = Binary(path, hashlib.sha256(path.read_bytes()).hexdigest())
        self.settings = ProbeSettings("profile-fixture", 2, "a"*64, self.pins["siesta"], self.pins["mpi"],
                                      self.pins["sinfo"], self.pins["scontrol"], self.pins["sbatch"],
                                      "local", "fixture-node", 4, 1, 512, self.root/"private")
        self.commands = Commands()

    def tearDown(self):
        self.temporary.cleanup()

    def observe(self, settings=None):
        return SlurmRuntimeProbe(self.commands).observe("project-fixture", settings or self.settings)

    def test_original_receipt_and_qualified_scope(self):
        result = self.observe()
        Contracts().validate("runtime-probe-receipt", result.receipt)
        payload = result.receipt["payload"]
        self.assertEqual(payload["profile"], {"profile_id": "profile-fixture", "revision": 2})
        self.assertEqual(payload["executable"]["sha256"], self.pins["siesta"].sha256)
        self.assertEqual(payload["launcher"]["ranks"], 4)
        checks = {check["check"]: check["result"] for check in payload["storage_checks"]}
        self.assertEqual(checks["MPI_RANK_EXECUTION"], "NOT_ESTABLISHED")
        self.assertFalse(result.evidence["submission_performed"])
        self.assertEqual(result.evidence["scientific_assessment"], "NOT_ESTABLISHED")
        self.assertEqual(result.evidence["profile_sha256"], "a"*64)
        self.assertEqual(result.evidence["module_commands"], [])
        self.assertEqual((datetime.fromisoformat(payload["valid_until"])-datetime.fromisoformat(payload["observed_at"])).total_seconds(), 900)
        self.assertTrue(all(Path(call[0]).name != "sbatch" for call in self.commands.calls))
        self.assertEqual(list((self.root/"private").iterdir()), [])

    def test_all_pins_precede_any_command_and_changes_fail_closed(self):
        self.pins["sbatch"].path.write_bytes(b"changed")
        with self.assertRaises(ProbeFailure):
            self.observe()
        self.assertEqual(self.commands.calls, [])
        self.pins["sbatch"].path.write_bytes(b"synthetic diagnostic pin; never executed")
        self.commands.hook = lambda: self.pins["siesta"].path.write_bytes(b"modified during observation")
        with self.assertRaises(ProbeFailure):
            self.observe()

    def test_pinned_alias_keeps_invocation_identity(self):
        # Port fixture models a validated alias resolving to another pathname.
        # Executing that pathname would change argv[0], as mpirun/orterun does.
        with patch.object(Binary, "verified", lambda pin: pin.path.with_name("resolved-"+pin.path.name)):
            result = self.observe()
        self.assertTrue(result.receipt["payload"]["launcher"]["mpi"])
        self.assertEqual(self.commands.calls[0][0], str(self.pins["siesta"].path))
        self.assertEqual(self.commands.calls[1][0], str(self.pins["mpi"].path))

    def test_version_build_capacity_partition_and_duplicate_fields(self):
        for key, replacement in (
            ("siesta", "Version : 5.4.1\nCompiler 5.4.2\nParallelisations: MPI\n"),
            ("siesta", "Version : 5.4.2\nParallelisations: none\n"),
            ("mpi", "unrecognized launcher"),
            ("sinfo", "other*|up\n"),
            ("scontrol:partition", "PartitionName=local State=UP Nodes=other\n"),
            ("scontrol:node", "NodeName=fixture-node State=IDLE CPUTot=12 CPUAlloc=10 RealMemory=6837 AllocMem=0\n"),
            ("scontrol:node", "NodeName=fixture-node State=IDLE CPUTot=12 CPUAlloc=0 RealMemory=256 AllocMem=0\n"),
            ("scontrol:node", "NodeName=fixture-node State=IDLE CPUTot=12 CPUTot=120 CPUAlloc=0 RealMemory=6837 AllocMem=0\n"),
            ("scontrol:node", "NodeName=fixture-node State=IDLE+DRAIN CPUTot=12 CPUAlloc=0 RealMemory=6837 AllocMem=0\n")):
            with self.subTest(key=key, replacement=replacement):
                old = self.commands.replies[key]
                self.commands.replies[key] = replacement
                with self.assertRaises(ProbeFailure):
                    self.observe()
                self.commands.replies[key] = old

    def test_invalid_settings_never_execute(self):
        for changes in ({"partition": "local;sbatch"}, {"ranks": 0}, {"threads_per_rank": True},
                        {"mpi": None}, {"ttl_seconds": 901}, {"profile_sha256": "not-a-digest"}):
            with self.subTest(changes=changes), self.assertRaises(ProbeFailure):
                self.observe(replace(self.settings, **changes))
        self.assertEqual(self.commands.calls, [])

    def test_serial_observation_does_not_claim_mpi(self):
        self.commands.replies["siesta"] = "Version : 5.4.2\nParallelisations: none\n"
        result = self.observe(replace(self.settings, mpi=None, ranks=1))
        self.assertFalse(result.receipt["payload"]["launcher"]["mpi"])
        self.assertFalse(any(Path(call[0]).name == "mpi" for call in self.commands.calls))

    def test_bounded_child_timeout_output_and_no_stdin(self):
        runner = BoundedCommands(timeout=0.4, limit=4096)
        arguments = {"cwd": self.root, "environment": dict(os.environ)}
        observed = runner.run((sys.executable, "-I", "-c", "import sys;print(len(sys.stdin.read()))"), **arguments)
        self.assertEqual(observed.output.strip(), "0")
        for script in ("import time;time.sleep(10)", "import sys;sys.stdout.write('x'*100000);sys.stdout.flush()"):
            with self.assertRaises(ProbeFailure):
                runner.run((sys.executable, "-I", "-c", script), **arguments)


if __name__ == "__main__":
    unittest.main()
