"""The HF-1 recipe's draft passes the real contracts and the resolver is exact."""
import copy
from dataclasses import dataclass
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from dftlab_platform import hf1_recipe as recipe
from dftlab_platform.artifact_storage import SQLiteArtifactIndex
from dftlab_platform.artifacts import LocalArtifactStore
from dftlab_platform.domain import Problem, identifier
from dftlab_platform.draft_storage import SQLiteDraftRepository
from dftlab_platform.storage import SQLiteRepository

BUNDLE_SHA = "ab"*32


@dataclass(frozen=True)
class Port:
    artifact_type: str
    media_type: str


class Fragment:
    def __init__(self, fragment_id, task, input_contracts):
        self.fragment_id, self.task, self.input_contracts = fragment_id, task, input_contracts

    @classmethod
    def single(cls, fragment_id, task, *, input_contracts):
        return cls(fragment_id, task, {f"{task['task_id']}.{name}": value for name, value in input_contracts.items()})


API = SimpleNamespace(WorkflowFragment=Fragment, ArtifactPortContract=Port,
                      RecipePolicy=lambda *values: values)


class HF1Recipe(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.repo = SQLiteRepository(root/"state.sqlite")
        self.owner = self.repo.ensure_principal("owner")
        self.project = self.repo.create_project(self.owner, {"name": "HF1 recipe", "idempotency_key": "hf1-recipe-project-1"})[0]["project_id"]
        self.store = LocalArtifactStore(root/"artifacts", SQLiteArtifactIndex(self.repo))
        self.drafts = SQLiteDraftRepository(self.repo, self.store)
        self.ref = {"artifact_id": "bundle-1", "sha256": BUNDLE_SHA, "media_type": "application/zip"}

    def tearDown(self):
        self.temporary.cleanup()

    def bundle(self):
        return self.drafts.create(self.owner, self.project, recipe.draft_request(BUNDLE_SHA, idempotency_key=identifier()))[0]

    def test_draft_is_accepted_by_the_real_contracts_and_resolves(self):
        bundle = self.bundle()
        resolve = recipe.recipe_registry(API, bundle_ref=self.ref, bundle_sha256=BUNDLE_SHA, profile_id="hf1-controller-outer-slurm-v1")
        ((key, resolver),) = resolve.items()
        self.assertEqual(key, (recipe.PROTOCOL["protocol_id"], recipe.PROTOCOL["version"]))
        result = resolver(self.owner, bundle)
        self.assertEqual(result.profile_id, "hf1-controller-outer-slurm-v1")
        self.assertEqual(result.sources, {recipe.BUNDLE_SOURCE: self.ref})
        task = result.fragments[0].task
        self.assertEqual((task["capability"], task["kind"], task["outputs"]), ("dftlab.engine.hubbardflow.hf1", "calculation", []))
        self.assertEqual(task["resources"], {"nodes": 1, "mpi_processes": 1, "processes_per_node": 1, "cpus_per_process": 1, "walltime_seconds": 1800})
        self.assertEqual(set(result.fragments[0].input_contracts), {"hf1.campaign"})

    def test_estimate_plus_shutdown_margin_fits_the_outer_allocation(self):
        # QRAFT: estimated_runtime_seconds + shutdown_margin_seconds < remaining allocation.
        allocation, margin = 3600, 30
        self.assertLess(recipe.TASK_WALLTIME_SECONDS + margin, allocation - 60)
        self.assertGreaterEqual(allocation - margin, 1800)

    def test_any_drift_between_draft_and_recipe_is_refused(self):
        resolve = recipe.recipe_registry(API, bundle_ref=self.ref, bundle_sha256=BUNDLE_SHA, profile_id="p")
        resolver = next(iter(resolve.values()))
        for change in (lambda b: b["structure"]["payload"]["sites"].pop(),
                       lambda b: b["intent"]["physical_model"]["payload"].update(spin="NONE"),
                       lambda b: b["intent"]["numerical_policy"]["payload"]["mesh_cutoff"].update(value=300),
                       lambda b: b["intent"]["run_intent"]["payload"].update(operation="dftlab.other.operation")):
            with self.subTest(change=change):
                bundle = copy.deepcopy(self.bundle())
                change(bundle)
                with self.assertRaises(Problem):
                    resolver(self.owner, bundle)

    def test_bundle_reference_must_match_the_declared_digest_and_media_type(self):
        for ref in ({**self.ref, "sha256": "cd"*32}, {**self.ref, "media_type": "text/plain"}, {"artifact_id": "x"}):
            with self.subTest(ref=ref), self.assertRaises(Problem):
                recipe.recipe_registry(API, bundle_ref=ref, bundle_sha256=BUNDLE_SHA, profile_id="p")


if __name__ == "__main__":
    unittest.main()
