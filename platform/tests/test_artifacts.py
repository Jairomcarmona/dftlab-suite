"""No partial publication, unsafe names, cross-owner reads or silent corruption."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
from pathlib import Path
import tempfile
import unittest

from dftlab_platform.artifacts import LocalArtifactStore
from dftlab_platform.artifact_storage import SQLiteArtifactIndex
from dftlab_platform.contracts import ContractError, Contracts, resource_json
from dftlab_platform.domain import Problem
from dftlab_platform.storage import SQLiteRepository


class Artifacts(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.repo = SQLiteRepository(self.root / "state.sqlite")
        self.alice, self.bob = [self.repo.ensure_principal(name) for name in ("alice", "bob")]
        self.project = self.repo.create_project(self.alice, {"name": "Artifacts", "idempotency_key": "artifact-project-01"})[0]["project_id"]
        self.index = SQLiteArtifactIndex(self.repo)
        self.store = LocalArtifactStore(self.root / "artifacts", self.index)
        self.data = b"scientific-original\x00\x01\xff"

    def tearDown(self):
        self.directory.cleanup()

    def request(self, data=None, key="artifact-upload-01"):
        data = self.data if data is None else data
        return {"project_id": self.project, "kind": "siesta.output", "media_type": "application/octet-stream", "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "idempotency_key": key}

    def upload(self, data=None, key="artifact-upload-01"):
        data = self.data if data is None else data
        upload = self.store.stage(self.alice, self.request(data, key))
        if data:
            self.store.write(self.alice, upload["upload_id"], 0, len(data)-1, len(data), data)
        return upload["upload_id"]

    def problem(self, code, function, *args):
        with self.assertRaises(Problem) as caught:
            function(*args)
        self.assertEqual(caught.exception.code, code)

    def test_roundtrip_schema_stream_range_and_retention(self):
        upload = self.upload()
        record = self.store.commit(self.alice, upload)
        Contracts().validate("artifact-record", record)
        artifact_id = record["payload"]["artifact_id"]
        self.assertEqual(record["payload"]["integrity_state"], "VERIFIED")
        self.assertEqual(b"".join(self.store.stream(self.alice, artifact_id)), self.data)
        self.assertEqual(b"".join(self.store.stream(self.alice, artifact_id, 1, 4)), self.data[1:5])
        self.assertEqual(self.store.commit(self.alice, upload), record)
        self.assertTrue(self.store.verify(self.alice, artifact_id))
        self.assertEqual(self.store.retention(self.alice, artifact_id), {"class": "ESSENTIAL", "delete_allowed": False})
        self.assertNotIn(str(self.root), str(record))
        self.problem("RANGE_NOT_SATISFIABLE", self.store.stream, self.alice, artifact_id, 0, len(self.data))

    def test_empty_artifact_and_wrong_digest_publish_nothing(self):
        empty = self.store.commit(self.alice, self.upload(b"", "empty-artifact-01"))
        self.assertEqual(b"".join(self.store.stream(self.alice, empty["payload"]["artifact_id"])), b"")
        request = self.request(key="wrong-hash-key-01")
        request["sha256"] = "0"*64
        upload = self.store.stage(self.alice, request)["upload_id"]
        self.store.write(self.alice, upload, 0, len(self.data)-1, len(self.data), self.data)
        self.problem("PRECONDITION_FAILED", self.store.commit, self.alice, upload)
        with self.repo._connection() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM artifact_records").fetchone()[0], 1)

    def test_owner_scope_on_every_upload_and_read_operation(self):
        self.problem("NOT_FOUND", self.store.stage, self.bob, self.request())
        upload = self.upload()
        self.problem("NOT_FOUND", self.store.write, self.bob, upload, 0, len(self.data)-1, len(self.data), self.data)
        self.problem("NOT_FOUND", self.store.commit, self.bob, upload)
        record = self.store.commit(self.alice, upload)
        artifact_id = record["payload"]["artifact_id"]
        for function in (self.store.metadata, self.store.stream, self.store.verify, self.store.retention):
            self.problem("NOT_FOUND", function, self.bob, artifact_id)

    def test_lost_chunk_ack_retry_and_uncommitted_tail(self):
        upload = self.store.stage(self.alice, self.request())["upload_id"]
        view = self.store.write(self.alice, upload, 0, 3, len(self.data), self.data[:4])
        self.assertEqual(self.store.write(self.alice, upload, 0, 3, len(self.data), self.data[:4]), view)
        self.problem("RANGE_NOT_SATISFIABLE", self.store.write, self.alice, upload, 0, 3, len(self.data), b"evil")
        # Simulate fsync completed but SQLite transaction was killed/rolled back.
        path = self.store._path("staging", upload)
        with path.open("ab") as stream:
            stream.write(b"uncommitted-crash-tail")
        self.store.write(self.alice, upload, 4, len(self.data)-1, len(self.data), self.data[4:])
        self.assertEqual(path.read_bytes(), self.data)
        self.assertEqual(self.store.commit(self.alice, upload)["payload"]["size_bytes"], len(self.data))

    def test_crash_after_rename_and_before_index_publication_is_recoverable(self):
        upload = self.upload()
        original = self.store._publish_file
        def crash(source, destination):
            original(source, destination)
            raise RuntimeError("process lost after atomic rename")
        self.store._publish_file = crash
        with self.assertRaises(RuntimeError):
            self.store.commit(self.alice, upload)
        with self.repo._connection() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM artifact_records").fetchone()[0], 0)
        restarted = LocalArtifactStore(self.root / "artifacts", SQLiteArtifactIndex(SQLiteRepository(self.repo.path)))
        record = restarted.commit(self.alice, upload)
        self.assertEqual(b"".join(restarted.stream(self.alice, record["payload"]["artifact_id"])), self.data)
        # A second publication crash, after COMMITTED persisted, also repairs.
        another = self.upload(key="publication-key-02")
        original_publish = self.index.publish
        self.index.publish = lambda *args: (_ for _ in ()).throw(RuntimeError("publication lost"))
        with self.assertRaises(RuntimeError):
            self.store.commit(self.alice, another)
        self.index.publish = original_publish
        self.assertTrue(self.store.commit(self.alice, another))

    def test_concurrent_stage_and_commit_are_single_identity(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            ids = list(pool.map(lambda _: self.store.stage(self.alice, self.request())["upload_id"], range(8)))
        self.assertEqual(len(set(ids)), 1)
        upload = self.upload()
        with ThreadPoolExecutor(max_workers=4) as pool:
            records = list(pool.map(lambda _: self.store.commit(self.alice, upload), range(8)))
        self.assertEqual(len({r["record_id"] for r in records}), 1)

    def test_limits_invalid_ranges_and_changed_original(self):
        limited = LocalArtifactStore(self.root / "limited", self.index, max_size=4)
        self.problem("PAYLOAD_TOO_LARGE", limited.stage, self.alice, self.request())
        upload = self.store.stage(self.alice, self.request())["upload_id"]
        self.problem("RANGE_NOT_SATISFIABLE", self.store.write, self.alice, upload, 1, 3, len(self.data), self.data[:3])
        self.problem("PRECONDITION_FAILED", self.store.commit, self.alice, upload)
        self.upload()
        record = self.store.commit(self.alice, upload)
        artifact_id = record["payload"]["artifact_id"]
        self.store._path("blobs", artifact_id).write_bytes(b"changed")
        self.assertFalse(self.store.verify(self.alice, artifact_id))
        self.problem("PRECONDITION_FAILED", self.store.stream, self.alice, artifact_id)

    def test_unsafe_identifiers_and_fixture_paths_are_not_local_paths(self):
        self.problem("NOT_FOUND", self.store.commit, self.alice, "../../escape")
        self.problem("NOT_FOUND", self.store.metadata, self.alice, "C:\\Windows\\secrets")
        manifest = resource_json("fixtures/manifest.json")["fixtures"]
        for fixture in manifest:
            if fixture["schema"] == "artifact-ref.schema.json" and fixture["expect"] == "invalid":
                with self.assertRaises(ContractError):
                    Contracts().validate("artifact-ref", resource_json(fixture["path"]))

    def test_symlink_and_hardlink_cannot_escape_private_store(self):
        upload = self.store.stage(self.alice, self.request())["upload_id"]
        staging = self.store._path("staging", upload)
        staging.unlink()
        outside = self.root / "outside-secret"
        outside.write_bytes(self.data)
        os.link(outside, staging)
        self.problem("PRECONDITION_FAILED", self.store.write, self.alice, upload, 0, len(self.data)-1, len(self.data), self.data)
        self.assertEqual(outside.read_bytes(), self.data)
        staging.unlink()
        try:
            staging.symlink_to(outside)
        except OSError:
            self.skipTest("Creating symlinks requires Windows privilege; hardlink case passed")
        self.problem("PRECONDITION_FAILED", self.store.write, self.alice, upload, 0, len(self.data)-1, len(self.data), self.data)


if __name__ == "__main__":
    unittest.main()
