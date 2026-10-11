"""Registered worker boundaries with fake public motor; no jobs or engines."""
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
from threading import Event
import unittest

from dftlab_platform.authority import LocalAuthorityManager
from dftlab_platform.authority_storage import SQLiteAuthorityStore
from dftlab_platform.domain import Problem, envelope, identifier
from dftlab_platform.native_worker import NativeWorker, RegisteredNativeRun
from dftlab_platform.storage import SQLiteRepository


class Worker(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.package = self.root/"package"
        self.package.mkdir()
        self.repo = SQLiteRepository(self.root/"state.sqlite")
        self.owner = self.repo.ensure_principal("worker-fixture")
        self.project = self.repo.create_project(self.owner, {"name": "Synthetic worker", "idempotency_key": identifier()})[0]["project_id"]
        self.manager = LocalAuthorityManager(SQLiteAuthorityStore(self.repo), self.root/"locks", scope="fixture-local-host")
        with self.repo.transaction() as db:
            db.execute("CREATE TABLE worker_test_publications(run_id TEXT PRIMARY KEY, document TEXT NOT NULL)")
        profile = {"profile_id": "fixture-profile", "revision": 1}
        current = datetime.now(timezone.utc)
        probe = envelope("runtime-probe-receipt", self.project, {"profile": profile, "executable": {"name": "siesta", "version": "5.4.2", "build": "mpi", "sha256": "a"*64},
                         "launcher": {"kind": "openmpi", "mpi": True, "ranks": 4, "threads_per_rank": 1}, "capabilities": [], "storage_checks": [],
                         "observed_at": current.isoformat().replace("+00:00", "Z"), "valid_until": (current+timedelta(minutes=5)).isoformat().replace("+00:00", "Z")})
        self.reg = RegisteredNativeRun(self.package, self.project, identifier(), identifier(), identifier(), profile, "a"*64, "b"*64, "c"*64, probe,
                                       lambda: None, lambda: None)
        self.run_lock = SimpleNamespace(run_id=self.reg.run_id, project_id=self.project, workflow_id=self.reg.workflow_id,
                                        workflow_lock_sha256=self.reg.workflow_digest, execution_profile_sha256=self.reg.profile_digest,
                                        execution_profile_id=profile["profile_id"])
        self.workflow = SimpleNamespace(project_id=self.project, workflow_id=self.reg.workflow_id)
        self.calls, self.controllers, self.published = [], [], []
        self.shutdown_observed = Event()
        self.hook = lambda controller: None
        outer = self
        class Shutdown:
            def request(self, reason):
                outer.calls.append(("shutdown", reason))
                outer.shutdown_observed.set()
        class Controller:
            @staticmethod
            def from_file(path, **kwargs):
                item = Controller()
                item.kwargs, item.result = kwargs, None
                outer.controllers.append(item)
                return item
            def run(self, **kwargs):
                outer.assertTrue(kwargs["install_signal_handlers"])
                callback = self.kwargs["authority_check"]
                for action in ("initialize", "launch_attempt"):
                    outer.assertTrue(callback(SimpleNamespace(action=action, generation=self.kwargs["authority_generation"], runtime_fingerprint="d"*64)))
                outer.hook(self)
                self.result = {"status": "COMPLETED", "node_results": {"single": {"execution_state": "COMPLETED", "technical_validation": "PASS", "scientific_decision": "NOT_ESTABLISHED"}}}
                return SimpleNamespace(value="COMPLETED")
        api = SimpleNamespace(RunInspector=lambda: SimpleNamespace(inspect=lambda root: SimpleNamespace(status="PREPARED_RUN_VERIFIED")),
                              load_run_lock=lambda path: (SimpleNamespace(content_sha256=self.reg.run_digest), self.run_lock),
                              load_workflow_lock=lambda path: (SimpleNamespace(content_sha256=self.reg.workflow_digest), self.workflow),
                              CanonicalController=Controller, ShutdownRequest=Shutdown)
        self.engines = SimpleNamespace(qraft=api, qraft_contracts=lambda: SimpleNamespace(canonical_json=lambda value: json.dumps(value, sort_keys=True)))
        self.worker = NativeWorker(self.engines, self.repo, self.manager)
        self.environment = {"SLURM_JOB_ID": "123", "SLURM_SUBMIT_DIR": str(self.package)}

    def tearDown(self):
        self.temporary.cleanup()

    def publication(self, summary, data):
        self.published.append((summary, json.loads(data)))
        def writer(db):
            db.execute("INSERT INTO worker_test_publications VALUES(?,?)", (summary["run_id"], data.decode()))
        return writer

    def execute(self, registered=None, publication=None):
        return self.worker.run(self.owner, registered or self.reg, environment=self.environment, publication=publication or self.publication)

    def test_installed_public_controller_binding_preserves_all_result_dimensions(self):
        result = self.execute()
        self.assertEqual(result["native_status"], "COMPLETED")
        self.assertEqual(result["scientific_assessment"], "NOT_ESTABLISHED")
        self.assertEqual(self.published[0][1]["node_results"]["single"]["scientific_decision"], "NOT_ESTABLISHED")
        self.assertEqual(self.controllers[0].kwargs["root"], self.package)
        self.assertEqual(self.controllers[0].kwargs["authority_generation"], "1")
        with self.repo._connection() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM worker_test_publications").fetchone()[0], 1)
        # A finished invocation does not establish terminal scheduler evidence.
        with self.assertRaises((OSError, Problem)):
            self.execute()

    def test_second_controller_rejected_while_native_invocation_holds_lock(self):
        def second(controller):
            with self.assertRaises((OSError, Problem)):
                self.execute()
            self.assertEqual(len(self.controllers), 1)
        self.hook = second
        self.execute()

    def test_expired_native_authority_cannot_publish(self):
        def expire(controller):
            controller.kwargs["authority_check"].__self__.deadline = 0
        self.hook = expire
        with self.assertRaises(Problem):
            self.execute()
        with self.repo._connection() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM worker_test_publications").fetchone()[0], 0)
        self.assertIn(("shutdown", "WORKER_FAILED"), self.calls)

    def test_package_native_digest_project_and_allocation_reject_before_controller(self):
        variants = (replace(self.reg, verify_package=lambda: False), replace(self.reg, authorize_allocation=lambda: False),
                    replace(self.reg, run_id=identifier()), replace(self.reg, profile_digest="e"*64), replace(self.reg, workflow_id=identifier()))
        for item in variants:
            with self.subTest(item=item), self.assertRaises(Problem):
                self.execute(item)
        self.environment["PYTHONPATH"] = str(self.root)
        with self.assertRaises(Problem):
            self.execute()
        self.assertEqual(self.controllers, [])

    def test_wrong_project_profile_and_expired_probe_reject_before_controller(self):
        from dftlab_platform.domain import reseal
        from copy import deepcopy
        for field, value in (("project_id", "foreign-project"), ("valid_until", "2000-01-01T00:00:00Z"), ("profile", {"profile_id": "other", "revision": 1})):
            probe = deepcopy(self.reg.probe)
            if field == "project_id":
                probe[field] = value
            else:
                probe["payload"][field] = value
            reseal(probe)
            with self.subTest(field=field), self.assertRaises(Problem):
                self.execute(replace(self.reg, probe=probe))
        self.assertEqual(self.controllers, [])

    def test_heartbeat_loss_requests_shutdown_and_never_commits_publication(self):
        self.worker = NativeWorker(self.engines, self.repo, self.manager, lease_seconds=2, heartbeat_seconds=0.01)
        def fail_renewal(controller):
            def fail(*args):
                raise Problem("PRECONDITION_FAILED")
            self.manager.store.renew = fail
            self.assertTrue(self.shutdown_observed.wait(1))
        self.hook = fail_renewal
        with self.assertRaises(Problem):
            self.execute()
        self.assertIn(("shutdown", "AUTHORITY_LOST"), self.calls)
        with self.repo._connection() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM worker_test_publications").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
