"""Explicit installed service-internal authoring qualification; no calculations."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import traceback
from zipfile import ZipFile

from dftlab_platform.artifact_storage import SQLiteArtifactIndex
from dftlab_platform.artifacts import LocalArtifactStore
from dftlab_platform.authoring import AuthoringHandlers
from dftlab_platform.contracts import canonical, loads
from dftlab_platform.domain import Processor, identifier
from dftlab_platform.draft_storage import SQLiteDraftRepository
from dftlab_platform.engines import PinnedEngines
from dftlab_platform.qraft_authoring import AuthoringProfile, AuthoringRecipe, QraftArtifactAuthoring
from dftlab_platform.storage import SQLiteRepository


def main():
    root, wheelhouse = map(Path, sys.argv[1:])
    engines = PinnedEngines(wheelhouse)
    api = engines.qraft
    repo = SQLiteRepository(root/"state.sqlite")
    owner = repo.ensure_principal("local-authoring-qualification")
    project = repo.create_project(owner, {"name": "Explicit Si authoring qualification", "idempotency_key": identifier()})[0]["project_id"]
    store = LocalArtifactStore(root/"artifacts", SQLiteArtifactIndex(repo))
    drafts = SQLiteDraftRepository(repo, store)
    def upload(data, kind, media):
        item = store.stage(owner, {"project_id": project, "kind": kind, "media_type": media, "size_bytes": len(data),
                                   "sha256": hashlib.sha256(data).hexdigest(), "idempotency_key": identifier()})
        for start in range(0, len(data), 65536):
            end = min(len(data), start+65536)
            store.write(owner, item["upload_id"], start, end-1, len(data), data[start:end])
        record = store.commit(owner, item["upload_id"])
        return {key: record["payload"][key] for key in ("artifact_id", "sha256", "media_type")}
    protocol = {"protocol_id": "dftlab.siesta.single-derived", "version": "0.1.0"}
    structure = {"convention": "cell-vectors-as-rows", "cell": {"vectors": [[0, 2.7155, 2.7155], [2.7155, 0, 2.7155], [2.7155, 2.7155, 0]], "unit": "angstrom"},
                 "periodicity": [True, True, True], "coordinates": {"kind": "fractional"},
                 "sites": [{"atom_id": "si-1", "species_label": "Si", "position": [0, 0, 0]}, {"atom_id": "si-2", "species_label": "Si", "position": [0.25, 0.25, 0.25]}],
                 "transformations": [], "physical_intent": "BULK"}
    model = {"xc": {"functional": "CA", "family": "LDA"}, "total_charge": {"value": 0, "unit": "e"}, "spin": "NONE", "relativistic": "SCALAR", "hubbard": None, "assumptions": []}
    parameters = {"basis": {"size": "DZP", "energy_shift": {"value": 0.02, "unit": "Ry"}}, "mesh_cutoff": {"value": 200, "unit": "Ry"},
                  "kgrid": {"kind": "MONKHORST_PACK", "divisions": [2, 2, 2], "shift": [0, 0, 0], "k_includes_2pi": False},
                  "smearing": None, "solver": "diagon", "tolerances": {"dm_tolerance": {"value": "1e-5", "unit": "1"}}, "convergence_target": "total_energy",
                  "justification": "Explicit local authoring case; fixed parameters, no universal convergence/science claim."}
    numerical = {"policy": {"policy_id": "dftlab.qualification-scf", "version": "0.1.0", "digest": hashlib.sha256(canonical(parameters)).hexdigest()}, **parameters}
    request = {"idempotency_key": identifier(), "title": "Explicit user-authored Si single and density reuse",
               "origin": {"kind": "USER_AUTHORED", "learning_dataset_id": None, "exported_kind": None, "source_artifact": None}, "purpose": "EXPLORATORY",
               "structure": structure, "intent": {"operation": "siesta.single-point", "protocol": protocol, "physical_model": model, "numerical_policy": numerical}}
    bundle = drafts.create(owner, project, request)[0]
    profile_data = (root/"profile.json").read_bytes()
    profile_id = loads(profile_data)["profile_id"]
    profile = AuthoringProfile(profile_id, 1, upload(profile_data, "qraft.execution-profile", "application/json"))
    fdf = """SystemName Explicit DFT Lab authoring qualification
SystemLabel si
XC.functional LDA
XC.authors CA
NumberOfSpecies 1
NumberOfAtoms 2
%block ChemicalSpeciesLabel
1 14 Si
%endblock ChemicalSpeciesLabel
PAO.BasisSize DZP
PAO.EnergyShift 0.02 Ry
LatticeConstant 1.0 Ang
%block LatticeVectors
0.0 2.7155 2.7155
2.7155 0.0 2.7155
2.7155 2.7155 0.0
%endblock LatticeVectors
AtomicCoordinatesFormat Fractional
%block AtomicCoordinatesAndAtomicSpecies
0.0 0.0 0.0 1
0.25 0.25 0.25 1
%endblock AtomicCoordinatesAndAtomicSpecies
MeshCutoff 200 Ry
%block kgrid_Monkhorst_Pack
2 0 0 0.0
0 2 0 0.0
0 0 2 0.0
%endblock kgrid_Monkhorst_Pack
Spin non-polarized
NetCharge 0
SolutionMethod diagon
SCF.DM.Tolerance 1.e-5
MD.TypeOfRun CG
MD.NumCGsteps 0
"""
    sources = {"Si.psml": upload((root/"Si.psml").read_bytes(), "siesta.pseudopotential", "application/xml")}
    fragments = []
    for step in ("single", "derived"):
        name = step+".fdf"
        sources[name] = upload((fdf+("DM.UseSaveDM true\n" if step == "derived" else "")).encode(), "siesta.input", "text/x-siesta-fdf")
        inputs = [{"name": "fdf", "source": name, "destination": "main.fdf", "media_type": "text/x-siesta-fdf"}, {"name": "pseudo", "source": "Si.psml", "destination": "Si.psml", "media_type": "application/xml"}]
        ports = {"fdf": api.ArtifactPortContract("siesta.fdf", "text/x-siesta-fdf"), "pseudo": api.ArtifactPortContract("siesta.pseudopotential", "application/xml")}
        if step == "derived":
            inputs.append({"name": "parent_dm", "from": {"task": "single", "output": "density"}, "destination": "si.DM", "media_type": "application/x-siesta-dm"})
            ports["parent_dm"] = api.ArtifactPortContract("siesta.density-matrix", "application/x-siesta-dm")
        fragments.append(api.WorkflowFragment.single(step, {"task_id": step, "kind": "calculation", "capability": "siestaflow.engine.siesta", "inputs": inputs,
                         "outputs": [{"name": "density", "path": "si.DM", "artifact_type": "siesta.density-matrix", "media_type": "application/x-siesta-dm"}],
                         "resources": {"nodes": 1, "mpi_processes": 4, "processes_per_node": 4, "cpus_per_process": 1, "walltime_seconds": 60}}, input_contracts=ports))
    def resolve(current_owner, current):
        payload = current["structure"]["payload"]
        actual_structure = {key: value for key, value in payload.items() if key not in {"structure_id", "revision", "parent_revision"}}
        assert current_owner == owner and actual_structure == structure
        assert current["intent"]["physical_model"]["payload"] == model and current["intent"]["numerical_policy"]["payload"] == numerical
        return AuthoringRecipe(api.RecipePolicy(protocol["protocol_id"], protocol["version"], "Explicit Si single/DM derivation", "Registered exact authoring case, no universal defaults"),
                               tuple(fragments), copy.deepcopy(sources), profile_id)
    native = QraftArtifactAuthoring(engines, store, {(protocol["protocol_id"], protocol["version"]): resolve}, {profile_id: profile}, root/"authoring")
    class PrivateTrace:
        def __getattr__(self, name):
            def call(*args, **kwargs):
                try:
                    return getattr(native, name)(*args, **kwargs)
                except Exception:
                    traceback.print_exc()  # captured only by local qualifier
                    raise
            return call
    handler = AuthoringHandlers(repo, drafts, store, PrivateTrace())
    processor = Processor(repo, handler.handlers())
    operations = []
    def execute(action, payload, target=None, selected_profile=None):
        command = {"action": action, "project_id": project, "payload": payload, "idempotency_key": identifier(),
                   "target": target or {"kind": "PROJECT", "id": project, "expected_revision": repo.project(owner, project)["revision"]}}
        if selected_profile:
            command["profile_ref"] = selected_profile
        operation = repo.accept(owner, command)[0]
        assert processor.once()
        result = repo.operation(owner, operation["payload"]["operation_id"])
        operations.append(result)
        if result["payload"]["state"] != "SUCCEEDED":
            raise RuntimeError("Local handler did not confirm its product; private diagnostics retained")
        return repo.local_products(owner, result["payload"]["operation_id"])[0]
    draft_ref = {"draft_id": bundle["draft"]["payload"]["draft_id"], "revision": 1}
    validation = execute("VALIDATE_INPUT", {"draft": draft_ref})
    campaign = execute("CREATE_CAMPAIGN", {"name": "Explicit local Si authoring", "drafts": [draft_ref]})
    plan = execute("CREATE_PLAN", {"draft": draft_ref, "intent_id": bundle["intent"]["run_intent"]["payload"]["intent_id"], "validation_receipt_id": validation.product_id},
                   {"kind": "CAMPAIGN", "id": campaign.product_id, "expected_revision": 1})
    native_plan = plan.document["native_contract_refs"][0]
    package = execute("PREPARE_PACKAGE", {"expected_plan_digest": native_plan["digest"]}, {"kind": "PLAN", "id": plan.product_id, "expected_revision": 1}, profile_id)
    lock_bytes = b"".join(store.stream(owner, native_plan["artifact"]["artifact_id"]))
    archive_bytes = b"".join(store.stream(owner, package.product_id))
    (root/"workflow.lock.json").write_bytes(lock_bytes)
    (root/"packages").mkdir()
    archive = root/"packages/native-qualification-run.zip"
    archive.write_bytes(archive_bytes)
    with ZipFile(archive) as packed:
        run_path = next(name for name in packed.namelist() if name.endswith("/run.lock.json"))
        (root/"run.lock.json").write_bytes(packed.read(run_path))
    run_native, run = api.load_run_lock(root/"run.lock.json")
    assert run.project_id == project and run.workflow_id == bundle["intent"]["run_intent"]["payload"]["intent_id"]
    assert run.workflow_lock_sha256 == native_plan["digest"]["value"]
    evidence = root/"evidence"
    evidence.mkdir()
    (evidence/"draft-bundle.json").write_bytes(canonical(bundle))
    (evidence/"validation-receipt.json").write_bytes(canonical(validation.document))
    (evidence/"operations.json").write_bytes(canonical(operations))
    exported = {}
    references = [profile.artifact, *sources.values(), *validation.document["payload"]["input_refs"], native_plan["artifact"]]
    for reference in references:
        if reference["artifact_id"] not in exported:
            data = b"".join(store.stream(owner, reference["artifact_id"]))
            assert hashlib.sha256(data).hexdigest() == reference["sha256"]
            (evidence/reference["artifact_id"]).write_bytes(data)
            exported[reference["artifact_id"]] = reference
    (evidence/"artifact-refs.json").write_bytes(canonical(exported))
    print(json.dumps({"engines": engines.evidence, "project_id": project, "draft_id": draft_ref["draft_id"], "intent_id": run.workflow_id,
                      "run_id": run.run_id, "operation_ids": [value["payload"]["operation_id"] for value in operations], "states": [value["payload"]["state"] for value in operations],
                      "validation_decision": validation.document["payload"]["decision"], "validation_native_refs": validation.document["native_contract_refs"],
                      "native_workflow_digest": native_plan["digest"]["value"], "workflow_file_sha256": native_plan["artifact"]["sha256"],
                      "package_sha256": package.document["payload"]["sha256"], "run_lock_sha256": run_native.content_sha256,
                      "pseudo_sha256": sources["Si.psml"]["sha256"], "scientific_assessment": "NOT_ESTABLISHED", "execution_performed": False}))


if __name__ == "__main__":
    main()
