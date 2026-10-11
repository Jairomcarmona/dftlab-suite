"""Black-box checks run with the installed wheel, outside the checkout."""
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import dftlab_platform


class InstalledPlatform(unittest.TestCase):
    def test_distribution_and_entrypoint(self):
        self.assertEqual(importlib.metadata.version("dftlab-platform"), dftlab_platform.__version__)
        self.assertEqual(sys.version_info[:3], (3, 12, 10))
        self.assertTrue(Path(dftlab_platform.__file__).resolve().is_relative_to(Path(sys.prefix).resolve()))
        self.assertNotIn("PYTHONPATH", os.environ)
        entrypoints = importlib.metadata.distribution("dftlab-platform").entry_points
        self.assertIn("dftlab-platform", [entry.name for entry in entrypoints if entry.group == "console_scripts"])

    def test_process_lifecycle_and_exclusive_instance(self):
        executable = Path(sys.executable).parent / ("dftlab-platform.exe" if os.name == "nt" else "dftlab-platform")
        with tempfile.TemporaryDirectory(prefix="dftlab-launcher-") as directory:
            def invoke(command, code=0):
                process = subprocess.run([str(executable), command, "--state-dir", directory], capture_output=True, text=True, timeout=30)
                self.assertEqual(process.returncode, code, process.stderr + process.stdout)
                return json.loads(process.stdout)
            try:
                self.assertEqual(invoke("status")["status"], "stopped")
                started = invoke("start")
                self.assertEqual(started["status"], "running")
                self.assertEqual(invoke("start", 2)["instance_id"], started["instance_id"])
                self.assertEqual(invoke("status")["instance_id"], started["instance_id"])
                self.assertEqual(invoke("stop")["status"], "stopped")
                self.assertEqual(invoke("stop")["status"], "stopped")
                restarted = invoke("start")
                self.assertNotEqual(restarted["instance_id"], started["instance_id"])
            finally:
                invoke("stop")
            self.assertEqual(invoke("status")["status"], "stopped")


if __name__ == "__main__":
    unittest.main()
