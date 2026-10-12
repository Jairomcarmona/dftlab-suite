"""Operator-registered HF-1 qualification recipe (ADR-017 Adenda 8).

The draft is a descriptive carrier of the NiO AFM-II case: the scientific
content lives in the verified campaign bundle, never in this translation. The
recipe only asserts that the stored draft is exactly the one built here, then
returns one controller task whose single input is that bundle. It chooses no
numerical value that D.2 does not already fix; every number below is copied
from the pinned `reference.fdf` / `material.json` of the case.
"""
import hashlib

from .contracts import canonical
from .domain import Problem
from .hf1_capability import CAPABILITY
from .qraft_authoring import AuthoringRecipe

PROTOCOL = {"protocol_id": "dftlab.hubbardflow.hf1-nio-qualification", "version": "0.1.0"}
OPERATION = "dftlab.hubbardflow.hf1-lr-u"
POLICY = {"policy_id": "dftlab.hubbardflow.hf1-nio-qualification-scf", "version": "0.1.0"}
FRAGMENT_ID = "hf1-controller"
TASK_ID = "hf1"
BUNDLE_SOURCE = "campaign.bundle.zip"
BUNDLE_DESTINATION = "campaign.bundle.zip"
BUNDLE_MEDIA_TYPE = "application/zip"
# NiO takes about 8 min; QRAFT needs estimate + shutdown margin < remaining
# allocation at launch and at preparation (run_preparation, capability_runtime).
TASK_WALLTIME_SECONDS = 1800
_LATTICE_ANGSTROM = 4.17
_ROWS = ((0.0, 1.0, 1.0), (0.5, 0.0, 0.5), (0.5, 0.5, 0.0))  # reference.fdf LatticeVectors, scaled


def structure():
    return {
        "convention": "cell-vectors-as-rows",
        "cell": {"vectors": [[round(value * _LATTICE_ANGSTROM, 6) for value in row] for row in _ROWS], "unit": "angstrom"},
        "periodicity": [True, True, True],
        "coordinates": {"kind": "fractional"},
        "sites": [
            {"atom_id": "ni-1", "species_label": "NiLR0", "position": [0.0, 0.0, 0.0]},
            {"atom_id": "ni-2", "species_label": "NiLR1", "position": [0.5, 0.0, 0.0]},
            {"atom_id": "o-1", "species_label": "O", "position": [0.25, 0.5, 0.5]},
            {"atom_id": "o-2", "species_label": "O", "position": [0.75, 0.5, 0.5]},
        ],
        "transformations": [],
        "physical_intent": "BULK",
    }


def physical_model():
    return {
        "xc": {"functional": "PBE", "family": "GGA"},
        "total_charge": {"value": 0, "unit": "e"},
        "spin": "COLLINEAR",
        "relativistic": "SCALAR",
        "hubbard": None,
        "assumptions": [
            "AFM-II initial moments Ni1 +2.0 and Ni2 -2.0 (reference.fdf DM.InitSpin)",
            "U_scalar_charge is the quantity measured by the campaign; no U value is imposed",
        ],
    }


def numerical_policy(bundle_sha256):
    parameters = {
        "basis": {"size": "DZP", "energy_shift": {"value": 0.005, "unit": "Ry"}},
        "mesh_cutoff": {"value": 200, "unit": "Ry"},
        "kgrid": {"kind": "MONKHORST_PACK", "divisions": [2, 4, 4], "shift": [0, 0, 0], "k_includes_2pi": False},
        "smearing": None,
        "solver": "diagon",
        "tolerances": {"dm_tolerance": {"value": "1e-5", "unit": "1"}, "h_tolerance": {"value": "1e-4", "unit": "eV"}},
        "convergence_target": "U_scalar_charge",
        "justification": "Fixed ADR-017 Adenda 4 D.2 case copied from reference.fdf; bundle sha256 " + bundle_sha256 + "; no universal defaults",
    }
    return {"policy": {**POLICY, "digest": hashlib.sha256(canonical(parameters)).hexdigest()}, **parameters}


def draft_request(bundle_sha256, *, idempotency_key, title="HF-1 NiO AFM-II qualification (ADR-017 D.2)"):
    return {
        "idempotency_key": idempotency_key, "title": title,
        "origin": {"kind": "USER_AUTHORED", "learning_dataset_id": None, "exported_kind": None, "source_artifact": None},
        "purpose": "EXPLORATORY", "structure": structure(),
        "intent": {"operation": OPERATION, "protocol": dict(PROTOCOL), "physical_model": physical_model(),
                   "numerical_policy": numerical_policy(bundle_sha256)},
    }


def fragment(api):
    task = {
        "task_id": TASK_ID, "kind": "calculation", "capability": CAPABILITY,
        "inputs": [{"name": "campaign", "source": BUNDLE_SOURCE, "destination": BUNDLE_DESTINATION, "media_type": BUNDLE_MEDIA_TYPE}],
        "outputs": [],
        "resources": {"nodes": 1, "mpi_processes": 1, "processes_per_node": 1, "cpus_per_process": 1,
                      "walltime_seconds": TASK_WALLTIME_SECONDS},
    }
    return api.WorkflowFragment.single(FRAGMENT_ID, task, input_contracts={
        "campaign": api.ArtifactPortContract("dftlab.hf1.campaign-bundle", BUNDLE_MEDIA_TYPE)})


def recipe_registry(api, *, bundle_ref, bundle_sha256, profile_id):
    """Value for QraftArtifactAuthoring(recipes=...): the key and the resolver."""
    if (not isinstance(bundle_ref, dict) or set(bundle_ref) != {"artifact_id", "sha256", "media_type"}
            or bundle_ref["sha256"] != bundle_sha256 or bundle_ref["media_type"] != BUNDLE_MEDIA_TYPE):
        raise Problem("PRECONDITION_FAILED")
    expected = {"structure": structure(), "physical_model": physical_model(), "numerical_policy": numerical_policy(bundle_sha256)}

    def resolve(owner, bundle):
        payload = bundle["structure"]["payload"]
        stored = {key: value for key, value in payload.items() if key not in {"structure_id", "revision", "parent_revision"}}
        if (stored != expected["structure"]
                or bundle["intent"]["physical_model"]["payload"] != expected["physical_model"]
                or bundle["intent"]["numerical_policy"]["payload"] != expected["numerical_policy"]
                or bundle["intent"]["run_intent"]["payload"]["operation"] != OPERATION):
            raise Problem("PRECONDITION_FAILED")
        policy = api.RecipePolicy(PROTOCOL["protocol_id"], PROTOCOL["version"], "HF-1 NiO AFM-II controller qualification",
                                  "Registered exact ADR-017 D.2 case; the bundle carries the science, no universal defaults")
        return AuthoringRecipe(policy, (fragment(api),), {BUNDLE_SOURCE: dict(bundle_ref)}, profile_id)

    return {(PROTOCOL["protocol_id"], PROTOCOL["version"]): resolve}
