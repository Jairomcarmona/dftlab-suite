"""Native packet invariants using synthetic files, never engines or jobs."""
from dataclasses import replace
from datetime import timedelta
import hashlib
import os
from pathlib import Path
from unittest.mock import patch
import unittest

import test_checkpoints as fixture
from dftlab_platform.authority import utcnow
from dftlab_platform.authority_storage import SQLiteAuthorityStore
from dftlab_platform.checkpoints import SQLiteCheckpointStore, file_hash
from dftlab_platform.contracts import canonical, loads, resource_json
from dftlab_platform.domain import Problem, identifier
from dftlab_platform.local_runtime import local_lock, private_directory
from dftlab_platform.native_checkpoints import LocalNativeQuiescenceSource, NativeCheckpointRegistration, inventory_native, relative_native_path


class NativeCheckpoints(unittest.TestCase):
    def setUp(self):
        self.case = fixture.Checkpoints()
        self.case.setUp()
        for name in ("root", "repository", "owner", "project", "artifacts", "engines", "packet", "destination"):
            setattr(self, name, getattr(self.case, name))
        self.run = identifier()
        self.package = self.root/"original-native"
        self.package.mkdir(mode=0o700)
        (self.package/"empty").mkdir()
        (self.package/"evidence").mkdir()
        (self.package/"run.lock.json").write_bytes(b"native run bytes; no platform digest substituted")
        (self.package/"evidence"/"events.jsonl").write_bytes(b'{"event_id":"native-opaque-id"}\n')
        (self.package/"evidence"/"events.stream.json").write_bytes(b'original stream identity')
        (self.package/"Si.DM").write_bytes(b"original-density-matrix\x00\xff")
        _, record = self.case.upload((self.package/"run.lock.json").read_bytes(), "native-original-lock-01")
        _, evidence = self.case.upload(b"positive terminal observation", "native-positive-proof-01")
        ref = lambda value: {key: value["payload"][key] for key in ("artifact_id", "sha256", "media_type")}
        self.native = resource_json("fixtures/native-contract-ref/valid/qraft-workflow-lock.json")
        self.native.update(contract="siestaflow.run-lock@1.0", artifact=ref(record))
        self.engines[0].update(**{key: self.native[key] for key in ("engine", "distribution", "version", "commit")})
        self.lock_dir = private_directory(self.root/"authority-locks")
        self.guard = self.lock_dir/(hashlib.sha256(canonical([self.project, self.run])).hexdigest()+".lock")
        with local_lock(self.guard):
            pass
        self.authorities = SQLiteAuthorityStore(self.repository)
        observed = utcnow()-timedelta(seconds=60)
        self.authority = self.authorities.create(self.owner, self.project, self.run, identifier(), identifier(), "fixture", observed, observed+timedelta(seconds=1))
        self.cursor = "opaque-native-cursor-unchanged"
        self.good = True
        self.verifications = []
        def verify(root):
            if not self.good or (root/"evidence"/"events.jsonl").read_bytes()[-1:] != b"\n":
                raise Problem("PRECONDITION_FAILED")
        self.registered = NativeCheckpointRegistration(self.project, self.run, self.package, self.native, (ref(evidence),), verify, lambda root: self.cursor)
        def restore_verify(owner, item, root, store):
            self.assertEqual(owner, self.owner)
            self.assertEqual(item["native"], self.native)
            self.assertEqual(item["cursor"], self.cursor)
            self.assertTrue(store.verify(owner, self.native["artifact"]["artifact_id"]))
            self.verifications.append(root)
        self.verifier = restore_verify
        self.configure()

    def tearDown(self):
        self.case.tearDown()

    def configure(self, registration=None):
        source = LocalNativeQuiescenceSource(self.repository, (registration or self.registered,), self.lock_dir)
        self.adapter = SQLiteCheckpointStore(self.repository, self.artifacts, native_source=source, native_verifier=self.verifier)

    def create(self):
        return self.adapter.create(self.owner, self.project, self.packet, self.engines)

    def restore(self, checkpoint):
        return self.adapter.restore(self.packet, checkpoint["integrity"]["digest"], self.destination)

    def reject(self, function, *args):
        with self.assertRaises(Problem):
            function(*args)

    def test_roundtrip_preserves_all_bytes_ids_empty_directories_cursor_and_closed_gate(self):
        original = inventory_native(self.package, 4096, 1024**2)
        checkpoint = self.create()
        self.assertEqual(checkpoint["payload"]["journal_cursors"], [{"run_id": self.run, "native": self.native, "cursor": self.cursor}])
        restored = self.restore(checkpoint)
        root = self.destination/"native"/self.run
        self.assertEqual(inventory_native(root, 4096, 1024**2), original)
        self.assertEqual(inventory_native(self.package, 4096, 1024**2), original)
        self.assertEqual(self.verifications, [root])
        self.reject(restored.repository.require_execution_ready)
        with restored.repository._connection() as db:
            self.assertEqual(db.execute("SELECT document FROM controller_authorities").fetchone()[0], canonical(self.authority).decode())

    def test_active_controller_and_lost_guard_rejected_without_new_inode(self):
        with local_lock(self.guard):
            self.reject(self.create)
        self.assertFalse(self.packet.exists())
        self.guard.unlink()  # owned synthetic fixture only
        with self.assertRaises((Problem, FileNotFoundError)):
            self.create()
        self.assertFalse(self.guard.exists())
        self.assertFalse(self.packet.exists())

    def test_expired_lease_is_insufficient_without_positive_proof_and_complete_journal(self):
        self.good = False
        self.reject(self.create)
        self.good = True
        (self.package/"evidence"/"events.jsonl").write_bytes(b"partial record")
        self.reject(self.create)
        self.assertFalse(self.packet.exists())

    def test_unregistered_run_and_foreign_or_missing_evidence_not_omitted(self):
        with self.repository.transaction() as db:
            db.execute("INSERT INTO resources VALUES(?, 'RUN', ?, 1, NULL)", (identifier(), self.project))
        self.reject(self.create)
        self.assertFalse(self.packet.exists())

    def test_corrupt_native_file_extra_file_and_required_restore_verifier(self):
        checkpoint = self.create()
        clean = self.adapter.native_verifier
        self.adapter.native_verifier = None
        self.reject(self.restore, checkpoint)
        self.assertFalse(self.destination.exists())
        self.adapter.native_verifier = clean
        target = self.packet/"native"/self.run/"Si.DM"
        original = target.read_bytes()
        target.write_bytes(b"different density")
        self.reject(self.restore, checkpoint)
        target.write_bytes(original)
        (target.parent/"undeclared.dat").write_bytes(b"cannot omit")
        self.reject(self.restore, checkpoint)
        self.assertFalse(self.destination.exists())

    def test_cursor_rotation_and_source_mutation_refuse_ready_publication(self):
        original = self.repository.checkpoint
        def rotating(path):
            original(path)
            self.cursor = "different-original-stream-cursor"
        self.repository.checkpoint = rotating
        self.reject(self.create)
        self.assertFalse((self.packet/"checkpoint.json").exists())

    def test_restore_verifier_failure_keeps_durable_recovery_and_no_ready_marker(self):
        checkpoint = self.create()
        def fail(*args):
            raise Problem("PRECONDITION_FAILED")
        self.adapter.native_verifier = fail
        self.reject(self.restore, checkpoint)
        from dftlab_platform.storage import SQLiteRepository
        self.reject(SQLiteRepository(self.destination/"state.sqlite").require_execution_ready)
        self.assertFalse((self.destination/"checkpoint"/"checkpoint.json").exists())
        self.assertEqual((self.package/"Si.DM").read_bytes(), b"original-density-matrix\x00\xff")

    def test_missing_evidence_hardlinks_and_nonportable_paths_refused(self):
        self.configure(replace(self.registered, quiescence_evidence=()))
        self.reject(self.create)
        self.configure()
        os.link(self.package/"Si.DM", self.root/"linked-fixture")
        self.reject(self.create)
        self.assertFalse((self.packet/"checkpoint.json").exists())
        for value in ("../escape", "/abs", "a\\b", "a/./b", "a//b", "C:stream", "a/../b"):
            self.reject(relative_native_path, value)

    def test_bound_budget_and_fifo_cannot_block_copy(self):
        self.adapter.max_files = 3
        self.reject(self.create)
        self.assertFalse((self.packet/"checkpoint.json").exists())
        if os.name != "nt":
            fifo = self.root/"fixture-pipe"
            os.mkfifo(fifo)
            self.reject(file_hash, fifo, 1024)

    def test_source_changes_during_copy_are_not_published_ready(self):
        from dftlab_platform.checkpoints import copy_original
        def changed(source, target, size, expected=None):
            result = copy_original(source, target, size, expected)
            if target.name == "Si.DM":
                (self.package/"late-native-output.dat").write_bytes(b"late original")
            return result
        with patch("dftlab_platform.checkpoints.copy_original", changed):
            self.reject(self.create)
        self.assertFalse((self.packet/"checkpoint.json").exists())
        self.assertTrue((self.package/"late-native-output.dat").exists())

    def test_live_lease_foreign_evidence_and_pin_mismatch_fail_closed(self):
        from dftlab_platform.domain import reseal
        from dftlab_platform.authority import stamp
        changed = loads(canonical(self.authority))
        changed["payload"]["lease_expires_at"] = stamp(utcnow()+timedelta(seconds=60))
        reseal(changed)
        with self.repository.transaction() as db:
            db.execute("UPDATE controller_authorities SET document=?", (canonical(changed).decode(),))
        self.reject(self.create)
        with self.repository.transaction() as db:
            db.execute("UPDATE controller_authorities SET document=?", (canonical(self.authority).decode(),))
        foreign = self.repository.create_project(self.owner, {"name": "other", "idempotency_key": "native-other-project"})[0]["project_id"]
        data = b"other-project observation"
        upload = self.artifacts.stage(self.owner, {"project_id": foreign, "kind": "dftlab.observation", "media_type": "application/json", "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "idempotency_key": "native-foreign-proof"})["upload_id"]
        self.artifacts.write(self.owner, upload, 0, len(data)-1, len(data), data)
        record = self.artifacts.commit(self.owner, upload)
        self.configure(replace(self.registered, quiescence_evidence=({key: record["payload"][key] for key in ("artifact_id", "sha256", "media_type")},)))
        self.reject(self.create)
        self.assertFalse((self.packet/"checkpoint.json").exists())
        self.packet = self.root/"mismatched-pins"
        self.configure()
        self.engines[0]["commit"] = "0"*40
        self.reject(self.create)
        self.assertFalse((self.packet/"checkpoint.json").exists())


if __name__ == "__main__":
    unittest.main()
