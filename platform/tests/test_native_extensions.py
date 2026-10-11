"""Trusted public registration stays bound to the original lock; no motors."""
from dataclasses import replace
from types import SimpleNamespace
import unittest

import test_engines as authoring_fixtures
import test_native_worker as worker_fixtures
from dftlab_platform.domain import Problem
from dftlab_platform.native_worker import RegisteredNativeExtensions


class NativeExtensions(unittest.TestCase):
    def setUp(self):
        self.fixture = worker_fixtures.Worker()
        self.fixture.setUp()
        self.fixture.workflow.tasks = (SimpleNamespace(task_id="hubbard", capability_id="dftlab.engine.hubbardflow.hf1"),)
        self.registration_calls = []
        self.extension = RegisteredNativeExtensions(self.fixture.reg.workflow_digest, (("hubbard", "dftlab.engine.hubbardflow.hf1"),), self.registration_calls.append, lambda: None)

    def tearDown(self):
        self.fixture.tearDown()

    def execute(self, extension=None):
        f = self.fixture
        return f.worker.run(f.owner, f.reg, environment=f.environment, publication=f.publication, extensions=extension or self.extension)

    def test_original_binding_reaches_public_controller_without_claiming_science(self):
        result = self.execute()
        args = self.fixture.controllers[0].kwargs
        self.assertIs(args["register_capabilities"], self.extension.register)
        self.assertEqual(args["capability_bindings"], {"hubbard": "dftlab.engine.hubbardflow.hf1"})
        self.assertEqual(result["scientific_assessment"], "NOT_ESTABLISHED")
        self.assertEqual(args["authority_generation"], "1")
        self.assertEqual(self.registration_calls, [])  # registry belongs to native controller

    def test_unknown_reassigned_duplicate_and_mutable_bindings_rejected_before_authority(self):
        variants = (replace(self.extension, workflow_digest="f"*64),
                    replace(self.extension, bindings=(("hubbard", "generic.command"),)),
                    replace(self.extension, bindings=(("missing", "dftlab.engine.hubbardflow.hf1"),)),
                    replace(self.extension, bindings=self.extension.bindings*2),
                    replace(self.extension, bindings=list(self.extension.bindings)),
                    replace(self.extension, bindings=(["hubbard", "dftlab.engine.hubbardflow.hf1"],)),
                    replace(self.extension, bindings=()),
                    replace(self.extension, register=None), replace(self.extension, verify=lambda: True))
        for item in variants:
            with self.subTest(item=item), self.assertRaises(Problem):
                self.execute(item)
        self.assertEqual(self.fixture.controllers, [])
        with self.fixture.repo._connection() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM controller_authorities").fetchone()[0], 0)

    def test_registered_source_rechecked_under_original_guard_before_controller(self):
        calls = []
        def verify():
            calls.append(1)
            return None if len(calls) == 1 else False
        with self.assertRaises(Problem):
            self.execute(replace(self.extension, verify=verify))
        self.assertEqual(len(calls), 2)
        self.assertEqual(self.fixture.controllers, [])
        self.assertEqual(self.fixture.published, [])

    def test_changed_installed_source_after_native_result_prevents_publication(self):
        source = [True]
        self.fixture.hook = lambda controller: source.__setitem__(0, False)
        with self.assertRaises(Problem):
            self.execute(replace(self.extension, verify=lambda: None if source[0] else False))
        self.assertEqual(len(self.fixture.controllers), 1)
        self.assertEqual(self.fixture.published, [])
        with self.fixture.repo._connection() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM worker_test_publications").fetchone()[0], 0)

    def test_no_discovery_registration_on_existing_worker_path(self):
        self.fixture.execute()
        args = self.fixture.controllers[0].kwargs
        self.assertNotIn("register_capabilities", args)
        self.assertNotIn("capability_bindings", args)


class PreparationExtensions(unittest.TestCase):
    def setUp(self):
        self.fixture = authoring_fixtures.Engines()
        self.fixture.setUp()
        self.adapter, self.intent, self.policy, _ = self.fixture.authoring()
        self.plan = self.adapter.compile(self.intent, self.policy, [], source_root=self.fixture.root, lock_path=self.fixture.root/"workflow.lock.json")
        original = self.adapter.engines.qraft.load_workflow_lock
        def load(path):
            envelope, workflow = original(path)
            workflow.tasks = (SimpleNamespace(capability_id="dftlab.engine.hubbardflow.hf1"),)
            return envelope, workflow
        self.adapter.engines.qraft.load_workflow_lock = load
        self.arguments = []
        original_preparer = self.adapter.engines.qraft.RunPreparer
        def prepare(**kwargs):
            self.arguments.append(kwargs)
            return original_preparer()
        self.adapter.engines.qraft.RunPreparer = prepare

    def tearDown(self):
        self.fixture.tearDown()

    def prepare(self, adapters):
        return self.adapter.prepare(self.plan, expected_native_digest=self.plan.native_digest, profile=self.fixture.root/"profile.json", output_root=self.fixture.root/"package", run_id="fixture-run", task_adapters=adapters)

    def test_explicit_installed_adapter_forwarded_only_for_declared_capability(self):
        adapter = lambda task, **kwargs: None
        original = {"dftlab.engine.hubbardflow.hf1": adapter}
        result, _ = self.prepare(original)
        self.assertIsNot(self.arguments[0]["task_adapters"], original)
        self.assertIs(self.arguments[0]["task_adapters"]["dftlab.engine.hubbardflow.hf1"], adapter)
        self.assertFalse(result.submission_performed)
        self.assertFalse(result.execution_authorized)

    def test_unknown_empty_client_payload_and_uncallable_adapter_rejected(self):
        for value in ({}, {"wrong.capability": lambda: None}, {"dftlab.engine.hubbardflow.hf1": "client-code"}, ["entrypoint"]):
            with self.subTest(value=value), self.assertRaises(Problem):
                self.prepare(value)
        self.assertEqual(self.arguments, [])

    def test_no_adapter_discovery_on_existing_prepare_path(self):
        self.prepare(None)
        self.assertEqual(self.arguments, [{}])
