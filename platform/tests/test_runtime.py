"""Installed API/processor ownership, private bootstrap and restart durability."""
from http.client import HTTPConnection
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import urlsplit

from dftlab_platform.local_runtime import local_lock
from dftlab_platform.storage import SQLiteRepository


class Runtime(unittest.TestCase):
    def test_installed_http_bootstrap_and_persistent_owner(self):
        executable = Path(sys.executable).parent / ("dftlab-platform.exe" if os.name == "nt" else "dftlab-platform")
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            def invoke(command, code=0):
                result = subprocess.run([str(executable), command, "--state-dir", directory, "--base-path", "/lab"], capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, code, result.stderr+result.stdout)
                return json.loads(result.stdout)
            def http(url, method, path, body=None, headers=None):
                parsed = urlsplit(url)
                connection = HTTPConnection(parsed.hostname, parsed.port, timeout=10)
                fields = {"Origin": f"http://{parsed.netloc}"}
                fields.update(headers or {})
                if body is not None:
                    fields["Content-Type"] = "application/json"
                    body = json.dumps(body)
                try:
                    connection.request(method, "/lab/api/v1"+path, body, fields)
                    result = connection.getresponse()
                    return result.status, dict(result.getheaders()), json.loads(result.read())
                finally:
                    connection.close()
            try:
                started = invoke("start")
                self.assertEqual(started["scope"], "local-api")
                bootstrap = json.loads((state / "access.json").read_text())
                self.assertNotIn(bootstrap["bootstrap_token"], json.dumps(started))
                self.assertNotIn(bootstrap["bootstrap_token"], (state / "heartbeat.json").read_text())
                self.assertEqual(http(started["url"], "GET", "/health")[0], 200)
                status, headers, session = http(started["url"], "POST", "/session", {"bootstrap_token": bootstrap["bootstrap_token"]})
                self.assertEqual(status, 201)
                credentials = {"Cookie": headers["set-cookie"].split(";", 1)[0], "X-CSRF-Token": session["csrf_token"]}
                status, _, project = http(started["url"], "POST", "/projects", {"name": "Durable", "idempotency_key": "runtime-project-01"}, credentials)
                self.assertEqual(status, 201)
                # A live API/processor cannot be taken over via stale heartbeat
                # or the explicit repair command. No stop of another PID.
                repair = subprocess.run([str(executable), "recover-local", "--state-dir", directory], capture_output=True, text=True, timeout=10)
                self.assertEqual(repair.returncode, 2)
                self.assertEqual(invoke("status")["instance_id"], started["instance_id"])
                invoke("stop")
                self.assertFalse((state / "access.json").exists())
                restarted = invoke("start")
                bootstrap2 = json.loads((state / "access.json").read_text())
                self.assertNotEqual(bootstrap2["bootstrap_token"], bootstrap["bootstrap_token"])
                status, headers, session2 = http(restarted["url"], "POST", "/session", {"bootstrap_token": bootstrap2["bootstrap_token"]})
                self.assertEqual(session2["principal_id"], session["principal_id"])
                credentials2 = {"Cookie": headers["set-cookie"].split(";", 1)[0]}
                self.assertEqual(http(restarted["url"], "GET", "/projects/"+project["project_id"], headers=credentials2)[2], project)
                self.assertEqual(http(restarted["url"], "GET", "/projects", headers=credentials)[0], 401)
            finally:
                invoke("stop")

    def test_kernel_lock_is_exclusive_and_stale_lease_requires_explicit_repair(self):
        executable = Path(sys.executable).parent / ("dftlab-platform.exe" if os.name == "nt" else "dftlab-platform")
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            with local_lock(state / "service.guard"):
                result = subprocess.run([sys.executable, "-I", "-c", "from pathlib import Path; from dftlab_platform.local_runtime import local_lock; import sys;\nwith local_lock(Path(sys.argv[1])): pass", str(state / "service.guard")], capture_output=True, text=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
            (state / "launcher.lock").write_text('{"instance_id":"11111111-1111-1111-1111-111111111111"}')
            refused = subprocess.run([str(executable), "start", "--state-dir", directory], capture_output=True, text=True, timeout=10)
            self.assertEqual(refused.returncode, 2)
            repaired = subprocess.run([str(executable), "recover-local", "--state-dir", directory], capture_output=True, text=True, timeout=10)
            self.assertEqual(repaired.returncode, 0, repaired.stderr)
            self.assertFalse((state / "launcher.lock").exists())
            self.assertTrue((state / "service.guard").exists())  # stable inode


if __name__ == "__main__":
    unittest.main()
