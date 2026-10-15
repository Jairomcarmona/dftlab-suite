"""Windows-safe launcher state reads and fail-closed shutdown recovery."""
import errno
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid

from dftlab_platform.launcher import _read, _reap_stopped_instance
from dftlab_platform.local_runtime import local_lock


class Launcher(unittest.TestCase):
    def test_read_retries_transient_windows_access_denial(self):
        path = Path("heartbeat.json")
        denied = PermissionError(errno.EACCES, "sharing violation", str(path))
        payload = {"instance_id": str(uuid.uuid4())}
        with patch("pathlib.Path.read_text", side_effect=[denied, json.dumps(payload)]) as read_text:
            self.assertEqual(_read(path), payload)
        self.assertEqual(read_text.call_count, 2)

    def test_stopped_instance_reaper_waits_for_both_kernel_guards(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            instance = str(uuid.uuid4())
            (state / "launcher.lock").write_text(json.dumps({"instance_id": instance}), encoding="utf-8")
            (state / "heartbeat.json").write_text(json.dumps({"instance_id": instance, "updated_at": 0}), encoding="utf-8")
            (state / "access.json").write_text("{}", encoding="utf-8")
            (state / f"stop-{instance}.json").write_text("{}", encoding="utf-8")

            with local_lock(state / "service.guard"):
                result, code = _reap_stopped_instance(state, instance)
                self.assertEqual(code, 2)
                self.assertEqual(result["error"], "STOP_TIMEOUT")
                self.assertTrue((state / "launcher.lock").exists())

            with local_lock(state / "processor.guard"):
                result, code = _reap_stopped_instance(state, instance)
                self.assertEqual(code, 2)
                self.assertEqual(result["error"], "STOP_TIMEOUT")
                self.assertTrue((state / "launcher.lock").exists())

            result, code = _reap_stopped_instance(state, instance)
            self.assertEqual(code, 0)
            self.assertEqual(result["status"], "stopped")
            for name in ("launcher.lock", "heartbeat.json", "access.json", f"stop-{instance}.json"):
                self.assertFalse((state / name).exists())
            self.assertTrue((state / "service.guard").exists())
            self.assertTrue((state / "processor.guard").exists())


if __name__ == "__main__":
    unittest.main()
