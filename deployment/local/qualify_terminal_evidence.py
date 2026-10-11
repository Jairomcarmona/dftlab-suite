"""Explicit readonly terminal qualification on one operator-owned WSL run.

Never submits/cancels/requeues, changes permissions/configuration, retires
authority or reopens admission. Ubuntu filetxt history uses the existing local
timezone and readonly root bridge. Raw Cluster=unknown is preserved separately.
"""
import argparse
import hashlib
import importlib.util
import os
from pathlib import Path
import secrets
import sys
from zoneinfo import ZoneInfo

from dftlab_platform.checkpoints import checked_path, write_new
from dftlab_platform.contracts import canonical, loads
from dftlab_platform.engines import PinnedEngines
from dftlab_platform.local_runtime import private_directory
from dftlab_platform.runtime_probe import Binary, Observation
from dftlab_platform.terminal_evidence import LocalTerminalSigner, SlurmTerminalCollector


def observe_registered(args, *, restored_context=None):
    """Operator qualification only; original readonly context and fresh proof."""
    root, output = checked_path(args.run), checked_path(args.output)
    if output.exists() or root.is_relative_to(output) or output.is_relative_to(root):
        raise RuntimeError("NEW independent private output required")
    output.mkdir(mode=0o700)
    private_directory(output)
    config = loads(args.config.read_bytes())
    engines = PinnedEngines(args.wheelhouse)
    # Reuse the already-qualified explicit harness registry, not engine private APIs.
    source = Path(__file__).with_name("qualify_native_runtime.py")
    spec = importlib.util.spec_from_file_location("registered_native_qualification", source)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    value, repo, owner, store, package, intent, ledger, port, verify = helper.context(root, config, engines)
    if restored_context is not None:
        # Explicit operator qualification of a restored copy. Observe the
        # ORIGINAL scheduler package/context; put fresh evidence in the copy.
        from dftlab_platform.slurm import SlurmSchedulerPort
        from dftlab_platform.submission_storage import SQLiteSubmissionLedger
        repo, store = restored_context
        ledger = SQLiteSubmissionLedger(repo)
        def forbidden_dispatch(current):
            raise RuntimeError("Readonly restored qualification cannot dispatch")
        port = SlurmSchedulerPort(port.site, port.packages,
                                  lambda current, raw: helper.blob(store, owner, current["project_id"], canonical(raw), "dftlab.scheduler-observation", "application/json"),
                                  forbidden_dispatch)
    _, _, receipt = ledger.snapshot(owner, intent["payload"]["operation_id"])
    if receipt is None or receipt["payload"]["job"]["job_id"] != args.job:
        raise RuntimeError("Job not authorized by original durable receipt")
    sacct = Binary(Path("/usr/bin/sacct"), args.sacct_sha256)
    sacct.verified()
    timezone_file = Path("/etc/localtime")
    timezone_bytes = timezone_file.read_bytes()
    if hashlib.sha256(timezone_bytes).hexdigest() != args.timezone_sha256:
        raise RuntimeError("Registered local producer timezone changed")
    with timezone_file.open("rb") as stream:
        zone = ZoneInfo.from_file(stream)
    raw = args.history_file.read_bytes()
    if hashlib.sha256(raw).hexdigest() != args.history_sha256:
        raise RuntimeError("Operator history capture changed")
    captured = loads(raw)
    expected_argv = ["C:\\Windows\\System32\\wsl.exe", "-d", "Ubuntu", "-u", "root", "--", "/usr/bin/sacct", "--completion", "--jobs="+args.job, "--noheader", "--parsable2", "--format=JobID,User,Cluster,State,Start,End"]
    if captured["argv"] != expected_argv or captured["bridge_sha256"] != args.bridge_sha256 or captured["sacct_sha256"] != args.sacct_sha256 or captured["timezone_sha256"] != args.timezone_sha256 or captured["scope"] != "OPERATOR_READONLY_WINDOWS_WSL_BRIDGE" or captured["returncode"] != 0:
        raise RuntimeError("Operator readonly bridge capture not registered")
    class ReadonlyBridge:
        def run(self, argv, *, cwd, environment):
            expected = (str(sacct.verified()), "--completion", "--jobs="+args.job, "--noheader", "--parsable2", "--format=JobID,User,Cluster,State,Start,End")
            if argv != expected:
                raise RuntimeError("Bridge refuses every other command/job")
            # Explicit qualification injection from the operator's pinned
            # Windows reader. This file is not a public service trust input.
            # Positive current contexts/history intervals are still mandatory.
            if len(raw) > 65536 or hashlib.sha256(args.history_file.read_bytes()).hexdigest() != args.history_sha256:
                raise RuntimeError("Operator history source changed/exceeded bound")
            sacct.verified()
            write_new(output/"root-bridge-observation.json", raw)
            return Observation(captured["output"], captured["returncode"])
    private_key = secrets.token_bytes(32)
    keys = private_directory(output/"private-keys")
    write_new(keys/"terminal-hmac.key", private_key)  # never artifact/log/checkpoint
    signer = LocalTerminalSigner(engines.qraft, "wsl-local-terminal-"+secrets.token_hex(8), private_key)
    collected = SlurmTerminalCollector(engines, port, sacct, signer, history_commands=ReadonlyBridge(),
                                      completion_timezone=zone, allow_unknown_cluster=True).observe(intent, args.job)
    return engines, value, repo, owner, store, package, intent, signer, collected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--wheelhouse", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--job", required=True)
    parser.add_argument("--sacct-sha256", required=True)
    parser.add_argument("--bridge-sha256", required=True)
    parser.add_argument("--timezone-sha256", required=True)
    parser.add_argument("--history-file", type=Path, required=True)
    parser.add_argument("--history-sha256", required=True)
    args = parser.parse_args()
    if os.name == "nt" or sys.flags.isolated != 1 or sys.version_info[:3] != (3, 12, 10) or "PYTHONPATH" in os.environ:
        raise RuntimeError("Installed isolated WSL Python 3.12.10 required")
    engines, value, repo, owner, store, package, intent, signer, collected = observe_registered(args)
    output = checked_path(args.output)
    plan = engines.qraft.RunInspector().resume(package, terminal_evidence=collected.native, verify_terminal_evidence=signer.verify, expected_job=collected.native.job)
    original = engines.qraft_contracts().canonical_json(collected.native).encode("utf-8")
    original_plan = engines.qraft_contracts().canonical_json(plan).encode("utf-8")
    write_new(output/"original-terminal-evidence.json", original)
    write_new(output/"original-native-resume-plan.json", original_plan)
    write_new(output/"observation-refs.json", canonical(list(collected.observations)))
    if plan.status != "NO_RESUBMISSION_REQUIRED":
        raise RuntimeError("Completed original run unexpectedly requests submission")
    report = {"success": True, "scope": "local terminal observation and public native resume decision; no new allocation/authority retirement",
              "job": args.job, "run_id": value["run_id"], "native_state": collected.native.state,
              "native_resume_status": plan.status, "cluster_binding": collected.cluster_binding,
              "terminal_original_sha256": hashlib.sha256(original).hexdigest(), "resume_plan_original_sha256": hashlib.sha256(original_plan).hexdigest(),
              "raw_observation_count": len(collected.observations), "requested_cpus": collected.requested_cpus, "allocated_cpus": collected.allocated_cpus,
              "scientific_assessment": "NOT_ESTABLISHED", "jobs_launched": 0, "authority_retired": False, "engines": engines.evidence}
    write_new(output/"report.json", canonical(report))
    print(canonical(report).decode())


if __name__ == "__main__":
    main()
