"""Explicit installed POSIX scheduler diagnostic; two tiny jobs, no science.

Never used by CI, unit tests, HTTP or mounting a view. Creates fresh private
Linux state, retains every observation/result and changes no site configuration.
Not a scientific workflow, native controller qualification or admission proof.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from zipfile import ZipFile

from dftlab_platform.artifact_storage import SQLiteArtifactIndex
from dftlab_platform.artifacts import LocalArtifactStore
from dftlab_platform.contracts import canonical, loads
from dftlab_platform.domain import Principal, envelope, identifier, now
from dftlab_platform.engines import PinnedEngines
from dftlab_platform.local_runtime import private_directory
from dftlab_platform.runtime_probe import Binary
from dftlab_platform.slurm import ManagedSlurmPackage, SlurmSchedulerPort, SlurmSite
from dftlab_platform.storage import SQLiteRepository
from dftlab_platform.submissions import DurableSubmissions
from dftlab_platform.submission_storage import SQLiteSubmissionLedger


def write(path, data):
    with path.open("xb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def blob(store, owner, project, data, kind, media):
    upload = store.stage(owner, {"project_id": project, "kind": kind, "media_type": media, "size_bytes": len(data),
                                 "sha256": hashlib.sha256(data).hexdigest(), "idempotency_key": identifier()})
    for start in range(0, len(data), 65536):
        end = min(len(data), start+65536)
        store.write(owner, upload["upload_id"], start, end-1, len(data), data[start:end])
    record = store.commit(owner, upload["upload_id"])
    return {key: record["payload"][key] for key in ("artifact_id", "sha256", "media_type")}


def ports(root, config, owner, intent, processor):
    repo = SQLiteRepository(root/"state.sqlite")
    store = LocalArtifactStore(root/"artifacts", SQLiteArtifactIndex(repo))
    site = SlurmSite(*(Binary(Path(config[name]["path"]), config[name]["sha256"]) for name in ("sbatch", "scontrol", "squeue")),
                     config["cluster"], config["remote_user"], config["uid"])
    package_root = root/"package"
    script = package_root/"diagnostic.slurm"
    expected = (root/"diagnostic.sha256").read_text().strip()
    def verify():
        if not store.verify(owner, intent["payload"]["package_ref"]["artifact_id"]) or hashlib.sha256(script.read_bytes()).hexdigest() != expected:
            raise ValueError("Diagnostic bytes changed")
    binding = ManagedSlurmPackage(package_root, script, expected, intent["payload"]["package_ref"], intent["payload"]["profile"],
                                  intent["payload"]["run_id"], 1, verify)
    ledger = SQLiteSubmissionLedger(repo)
    evidence = lambda value, observation: blob(store, owner, value["project_id"], canonical(observation), "dftlab.scheduler-observation", "application/json")
    port = SlurmSchedulerPort(site, {binding.run_id: binding}, evidence, lambda value: ledger.enter_rpc(value, processor))
    return repo, ledger, port


def child(root, config, phase):
    context = loads((root/"context.json").read_bytes())
    owner, processor = Principal(context["owner"]), context["processor"]
    intent = loads((root/"effect-intent.json").read_bytes())
    repo, ledger, port = ports(root, config, owner, intent, processor)
    operation = repo.operation(owner, intent["payload"]["operation_id"])
    if phase == "before":
        os._exit(71)
    if phase == "reserved":
        ledger.reserve(operation["record_id"], operation["payload"]["revision"], processor, intent)
        os._exit(72)
    if phase == "lost-ack":
        native_submit = port.submit
        class LostAck:
            def submit(self, value):
                receipt = native_submit(value)
                write(root/"failure-oracle-receipt.json", canonical(receipt))
                os._exit(73)  # real job accepted; ledger/operation ack lost
        port = LostAck()
    result = DurableSubmissions(repo, ledger, port).perform(operation, processor, intent)
    repo.transition(operation["record_id"], operation["payload"]["revision"], "SUCCEEDED", result=result, processor_id=processor)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--wheelhouse", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--child", choices=("before", "reserved", "lost-ack", "normal"))
    args = parser.parse_args()
    if os.name == "nt" or sys.version_info[:3] != (3, 12, 10):
        parser.error("Installed POSIX Python 3.12.10 required")
    config = loads(args.config.read_bytes())
    required = {"sbatch", "scontrol", "squeue", "cluster", "remote_user", "uid", "partition", "account", "qos"}
    if not isinstance(config, dict) or set(config) != required or any(re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", config[key]) is None for key in ("partition", "account", "qos")):
        parser.error("Explicit diagnostic site config required")
    engines = PinnedEngines(args.wheelhouse)  # both installed pins mandatory
    root = args.output.absolute()
    if args.child:
        child(root, config, args.child)
        return 0
    if root.exists():
        parser.error("Output must be a new private Linux directory")
    root = private_directory(root)
    report = {"success": False, "engines": engines.evidence, "scope": "real local SLURM diagnostic and crash boundaries; no SIESTA/native controller/admission/science",
              "scientific_execution_performed": False, "scientific_assessment": "NOT_ESTABLISHED", "cases": []}
    try:
        for phase, expected_exit in (("before", 71), ("reserved", 72), ("lost-ack", 73), ("normal", 0)):
            case = private_directory(root/phase)
            repo = SQLiteRepository(case/"state.sqlite")
            owner = repo.ensure_principal("qualification-operator")
            project = repo.create_project(owner, {"name": "Scheduler diagnostic only", "idempotency_key": identifier()})[0]["project_id"]
            store = LocalArtifactStore(case/"artifacts", SQLiteArtifactIndex(repo))
            package = private_directory(case/"package")
            body = f"""#!/bin/sh
#SBATCH --partition={config['partition']}
#SBATCH --account={config['account']}
#SBATCH --qos={config['qos']}
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=1
#SBATCH --mem=128M
#SBATCH --time=00:01:00
#SBATCH --output=diagnostic.%j.out
#SBATCH --error=diagnostic.%j.err
set -eu
printf 'DFTLAB_SCHEDULER_DIAGNOSTIC job=%s node=%s cpus=%s\\n' "$SLURM_JOB_ID" "$SLURM_JOB_NODELIST" "$SLURM_CPUS_ON_NODE"
/bin/sleep 30
""".encode()
            write(package/"diagnostic.slurm", body)
            write(case/"diagnostic.sha256", hashlib.sha256(body).hexdigest().encode())
            archive = case/"diagnostic.zip"
            with ZipFile(archive, "x") as zipfile:
                zipfile.writestr("diagnostic.slurm", body)
            package_ref = blob(store, owner, project, archive.read_bytes(), "dftlab.scheduler-diagnostic", "application/zip")
            plan, processor = identifier(), identifier()
            with repo.transaction() as db:
                db.execute("INSERT INTO resources VALUES(?,?,?,1,NULL)", (plan, "PLAN", project))
            pending = repo.accept(owner, {"action": "SUBMIT_RUN", "project_id": project, "target": {"kind": "PLAN", "id": plan, "expected_revision": 1},
                                          "payload": {"plan_id": plan, "package_id": package_ref["artifact_id"], "admission_purpose": "EXPLORATORY"},
                                          "profile_ref": "wsl-slurm-diagnostic", "idempotency_key": identifier()})[0]
            operation = repo.claim(processor)
            intent = envelope("effect-intent", project, {"effect_intent_id": identifier(), "operation_id": pending["record_id"], "action": "SUBMIT_RUN",
                                "run_id": identifier(), "attempt_id": identifier(), "attempt_token": identifier(), "package_ref": package_ref,
                                "profile": {"profile_id": "wsl-slurm-diagnostic", "revision": 1}, "scheduler": "SLURM", "authority_generation": 1, "recorded_at": now()})
            write(case/"effect-intent.json", canonical(intent))
            write(case/"context.json", canonical({"owner": owner.principal_id, "processor": processor}))
            result = subprocess.run([sys.executable, "-I", str(Path(__file__).resolve()), "--config", str(args.config.resolve()), "--wheelhouse", str(args.wheelhouse.resolve()),
                                     "--output", str(case), "--child", phase], cwd=case, capture_output=True, timeout=60)
            write(case/"child.log", result.stdout+result.stderr)
            if result.returncode != expected_exit:
                raise RuntimeError("Diagnostic child failed; see retained local evidence")
            if phase != "normal":
                if repo.recover() != 1:
                    raise RuntimeError("Unexpected recovery count")
            if repo.claim(identifier()) is not None:
                raise RuntimeError("Interrupted submission was claimed again")
            repo, ledger, port = ports(case, config, owner, intent, processor)
            current = repo.operation(owner, pending["record_id"])
            if phase == "lost-ack":
                current = DurableSubmissions(repo, ledger, port).reconcile(owner, pending["record_id"])
                if current["payload"]["state"] != "SUCCEEDED":
                    raise RuntimeError("Lost ack could not be proven; remains unknown, never resend")
            elif phase == "reserved":
                if DurableSubmissions(repo, ledger, port).reconcile(owner, pending["record_id"]) != current:
                    raise RuntimeError("Reserved-only intent changed during reconciliation")
            with repo._connection() as db:
                rpc = db.execute("SELECT count(*) FROM scheduler_rpc_entries").fetchone()[0]
                confirmed_intent = repo._effect_intent(db, pending["record_id"])
            if rpc != (1 if phase in {"normal", "lost-ack"} else 0) or (confirmed_intent is None) != (phase == "before"):
                raise RuntimeError("Write-ahead/RPC counts disagree")
            write(case/"final-operation.json", canonical(current))
            report["cases"].append({"phase": phase, "child_exit": result.returncode, "operation_id": pending["record_id"],
                                     "state": current["payload"]["state"], "rpc_entries": rpc, "result": current["payload"]["result"]})
        report["success"] = True
    except Exception as error:
        report["error_type"] = type(error).__name__
        report["error"] = str(error)
    write(root/"report.json", (json.dumps(report, indent=2)+"\n").encode())
    print(json.dumps({"success": report["success"], "scope": report["scope"]}))
    return 0 if report["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
