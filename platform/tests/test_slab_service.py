"""Slabs persist through the existing authorized draft/artifact ports."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from dftlab_platform.artifact_storage import SQLiteArtifactIndex
from dftlab_platform.artifacts import LocalArtifactStore
from dftlab_platform.contracts import resource_json
from dftlab_platform.domain import Problem
from dftlab_platform.draft_storage import SQLiteDraftRepository
from dftlab_platform.slabs import SlabService
from dftlab_platform.storage import SQLiteRepository


class SlabPersistence(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        self.repo = SQLiteRepository(root / 'state.sqlite')
        self.alice = self.repo.ensure_principal('alice')
        self.bob = self.repo.ensure_principal('bob')
        project = self.repo.create_project(self.alice, {'name': 'Slabs', 'idempotency_key': 'slab-project-001'})[0]
        self.store = LocalArtifactStore(root / 'artifacts', SQLiteArtifactIndex(self.repo))
        self.drafts = SQLiteDraftRepository(self.repo, self.store)
        self.original = self.drafts.create(self.alice, project['project_id'], resource_json('fixtures/draft-create-request/valid/promote-template.json'))[0]
        self.draft = self.original['draft']['payload']['draft_id']
        self.service = SlabService(self.repo, self.store, self.drafts)
        self.conventional = [[5.43, 0, 0], [0, 5.43, 0], [0, 0, 5.43]]
        self.spec = {'hkl': [1, 1, 1], 'n_planes': 4, 'vacuum_A': 18., 'termination': 0}

    def tearDown(self):
        self.directory.cleanup()

    def create(self, owner=None, key='slab-revision-001', **kwargs):
        return self.service.create_revision(owner or self.alice, self.draft, 1, self.conventional, self.spec,
            fixed=[1], idempotency_key=key, conventional_from_g03=True, **kwargs)

    def test_revision_atom_map_retry_and_history(self):
        revision = self.create()
        self.assertEqual(self.create(), revision)
        p = revision['payload']
        self.assertEqual((p['revision'], p['parent_revision'], p['physical_intent']), (2, 1, 'SLAB'))
        self.assertEqual(p['periodicity'], self.original['structure']['payload']['periodicity'])
        transform = p['transformations'][0]
        self.assertEqual(transform['parameters']['constraints'], [1])
        reference = transform['atom_map']
        data = b''.join(self.store.stream(self.alice, reference['artifact_id']))
        self.assertEqual(hashlib.sha256(data).hexdigest(), reference['sha256'])
        atom_map = json.loads(data)
        self.assertEqual([a['id'] for a in atom_map], [s['atom_id'] for s in p['sites']])
        self.assertEqual({a['bulk_id'] for a in atom_map}, {s['atom_id'] for s in self.original['structure']['payload']['sites']})
        self.assertEqual(self.drafts.get_revision(self.alice, self.draft, 1), self.original)
        self.assertEqual(self.drafts.get(self.alice, self.draft)['structure'], revision)
        self.assertEqual(self.drafts.get(self.alice, self.draft)['draft']['payload']['scientific_assessment'], 'NOT_EVALUATED')

    def test_owner_isolation_and_cas(self):
        with self.assertRaises(Problem) as denied:
            self.create(self.bob)
        self.assertEqual(denied.exception.code, 'NOT_FOUND')
        self.create()
        with self.assertRaises(Problem) as stale:
            self.create(key='slab-revision-002')
        self.assertEqual(stale.exception.code, 'PRECONDITION_FAILED')

    def test_conventional_provenance_precondition_and_constraint_validation(self):
        with self.assertRaises(ValueError):
            self.service.create_revision(self.alice, self.draft, 1, self.conventional, self.spec, idempotency_key='slab-invalid-001')
        with self.assertRaisesRegex(ValueError, 'CONSTRAINT_INDEX_INVALID'):
            self.service.create_revision(self.alice, self.draft, 1, self.conventional, self.spec,
                idempotency_key='slab-invalid-002', fixed=[-1], conventional_from_g03=True)
        self.assertEqual(self.drafts.get(self.alice, self.draft), self.original)


if __name__ == '__main__':
    unittest.main()
