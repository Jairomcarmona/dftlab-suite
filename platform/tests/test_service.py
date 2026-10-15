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
from dftlab_platform.contracts import Contracts, canonical, resource_json
from dftlab_platform.domain import Operations, Problem, envelope, identifier, reseal
from dftlab_platform.projection_storage import SQLiteReadModels
from dftlab_platform.security import LocalSettings, Sessions, SecurityMiddleware
from dftlab_platform.service import create_app
from dftlab_platform.storage import SQLiteRepository


class PrivateSettings(unittest.TestCase):
    def test_platform_resume_is_private_and_disabled_by_default(self):
        settings = LocalSettings(43210)
        self.assertFalse(settings.platform_resume_enabled)
        with self.assertRaises(ValueError):
            LocalSettings(43210, platform_resume_enabled=1)


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
        request = {"action": "VALIDATE_INPUT", "project_id": project["project_id"], "target": {"kind": "PROJECT", "id": project["project_id"], "expected_revision": 1}, "payload": {"draft": {"draft_id": "draft-fixture", "revision": 1}}, "idempotency_key": "service-command-01"}
        invalid = copy.deepcopy(request);invalid["payload"] = {}
        self.assert_problem(self.request("POST", "/projects/"+project["project_id"]+"/validations", invalid), 422, "VALIDATION_FAILED")
        self.assert_problem(self.request("POST", "/projects/"+project["project_id"]+"/validations", request), 503, "ENGINE_UNAVAILABLE")
        operation = Operations(self.repo).accept(self.alice, request)[0]
        response = self.request("GET", "/operations/"+operation["record_id"])
        self.assertEqual(response[0], 200)
        self.assertEqual(response[2], operation)
        self.assert_problem(self.request("GET", "/operations/"+operation["record_id"], cookie=self.other_cookie), 404, "NOT_FOUND")

    def test_campaign_and_plan_actions_are_http_routes_over_existing_operation_contracts(self):
        project = self.project()
        campaign = {
            "action": "CREATE_CAMPAIGN", "project_id": project["project_id"],
            "target": {"kind": "PROJECT", "id": project["project_id"], "expected_revision": 1},
            "payload": {"name": "Si local", "drafts": [{"draft_id": "draft-fixture", "revision": 1}]},
            "idempotency_key": "campaign-route-key-01",
        }
        wrong_campaign_action = copy.deepcopy(campaign)
        wrong_campaign_action["action"] = "CREATE_PLAN"
        self.assert_problem(self.request("POST", f"/projects/{project['project_id']}/campaigns", wrong_campaign_action), 422, "VALIDATION_FAILED")
        wrong_campaign_target = copy.deepcopy(campaign)
        wrong_campaign_target["target"]["id"] = identifier()
        self.assert_problem(self.request("POST", f"/projects/{project['project_id']}/campaigns", wrong_campaign_target), 422, "VALIDATION_FAILED")
        self.assert_problem(self.request("POST", f"/projects/{project['project_id']}/campaigns", campaign), 503, "ENGINE_UNAVAILABLE")
        plan = {
            "action": "CREATE_PLAN", "project_id": project["project_id"],
            "target": {"kind": "CAMPAIGN", "id": "campaign-fixture", "expected_revision": 1},
            "payload": {"draft": {"draft_id": "draft-fixture", "revision": 1},
                        "intent_id": "intent-fixture", "validation_receipt_id": "receipt-fixture"},
            "idempotency_key": "plan-route-key-0001",
        }
        wrong_plan_action = copy.deepcopy(plan)
        wrong_plan_action["action"] = "CREATE_CAMPAIGN"
        self.assert_problem(self.request("POST", "/campaigns/campaign-fixture/plans", wrong_plan_action), 422, "VALIDATION_FAILED")
        wrong_plan_target = copy.deepcopy(plan)
        wrong_plan_target["target"]["id"] = "campaign-other"
        self.assert_problem(self.request("POST", "/campaigns/campaign-fixture/plans", wrong_plan_target), 422, "VALIDATION_FAILED")
        self.assert_problem(self.request("POST", "/campaigns/campaign-fixture/plans", plan), 404, "NOT_FOUND")
        self.assertEqual(self.request("GET", "/capabilities")[2], [])

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


    def test_session_recovery_same_csrf_deadline_and_fetch_metadata(self):
        first = self.request("GET", "/session", headers={"Sec-Fetch-Site": "same-origin"})
        self.assertEqual(first[0], 200)
        self.assertEqual(first[2]["csrf_token"], self.csrf)
        self.assertEqual(first[2], self.request("GET", "/session")[2])
        self.assertEqual(first[1]["cache-control"], "no-store")
        for site in ("cross-site", "same-site", "none"):
            self.assert_problem(self.request("GET", "/session", headers={"Sec-Fetch-Site": site}), 403, "ORIGIN_REJECTED")
        self.assert_problem(self.request("GET", "/session", headers={"Origin": "null"}), 403, "ORIGIN_REJECTED")
        self.assertEqual(self.request("POST", "/projects", {"name": "Reload", "idempotency_key": "reload-project-key"}, csrf=first[2]["csrf_token"])[0], 201)
        self.assertEqual(self.request("DELETE", "/session")[0], 204)
        self.assert_problem(self.request("GET", "/session"), 401, "NOT_AUTHENTICATED")

    def test_draft_http_contract_retry_conflict_revision_owner(self):
        project = self.project()
        path = "/projects/"+project["project_id"]+"/drafts"
        request = resource_json("fixtures/draft-create-request/valid/promote-structure.json")
        first = self.request("POST", path, request)
        self.assertEqual(first[0], 201, first[2])
        draft = first[2]["draft"]
        self.assertEqual(self.request("POST", path, request)[2], first[2])
        self.assertEqual(self.request("POST", path, request)[0], 200)
        changed = copy.deepcopy(request);changed["title"] = "Other"
        self.assert_problem(self.request("POST", path, changed), 409, "IDEMPOTENCY_KEY_REUSED")
        self.assertEqual(self.request("GET", path)[2], [draft])
        draft_path = "/drafts/"+draft["payload"]["draft_id"]
        self.assertEqual(self.request("GET", draft_path)[2], first[2])
        self.assert_problem(self.request("GET", draft_path, cookie=self.other_cookie, csrf=self.other_csrf), 404, "NOT_FOUND")
        self.assert_problem(self.request("POST", path, request, cookie=self.other_cookie, csrf=self.other_csrf), 404, "NOT_FOUND")
        revision = {"idempotency_key": "service-revision-01", "expected_revision": 1, "changes": {"purpose": "OPERATIONAL"}}
        self.assertEqual(self.request("POST", draft_path+"/revisions", revision)[0], 201)
        self.assertEqual(self.request("POST", draft_path+"/revisions", revision)[0], 200)
        revision["idempotency_key"] = "service-revision-02"
        self.assert_problem(self.request("POST", draft_path+"/revisions", revision), 412, "PRECONDITION_FAILED")
        self.assertEqual(self.request("GET", "/projects/"+project["project_id"])[2], project)


    def test_get_run_revision_tracks_accepted_command_and_preserves_dimensions(self):
        project = self.project()
        projection = resource_json("fixtures/run-projection/valid/completed-not-established.json")
        projection["project_id"] = project["project_id"]
        self.readmodels.put(self.alice, "RUN", projection)
        run_id = projection["payload"]["run_id"]
        request = {"action": "CANCEL_RUN", "project_id": project["project_id"], "target": {"kind": "RUN", "id": run_id, "expected_revision": projection["payload"]["source_revision"]}, "payload": {"reason": "fixture cancellation"}, "idempotency_key": "service-cancel-key"}
        self.repo.accept(self.alice, request)
        status, _, actual = self.request("GET", "/runs/"+run_id)
        self.assertEqual(status, 200, actual)
        self.assertEqual(actual["payload"]["source_revision"], self.readmodels.target(self.alice, "RUN", run_id)["revision"])
        self.assertEqual(actual["payload"]["dimensions"], projection["payload"]["dimensions"])
        self.assertEqual(actual["payload"]["snapshot_cursor"], projection["payload"]["snapshot_cursor"])
        self.assertEqual(self.repo.project(self.alice, project["project_id"]), project)

    def _insert_aggregate(self, kind, document, revision=1):
        self.repo.contracts.validate(kind.lower() if kind in {"CAMPAIGN", "PLAN"} else kind, document)
        resource_id = document["payload"][{"CAMPAIGN": "campaign_id", "PLAN": "plan_id"}[kind]]
        with self.repo.transaction() as db:
            db.execute("INSERT INTO resources VALUES(?,?,?,?,?)", (resource_id, kind, document["project_id"], revision, canonical(document).decode()))
        return resource_id

    def _campaign_document(self, project_id, *, name="Campaign"):
        campaign_id = identifier()
        document = resource_json("fixtures/campaign/valid/one-draft.json")
        document["project_id"] = project_id
        document["record_id"] = campaign_id
        document["payload"].update(campaign_id=campaign_id, name=name, revision=1)
        reseal(document)
        return document

    def test_adr019_reads_have_owner_non_oracle_and_current_products(self):
        project = self.project()
        campaign = self._campaign_document(project["project_id"])
        campaign_id = self._insert_aggregate("CAMPAIGN", campaign)
        plan_id = identifier()
        plan = resource_json("fixtures/plan/valid/locked.json")
        plan["project_id"] = project["project_id"]
        plan["record_id"] = plan_id
        plan["payload"].update(plan_id=plan_id, campaign_id=campaign_id, revision=1)
        native_ref = copy.deepcopy(plan["native_contract_refs"][0])
        reseal(plan)
        self._insert_aggregate("PLAN", plan)
        receipt = resource_json("fixtures/validation-receipt/valid/heuristic-override.json")
        receipt_id = identifier()
        receipt["project_id"] = project["project_id"]
        receipt["record_id"] = receipt_id
        reseal(receipt)
        with self.repo.transaction() as db:
            db.execute("INSERT INTO resources VALUES(?,?,?,?,?)", (receipt_id, "VALIDATION_RECEIPT", project["project_id"], 1, canonical(receipt).decode()))
        projection = resource_json("fixtures/run-projection/valid/completed-not-established.json")
        projection["project_id"] = project["project_id"]
        self.readmodels.put(self.alice, "RUN", projection)
        run_id = projection["payload"]["run_id"]
        operation_request = resource_json("fixtures/operation-request/valid/create-campaign.json")
        operation_request.update(project_id=project["project_id"], idempotency_key="adr019-list-operation")
        operation_request["target"].update(id=project["project_id"], expected_revision=self.repo.project(self.alice, project["project_id"])["revision"])
        operation = self.repo.accept(self.alice, operation_request)[0]
        operation_id = operation["payload"]["operation_id"]

        paths = [
            "/projects/"+project["project_id"]+"/campaigns",
            "/campaigns/"+campaign_id,
            "/campaigns/"+campaign_id+"/plans",
            "/plans/"+plan_id,
            "/projects/"+project["project_id"]+"/runs",
            "/projects/"+project["project_id"]+"/operations",
            "/validation-receipts/"+receipt_id,
        ]
        results = [self.request("GET", path) for path in paths]
        self.assertEqual([result[0] for result in results], [200]*7)
        self.assertEqual(results[0][2]["items"][0]["payload"]["campaign_id"], campaign_id)
        self.assertEqual(results[1][2]["payload"]["campaign_id"], campaign_id)
        self.assertEqual(results[2][2]["items"][0]["payload"]["plan_id"], plan_id)
        self.assertEqual(results[3][2]["payload"]["plan_id"], plan_id)
        self.assertEqual(results[3][2]["native_contract_refs"][0], native_ref)
        self.assertEqual(results[4][2]["items"][0]["payload"]["run_id"], run_id)
        self.assertEqual(results[5][2]["items"][0]["payload"]["operation_id"], operation_id)
        self.assertEqual(results[6][2]["record_id"], receipt_id)

        missing_id = identifier()
        missing_project = identifier()
        missing_paths = [
            "/projects/"+missing_project+"/campaigns",
            "/campaigns/"+missing_id,
            "/campaigns/"+missing_id+"/plans",
            "/plans/"+missing_id,
            "/projects/"+missing_project+"/runs",
            "/projects/"+missing_project+"/operations",
            "/validation-receipts/"+missing_id,
        ]
        for owned_path, absent_path in zip(paths, missing_paths):
            inaccessible = self.request("GET", owned_path, cookie=self.other_cookie, csrf=self.other_csrf)
            absent = self.request("GET", absent_path, cookie=self.other_cookie, csrf=self.other_csrf)
            self.assertEqual(inaccessible[0], 404, (owned_path, inaccessible[2]))
            self.assertEqual(absent[0], 404, (absent_path, absent[2]))
            self.assertEqual({key: value for key, value in inaccessible[2].items() if key != "request_id"},
                             {key: value for key, value in absent[2].items() if key != "request_id"})

    def test_adr019_pagination_is_stable_bounded_and_expires(self):
        project = self.project()
        originals = [self._campaign_document(project["project_id"], name=f"Campaign {index}") for index in range(3)]
        original_ids = [self._insert_aggregate("CAMPAIGN", document) for document in originals]
        base = "/projects/"+project["project_id"]+"/campaigns"
        for limit in (1, 50, 200):
            status, _, response = self.request("GET", base+f"?limit={limit}")
            self.assertEqual(status, 200, response)
            self.assertGreaterEqual(len(response["items"]), min(limit, len(original_ids)))
        for limit in (0, 201):
            self.assert_problem(self.request("GET", base+f"?limit={limit}"), 422, "VALIDATION_FAILED")
        self.assert_problem(self.request("GET", base+"?cursor=malformed"), 422, "VALIDATION_FAILED")

        status, _, page = self.request("GET", base+"?limit=1")
        self.assertEqual(status, 200)
        cursor = page["next_cursor"]
        self.assertIsNotNone(cursor)
        inserted = self._campaign_document(project["project_id"], name="Inserted after first page")
        self._insert_aggregate("CAMPAIGN", inserted)
        collected = [item["payload"]["campaign_id"] for item in page["items"]]
        while cursor is not None:
            status, _, page = self.request("GET", base+"?limit=1&cursor="+cursor)
            self.assertEqual(status, 200, page)
            collected.extend(item["payload"]["campaign_id"] for item in page["items"])
            cursor = page["next_cursor"]
        self.assertEqual(set(collected), set(original_ids))
        self.assertEqual(len(collected), len(set(collected)))
        created = {doc["payload"]["campaign_id"]: doc["created_at"] for doc in originals}
        self.assertEqual(collected, sorted(original_ids, key=lambda item: (created[item], item)))

        self.readmodels.clock = lambda: 1000
        self.readmodels.cursor_seconds = 3
        expired_cursor = self.request("GET", base+"?limit=1")[2]["next_cursor"]
        self.readmodels.clock = lambda: 1003
        self.assert_problem(self.request("GET", base+"?limit=1&cursor="+expired_cursor), 410, "CURSOR_EXPIRED")


if __name__ == "__main__":
    unittest.main()
