"""Installed service through real loopback HTTP, including adversarial clients."""
import asyncio
import copy
import hashlib
from http.client import HTTPConnection
import json
from pathlib import Path
import socket
import tempfile
import threading
import time
import unittest

import uvicorn
from dftlab_platform.artifacts import LocalArtifactStore
from dftlab_platform.artifact_storage import SQLiteArtifactIndex
from dftlab_platform.contracts import Contracts, resource_json
from dftlab_platform.domain import Operations, Problem, identifier, reseal
from dftlab_platform.projection_storage import SQLiteReadModels
from dftlab_platform.security import LocalSettings, Sessions, SecurityMiddleware
from dftlab_platform.service import create_app
from dftlab_platform.storage import SQLiteRepository


class HTTPService(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.repo = SQLiteRepository(self.root / "state.sqlite")
        self.alice, self.bob = [self.repo.ensure_principal(name) for name in ("alice", "bob")]
        self.store = LocalArtifactStore(self.root / "artifacts", SQLiteArtifactIndex(self.repo))
        self.readmodels = SQLiteReadModels(self.repo)
        self.sessions = Sessions()
        self.socket = socket.socket()
        self.socket.bind(("127.0.0.1", 0))
        self.socket.listen(16)
        self.settings = LocalSettings(self.socket.getsockname()[1], base_path="/lab")
        self.app = create_app(self.repo, self.store, self.readmodels, self.settings, self.sessions)
        config = uvicorn.Config(self.app, host="127.0.0.1", port=self.settings.port, log_config=None, access_log=False, lifespan="off", proxy_headers=False, ws="none")
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(target=lambda: asyncio.run(self.server.serve(sockets=[self.socket])), daemon=True)
        self.thread.start()
        deadline = time.monotonic()+10
        while not self.server.started and self.thread.is_alive() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(self.server.started)
        self.cookie, self.csrf = self.login(self.alice)
        self.other_cookie, self.other_csrf = self.login(self.bob)

    def tearDown(self):
        self.server.should_exit = True
        self.thread.join(10)
        self.socket.close()
        self.assertFalse(self.thread.is_alive())
        self.directory.cleanup()

    def request(self, method, path, body=None, *, cookie=None, csrf=None, headers=None, authenticated=True):
        connection = HTTPConnection("127.0.0.1", self.settings.port, timeout=10)
        fields = {"Origin": self.settings.origin}
        if authenticated:
            fields["Cookie"] = "dftlab_session="+(cookie if cookie is not None else self.cookie)
            fields["X-CSRF-Token"] = csrf if csrf is not None else self.csrf
        if isinstance(body, dict):
            body = json.dumps(body).encode()
            fields["Content-Type"] = "application/json"
        fields.update(headers or {})
        try:
            connection.request(method, self.settings.base_path+"/api/v1"+path, body, fields)
            response = connection.getresponse()
            data = response.read()
            return response.status, dict(response.getheaders()), json.loads(data) if response.getheader("Content-Type", "").startswith(("application/json", "application/problem+json")) else data
        finally:
            connection.close()

    def login(self, principal):
        bootstrap = self.sessions.issue(principal)
        status, headers, result = self.request("POST", "/session", {"bootstrap_token": bootstrap}, authenticated=False)
        self.assertEqual(status, 201)
        Contracts().validate_ref(Contracts().api_ref("createSession", status=201), result)
        self.assertIn("HttpOnly", headers["set-cookie"])
        self.assertIn("SameSite=strict", headers["set-cookie"])
        self.assertIn("Path=/lab/", headers["set-cookie"])
        return headers["set-cookie"].split(";", 1)[0].split("=", 1)[1], result["csrf_token"]

    def project(self):
        status, _, project = self.request("POST", "/projects", {"name": "Project", "idempotency_key": "service-project-01"})
        self.assertEqual(status, 201)
        return project

    def assert_problem(self, response, status, code):
        actual, _, body = response
        self.assertEqual(actual, status, body)
        self.assertEqual(body["code"], code)
        Contracts().validate("problem", body)

    def test_exact_origin_null_dns_rebinding_csrf_and_auth(self):
        self.assert_problem(self.request("GET", "/projects", headers={"Origin": "null"}), 403, "ORIGIN_REJECTED")
        self.assert_problem(self.request("GET", "/health", headers={"Host": "evil.example"}), 403, "ORIGIN_REJECTED")
        self.assert_problem(self.request("POST", "/projects", {}, headers={"Origin": self.settings.origin+"/"}), 403, "ORIGIN_REJECTED")
        self.assert_problem(self.request("POST", "/projects", {}, headers={"X-CSRF-Token": "bad"}), 403, "CSRF_REJECTED")
        self.assert_problem(self.request("POST", "/projects", {}, cookie=self.other_cookie), 403, "CSRF_REJECTED")
        self.assert_problem(self.request("GET", "/projects", headers={"Cookie": "dftlab_session="+self.cookie+"; dftlab_session="+self.other_cookie}), 401, "NOT_AUTHENTICATED")
        self.assert_problem(self.request("GET", "/projects", authenticated=False), 401, "NOT_AUTHENTICATED")
        self.assertEqual(self.request("GET", "/health", authenticated=False)[0], 200)
        self.assertEqual(self.request("GET", "/capabilities")[2], [])

    def test_bootstrap_expiry_replay_no_query_and_revocation(self):
        token = self.sessions.issue(self.alice)
        self.assertEqual(self.request("POST", "/session", {"bootstrap_token": token}, authenticated=False)[0], 201)
        self.assert_problem(self.request("POST", "/session", {"bootstrap_token": token}, authenticated=False), 401, "NOT_AUTHENTICATED")
        self.assert_problem(self.request("POST", "/session?bootstrap_token=must-not-log", {"bootstrap_token": token}, authenticated=False), 422, "VALIDATION_FAILED")
        now = [0.0]
        isolated = Sessions(clock=lambda: now[0], bootstrap_seconds=1, session_seconds=2)
        token = isolated.issue(self.alice)
        now[0] = 2
        with self.assertRaises(Problem):
            isolated.exchange(token)
        token = isolated.issue(self.alice)
        cookie, result = isolated.exchange(token)
        now[0] = 5
        with self.assertRaises(Problem):
            isolated.authenticate(cookie, result["csrf_token"])
        self.assertEqual(self.request("DELETE", "/session")[0], 204)
        self.assert_problem(self.request("GET", "/projects"), 401, "NOT_AUTHENTICATED")

    def test_project_owner_wire_contract_and_private_internal_error(self):
        project = self.project()
        self.assertEqual(project["owner_principal_id"], self.alice.principal_id)
        self.assertEqual(self.request("POST", "/projects", {"name": "Project", "idempotency_key": "service-project-01"})[0], 200)
        self.assert_problem(self.request("GET", "/projects/"+project["project_id"], cookie=self.other_cookie, csrf=self.other_csrf), 404, "NOT_FOUND")
        self.assertEqual(self.request("GET", "/projects", cookie=self.other_cookie)[2], [])
        self.assert_problem(self.request("POST", "/projects", {"name": "X", "idempotency_key": "service-project-02", "owner_principal_id": self.bob.principal_id}), 422, "VALIDATION_FAILED")
        self.assert_problem(self.request("POST", "/projects", b'{"name":"a","name":"b"}', headers={"Content-Type": "application/json"}), 422, "VALIDATION_FAILED")
        def fail(*args):
            raise RuntimeError("secret-token-and-private-host-path")
        self.repo.list_projects = fail
        response = self.request("GET", "/projects")
        self.assert_problem(response, 500, "INTERNAL")
        self.assertNotIn("secret-token", str(response))
        self.assertNotIn(str(self.root), str(response))

    def test_operation_reads_are_authorized_and_open_commands_not_admitted(self):
        project = self.project()
        request = {"action": "VALIDATE_INPUT", "project_id": project["project_id"], "target": {"kind": "PROJECT", "id": project["project_id"], "expected_revision": 1}, "payload": {}, "idempotency_key": "service-command-01"}
        self.assert_problem(self.request("POST", "/projects/"+project["project_id"]+"/validations", request), 503, "ENGINE_UNAVAILABLE")
        operation = Operations(self.repo).accept(self.alice, request)[0]
        response = self.request("GET", "/operations/"+operation["record_id"])
        self.assertEqual(response[0], 200)
        self.assertEqual(response[2], operation)
        self.assert_problem(self.request("GET", "/operations/"+operation["record_id"], cookie=self.other_cookie), 404, "NOT_FOUND")

    def test_artifacts_http_binary_range_integrity_and_cross_owner(self):
        project = self.project()
        data = b"native-output\x00\xff"
        request = {"project_id": project["project_id"], "kind": "siesta.output", "media_type": "application/octet-stream", "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "idempotency_key": "service-upload-01"}
        status, _, upload = self.request("POST", "/artifacts/uploads", request)
        self.assertEqual(status, 201, upload)
        path = "/artifacts/uploads/"+upload["upload_id"]
        self.assert_problem(self.request("PUT", path, data, cookie=self.other_cookie, csrf=self.other_csrf, headers={"Content-Type": "application/octet-stream", "Content-Range": f"bytes 0-{len(data)-1}/{len(data)}"}), 404, "NOT_FOUND")
        self.assertEqual(self.request("PUT", path, data, headers={"Content-Type": "application/octet-stream", "Content-Range": f"bytes 0-{len(data)-1}/{len(data)}"})[0], 200)
        status, _, artifact = self.request("POST", path+"/commit")
        self.assertEqual(status, 200, artifact)
        path = "/artifacts/"+artifact["payload"]["artifact_id"]
        self.assertEqual(self.request("GET", path+"/content")[2], data)
        status, headers, received = self.request("GET", path+"/content", headers={"Range": "bytes=1-4"})
        self.assertEqual((status, received), (206, data[1:5]))
        self.assertEqual(headers["content-range"], f"bytes 1-4/{len(data)}")
        self.assertIn("sha-256=", headers["digest"])
        self.assert_problem(self.request("GET", path+"/content", cookie=self.other_cookie), 404, "NOT_FOUND")
        self.assert_problem(self.request("GET", path+"/content", headers={"Range": "bytes=0-2,5-7"}), 416, "RANGE_NOT_SATISFIABLE")

    def test_run_fixture_replay_isolated_expired_cursor_and_future_event(self):
        project = self.project()
        fixture = next(f for f in resource_json("fixtures/manifest.json")["fixtures"] if f["schema"] == "run-projection.schema.json" and f["expect"] == "valid")
        projection = resource_json(fixture["path"])
        original_refs = copy.deepcopy(projection["payload"]["native_refs"])
        projection["project_id"] = project["project_id"]
        self.readmodels.put(self.alice, "RUN", projection)
        path = "/runs/"+projection["payload"]["run_id"]
        self.assertEqual(self.request("GET", path)[2]["payload"]["native_refs"], original_refs)
        self.assert_problem(self.request("GET", path+"/events?after=unknown:0", cookie=self.other_cookie), 404, "NOT_FOUND")
        self.assert_problem(self.request("GET", path+"/events?after=unknown:0"), 410, "CURSOR_EXPIRED")
        self.assert_problem(self.request("GET", path+"/events?limit=501"), 422, "VALIDATION_FAILED")
        event = {"event_id": identifier(), "stream_id": projection["payload"]["run_id"], "sequence": 43, "occurred_at": projection["created_at"], "recorded_at": projection["created_at"], "type": "vendor.future_event", "schema_version": "0.1.0", "project_id": project["project_id"], "operation_id": None, "run_id": projection["payload"]["run_id"], "attempt_id": "att-older", "payload": {}, "evidence_refs": []}
        self.readmodels.append_event(self.alice, event)
        response = self.request("GET", path+"/events")
        self.assertEqual(response[2]["events"], [event])
        self.assertEqual(self.request("GET", path)[2], projection)  # old callback never replaces projection
        status, headers, data = self.request("GET", path+"/events", headers={"Accept": "text/event-stream"})
        self.assertEqual(status, 200)
        self.assertIn(b"id: run-1:43", data)
        self.assertIn("text/event-stream", headers["content-type"])

    def test_transport_limits_compression_and_websocket_are_closed(self):
        self.assert_problem(self.request("POST", "/projects", b"x", headers={"Content-Encoding": "gzip"}), 422, "VALIDATION_FAILED")
        self.assert_problem(self.request("POST", "/projects", b"x", headers={"Content-Length": str(1024**2+1)}), 413, "PAYLOAD_TOO_LARGE")
        response = self.request("GET", "/health")
        self.assertIn("frame-ancestors 'none'", response[1]["content-security-policy"])
        self.assertEqual(response[1]["cache-control"], "no-store")
        sent = []
        async def app(scope, receive, send):
            self.fail("Unqualified websocket reached the application")
        async def send(message):
            sent.append(message)
        async def receive():
            return {"type": "websocket.connect"}
        scope = {"type": "websocket", "headers": [(b"host", self.settings.host.encode()), (b"origin", b"null")]}
        asyncio.run(SecurityMiddleware(app, self.settings)(scope, receive, send))
        self.assertEqual(sent, [{"type": "websocket.close", "code": 4403}])


if __name__ == "__main__":
    unittest.main()
