"""Operator-only retirement of a RESTORED completed-run copy; zero jobs.

Fresh original terminal signature/current contexts, original native identities
and retained guard. The original instance/authority are left unchanged. No
takeover or reopening admission; this is not interrupted resume qualification.
"""
import argparse
import hashlib
import importlib.util
import os
from pathlib import Path
import re
import sys

from dftlab_platform.artifact_storage import SQLiteArtifactIndex
from dftlab_platform.artifacts import LocalArtifactStore
from dftlab_platform.authority_recovery import RegisteredAuthorityRetirement, SQLiteNativeAuthorityRetirement
from dftlab_platform.checkpoints import SQLiteCheckpointStore, checked_path, write_new
from dftlab_platform.contracts import canonical, loads
from dftlab_platform.domain import Principal, Problem, identifier
from dftlab_platform.runtime_probe import Binary, BoundedCommands
from dftlab_platform.native_checkpoints import LocalNativeQuiescenceSource, NativeCheckpointRegistration, inventory_native
from dftlab_platform.storage import SQLiteRepository
from dftlab_platform.submission_storage import SQLiteSubmissionLedger
from dftlab_platform.terminal_evidence import SlurmTerminalCollector


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("run", "restored", "config", "wheelhouse", "output", "history-file"):
        parser.add_argument("--"+name, type=Path, required=True)
    for name in ("job", "sacct-sha256", "bridge-sha256", "timezone-sha256", "history-sha256"):
        parser.add_argument("--"+name, required=True)
    args = parser.parse_args()
    if os.name == "nt" or sys.flags.isolated != 1 or sys.version_info[:3] != (3, 12, 10) or "PYTHONPATH" in os.environ:
        raise RuntimeError("Installed isolated WSL Python 3.12.10 required")
    restored, original_run = checked_path(args.restored), checked_path(args.run)
    if restored.is_relative_to(original_run) or original_run.is_relative_to(restored) or not (restored/"checkpoint/checkpoint.json").is_file():
        raise RuntimeError("An independently restored completed run is required")
    repo = SQLiteRepository(restored/"state.sqlite")
    checkpoint = repo.restored_checkpoint()
    if checkpoint is None:
        raise RuntimeError("Recovery checkpoint identity required")
    try:
        repo.require_execution_ready()
    except Problem as error:
        if error.code != "PRECONDITION_FAILED":
            raise
    else:
        raise RuntimeError("Refuse retirement qualification on LIVE instance")
    store = LocalArtifactStore(restored/"artifacts", SQLiteArtifactIndex(repo))
    source = Path(__file__).with_name("qualify_terminal_evidence.py")
    spec = importlib.util.spec_from_file_location("readonly_original_terminal", source)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    engines, value, _, owner, _, package, intent, signer, collected = helper.observe_registered(args, restored_context=(repo, store))
    ledger = SQLiteSubmissionLedger(repo)
    native_root = restored/"native"/value["run_id"]
    original_repo = SQLiteRepository(original_run/"authoring/state.sqlite")
    def authority(repository):
        with repository._connection() as db:
            row = db.execute(
                "SELECT document FROM controller_authorities WHERE project_id=? AND run_id=? "
                "ORDER BY generation DESC LIMIT 1",
                (intent["project_id"], value["run_id"]),
            ).fetchone()
        if row is None:
            raise RuntimeError("Original authority absent")
        return row[0]
    original_authority = authority(original_repo)
    record = loads(authority(repo))
    if canonical(record) != canonical(loads(original_authority)) or checkpoint["payload"]["journal_cursors"][0]["run_id"] != value["run_id"]:
        raise RuntimeError("Restored original authority/run changed")
    raw = engines.qraft_contracts().canonical_json(collected.native).encode()
    upload = store.stage(owner, {"project_id": intent["project_id"], "kind": "qraft.terminal-evidence-original", "media_type": "application/json", "size_bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "idempotency_key": identifier()})["upload_id"]
    store.write(owner, upload, 0, len(raw)-1, len(raw), raw)
    proof_payload = store.commit(owner, upload)["payload"]
    proof = {key: proof_payload[key] for key in ("artifact_id", "sha256", "media_type")}
    contexts = [loads(b"".join(store.stream(owner, ref["artifact_id"])))["output"] for ref in collected.observations if loads(b"".join(store.stream(owner, ref["artifact_id"])))["command"] == "job-context"]
    def fields(raw):
        pairs = re.findall(r"(?:^|\s)(JobId|JobName|UserId|Comment|SubmitTime|WorkDir|Command)=(\S+)", raw)
        if len(pairs) != 7 or len(dict(pairs)) != 7:
            raise RuntimeError("Ambiguous current scheduler context")
        return dict(pairs), SlurmTerminalCollector.fields(raw)
    if len(contexts) != 2 or fields(contexts[0]) != fields(contexts[1]):
        raise RuntimeError("Positive native contexts disagree")
    config = loads(args.config.read_bytes())
    binary = Binary(Path(config["scontrol"]["path"]), config["scontrol"]["sha256"])
    commands, checks = BoundedCommands(timeout=15, limit=65536), []
    def verify(root):
        executable = binary.verified()
        observation = commands.run((str(executable), "--oneliner", "show", "job", args.job), cwd=package, environment={"PATH": "/usr/bin:/bin", "LC_ALL": "C", "LANG": "C", "TZ": "UTC"})
        binary.verified()
        if observation.returncode != 0 or fields(observation.output) != fields(contexts[0]):
            raise RuntimeError("Original allocation requeued/context changed")
        plan = engines.qraft.RunInspector().resume(root, terminal_evidence=collected.native, verify_terminal_evidence=signer.verify, expected_job=collected.native.job)
        if plan.status != "NO_RESUBMISSION_REQUIRED":
            raise RuntimeError("Completed case unexpectedly requires launch")
        raw = canonical({"output": observation.output, "returncode": observation.returncode})
        write_new(args.output/("current-context-%02d.json" % len(checks)), raw)
        checks.append(hashlib.sha256(raw).hexdigest())
    registration = RegisteredAuthorityRetirement(native_root, intent["payload"]["operation_id"], verify)
    port = SQLiteNativeAuthorityRetirement(engines, repo, store, ledger, original_run/"authority-locks", signer.verify)
    retired = port.retire(owner, registration, record, collected.native, proof, collected.observations)
    if port.retire(owner, registration, record, collected.native, proof, collected.observations) != retired or original_authority != authority(original_repo) or repo.restored_checkpoint() != checkpoint:
        raise RuntimeError("Retirement ack/original/checkpoint identity changed")
    try:
        repo.require_execution_ready()
    except Problem as error:
        if error.code != "PRECONDITION_FAILED":
            raise
    else:
        raise RuntimeError("Retirement incorrectly opened admission")
    original_inventory = inventory_native(native_root, 4096, 4*1024**3)
    native_identity = loads((native_root/"evidence/workflow_events.stream.json").read_bytes())
    def cursor(root):
        stream = engines.qraft.NativeEventStream(root/"evidence/workflow_events.jsonl", native_identity["runtime_fingerprint"], expected_stream_id=native_identity["stream_id"])
        page = stream.read(limit=10000)
        if len(page.events) == 10000:
            raise RuntimeError("Qualification event bound exceeded")
        return page.cursor
    native_ref = checkpoint["payload"]["journal_cursors"][0]["native"]
    capture = NativeCheckpointRegistration(intent["project_id"], value["run_id"], native_root, native_ref, (proof, *collected.observations), verify, cursor)
    def restore_verify(current_owner, item, root, artifacts):
        if current_owner != owner or item["native"] != native_ref or item["cursor"] != cursor(root):
            raise RuntimeError("Retired checkpoint native identity changed")
        verify(root)
    checkpoint_port = SQLiteCheckpointStore(repo, store,
        native_source=LocalNativeQuiescenceSource(repo, (capture,), original_run/"authority-locks"), native_verifier=restore_verify)
    retired_checkpoint = checkpoint_port.create(owner, intent["project_id"], args.output/"packet", checkpoint["payload"]["engine_versions"])
    roundtrip = checkpoint_port.restore(args.output/"packet", retired_checkpoint["integrity"]["digest"], args.output/"restored")
    if inventory_native(args.output/"restored/native"/value["run_id"], 4096, 4*1024**3) != original_inventory or authority(roundtrip.repository) != authority(repo):
        raise RuntimeError("Retired original namespace changed during roundtrip")
    with roundtrip.repository._connection() as db:
        original, current = db.execute("SELECT original_document,retired_document FROM authority_retirements WHERE run_id=?", (value["run_id"],)).fetchone()
    if original != original_authority or loads(current) != retired or roundtrip.repository.restored_checkpoint() != retired_checkpoint:
        raise RuntimeError("Original/retired history or checkpoint lost")
    try:
        roundtrip.repository.require_execution_ready()
    except Problem as error:
        if error.code != "PRECONDITION_FAILED":
            raise
    else:
        raise RuntimeError("Retired roundtrip opened admission")
    write_new(args.output/"original-native-terminal.json", raw)
    write_new(args.output/"retired-authority.json", canonical(retired))
    report = {"success": True, "scope": "explicit local retirement in restored completed-run copy, not interrupted resume",
              "run_id": value["run_id"], "job": args.job, "checkpoint_digest": checkpoint["integrity"]["digest"],
              "original_authority_unchanged": True, "original_authority_sha256": hashlib.sha256(original_authority.encode()).hexdigest(),
              "retired_authority_digest": retired["integrity"]["digest"], "original_native_proof": proof,
              "retired_roundtrip_checkpoint": retired_checkpoint["integrity"]["digest"], "retired_original_history_preserved": True,
              "readonly_current_context_sha256": checks, "idempotent_ack": True, "mode": "RECOVERY", "automatic_takeover": "DISABLED",
              "jobs_launched": 0, "new_controller_created": False, "scientific_assessment": "NOT_ESTABLISHED", "engines": engines.evidence}
    write_new(args.output/"report.json", canonical(report))
    print(canonical(report).decode())


if __name__ == "__main__":
    main()
