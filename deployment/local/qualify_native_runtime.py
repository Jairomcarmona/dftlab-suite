"""Explicit local Si qualification, installed worker, original native package.

Never invoked by CI, unit tests, HTTP or a view. Requires existing WSL SIESTA
and SLURM unchanged. Retains private state/results on failure; never resubmits.
Scope is native runtime/fencing evidence, not admission, restore or P4 closure.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
import time
import uuid
from zipfile import ZipFile

from dftlab_platform.artifact_storage import SQLiteArtifactIndex
from dftlab_platform.artifacts import LocalArtifactStore
from dftlab_platform.authority import LocalAuthorityManager
from dftlab_platform.authority_storage import SQLiteAuthorityStore
from dftlab_platform.contracts import canonical, loads
from dftlab_platform.domain import Principal, envelope, identifier, now, reseal
from dftlab_platform.engines import PinnedEngines
from dftlab_platform.local_runtime import private_directory
from dftlab_platform.native_worker import NativeWorker, RegisteredNativeRun
from dftlab_platform.runtime_probe import Binary, ProbeSettings, SlurmRuntimeProbe
from dftlab_platform.slurm import ManagedSlurmPackage, SlurmSchedulerPort, SlurmSite
from dftlab_platform.storage import SQLiteRepository
from dftlab_platform.submissions import DurableSubmissions
from dftlab_platform.submission_storage import SQLiteSubmissionLedger


def write(path, data):
    temporary = path.with_name("."+str(uuid.uuid4())+".part")
    try:
        with temporary.open("xb") as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        os.link(temporary, path)  # atomic publication, fails if destination exists
        descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if temporary.exists():
            temporary.unlink()  # only this invocation's newly created scratch


def blob(store, owner, project, data, kind, media):
    upload = store.stage(owner, {"project_id": project, "kind": kind, "media_type": media, "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "idempotency_key": identifier()})
    for start in range(0, len(data), 65536):
        end = min(len(data), start+65536)
        store.write(owner, upload["upload_id"], start, end-1, len(data), data[start:end])
    record = store.commit(owner, upload["upload_id"])
    return {key: record["payload"][key] for key in ("artifact_id", "sha256", "media_type")}


def package_files(archive, parent, run_id, *, extract=False):
    """Exact original ZIP bytes, bounded trusted local qualification package."""
    with ZipFile(archive) as packed:
        items = packed.infolist()
        if len(items) > 4096 or sum(item.file_size for item in items) > 128*1024**2 or len({item.filename for item in items}) != len(items):
            raise ValueError("Qualification package exceeds explicit bounds")
        for item in items:
            name = PurePosixPath(item.filename)
            if item.is_dir() or name.is_absolute() or ".." in name.parts or "\\" in item.filename or len(name.parts) < 2 or name.parts[0] != run_id or stat.S_ISLNK(item.external_attr >> 16):
                raise ValueError("Unsafe qualification package entry")
            destination = parent.joinpath(*name.parts)
            if extract:
                destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                write(destination, packed.read(item))
            elif any(path.is_symlink() for path in (destination, *destination.parents)) or not destination.is_file() or destination.read_bytes() != packed.read(item):
                raise ValueError("Original package entry changed")


def context(root, config, engines):
    value = loads((root/"worker-context.json").read_bytes())
    repo = SQLiteRepository(root/"authoring/state.sqlite")
    owner = Principal(value["owner"])
    store = LocalArtifactStore(root/"authoring/artifacts", SQLiteArtifactIndex(repo))
    package = root/"extracted"/value["run_id"]
    intent = loads((root/"effect-intent.json").read_bytes())
    script = root/"extracted/installed-worker.slurm"
    def verify():
        if not store.verify(owner, intent["payload"]["package_ref"]["artifact_id"]) or hashlib.sha256(script.read_bytes()).hexdigest() != value["script_sha256"]:
            raise ValueError("Original package/script bytes unavailable")
        package_files(root/"authoring/packages/native-qualification-run.zip", package.parent, value["run_id"])
        for item in ("siesta", "mpi"):
            Binary(Path(config[item]["path"]), config[item]["sha256"]).verified()
        if engines.qraft.RunInspector().inspect(package).status != "PREPARED_RUN_VERIFIED":
            raise ValueError("Native package inspection failed")
    site = SlurmSite(*(Binary(Path(config[name]["path"]), config[name]["sha256"]) for name in ("sbatch", "scontrol", "squeue")), config["cluster"], config["remote_user"], config["uid"])
    ledger = SQLiteSubmissionLedger(repo)
    managed = ManagedSlurmPackage(package, script, value["script_sha256"], intent["payload"]["package_ref"], intent["payload"]["profile"], value["run_id"], 1, verify)
    evidence = lambda current, observation: blob(store, owner, current["project_id"], canonical(observation), "dftlab.scheduler-observation", "application/json")
    port = SlurmSchedulerPort(site, {value["run_id"]: managed}, evidence, lambda current: ledger.enter_rpc(current, value["processor"]))
    return value, repo, owner, store, package, intent, ledger, port, verify


def worker(root, config, engines):
    value, repo, owner, store, package, intent, ledger, port, verify = context(root, config, engines)
    def authorize():
        receipt = port.find(intent)
        if receipt is None or receipt["payload"]["job"]["job_id"] != os.environ.get("SLURM_JOB_ID"):
            raise ValueError("Allocation correlation not established")
        with repo._connection() as db:
            entry = db.execute("SELECT intent_hash FROM scheduler_rpc_entries WHERE operation_id=?", (intent["payload"]["operation_id"],)).fetchone()
        if entry != (hashlib.sha256(canonical(intent)).hexdigest(),):
            raise ValueError("Allocation lacks original durable RPC entry")
    manager = LocalAuthorityManager(SQLiteAuthorityStore(repo), root/"authority-locks", scope="qualified-local-WSL-SLURM")
    registered = RegisteredNativeRun(package, intent["project_id"], value["run_id"], value["workflow_id"], intent["payload"]["attempt_id"], intent["payload"]["profile"],
                                     value["workflow_digest"], value["run_digest"], value["profile_digest"], loads((root/"runtime-probe-receipt.json").read_bytes()), verify, authorize)
    def publication(summary, original):
        reference = blob(store, owner, intent["project_id"], original, "qraft.runtime-result-observation", "application/json")
        write(root/"original-runtime-result.json", original)
        write(root/"worker-result.json", canonical(summary))
        return lambda db: db.execute("INSERT INTO qualification_native_results VALUES(?,?,?)", (value["run_id"], canonical(summary).decode(), canonical(reference).decode()))
    result = NativeWorker(engines, repo, manager).run(owner, registered, publication=publication)
    write(root/"worker-return.json", canonical(result))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--wheelhouse", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--profile", type=Path)
    parser.add_argument("--pseudo", type=Path)
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("--second", action="store_true")
    args = parser.parse_args()
    if os.name == "nt" or sys.version_info[:3] != (3, 12, 10) or "PYTHONPATH" in os.environ:
        parser.error("Installed isolated POSIX Python 3.12.10 required")
    config = loads(args.config.read_bytes())
    engines = PinnedEngines(args.wheelhouse)
    root = args.output.absolute()
    if args.second:
        value, repo, owner, _, _, intent, _, _, _ = context(root, config, engines)
        manager = LocalAuthorityManager(SQLiteAuthorityStore(repo), root/"authority-locks", scope="qualified-local-WSL-SLURM")
        from dftlab_platform.domain import Problem
        try:
            with manager.controller(owner, intent["project_id"], value["run_id"], intent["payload"]["attempt_id"]):
                return 1  # unexpected acquisition; never instantiate a motor
        except (OSError, Problem):
            print("SECOND_CONTROLLER_REJECTED")
            return 0
    if args.worker:
        worker(root, config, engines)
        return 0
    if root.exists() or args.profile is None or args.pseudo is None:
        parser.error("New private Linux output/profile/pseudo required")
    root = private_directory(root)
    report = {"success": False, "engines": engines.evidence, "scope": "installed public native runtime and local authority; no admission, restore, terminal or P4 closure", "scientific_assessment": "NOT_ESTABLISHED"}
    try:
        authoring = private_directory(root/"authoring")
        write(authoring/"profile.json", args.profile.read_bytes())
        write(authoring/"Si.psml", args.pseudo.read_bytes())
        prepared = subprocess.run([sys.executable, "-I", str(Path(__file__).with_name("qualify_native_handlers.py")), str(authoring), str(args.wheelhouse.resolve())], cwd=authoring, capture_output=True, timeout=180)
        write(root/"authoring.log", prepared.stdout+prepared.stderr)
        prepared.check_returncode()
        observed = loads(prepared.stdout)
        report["authoring"] = observed
        if observed["validation_decision"] != "ACCEPTED":
            raise ValueError("Exact local authoring did not pass preflight")
        repo = SQLiteRepository(authoring/"state.sqlite")
        owner = repo.ensure_principal("local-authoring-qualification")
        store = LocalArtifactStore(authoring/"artifacts", SQLiteArtifactIndex(repo))
        package_record = repo.local_products(owner, observed["operation_ids"][-1])[0]
        plan = repo.local_products(owner, observed["operation_ids"][-2])[0]
        project, run_id = observed["project_id"], observed["run_id"]
        extracted = private_directory(root/"extracted")
        package_files(authoring/"packages/native-qualification-run.zip", extracted, run_id, extract=True)
        package = extracted/run_id
        package.chmod(0o700)
        run_envelope, native = engines.qraft.load_run_lock(package/"run.lock.json")
        execution = loads((package/"execution-profile.json").read_bytes())
        profile = {"profile_id": native.execution_profile_id, "revision": 1}
        settings = ProbeSettings(profile["profile_id"], 1, hashlib.sha256((package/"execution-profile.json").read_bytes()).hexdigest(),
                                 *(Binary(Path(config[name]["path"]), config[name]["sha256"]) for name in ("siesta", "mpi", "sinfo", "scontrol", "sbatch")),
                                 config["partition"], config["node"], 4, 1, 512, root/"probe-workspace")
        probe = SlurmRuntimeProbe().observe(project, settings)
        write(root/"runtime-probe-receipt.json", canonical(probe.receipt)); write(root/"runtime-probe-observations.json", canonical(probe.evidence))
        report["runtime_probe_digest"] = probe.receipt["integrity"]["digest"]
        report["scientific_execution_performed"] = False
        selected_environment = execution["runtime"]["environment"]
        if set(selected_environment) != {"QRAFT_PYTHON", "OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "PATH"} or execution["runtime"]["module_commands"] or selected_environment.get("QRAFT_PYTHON") != sys.executable or any(selected_environment.get(key) != "1" for key in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS")):
            raise ValueError("Explicit installed interpreter/thread profile required")
        # Reuse exact native SBATCH directives; preserve the original file.
        header = (package/"submit.slurm").read_text().split("set -euo pipefail", 1)[0]
        import shlex
        argv = [sys.executable, "-I", str(Path(__file__).resolve()), "--worker", "--config", str(args.config.resolve()), "--wheelhouse", str(args.wheelhouse.resolve()), "--output", str(root)]
        body = header+"set -euo pipefail\nunset PYTHONPATH\n"+"".join("export "+key+"="+shlex.quote(val)+"\n" for key, val in selected_environment.items())+"exec "+shlex.join(argv)+"\n"
        script = extracted/"installed-worker.slurm"
        write(script, body.encode())
        package_ref = {key: package_record.document["payload"][key] for key in ("artifact_id", "sha256", "media_type")}
        processor = identifier()
        with repo._connection() as db:
            revision = db.execute("SELECT revision FROM resources WHERE resource_id=?", (plan.product_id,)).fetchone()[0]
        pending = repo.accept(owner, {"action": "SUBMIT_RUN", "project_id": project, "target": {"kind": "PLAN", "id": plan.product_id, "expected_revision": revision},
                                      "payload": {"plan_id": plan.product_id, "package_id": package_ref["artifact_id"], "admission_purpose": "EXPLORATORY"}, "profile_ref": profile["profile_id"], "idempotency_key": identifier()})[0]
        operation = repo.claim(processor)
        intent = envelope("effect-intent", project, {"effect_intent_id": identifier(), "operation_id": pending["record_id"], "action": "SUBMIT_RUN", "run_id": run_id,
                           "attempt_id": identifier(), "attempt_token": identifier(), "package_ref": package_ref, "profile": profile, "scheduler": "SLURM", "authority_generation": 1, "recorded_at": now()})
        run_artifact = blob(store, owner, project, (package/"run.lock.json").read_bytes(), "qraft.run-lock", "application/json")
        pin = engines.lock["engines"]["qraft"]
        run_ref = {"engine": "qraft", "distribution": pin["distribution"], "version": pin["declared_version"], "commit": pin["commit"],
                   "contract": str(run_envelope.contract), "digest": {"algorithm": "qraft.content-sha256-v1", "value": run_envelope.content_sha256},
                   "artifact": run_artifact, "verification": {"status": "VERIFIED", "verified_at": now()}}
        repo.contracts.validate("native-contract-ref", run_ref)
        intent["native_contract_refs"] = [plan.document, run_ref]
        reseal(intent)
        write(root/"effect-intent.json", canonical(intent))
        value = {"owner": owner.principal_id, "processor": processor, "run_id": run_id, "workflow_id": native.workflow_id,
                 "workflow_digest": native.workflow_lock_sha256, "run_digest": run_envelope.content_sha256, "profile_digest": native.execution_profile_sha256,
                 "script_sha256": hashlib.sha256(body.encode()).hexdigest()}
        write(root/"worker-context.json", canonical(value))
        with repo.transaction() as db:
            db.execute("CREATE TABLE qualification_native_results(run_id TEXT PRIMARY KEY, summary TEXT NOT NULL, artifact_ref TEXT NOT NULL)")
        _, repo, owner, _, _, intent, ledger, port, _ = context(root, config, engines)
        receipt = DurableSubmissions(repo, ledger, port).perform(operation, processor, intent)
        committed = repo.transition(operation["record_id"], operation["payload"]["revision"], "SUCCEEDED", result=receipt, processor_id=processor)
        write(root/"submit-operation.json", canonical(committed))
        report["submission_receipt"] = receipt["receipt"]
        report["scientific_execution_performed"] = True
        # Poll own result, never resubmit on timeout/failure. Caller may stop the
        # diagnostic process while the retained SLURM allocation keeps running.
        until = time.monotonic()+180
        checked_second = False
        while not (root/"worker-return.json").exists() and time.monotonic() < until:
            if not checked_second:
                with repo._connection() as db:
                    initialized = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='controller_authorities'").fetchone()
                    exists = initialized and db.execute("SELECT 1 FROM controller_authorities WHERE run_id=?", (run_id,)).fetchone()
                if exists:
                    second = subprocess.run([sys.executable, "-I", str(Path(__file__).resolve()), "--second", "--config", str(args.config.resolve()),
                                             "--wheelhouse", str(args.wheelhouse.resolve()), "--output", str(root)], cwd=root, capture_output=True, timeout=30)
                    write(root/"second-controller.log", second.stdout+second.stderr)
                    if second.returncode or second.stdout.strip() != b"SECOND_CONTROLLER_REJECTED":
                        raise RuntimeError("Second authority was not rejected")
                    checked_second = True
                    report["second_controller_rejected"] = True
            time.sleep(1)
        if not (root/"worker-return.json").exists():
            raise RuntimeError("Worker outcome unconfirmed; retain job/state, never resend")
        if not checked_second:
            raise RuntimeError("Live second-controller rejection was not observed")
        result = loads((root/"worker-return.json").read_bytes())
        report["worker"] = result
        report["native_results"] = loads((root/"original-runtime-result.json").read_bytes())
        if result["native_status"] != "COMPLETED":
            raise RuntimeError("Native runtime did not complete; original gates/results retained")
        report["success"] = True
    except Exception as error:
        report["error_type"], report["error"] = type(error).__name__, str(error)
    write(root/"report.json", (json.dumps(report, indent=2)+"\n").encode())
    print(json.dumps({"success": report["success"], "scope": report["scope"]}))
    return 0 if report["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
