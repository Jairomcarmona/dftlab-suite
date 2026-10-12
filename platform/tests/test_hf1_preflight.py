"""Pure parsing and the read-only report shape of the HF-1 qualification preflight."""
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest

from dftlab_platform import hf1_preflight as preflight


class HF1Preflight(unittest.TestCase):
    def test_slurm_time_limits(self):
        self.assertIsNone(preflight.slurm_seconds("UNLIMITED"))
        self.assertEqual(preflight.slurm_seconds("01:00:00"), 3600)
        self.assertEqual(preflight.slurm_seconds("1-00:00:00"), 86400)
        self.assertEqual(preflight.slurm_seconds("00:39:59"), 2399)
        self.assertIs(preflight.slurm_seconds("soon"), False)
        self.assertIs(preflight.slurm_seconds(""), False)

    def test_config_and_partition_parsing(self):
        config = preflight.config_pairs("ClusterName             = local\nProctrackType           = proctrack/linuxproc\nJobRequeue              = 1\n")
        self.assertEqual((config["ClusterName"], config["ProctrackType"], config["JobRequeue"]), ("local", "proctrack/linuxproc", "1"))
        partition = preflight.keyed_pairs("PartitionName=local AllowGroups=ALL State=UP\n   MaxNodes=UNLIMITED MaxTime=UNLIMITED Nodes=wsl")
        self.assertEqual((partition["State"], partition["MaxTime"], partition["Nodes"]), ("UP", "UNLIMITED", "wsl"))

    def test_sinfo_states_lose_their_flags(self):
        nodes = preflight.parse_sinfo_nodes("wsl|idle|4|7800\nwsl2|down*|4|7800\nmalformed\n")
        self.assertEqual([(item["node"], item["state"]) for item in nodes], [("wsl", "idle"), ("wsl2", "down")])

    @unittest.skipUnless(os.name == "posix", "mountinfo is Linux")
    def test_mount_type_uses_the_longest_containing_mount(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            info = root/"mountinfo"
            info.write_text(
                "1 0 0:1 / / rw - ext4 /dev/sda rw\n"
                f"2 1 0:2 / {root}/c rw - 9p drvfs rw\n")
            self.assertEqual(preflight.mount_type(root/"c"/"x", str(info)), "9p")
            self.assertEqual(preflight.mount_type(root/"private", str(info)), "ext4")

    def test_report_is_read_only_and_lists_every_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)/"report.json"
            with contextlib.redirect_stdout(io.StringIO()):
                code = preflight.main(["--state-dir", str(Path(directory)/"state"), "--partition", "none-such", "--output", str(output)])
            report = json.loads(output.read_text())
            self.assertEqual(report["schema"], "dftlab.hf1-qualification-preflight@1")
            self.assertIs(report["submission_performed"], False)
            self.assertIs(report["attempt_created"], False)
            self.assertEqual(report["failed"], [item["id"] for item in report["checks"] if item["status"] == "FAIL"])
            self.assertEqual(code, 1 if report["failed"] else 0)
            self.assertFalse((Path(directory)/"state").exists())
            with self.assertRaises(FileExistsError), contextlib.redirect_stdout(io.StringIO()):
                preflight.main(["--state-dir", str(Path(directory)/"state"), "--partition", "none-such", "--output", str(output)])
            self.assertEqual(os.listdir(directory), ["report.json"])


if __name__ == "__main__":
    unittest.main()
