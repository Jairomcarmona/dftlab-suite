"""Draft history, owner isolation and retry/CAS against installed contracts."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import copy
import hashlib
import tempfile
import unittest

from dftlab_platform.artifact_storage import SQLiteArtifactIndex
from dftlab_platform.artifacts import LocalArtifactStore
from dftlab_platform.contracts import resource_json
from dftlab_platform.domain import Problem
from dftlab_platform.draft_storage import SQLiteDraftRepository
from dftlab_platform.storage import SQLiteRepository


class Drafts(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        self.repo = SQLiteRepository(root / "state.sqlite")
        self.alice, self.bob = [self.repo.ensure_principal(n) for n in ("alice", "bob")]
        self.project = self.repo.create_project(self.alice, {"name": "Drafts", "idempotency_key": "draft-project-key"})[0]
        self.store = LocalArtifactStore(root / "artifacts", SQLiteArtifactIndex(self.repo))
        self.drafts = SQLiteDraftRepository(self.repo, self.store)
        self.request = resource_json("fixtures/draft-create-request/valid/promote-template.json")

    def tearDown(self):
        self.directory.cleanup()

    def problem(self, code, call, *args):
        with self.assertRaises(Problem) as caught:
            call(*args)
        self.assertEqual(caught.exception.code, code)

    def test_atomic_concurrent_retry_owner_project_and_immutable_history(self):
        project = self.project["project_id"]
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.drafts.create(self.alice, project, self.request), range(8)))
        self.assertEqual(sum(created for _, created in results), 1)
        bundle = results[0][0]
        self.assertTrue(all(value == bundle for value, _ in results))
        draft_id = bundle["draft"]["payload"]["draft_id"]
        self.problem("NOT_FOUND", self.drafts.get, self.bob, draft_id)
        self.problem("NOT_FOUND", self.drafts.list, self.bob, project)
        changed = copy.deepcopy(self.request);changed["title"] = "changed"
        self.problem("IDEMPOTENCY_KEY_REUSED", self.drafts.create, self.alice, project, changed)
        other = self.repo.create_project(self.alice, {"name": "Other", "idempotency_key": "other-project-key"})[0]
        self.assertNotEqual(self.drafts.create(self.alice, other["project_id"], self.request)[0]["draft"]["payload"]["draft_id"], draft_id)
        revision = {"idempotency_key": "draft-revision-001", "expected_revision": 1, "changes": {"purpose": "OPERATIONAL"}}
        revised, fresh = self.drafts.revise(self.alice, draft_id, revision)
        self.assertTrue(fresh)
        self.assertEqual(self.drafts.revise(self.alice, draft_id, revision), (revised, False))
        self.assertEqual(self.drafts.create(self.alice, project, self.request), (bundle, False))
        self.assertEqual(self.drafts.get(self.alice, draft_id), revised)
        self.assertEqual(revised["structure"], bundle["structure"])
        self.assertNotEqual(revised["intent"]["run_intent"]["record_id"], bundle["intent"]["run_intent"]["record_id"])
        self.assertEqual(self.repo.project(self.alice, project), self.project)
        revision["idempotency_key"] = "draft-revision-002"
        self.problem("PRECONDITION_FAILED", self.drafts.revise, self.alice, draft_id, revision)
        restarted = SQLiteDraftRepository(SQLiteRepository(self.repo.path), self.store)
        self.assertEqual(restarted.get(self.alice, draft_id), revised)

    def test_structure_and_policy_dependencies_get_new_immutable_records(self):
        old = self.drafts.create(self.alice, self.project["project_id"], self.request)[0]
        draft_id = old["draft"]["payload"]["draft_id"]
        content = copy.deepcopy(self.request["structure"]);content["sites"][1]["position"][0] = 0.26
        revised = self.drafts.revise(self.alice, draft_id, {"idempotency_key": "draft-revision-001", "expected_revision": 1, "changes": {"structure": content}})[0]
        self.assertEqual(revised["structure"]["payload"]["parent_revision"], 1)
        self.assertEqual(revised["structure"]["payload"]["revision"], 2)
        self.assertNotEqual(old["structure"]["record_id"], revised["structure"]["record_id"])
        self.assertNotEqual(old["intent"]["run_intent"]["record_id"], revised["intent"]["run_intent"]["record_id"])
        title_only = self.drafts.revise(self.alice, draft_id, {"idempotency_key": "draft-revision-002", "expected_revision": 2, "changes": {"title": "title"}})[0]
        self.assertEqual(title_only["intent"], revised["intent"])
        self.assertEqual(old["structure"]["payload"]["sites"][1]["position"][0], 0.25)
        self.assertEqual(title_only["draft"]["payload"]["scientific_assessment"], "NOT_EVALUATED")
        self.assertEqual(title_only["draft"]["payload"]["provenance_state"], "PARTIAL")
        template = copy.deepcopy(self.request["intent"])
        template["numerical_policy"]["mesh_cutoff"]["value"] = 350
        policy_change = self.drafts.revise(self.alice, draft_id, {"idempotency_key": "draft-revision-003", "expected_revision": 3, "changes": {"intent": template}})[0]
        self.assertNotEqual(policy_change["intent"]["numerical_policy"]["record_id"], title_only["intent"]["numerical_policy"]["record_id"])
        self.assertNotEqual(policy_change["intent"]["run_intent"]["record_id"], title_only["intent"]["run_intent"]["record_id"])

    def test_concurrent_edits_commit_only_one_revision(self):
        first = self.drafts.create(self.alice, self.project["project_id"], self.request)[0]
        draft_id = first["draft"]["payload"]["draft_id"]
        def edit(index):
            try:
                return self.drafts.revise(self.alice, draft_id, {"idempotency_key": f"concurrent-key-{index:03}", "expected_revision": 1, "changes": {"title": str(index)}})[1]
            except Problem as error:
                self.assertEqual(error.code, "PRECONDITION_FAILED")
                return False
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(sum(pool.map(edit, range(4))), 1)
        self.assertEqual(self.drafts.get(self.alice, draft_id)["draft"]["payload"]["revision"], 2)

    def test_authoring_unknown_and_import_requires_authorized_verified_bytes(self):
        request = copy.deepcopy(self.request)
        request["origin"] = {"kind": "USER_AUTHORED", "learning_dataset_id": None, "exported_kind": None, "source_artifact": None}
        self.assertEqual(self.drafts.create(self.alice, self.project["project_id"], request)[0]["draft"]["payload"]["provenance_state"], "UNKNOWN")
        imported = resource_json("fixtures/draft-create-request/valid/user-import.json")
        self.problem("NOT_FOUND", self.drafts.create, self.alice, self.project["project_id"], imported)
        data = b"original structure input"
        upload = self.store.stage(self.alice, {"project_id": self.project["project_id"], "idempotency_key": "draft-upload-key-001", "kind": "siesta.input", "media_type": "text/plain", "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        self.store.write(self.alice, upload["upload_id"], 0, len(data)-1, len(data), data)
        artifact = self.store.commit(self.alice, upload["upload_id"])
        imported["origin"]["source_artifact"] = {k: artifact["payload"][k] for k in ("artifact_id", "sha256", "media_type")}
        self.assertEqual(self.drafts.create(self.alice, self.project["project_id"], imported)[0]["draft"]["payload"]["provenance_state"], "PARTIAL")
        imported["idempotency_key"] = "new-import-key-001"
        imported["origin"]["source_artifact"]["sha256"] = "0"*64
        self.problem("NOT_FOUND", self.drafts.create, self.alice, self.project["project_id"], imported)


if __name__ == "__main__":
    unittest.main()
