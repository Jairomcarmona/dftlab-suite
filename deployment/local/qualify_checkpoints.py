"""Explicit installed control-plane restore qualification; never launches jobs.

Input is a NEW private authoring-only case from qualify_native_handlers.py.
An instance with native execution is rejected by this first checkpoint adapter.
Full journals, terminal evidence and resume need the subsequent qualification.
"""
import argparse
import hashlib
import os
from pathlib import Path
import platform
import sys
import time
from zipfile import ZipFile

from dftlab_platform.artifact_storage import SQLiteArtifactIndex
from dftlab_platform.artifacts import LocalArtifactStore
from dftlab_platform.checkpoints import SQLiteCheckpointStore, checked_path, write_new
from dftlab_platform.contracts import canonical, loads
from dftlab_platform.domain import Principal, Problem
from dftlab_platform.engines import PinnedEngines
from dftlab_platform.local_runtime import private_directory
from dftlab_platform.storage import SQLiteRepository


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", type=Path, required=True)
    parser.add_argument("--wheelhouse", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if sys.flags.isolated != 1 or "PYTHONPATH" in os.environ:
        raise RuntimeError("Installed isolated consumer required")
    case, output = checked_path(args.case), checked_path(args.output)
    if output.exists() or output.is_relative_to(case) or case.is_relative_to(output):
        raise RuntimeError("NEW independent output required")
    output.mkdir(mode=0o700)
    private_directory(output)
    engines = PinnedEngines(args.wheelhouse)
    repo = SQLiteRepository(case/"state.sqlite")
    artifacts = LocalArtifactStore(case/"artifacts", SQLiteArtifactIndex(repo))
    with repo._connection() as db:
        projects = db.execute("SELECT project_id,owner_id FROM projects").fetchall()
        operations = db.execute("SELECT operation_id,request FROM operations ORDER BY operation_id").fetchall()
        artifact_ids = [row[0] for row in db.execute("SELECT artifact_id FROM artifact_records ORDER BY artifact_id")]
    if len(projects) != 1 or len(operations) != 4:
        raise RuntimeError("Exact four-operation authoring-only case required")
    project, owner_id = projects[0]
    owner = Principal(owner_id)
    before = {op_id: repo.operation(owner, op_id) for op_id, _ in operations}
    products = {op_id: repo.local_products(owner, op_id) for op_id, _ in operations}
    if {value["payload"]["action"] for value in before.values()} != {"VALIDATE_INPUT", "CREATE_CAMPAIGN", "CREATE_PLAN", "PREPARE_PACKAGE"} or any(value["payload"]["state"] != "SUCCEEDED" for value in before.values()):
        raise RuntimeError("Unconfirmed authoring products")
    pins = [{"engine": name, "distribution": engines.lock["engines"][name]["distribution"],
             "version": engines.lock["engines"][name]["declared_version"], "commit": engines.evidence[name]["commit"],
             "distribution_sha256": engines.evidence[name]["wheel_sha256"]} for name in ("qraft", "hubbardflow")]
    adapter = SQLiteCheckpointStore(repo, artifacts)
    start = time.monotonic()
    checkpoint = adapter.create(owner, project, output/"packet", pins)
    checkpoint_seconds = time.monotonic()-start
    start = time.monotonic()
    restored = adapter.restore(output/"packet", checkpoint["integrity"]["digest"], output/"restored")
    restore_seconds = time.monotonic()-start
    verified_bytes = 0
    for artifact_id in artifact_ids:
        record = artifacts.metadata(owner, artifact_id)
        if restored.artifacts.metadata(owner, artifact_id) != record:
            raise RuntimeError("Original ArtifactRecord changed")
        expected = record["payload"]["sha256"]
        for store in (artifacts, restored.artifacts):
            hashed = hashlib.sha256()
            for block in store.stream(owner, artifact_id):
                hashed.update(block)
            if hashed.hexdigest() != expected:
                raise RuntimeError("Original artifact bytes changed")
        verified_bytes += record["payload"]["size_bytes"]
    for op_id, request in operations:
        if restored.repository.operation(owner, op_id) != before[op_id] or restored.repository.local_products(owner, op_id) != products[op_id]:
            raise RuntimeError("Operation/product identity changed")
        retry, created = restored.repository.accept(owner, loads(request))
        if created or retry != before[op_id]:
            raise RuntimeError("Restored idempotency changed")
    package = next(product.document for values in products.values() for product in values if product.kind == "PACKAGE")
    archive = output/"original-package.zip"
    write_new(archive, b"".join(restored.artifacts.stream(owner, package["payload"]["artifact_id"])))
    with ZipFile(archive) as packed:
        for name in ("run.lock.json", "workflow.lock.json"):
            matches = [key for key in packed.namelist() if key.endswith("/"+name)]
            if len(matches) != 1:
                raise RuntimeError("Native lock ambiguous")
            write_new(output/name, packed.read(matches[0]))
    run_envelope, run = engines.qraft.load_run_lock(output/"run.lock.json")
    workflow_envelope, workflow = engines.qraft.load_workflow_lock(output/"workflow.lock.json")
    if run.project_id != project or workflow.project_id != project or run.workflow_lock_sha256 != workflow_envelope.content_sha256:
        raise RuntimeError("Native identity changed")
    try:
        restored.repository.require_execution_ready()
    except Problem as error:
        if error.code != "PRECONDITION_FAILED":
            raise
    else:
        raise RuntimeError("Restored admission reopened")
    report = {"success": True, "scope": "authoring-only SQLite/ArtifactStore restore; no active native journals or resume",
              "system": platform.system(), "python": platform.python_version(), "isolated": True, "engines": engines.evidence,
              "project_id": project, "checkpoint_digest": checkpoint["integrity"]["digest"], "artifact_count": len(artifact_ids),
              "verified_original_bytes": verified_bytes, "operations_preserved": 4, "products_preserved": 4,
              "native_run_digest": run_envelope.content_sha256, "native_workflow_digest": workflow_envelope.content_sha256,
              "checkpoint_seconds": checkpoint_seconds, "restore_seconds": restore_seconds,
              "sla_rpo_rto": "NOT_ESTABLISHED", "admission": "RECOVERY_CLOSED", "scientific_assessment": "NOT_ESTABLISHED", "jobs_launched": 0}
    write_new(output/"report.json", canonical(report))
    print(canonical(report).decode())


if __name__ == "__main__":
    main()
