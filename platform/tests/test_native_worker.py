"""Registered worker boundaries with fake public motor; no jobs or engines."""
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
from threading import Event
import unittest

from dftlab_platform.authority import LocalAuthorityManager
from dftlab_platform.authority_storage import SQLiteAuthorityStore
from dftlab_platform.domain import Problem, envelope, identifier
from dftlab_platform.native_worker import NativeWorker, RegisteredNativeExtensions, RegisteredNativeRun
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
        self.workflow = SimpleNamespace(project_id=self.project, workflow_id=self.reg.workflow_id, tasks=())
        self.calls, self.controllers, self.published = [], [], []
        self.shutdown_observed = Event()
        self.hook = lambda controller: None
        self.result_override = None
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
                self.result = outer.result_override or {"status": "COMPLETED", "node_results": {"single": {"execution_state": "COMPLETED", "technical_validation": "PASS", "scientific_decision": "NOT_ESTABLISHED"}}}
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

    def test_worker_passes_registered_generation_to_authority_and_qraft(self):
        captured = []
        outer = self

        class Authority:
            record = {"payload": {"generation": 2}}

            @staticmethod
            def authority_check(event):
                return True

            @staticmethod
            def renew(seconds):
                return None

            @staticmethod
            def publish(writer):
                with outer.repo.transaction() as db:
                    return writer(db)

        class Manager:
            @contextmanager
            def controller(_self, owner, project, run, attempt, *, generation, seconds):
                captured.append((owner, project, run, attempt, generation, seconds))
                yield Authority()

        worker = NativeWorker(self.engines, self.repo, Manager())
        result = worker.run(
            self.owner, replace(self.reg, generation=2), environment=self.environment,
            publication=self.publication,
        )
        self.assertEqual(result["native_status"], "COMPLETED")
        self.assertEqual(captured[0][4], 2)
        self.assertEqual(self.controllers[0].kwargs["authority_generation"], "2")

    def test_qraft_resume_refusal_requires_exact_public_attempt_identity_and_reason(self):
        capability = "dftlab.engine.hubbardflow.hf1"
        bindings = (("hf1-lru", capability),)
        registered = replace(self.reg, generation=2)
        refusal = SimpleNamespace(
            node_id="hf1-lru",
            attempt_id="attempt-0002",
            exit_code=75,
            result=SimpleNamespace(
                execution_state="BLOCKED",
                technical_validation=SimpleNamespace(
                    status="BLOCKED", classification="RESUME_INPUTS_CHANGED",
                ),
            ),
        )
        result = SimpleNamespace(attempts={"hf1-lru": refusal})
        verdict = NativeWorker._controller_resume_verdict(result, bindings, registered, "d" * 64)
        self.assertEqual(verdict, {
            "run_id": self.reg.run_id,
            "generation": 2,
            "attempt_id": "attempt-0002",
            "decision": "REFUSE",
            "reason": "RESUME_INPUTS_CHANGED",
            "result_sha256": "d" * 64,
        })

        refusal.result.technical_validation.classification = "GENERIC_BLOCKED"
        self.assertIsNone(NativeWorker._controller_resume_verdict(result, bindings, registered, "d" * 64))
        refusal.result.technical_validation.classification = "RESUME_INPUTS_CHANGED"
        refusal.attempt_id = "attempt-0001"
        self.assertIsNone(NativeWorker._controller_resume_verdict(result, bindings, registered, "d" * 64))

    def test_worker_persists_classified_controller_result_with_native_result_hash(self):
        capability = "dftlab.engine.hubbardflow.hf1"
        task_id = "hf1-lru"
        self.workflow.tasks = (SimpleNamespace(task_id=task_id, capability_id=capability),)
        self.worker = NativeWorker(self.engines, self.repo, self.manager,
                                  native_extension_capabilities=(capability,))
        self.result_override = SimpleNamespace(attempts={task_id: SimpleNamespace(
            node_id=task_id,
            attempt_id="attempt-0001",
            exit_code=0,
            result=SimpleNamespace(execution_state="COMPLETED", technical_validation=SimpleNamespace(
                status="PASS", classification="CONTROLLER_CONTINUATION",
            )),
        )})
        native_bytes = b'{"public":"qraft-result"}'
        self.engines.qraft_contracts = lambda: SimpleNamespace(
            canonical_json=lambda _value: native_bytes.decode("utf-8"),
        )
        extensions = RegisteredNativeExtensions(
            self.reg.workflow_digest, ((task_id, capability),), lambda _registry: None, lambda: None,
        )
        self.worker.run(
            self.owner, self.reg, environment=self.environment,
            publication=self.publication, extensions=extensions,
        )
        with self.repo._connection() as db:
            row = db.execute(
                "SELECT attempt_id,decision,reason,result_sha256 FROM controller_resume_verdicts "
                "WHERE run_id=? AND generation=1",
                (self.reg.run_id,),
            ).fetchone()
        self.assertEqual(row, (
            "attempt-0001", "NO_REFUSAL", None,
            hashlib.sha256(native_bytes).hexdigest(),
        ))

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

    def test_operator_factory_registers_exact_lock_bound_extension_before_controller(self):
        capability = "dftlab.engine.hubbardflow.hf1"
        self.workflow.tasks = (SimpleNamespace(task_id="hf1-lru", capability_id=capability),)
        calls = []
        register = lambda registry: calls.append(("register", registry))
        verify = lambda: None
        def factory(*, registered, root, workflow_digest, bindings):
            calls.append((registered.run_id, root, workflow_digest, bindings))
            return RegisteredNativeExtensions(workflow_digest, bindings, register, verify)
        self.worker = NativeWorker(self.engines, self.repo, self.manager,
                                  native_extension_capabilities=(capability,),
                                  native_extensions_factory=factory)
        self.execute()
        self.assertEqual(calls[0], (self.reg.run_id, self.package, self.reg.workflow_digest,
                                    (("hf1-lru", capability),)))
        self.assertIs(self.controllers[0].kwargs["register_capabilities"], register)
        self.assertEqual(self.controllers[0].kwargs["capability_bindings"], {"hf1-lru": capability})

    def test_lock_bound_extension_is_required_and_extra_bindings_rejected(self):
        capability = "dftlab.engine.hubbardflow.hf1"
        self.workflow.tasks = (SimpleNamespace(task_id="hf1-lru", capability_id=capability),)
        self.worker = NativeWorker(self.engines, self.repo, self.manager,
                                  native_extension_capabilities=(capability,))
        with self.assertRaises(Problem):
            self.execute()
        self.assertEqual(self.controllers, [])


if __name__ == "__main__":
    unittest.main()
