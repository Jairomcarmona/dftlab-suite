"""External installed consumer fixture for qualify_engines.py; never executes."""
import hashlib
import json
from pathlib import Path
import sys
import uuid

from dftlab_platform.domain import envelope
from dftlab_platform.engines import PinnedEngines, QraftAuthoring


def main():
    root, wheelhouse = map(Path, sys.argv[1:])
    engines = PinnedEngines(wheelhouse)
    api = engines.qraft
    source = root/"source"
    source.mkdir()
    pseudo = (root/"Si.psml").read_bytes()
    (source/"Si.psml").write_bytes(pseudo)
    fdf = """SystemName DFT Lab native authoring qualification
SystemLabel si
XC.functional LDA
XC.authors CA
NumberOfSpecies 1
NumberOfAtoms 2
%block ChemicalSpeciesLabel
1 14 Si
%endblock ChemicalSpeciesLabel
PAO.BasisSize DZP
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
DM.Tolerance 1.e-5
MD.TypeOfRun CG
MD.Steps 0
"""
    fragments = []
    for step in ("single", "derived"):
        (source/(step+".fdf")).write_bytes((fdf+("DM.UseSaveDM true\n" if step == "derived" else "")).encode())
        inputs = [{"name": "fdf", "source": step+".fdf", "destination": "main.fdf", "media_type": "text/x-siesta-fdf"}, {"name": "pseudo", "source": "Si.psml", "destination": "Si.psml", "media_type": "application/xml"}]
        ports = {"fdf": api.ArtifactPortContract("siesta.fdf", "text/x-siesta-fdf"), "pseudo": api.ArtifactPortContract("siesta.pseudopotential", "application/xml")}
        if step == "derived":
            inputs.append({"name": "parent_dm", "from": {"task": "single", "output": "density"}, "destination": "si.DM", "media_type": "application/x-siesta-dm"})
            ports["parent_dm"] = api.ArtifactPortContract("siesta.density-matrix", "application/x-siesta-dm")
        fragments.append(api.WorkflowFragment.single(step, {"task_id": step, "kind": "calculation", "capability": "siestaflow.engine.siesta", "inputs": inputs, "outputs": [{"name": "density", "path": "si.DM", "artifact_type": "siesta.density-matrix", "media_type": "application/x-siesta-dm"}], "resources": {"nodes": 1, "mpi_processes": 4, "processes_per_node": 4, "cpus_per_process": 1, "walltime_seconds": 60}}, input_contracts=ports))
    identifier = lambda: str(uuid.uuid4())
    protocol = {"protocol_id": "dftlab.siesta.single-derived", "version": "0.1.0"}
    intent = envelope("run-intent", identifier(), {"intent_id": identifier(), "draft_id": identifier(), "operation": "siesta.scf", "purpose": "EXPLORATORY", "structure": {"structure_id": identifier(), "revision": 1}, "physical_model_ref": identifier(), "numerical_policy_ref": identifier(), "protocol": protocol, "promoted_from": None})
    authoring = QraftAuthoring(engines)
    plan = authoring.compile(intent, api.RecipePolicy(protocol["protocol_id"], protocol["version"], "Si single point and density reuse fixture", "authoring/package only, not validated science"), fragments, source_root=source, lock_path=root/"workflow.lock.json")
    prepared, inspection = authoring.prepare(plan, expected_native_digest=plan.native_digest, profile=root/"profile.json", output_root=root/"packages", run_id="native-qualification-run")
    assert prepared.execution_authorized is False and prepared.submission_performed is False
    print(json.dumps({"engines": engines.evidence, "intent_id": plan.intent_id, "project_id": plan.project_id, "native_workflow_digest": plan.native_digest, "workflow_file_sha256": plan.file_sha256, "package_sha256": prepared.zip_sha256, "run_lock_sha256": prepared.run_lock_sha256, "profile_native_digest": prepared.execution_profile_sha256, "controller_campaign_sha256": prepared.controller_campaign_sha256, "task_count": prepared.task_count, "inspection_status": inspection.status, "native_validation_status": prepared.validation_status, "native_validation_review_codes": prepared.validation_review_codes, "pseudo_sha256": hashlib.sha256(pseudo).hexdigest(), "scientific_assessment": "NOT_ESTABLISHED", "execution_performed": False}))


if __name__ == "__main__":
    main()
