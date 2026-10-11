"""Dedicated installed HF1 bridge, using only native public facade and CLI.

QRAFT owns the exterior allocation/task. This process hosts one foreground
HubbardFlow worker, never submits sbatch, never edits scientific policy, and
closes local descendants before returning. Only one-node WSL/Linux is scoped.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
from threading import Event
import time

from .checkpoints import checked_path, open_original, write_new
from .contracts import canonical, loads
from .domain import Problem
from .engines import PinnedEngines
from .hf1_bundle import inspect_bundle
from .hf1_children import OwnedLinuxChildren
from .native_checkpoints import inventory_native


def run(request_path):
    if not sys.flags.isolated or "PYTHONPATH" in os.environ or not sys.platform.startswith("linux") or not os.environ.get("SLURM_JOB_ID", "").isdigit() or any(name in os.environ for name in ("OMPI_COMM_WORLD_RANK", "PMI_RANK", "PMIX_RANK")):
        raise Problem("PRECONDITION_FAILED")
    request_path = checked_path(request_path)
    with open_original(request_path) as source:
        raw_request = source.read(65537)
    if len(raw_request) > 65536:
        raise Problem("PAYLOAD_TOO_LARGE")
    request = loads(raw_request)
    required = {"schema_version", "outer_run_id", "task_id", "attempt_id", "bundle", "bundle_sha256", "profile_sha256", "reserved_cpus", "wheelhouse", "max_seconds", "grace_seconds", "campaign_id"}
    if not isinstance(request, dict) or set(request) != required or request["schema_version"] != 1 or type(request["schema_version"]) is not int or type(request["max_seconds"]) is not int or not 1 <= request["max_seconds"] <= 3600 or type(request["grace_seconds"]) is not int or not 1 <= request["grace_seconds"] <= 10 or any(type(request[field]) is not str or not 1 <= len(request[field]) <= 256 for field in ("outer_run_id", "task_id", "attempt_id", "campaign_id")):
        raise Problem("PRECONDITION_FAILED")
    engines = PinnedEngines(checked_path(request["wheelhouse"]))
    bundle = inspect_bundle(checked_path(request["bundle"]), expected_sha256=request["bundle_sha256"], expected_profile_sha256=request["profile_sha256"], reserved_cpus=request["reserved_cpus"])
    root = request_path.parent
    campaign_root = checked_path(root/"hf1")
    directories, inventory = inventory_native(campaign_root, 4096, 256*1024**2)
    expected = {name: hashlib.sha256(data).hexdigest() for name, data in bundle.files}
    if request["campaign_id"] != bundle.campaign_id or {item["path"]: item["sha256"] for item in inventory} != expected:
        raise Problem("PRECONDITION_FAILED")
    campaign = campaign_root/"campaign.v2.json"
    children = OwnedLinuxChildren()
    cancel = Event()
    previous = {}
    for number in (signal.SIGTERM, signal.SIGINT, signal.SIGUSR1):
        previous[number] = signal.signal(number, lambda *_: cancel.set())
    started, stop_at, escalated = time.monotonic(), None, False
    process = None
    try:
        with (root/"hf1-cli.stdout").open("xb") as stdout, (root/"hf1-cli.stderr").open("xb") as stderr:
            process = subprocess.Popen([sys.executable, "-I", "-m", "hubbardflow.cli", "run", str(campaign)], cwd=campaign_root, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, start_new_session=True)
            while process.poll() is None:
                children.descendants()  # tracks descendants, no generic kill name
                if time.monotonic()-started >= request["max_seconds"]:
                    cancel.set()
                if cancel.is_set() and stop_at is None:
                    stop_at = time.monotonic()
                    # Public stop is a request. Its exit code never establishes
                    # termination; original response remains private evidence.
                    with (root/"hf1-stop.stdout").open("xb") as stop_out, (root/"hf1-stop.stderr").open("xb") as stop_err:
                        try:
                            subprocess.run([sys.executable, "-I", "-m", "hubbardflow.cli", "stop", str(campaign)], cwd=campaign_root, stdin=subprocess.DEVNULL, stdout=stop_out, stderr=stop_err, timeout=10, check=False)
                        except subprocess.TimeoutExpired:
                            pass
                if stop_at is not None and time.monotonic()-stop_at >= request["grace_seconds"]:
                    children.signal_all(signal.SIGTERM if not escalated else signal.SIGKILL)
                    escalated = True
                if stop_at is not None and time.monotonic()-stop_at > request["grace_seconds"]+15:
                    raise Problem("PRECONDITION_FAILED")
                time.sleep(0.05)
            exit_code = process.wait()
        leftover = any(row[3] != "Z" for row in children.descendants().values())
        children.close(grace_seconds=request["grace_seconds"])
        # Reconfirm the original installed motor bytes after the CLI returns.
        repeated = PinnedEngines(checked_path(request["wheelhouse"]))
        if repeated.evidence != engines.evidence:
            raise Problem("PRECONDITION_FAILED")
        state_path = campaign_root/".siestaflow/worker-state.json"
        state_bytes = None
        if state_path.exists():
            with open_original(checked_path(state_path)) as source:
                state_bytes = source.read(1024**2+1)
        if state_bytes is not None and len(state_bytes) > 1024**2:
            raise Problem("PAYLOAD_TOO_LARGE")
        receipt = None if state_bytes is None else engines.hubbardflow.worker_status({"snapshot": loads(state_bytes)}).to_mapping()
        observed = {} if state_bytes is None else loads(state_bytes)
        if observed and observed.get("campaign_id") != bundle.campaign_id:
            raise Problem("PRECONDITION_FAILED")
        _, files = inventory_native(campaign_root, 4096, 256*1024**2)
        result = {"schema_version": 1, "kind": "dftlab.hf1.worker-result", "outer_run_id": request["outer_run_id"], "task_id": request["task_id"], "attempt_id": request["attempt_id"], "campaign_id": bundle.campaign_id,
                  "bundle_sha256": bundle.sha256, "exit_code": exit_code, "cancel_requested": cancel.is_set(), "local_children_closed": True, "orphan_observed": leftover,
                  "native_worker_receipt": receipt, "worker_state_sha256": None if state_bytes is None else hashlib.sha256(state_bytes).hexdigest(), "native_files": files,
                  "engines": engines.evidence, "scientific_assessment": "NOT_ESTABLISHED", "quantity_kind": "U_scalar_charge"}
        write_new(root/"hf1-result.json", canonical(result))
        print(canonical(result).decode("utf-8"), flush=True)
        # A closed local child namespace is not scheduler terminal evidence.
        return 130 if cancel.is_set() else (1 if leftover else exit_code)
    except BaseException:
        if process is not None:
            children.signal_all(signal.SIGKILL)
            process.wait(timeout=10)
            children.close(grace_seconds=0)
        raise
    finally:
        for number, handler in previous.items():
            signal.signal(number, handler)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("request", type=Path)
    args = parser.parse_args()
    return run(args.request)


if __name__ == "__main__":
    raise SystemExit(main())
