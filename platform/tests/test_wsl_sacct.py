from pathlib import Path
import unittest
from unittest.mock import patch

from dftlab_platform.runtime_probe import Binary, Observation, ProbeFailure
from dftlab_platform.wsl_sacct import (
    SACCT_PATH,
    SACCT_COMMAND,
    SACCT_SHA256,
    WSL_EXE,
    WSL_SHA256,
    WslSacctBridge,
)


class Commands:
    def __init__(self, hashes=None):
        self.calls = []
        self.hashes = list(hashes or [SACCT_SHA256, SACCT_SHA256])

    def run(self, argv, *, cwd, environment):
        self.calls.append((argv, cwd, dict(environment)))
        if argv[-2:] == ("/usr/bin/sha256sum", "/usr/bin/sacct"):
            return Observation(self.hashes.pop(0)+"  /usr/bin/sacct\n", 0)
        return Observation("440|jmc(1000)|unknown|COMPLETED|2026-10-11T09:00:14|2026-10-11T09:00:21\n", 0)


class WslSacctBridgeTests(unittest.TestCase):
    def setUp(self):
        self.commands = Commands()
        self.bridge = WslSacctBridge(Binary(SACCT_PATH, SACCT_SHA256), commands=self.commands)
        self.input_argv = (SACCT_COMMAND, "--completion", "--jobs=440", "--noheader", "--parsable2",
                           "--format=JobID,User,Cluster,State,Start,End")

    def test_executes_only_fixed_root_sacct_argv_and_checks_both_pins_each_time(self):
        with patch.dict("os.environ", {"WSL_INTEROP": "/run/WSL/551_interop"}), \
             patch("dftlab_platform.wsl_sacct.Binary.verified", autospec=True,
                   side_effect=lambda binary: binary.path) as verify:
            result = self.bridge.run(self.input_argv, cwd=Path("/tmp"),
                                     environment={"PATH": "/usr/bin:/bin", "TZ": "UTC"})

        self.assertEqual(result.returncode, 0)
        expected = [
            (str(WSL_EXE), "-d", "Ubuntu", "--exec", "/usr/bin/sha256sum", "/usr/bin/sacct"),
            (str(WSL_EXE), "-d", "Ubuntu", "-u", "root", "--exec", "/usr/bin/sacct", "--completion",
             "--jobs=440", "--noheader", "--parsable2", "--format=JobID,User,Cluster,State,Start,End"),
            (str(WSL_EXE), "-d", "Ubuntu", "--exec", "/usr/bin/sha256sum", "/usr/bin/sacct"),
        ]
        self.assertEqual([call[0] for call in self.commands.calls], expected)
        self.assertTrue(all(isinstance(call[0], tuple) for call in self.commands.calls))
        self.assertTrue(all(call[2]["WSL_INTEROP"] == "/run/WSL/551_interop" for call in self.commands.calls))
        self.assertEqual(verify.call_count, 6)

    def test_rejects_non_numeric_or_additional_job_arguments_before_execution(self):
        with patch.dict("os.environ", {"WSL_INTEROP": "/run/WSL/551_interop"}):
            for selector in ("--jobs=440;id", "--jobs=440.1", "--jobs=0", "--jobs=440"):
                argv = (str(SACCT_PATH), "--completion", selector, "--noheader", "--parsable2",
                        "--format=JobID,User,Cluster,State,Start,End")
                if selector == "--jobs=440":
                    argv = (*argv, "--extra")
                with self.subTest(selector=selector), self.assertRaises(ProbeFailure):
                    self.bridge.run(argv, cwd=Path("/tmp"), environment={"PATH": "/usr/bin:/bin"})
        self.assertEqual(self.commands.calls, [])

    def test_rejects_missing_interop_socket_before_execution(self):
        with patch.dict("os.environ", {}, clear=True), self.assertRaises(ProbeFailure):
            self.bridge.run(self.input_argv, cwd=Path("/tmp"), environment={"PATH": "/usr/bin:/bin"})
        self.assertEqual(self.commands.calls, [])

    def test_sacct_pin_mismatch_before_root_call_fails_closed(self):
        commands = Commands(["0"*64])
        bridge = WslSacctBridge(Binary(SACCT_PATH, SACCT_SHA256), commands=commands)
        with patch.dict("os.environ", {"WSL_INTEROP": "/run/WSL/551_interop"}), \
             patch("dftlab_platform.wsl_sacct.Binary.verified", autospec=True,
                   side_effect=lambda binary: binary.path), \
             self.assertRaises(ProbeFailure):
            bridge.run(self.input_argv, cwd=Path("/tmp"), environment={"PATH": "/usr/bin:/bin"})
        self.assertEqual(len(commands.calls), 1)
        self.assertNotIn("root", commands.calls[0][0])

    def test_sacct_pin_is_rechecked_after_root_call(self):
        commands = Commands([SACCT_SHA256, "0"*64])
        bridge = WslSacctBridge(Binary(SACCT_PATH, SACCT_SHA256), commands=commands)
        with patch.dict("os.environ", {"WSL_INTEROP": "/run/WSL/551_interop"}), \
             patch("dftlab_platform.wsl_sacct.Binary.verified", autospec=True,
                   side_effect=lambda binary: binary.path), \
             self.assertRaises(ProbeFailure):
            bridge.run(self.input_argv, cwd=Path("/tmp"), environment={"PATH": "/usr/bin:/bin"})
        self.assertEqual(len(commands.calls), 3)
        self.assertIn("root", commands.calls[1][0])

    def test_rejects_unpinned_binaries(self):
        with self.assertRaises(ValueError):
            WslSacctBridge(Binary(Path("/tmp/sacct"), "0"*64))
        self.assertEqual(WSL_SHA256, "fcd08205b608b5c4831e0dcb1801dd274436cd2c8420815f18ae58a085891a18")


if __name__ == "__main__":
    unittest.main()
