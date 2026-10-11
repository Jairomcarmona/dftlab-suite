"""Installed checkpoint qualification, corruption and crash recovery fixtures.

No native engine, scientific job, credentials or scheduler in tests/CI.
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import copy
import hashlib
import os
from pathlib import Path
import sqlite3
import tempfile
from threading import Event
import unittest
from unittest.mock import patch

from dftlab_platform.artifact_storage import SQLiteArtifactIndex
from dftlab_platform.artifacts import LocalArtifactStore
from dftlab_platform.authority_storage import SQLiteAuthorityStore
from dftlab_platform.authority import utcnow
from dftlab_platform.checkpoints import SQLiteCheckpointStore
from dftlab_platform.contracts import canonical, loads, resource_json
from dftlab_platform.domain import Problem, identifier, reseal
from dftlab_platform.storage import SQLiteRepository


class Checkpoints(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.repository = SQLiteRepository(self.root/"live.sqlite")
        self.owner = self.repository.ensure_principal("owner")
        self.project = self.repository.create_project(self.owner, {"name": "Checkpoint", "idempotency_key": "checkpoint-project-01"})[0]["project_id"]
        self.artifacts = LocalArtifactStore(self.root/"artifacts", SQLiteArtifactIndex(self.repository))
        self.store = SQLiteCheckpointStore(self.repository, self.artifacts)
        self.engines = copy.deepcopy(resource_json("fixtures/recovery-checkpoint/valid/sqlite.json")["payload"]["engine_versions"])
        self.engines.append({"engine": "hubbardflow", "distribution": "hubbardflow", "version": "fixture", "commit": None, "distribution_sha256": None})
        self.packet, self.destination = self.root/"packet", self.root/"restored"

    def tearDown(self):
        self.temp.cleanup()

    def upload(self, data=b"scientific-original\x00\xff", key="checkpoint-upload-01", commit=True):
        upload = self.artifacts.stage(self.owner, {"project_id": self.project, "kind": "siesta.output", "media_type": "application/octet-stream", "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "idempotency_key": key})["upload_id"]
        if data:
            self.artifacts.write(self.owner, upload, 0, len(data)-1, len(data), data)
        record = self.artifacts.commit(self.owner, upload) if commit else None
        return upload, record

    def create(self):
        return self.store.create(self.owner, self.project, self.packet, self.engines)

    def restore(self, checkpoint):
        return self.store.restore(self.packet, checkpoint["integrity"]["digest"], self.destination)

    def request(self, action="VALIDATE_INPUT", key="checkpoint-operation-01"):
        revision = self.repository.project(self.owner, self.project)["revision"]
        return {"action": action, "project_id": self.project, "target": {"kind": "PROJECT", "id": self.project, "expected_revision": revision}, "payload": {"draft": {"draft_id": "fixture-draft", "revision": 1}}, "idempotency_key": key}

    def problem(self, function, *args):
        with self.assertRaises(Problem):
            function(*args)

    def test_roundtrip_original_bytes_identity_indexes_and_recovery_mode(self):
        _, record = self.upload()
        op = self.repository.accept(self.owner, self.request())[0]
        self.repository.claim("interrupted-processor")
        checkpoint = self.create()
        self.repository.contracts.validate("recovery-checkpoint", checkpoint)
        restored = self.restore(checkpoint)
        self.assertEqual(restored.repository.ensure_principal("owner"), self.owner)
        self.assertEqual(restored.artifacts.metadata(self.owner, record["payload"]["artifact_id"]), record)
        self.assertEqual(b"".join(restored.artifacts.stream(self.owner, record["payload"]["artifact_id"])), b"scientific-original\x00\xff")
        self.assertEqual(restored.repository.operation(self.owner, op["record_id"])["payload"]["state"], "OUTCOME_UNKNOWN")
        self.assertEqual(restored.repository.restored_checkpoint(), checkpoint)
        self.problem(restored.repository.require_execution_ready)
        self.assertIsNone(restored.repository.claim("new-processor"))
        self.assertTrue((self.destination/"checkpoint"/"checkpoint.json").is_file())
        self.assertEqual(self.repository.operation(self.owner, op["record_id"])["payload"]["state"], "RUNNING")
        self.repository.require_execution_ready()  # original untouched

    def test_open_upload_restores_only_committed_prefix_without_changing_source(self):
        data = b"full-original"
        request = {"project_id": self.project, "kind": "siesta.output", "media_type": "application/octet-stream", "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "idempotency_key": "partial-upload-001"}
        upload = self.artifacts.stage(self.owner, request)["upload_id"]
        self.artifacts.write(self.owner, upload, 0, 3, len(data), data[:4])
        source = self.artifacts._path("staging", upload)
        with source.open("ab") as stream:
            stream.write(b"uncommitted-crash-tail")
        original = source.read_bytes()
        restored = self.restore(self.create())
        self.assertEqual(restored.artifacts._path("staging", upload).read_bytes(), data[:4])
        self.assertEqual(source.read_bytes(), original)
        restored.artifacts.write(self.owner, upload, 4, len(data)-1, len(data), data[4:])
        record = restored.artifacts.commit(self.owner, upload)
        self.assertEqual(b"".join(restored.artifacts.stream(self.owner, record["payload"]["artifact_id"])), data)

    def test_commit_rename_crash_and_unpublished_blob_are_recoverable(self):
        upload, _ = self.upload(commit=False)
        original = self.artifacts._publish_file
        def fail(source, destination):
            original(source, destination)
            raise RuntimeError("killed after rename")
        self.artifacts._publish_file = fail
        with self.assertRaises(RuntimeError):
            self.artifacts.commit(self.owner, upload)
        restored = self.restore(self.create())
        with restored.repository._connection() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM artifact_records").fetchone()[0], 0)
        record = restored.artifacts.commit(self.owner, upload)
        self.assertTrue(restored.artifacts.verify(self.owner, record["payload"]["artifact_id"]))

    def test_snapshot_writer_barrier_preserves_one_sql_and_chunk_revision(self):
        upload, _ = self.upload(b"old", commit=False)
        entered, release, writer_started = Event(), Event(), Event()
        original = self.repository.checkpoint
        def paused(path):
            entered.set()
            if not release.wait(5):
                raise RuntimeError("fixture did not release")
            original(path)
        self.repository.checkpoint = paused
        def writer():
            writer_started.set()
            return self.artifacts.commit(self.owner, upload)
        with ThreadPoolExecutor(max_workers=2) as pool:
            snapshot = pool.submit(self.create)
            self.assertTrue(entered.wait(5))
            changing = pool.submit(writer)
            self.assertTrue(writer_started.wait(5))
            self.assertFalse(changing.done())
            release.set()
            checkpoint = snapshot.result(timeout=10)
            changing.result(timeout=10)
        restored = self.restore(checkpoint)
        with restored.repository._connection() as db:
            self.assertEqual(loads(db.execute("SELECT document FROM uploads").fetchone()[0])["state"], "OPEN")
        self.assertTrue(restored.artifacts.commit(self.owner, upload))

    def test_restore_disables_accept_claim_native_authority_and_rpc_before_reconcile(self):
        # No dispatch/native run yet: snapshot pending submission, not journals.
        plan_id = identifier()
        with self.repository.transaction() as db:
            db.execute("INSERT INTO resources VALUES(?, 'PLAN', ?, 1, NULL)", (plan_id, self.project))
        request = copy.deepcopy(resource_json("fixtures/operation-request/valid/submit-run.json"))
        request["project_id"] = self.project
        request["target"] = {"kind": "PLAN", "id": plan_id, "expected_revision": 1}
        operation = self.repository.accept(self.owner, request)[0]
        restored = self.restore(self.create())
        self.assertIsNone(restored.repository.claim("must-not-submit"))
        retry, created = restored.repository.accept(self.owner, request)
        self.assertFalse(created)  # read-only acknowledgement remains possible
        self.assertEqual(retry, operation)
        request["idempotency_key"] = "new-restored-submit-key"
        request["target"]["expected_revision"] = 2
        self.problem(restored.repository.accept, self.owner, request)
        from datetime import timedelta
        authority = SQLiteAuthorityStore(restored.repository)
        self.problem(authority.create, self.owner, self.project, "native-run", "attempt", "instance", "local", utcnow(), utcnow()+timedelta(seconds=30))
        # Even an already claimed old worker cannot cross the intent/RPC guard.
        from dftlab_platform.submission_storage import SQLiteSubmissionLedger
        ledger = SQLiteSubmissionLedger(restored.repository)
        self.problem(ledger.enter_rpc, {}, "old-worker")
        self.problem(restored.repository.persist_effect_intent, operation["record_id"], 2, "old-worker", {})

    def test_corrupt_original_and_orphan_fail_without_ready_checkpoint(self):
        _, record = self.upload()
        path = self.artifacts._path("blobs", record["payload"]["artifact_id"])
        original = path.read_bytes()
        path.write_bytes(b"corrupt")
        self.problem(self.create)
        self.assertFalse((self.packet/"checkpoint.json").exists())
        path.write_bytes(original)
        self.packet = self.root/"orphan-packet"
        orphan = self.artifacts.root/"blobs"/identifier()
        orphan.write_bytes(b"unindexed-original")
        self.problem(self.create)
        self.assertEqual(orphan.read_bytes(), b"unindexed-original")
        self.assertFalse(self.packet.exists())

    def test_packet_tamper_wrong_trusted_digest_and_no_overwrite(self):
        _, record = self.upload()
        checkpoint = self.create()
        self.problem(self.store.restore, self.packet, "0"*64, self.destination)
        self.assertFalse(self.destination.exists())
        path = self.packet/"files"/"blobs"/record["payload"]["artifact_id"]
        original = path.read_bytes()
        path.write_bytes(b"tampered")
        self.problem(self.restore, checkpoint)
        self.assertFalse(self.destination.exists())
        path.write_bytes(original)
        self.destination.mkdir()
        user_file = self.destination/"precious.dat"
        user_file.write_bytes(b"preserve")
        self.problem(self.restore, checkpoint)
        self.problem(self.create)
        self.assertEqual(user_file.read_bytes(), b"preserve")

    def test_foreign_owner_native_runs_missing_engine_and_bounds_are_not_omitted(self):
        owner = self.repository.ensure_principal("other")
        self.repository.create_project(owner, {"name": "Private", "idempotency_key": "foreign-project-key"})
        self.problem(self.create)
        self.assertFalse(self.packet.exists())
        # Independent instances exercise refusals before allocating a packet.
        for kind in ("native", "engines", "bounds"):
            root = self.root/kind
            root.mkdir()
            repo = SQLiteRepository(root/"state.sqlite")
            principal = repo.ensure_principal("owner")
            project = repo.create_project(principal, {"name": kind, "idempotency_key": "local-project-key"})[0]["project_id"]
            artifacts = LocalArtifactStore(root/"artifacts", SQLiteArtifactIndex(repo))
            store = SQLiteCheckpointStore(repo, artifacts, max_bytes=1 if kind == "bounds" else 4*1024**3)
            if kind == "native":
                with repo.transaction() as db:
                    db.execute("INSERT INTO resources VALUES(?, 'RUN', ?, 1, NULL)", (identifier(), project))
            self.problem(store.create, principal, project, root/"packet", self.engines[:1] if kind == "engines" else self.engines)
            self.assertFalse((root/"packet"/"checkpoint.json").exists())

    def test_hardlink_packet_and_path_escape_rejected(self):
        _, record = self.upload()
        checkpoint = self.create()
        source = self.packet/"files"/"blobs"/record["payload"]["artifact_id"]
        os.link(source, self.root/"linked-output")
        self.problem(self.restore, checkpoint)
        self.assertFalse(self.destination.exists())
        self.problem(self.store.restore, self.packet, checkpoint["integrity"]["digest"], self.packet/"inside")

    def test_copy_failure_keeps_restored_gate_closed_and_originals_intact(self):
        _, record = self.upload()
        checkpoint = self.create()
        from dftlab_platform.checkpoints import copy_original
        def fail(source, destination, size, expected=None):
            if destination.parent.name == "blobs":
                raise OSError("injected disk failure")
            return copy_original(source, destination, size, expected)
        with patch("dftlab_platform.checkpoints.copy_original", fail), self.assertRaises(OSError):
            self.restore(checkpoint)
        partial = SQLiteRepository(self.destination/"state.sqlite")
        self.problem(partial.require_execution_ready)
        self.assertEqual(partial.restored_checkpoint(), checkpoint)
        self.assertFalse((self.destination/"checkpoint"/"checkpoint.json").exists())
        self.assertTrue(self.artifacts.verify(self.owner, record["payload"]["artifact_id"]))


if __name__ == "__main__":
    unittest.main()
