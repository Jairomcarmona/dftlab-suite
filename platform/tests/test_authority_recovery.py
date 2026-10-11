"""Retirement CAS, evidence, rollback and retained history; no engines/jobs."""
from dataclasses import asdict, replace
from datetime import timedelta
import hashlib
from pathlib import Path
from types import SimpleNamespace
import unittest

import test_submissions as submissions
import test_terminal_evidence as terminal
from dftlab_platform.artifact_storage import SQLiteArtifactIndex
from dftlab_platform.artifacts import LocalArtifactStore
from dftlab_platform.authority import utcnow
from dftlab_platform.authority_storage import SQLiteAuthorityStore
from dftlab_platform.authority_recovery import RegisteredAuthorityRetirement, SQLiteNativeAuthorityRetirement
from dftlab_platform.contracts import canonical, loads
from dftlab_platform.domain import Problem, identifier, reseal
from dftlab_platform.local_runtime import local_lock, private_directory
from dftlab_platform.terminal_evidence import LocalTerminalSigner


class Retirement(unittest.TestCase):
    def setUp(self):
        self.fixture = submissions.Submissions()
        self.fixture.setUp()
        for name in ("root", "repo", "owner", "other", "project", "ledger"):
            setattr(self, name, getattr(self.fixture, name))
        self.root = self.root.resolve()
        self.fixture.accept()
        self.fixture.process()
        self.intent = next(iter(self.fixture.intents.values()))
        self.run, self.attempt = [self.intent["payload"][key] for key in ("run_id", "attempt_id")]
        self.api = SimpleNamespace(TerminalSchedulerEvidence=terminal.NativeEvidence)
        workflow = SimpleNamespace(workflow_id="fixture-workflow", project_id=self.project)
        run = SimpleNamespace(run_id=self.run, project_id=self.project, workflow_id=workflow.workflow_id, workflow_lock_sha256="1"*64)
        self.api.load_run_lock = lambda path: (SimpleNamespace(content_sha256="2"*64), run)
        self.api.load_workflow_lock = lambda path: (SimpleNamespace(content_sha256="1"*64), workflow)
        self.api.RunInspector = lambda: SimpleNamespace(inspect=lambda root: SimpleNamespace(status="PREPARED_RUN_VERIFIED", run_id=self.run, project_id=self.project))
        self.engines = SimpleNamespace(qraft=self.api, qraft_contracts=lambda: SimpleNamespace(canonical_json=lambda value: canonical(asdict(value)).decode()))
        self.now = utcnow()
        self.signer = LocalTerminalSigner(self.api, "retirement-fixture", b"private-synthetic-key-000000000001", clock=lambda: self.now)
        self.native = self.signer.sign(terminal.NativeEvidence(self.run, "1"*64, "2"*64, terminal.Job("synthetic-1", "synthetic-cluster", "synthetic-user"), "COMPLETED", self.now.isoformat(), (self.now+timedelta(seconds=30)).isoformat(), self.signer.signer_id, "pending", True))
        self.artifacts = LocalArtifactStore(self.root/"artifacts", SQLiteArtifactIndex(self.repo))
        self.proof = self.upload(self.engines.qraft_contracts().canonical_json(self.native).encode())
        self.observations = (self.upload(b"positive same-job terminal context"),)
        self.directory = private_directory(self.root/"original-locks")
        self.guard = self.directory/(hashlib.sha256(canonical([self.project, self.run])).hexdigest()+".lock")
        with local_lock(self.guard):
            pass
        self.authority_store = SQLiteAuthorityStore(self.repo)
        self.record = self.authority_store.create(self.owner, self.project, self.run, self.attempt, identifier(), "synthetic-original-site", self.now-timedelta(seconds=60), self.now-timedelta(seconds=30))
        self.package = self.root/"native-package"
        self.package.mkdir(mode=0o700)
        self.good, self.calls = True, 0
        def verify(root):
            self.assertEqual(root, self.package)
            self.calls += 1
            if not self.good:
                raise Problem("PRECONDITION_FAILED")
        self.registration = RegisteredAuthorityRetirement(self.package, self.intent["payload"]["operation_id"], verify)
        self.port = SQLiteNativeAuthorityRetirement(self.engines, self.repo, self.artifacts, self.ledger, self.directory, self.signer.verify, clock=lambda: self.now)

    def tearDown(self):
        self.fixture.tearDown()

    def upload(self, raw, project=None):
        upload = self.artifacts.stage(self.owner, {"project_id": project or self.project, "kind": "dftlab.native-terminal", "media_type": "application/json", "size_bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "idempotency_key": identifier()})["upload_id"]
        self.artifacts.write(self.owner, upload, 0, len(raw)-1, len(raw), raw)
        payload = self.artifacts.commit(self.owner, upload)["payload"]
        return {key: payload[key] for key in ("artifact_id", "media_type", "sha256")}

    def retire(self):
        return self.port.retire(self.owner, self.registration, self.record, self.native, self.proof, self.observations)

    def untouched(self):
        with self.repo._connection() as db:
            self.assertEqual(loads(db.execute("SELECT document FROM controller_authorities").fetchone()[0]), self.record)
            self.assertEqual(db.execute("SELECT count(*) FROM authority_retirements").fetchone()[0], 0)

    def reject(self, function, *args):
        with self.assertRaises(Problem):
            function(*args)

    def test_atomic_retirement_preserves_original_history_no_automatic_replacement(self):
        retired = self.retire()
        self.assertNotEqual(retired["record_id"], self.record["record_id"])
        self.assertEqual(retired["payload"]["generation"], 1)
        self.assertIsNone(retired["payload"]["lease_expires_at"])
        self.assertEqual(retired["payload"]["termination_evidence"], [self.proof, *self.observations])
        self.assertEqual(retired["payload"]["automatic_takeover"], "DISABLED")
        with self.repo._connection() as db:
            original, current, proof = db.execute("SELECT original_document,retired_document,native_proof FROM authority_retirements").fetchone()
            self.assertEqual(loads(original), self.record)
            self.assertEqual(loads(current), retired)
            self.assertEqual(proof, self.engines.qraft_contracts().canonical_json(self.native))
        self.reject(self.authority_store.create, self.owner, self.project, self.run, identifier(), identifier(), "fixture", self.now, self.now+timedelta(seconds=30))
        self.reject(self.authority_store.renew, self.owner, self.record, self.now, self.now+timedelta(seconds=30))
        self.reject(self.authority_store.publish, self.owner, self.record, lambda: self.now, lambda db: self.fail("old owner published"))

    def test_exact_idempotent_ack_after_expiry_has_no_new_effect(self):
        retired = self.retire()
        calls = self.calls
        self.now += timedelta(seconds=60)
        self.assertEqual(self.retire(), retired)
        self.assertEqual(self.calls, calls)
        self.observations = (self.upload(b"different proof"),)
        self.reject(self.retire)

    def test_active_guard_and_lost_inode_refuse_retirement(self):
        with local_lock(self.guard):
            self.reject(self.retire)
        self.untouched()
        self.guard.unlink()  # owned synthetic fixture only
        with self.assertRaises(FileNotFoundError):
            self.retire()
        self.assertFalse(self.guard.exists())
        self.untouched()

    def test_wrong_native_signature_job_locks_run_and_absence_are_rejected(self):
        original = self.native
        for changed in (replace(original, signature="0"*64), replace(original, run_id=identifier()), replace(original, run_lock_sha256="3"*64), replace(original, job=terminal.Job("other", "synthetic-cluster", "synthetic-user")), replace(original, active_allocation_absent=False)):
            self.native = self.signer.sign(changed) if changed.signature != "0"*64 else changed
            self.proof = self.upload(self.engines.qraft_contracts().canonical_json(self.native).encode())
            self.reject(self.retire)
            self.untouched()
        self.native = original

    def test_expired_future_live_lease_and_readonly_context_failure_reject(self):
        self.good = False
        self.reject(self.retire)
        self.good = True
        self.now += timedelta(seconds=30)
        self.reject(self.retire)
        self.untouched()

    def test_cas_old_generation_owner_and_corrupt_or_foreign_artifacts_refuse(self):
        self.reject(self.port.retire, self.other, self.registration, self.record, self.native, self.proof, self.observations)
        original = self.record
        self.record = loads(canonical(original))
        self.record["payload"]["generation"] = 2
        reseal(self.record)
        self.reject(self.retire)
        self.record = original
        target = self.artifacts._path("blobs", self.proof["artifact_id"])
        target.write_bytes(b"corrupt proof")
        self.reject(self.retire)
        self.untouched()

    def test_expiry_after_sql_write_rolls_back_history_and_current_together(self):
        original = self.registration.verify
        def expire(root):
            original(root)
            if self.calls == 3:
                self.now += timedelta(seconds=31)
        self.registration = replace(self.registration, verify=expire)
        self.reject(self.retire)
        self.untouched()

    def test_retirement_in_recovery_does_not_open_admission(self):
        with self.repo.transaction() as db:
            db.execute("UPDATE instance_recovery SET mode='RECOVERY'")
        self.retire()
        self.reject(self.repo.require_execution_ready)
        with self.repo._connection() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM scheduler_dispatches").fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT count(*) FROM scheduler_rpc_entries").fetchone()[0], 0)

    def test_live_lease_and_future_proof_are_not_retirement_authority(self):
        original = self.record
        self.record = loads(canonical(original))
        self.record["payload"]["lease_expires_at"] = (self.now+timedelta(seconds=30)).isoformat()
        reseal(self.record)
        with self.repo.transaction() as db:
            db.execute("UPDATE controller_authorities SET document=?", (canonical(self.record).decode(),))
        self.reject(self.retire)
        self.untouched()
        with self.repo.transaction() as db:
            db.execute("UPDATE controller_authorities SET document=?", (canonical(original).decode(),))
        self.record = original
        self.native = self.signer.sign(replace(self.native, observed_at=(self.now+timedelta(seconds=1)).isoformat(), expires_at=(self.now+timedelta(seconds=31)).isoformat()))
        self.proof = self.upload(self.engines.qraft_contracts().canonical_json(self.native).encode())
        self.reject(self.retire)
        self.untouched()

    def test_retired_namespace_needs_audit_and_fresh_positive_proof_to_freeze(self):
        from dftlab_platform.contracts import resource_json
        from dftlab_platform.native_checkpoints import LocalNativeQuiescenceSource, NativeCheckpointRegistration
        retired = self.retire()
        native = resource_json("fixtures/native-contract-ref/valid/qraft-workflow-lock.json")
        native.update(contract="siestaflow.run-lock@1.0", artifact=self.proof)
        registration = NativeCheckpointRegistration(self.project, self.run, self.package, native, self.observations, self.registration.verify, lambda root: "opaque-original-cursor")
        source = LocalNativeQuiescenceSource(self.repo, (registration,), self.directory)
        with source.freeze(self.owner, ((self.project, self.run),)) as snapshots:
            self.assertEqual(snapshots[0].cursor, "opaque-original-cursor")
        self.good = False
        with self.assertRaises(Problem), source.freeze(self.owner, ((self.project, self.run),)):
            self.fail("retired record bypassed positive evidence")
        self.good = True
        with self.repo.transaction() as db:
            # Corrupt owned synthetic audit, never remove a real user history.
            db.execute("UPDATE authority_retirements SET retired_document=?", (canonical(self.record).decode(),))
        with self.assertRaises(Problem), source.freeze(self.owner, ((self.project, self.run),)):
            self.fail("corrupt audit authorized freeze")


if __name__ == "__main__":
    unittest.main()
