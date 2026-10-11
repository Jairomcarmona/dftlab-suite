"""Explicit installed native checkpoint qualification for an owned completed run.

Fresh positively signed original terminal evidence, original retained kernel
guard and public QRAFT inspector/event/resume decision. No launch, cancellation,
authority retirement or opening admission. Keys stay outside exported state.
Completed-case decision does not qualify execution of an interrupted resume.
"""
import argparse
import hashlib
import importlib.util
import os
from pathlib import Path
import re
import sys
import time

from dftlab_platform.checkpoints import SQLiteCheckpointStore, checked_path, write_new
from dftlab_platform.contracts import canonical, loads
from dftlab_platform.native_checkpoints import LocalNativeQuiescenceSource, NativeCheckpointRegistration, inventory_native
from dftlab_platform.domain import Problem
from dftlab_platform.runtime_probe import Binary, BoundedCommands
from dftlab_platform.terminal_evidence import SlurmTerminalCollector


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("run", "config", "wheelhouse", "output", "history-file"):
        parser.add_argument("--"+name, type=Path, required=True)
    for name in ("job", "sacct-sha256", "bridge-sha256", "timezone-sha256", "history-sha256"):
        parser.add_argument("--"+name, required=True)
    args = parser.parse_args()
    if os.name == "nt" or sys.flags.isolated != 1 or sys.version_info[:3] != (3, 12, 10) or "PYTHONPATH" in os.environ:
        raise RuntimeError("Installed isolated WSL Python 3.12.10 required")
    source = Path(__file__).with_name("qualify_terminal_evidence.py")
    spec = importlib.util.spec_from_file_location("operator_terminal_qualification", source)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    engines, value, repo, owner, store, package, intent, signer, collected = helper.observe_registered(args)
    output, run = checked_path(args.output), checked_path(args.run)
    native = next(ref for ref in intent["native_contract_refs"] if ref["contract"] == "siestaflow.run-lock@1.0")
    config = loads(args.config.read_bytes())
    scontrol = Binary(Path(config["scontrol"]["path"]), config["scontrol"]["sha256"])
    expected_contexts = []
    for reference in collected.observations:
        document = loads(b"".join(store.stream(owner, reference["artifact_id"])))
        if document["command"] == "job-context":
            expected_contexts.append(document["output"])
    keys = "JobId|JobName|UserId|Comment|SubmitTime|WorkDir|Command"
    def context_fields(raw):
        pairs = re.findall(r"(?:^|\s)("+keys+r")=(\S+)", raw)
        if len(pairs) != len(dict(pairs)) or len(pairs) != 7:
            raise RuntimeError("Current scheduler identity is ambiguous")
        return dict(pairs), SlurmTerminalCollector.fields(raw)
    if len(expected_contexts) != 2 or context_fields(expected_contexts[0]) != context_fields(expected_contexts[1]):
        raise RuntimeError("Positive original scheduler contexts disagree")
    expected_context = context_fields(expected_contexts[0])
    readonly = BoundedCommands(timeout=15, limit=65536)
    raw_checks = []
    original_identity = loads((package/"evidence/workflow_events.stream.json").read_bytes())
    def events(root):
        stream = engines.qraft.NativeEventStream(root/"evidence/workflow_events.jsonl", original_identity["runtime_fingerprint"], expected_stream_id=original_identity["stream_id"])
        cursor, result = None, []
        while True:
            page = stream.read(after=cursor, limit=10000)
            cursor = page.cursor
            if not page.events:
                return cursor, result
            result.extend(page.events)
            if len(result) > 10000:
                raise RuntimeError("Qualification event bound exceeded")
    def cursor(root):
        return events(root)[0]
    decisions = []
    def verify(root):
        executable = scontrol.verified()
        observation = readonly.run((str(executable), "--oneliner", "show", "job", args.job), cwd=package, environment={"PATH": "/usr/bin:/bin", "LC_ALL": "C", "LANG": "C", "TZ": "UTC"})
        scontrol.verified()
        if observation.returncode != 0 or context_fields(observation.output) != expected_context:
            raise RuntimeError("Allocation requeued or identity/terminal context changed")
        # Readonly scheduler observations remain private outside packet/SQL.
        raw_path = output/("current-context-%02d.json" % len(raw_checks))
        raw = canonical({"argv": [str(executable), "--oneliner", "show", "job", args.job], "output": observation.output, "returncode": observation.returncode})
        write_new(raw_path, raw)
        raw_checks.append(hashlib.sha256(raw).hexdigest())
        inspected = engines.qraft.RunInspector().inspect(root)
        env, payload = engines.qraft.load_run_lock(root/"run.lock.json")
        if inspected.status != "PREPARED_RUN_VERIFIED" or inspected.run_id != value["run_id"] or inspected.project_id != intent["project_id"] or env.content_sha256 != native["digest"]["value"] or payload.run_id != value["run_id"] or not signer.verify(collected.native):
            raise RuntimeError("Original native/terminal identity not verified")
        plan = engines.qraft.RunInspector().resume(root, terminal_evidence=collected.native, verify_terminal_evidence=signer.verify, expected_job=collected.native.job)
        if plan.status != "NO_RESUBMISSION_REQUIRED":
            raise RuntimeError("Completed qualification unexpectedly requires submission")
        decisions.append(engines.qraft_contracts().canonical_json(plan))
    def restored_verify(current_owner, item, root, artifacts):
        if current_owner != owner or item["native"] != native or cursor(root) != item["cursor"]:
            raise RuntimeError("Restored native cursor/reference/owner changed")
        verify(root)
    original_inventory = inventory_native(package, 4096, 4*1024**3)
    original_events = events(package)
    with repo._connection() as db:
        ids = [row[0] for row in db.execute("SELECT artifact_id FROM artifact_records ORDER BY artifact_id")]
        authorities = db.execute("SELECT document FROM controller_authorities ORDER BY run_id").fetchall()
    registration = NativeCheckpointRegistration(intent["project_id"], value["run_id"], package, native, collected.observations, verify, cursor)
    source = LocalNativeQuiescenceSource(repo, (registration,), run/"authority-locks")
    adapter = SQLiteCheckpointStore(repo, store, native_source=source, native_verifier=restored_verify)
    pins = [{"engine": name, "distribution": engines.lock["engines"][name]["distribution"], "version": engines.lock["engines"][name]["declared_version"], "commit": engines.evidence[name]["commit"], "distribution_sha256": engines.evidence[name]["wheel_sha256"]} for name in ("qraft", "hubbardflow")]
    started = time.monotonic()
    checkpoint = adapter.create(owner, intent["project_id"], output/"packet", pins)
    create_seconds = time.monotonic()-started
    started = time.monotonic()
    restored = adapter.restore(output/"packet", checkpoint["integrity"]["digest"], output/"restored")
    restore_seconds = time.monotonic()-started
    root = output/"restored/native"/value["run_id"]
    if inventory_native(root, 4096, 4*1024**3) != original_inventory or inventory_native(package, 4096, 4*1024**3) != original_inventory or events(root) != original_events:
        raise RuntimeError("Original bytes/directories/events changed")
    for artifact_id in ids:
        if store.metadata(owner, artifact_id) != restored.artifacts.metadata(owner, artifact_id) or not restored.artifacts.verify(owner, artifact_id):
            raise RuntimeError("Original artifact identity/bytes lost")
    with restored.repository._connection() as db:
        if db.execute("SELECT document FROM controller_authorities ORDER BY run_id").fetchall() != authorities:
            raise RuntimeError("Authority replaced or retired during restore")
    try:
        restored.repository.require_execution_ready()
    except Problem as error:
        if error.code != "PRECONDITION_FAILED":
            raise
    else:
        raise RuntimeError("Restore opened admission")
    if any("private-keys" in p.parts or p.name == "terminal-hmac.key" for p in (output/"packet").rglob("*")):
        raise RuntimeError("Signer credential present in checkpoint")
    report = {"success": True, "scope": "complete local native byte/cursor restore and completed-case public resume decision; no resumed execution",
              "run_id": value["run_id"], "job": args.job, "checkpoint_digest": checkpoint["integrity"]["digest"], "native_run_digest": native["digest"],
              "native_directories": len(original_inventory[0]), "native_files": len(original_inventory[1]), "native_bytes": sum(v["size_bytes"] for v in original_inventory[1]),
              "original_artifacts": len(ids), "original_events": len(original_events[1]), "native_cursor": original_events[0],
              "create_seconds": create_seconds, "restore_seconds": restore_seconds, "rpo_rto_global": "NOT_ESTABLISHED",
              "native_resume_status": "NO_RESUBMISSION_REQUIRED", "native_resume_original_sha256": hashlib.sha256(decisions[-1].encode()).hexdigest(),
              "readonly_current_context_sha256": raw_checks,
              "jobs_launched": 0, "authority_retired": False, "mode": "RECOVERY", "scientific_assessment": "NOT_ESTABLISHED", "engines": engines.evidence}
    write_new(output/"report.json", canonical(report))
    print(canonical(report).decode())


if __name__ == "__main__":
    main()
