"""Installed QRAFT controller entry for HF-1 (ADR-017 Adenda 9).

QRAFT admits the persistent state directory empty, then its supervisor claims it
with owner.json and launches this console script. The verified bundle is staged
here, after that claim, and only then does HubbardFlow's own entrypoint run with
the unchanged arguments. Nothing is staged before ownership: a state directory
that holds files but no owner is read by QRAFT as tampering.
"""
import importlib
from pathlib import Path, PurePosixPath
import sys

from .contracts import loads
from .domain import Problem
from .hf1_bundle import CONTROLLER_TARGETS, final_root_findings, inspect_bundle, stage_bundle, verify_staged

STAGE_PLAN = "hf1-stage.json"
_PLAN_KEYS = {"schema_version", "bundle", "bundle_sha256", "profile_sha256", "reserved_cpus"}


def _option(argv, name):
    values = [argv[index + 1] for index, item in enumerate(argv[:-1]) if item == name]
    if len(values) != 1:
        raise Problem("PRECONDITION_FAILED")
    return values[0]


def stage(root, argv):
    """Stage (fresh) or verify in place (resume) and return the campaign path."""
    root = Path(root).resolve()
    reservation = PurePosixPath(_option(argv, "--qraft-reservation"))
    campaign = PurePosixPath(_option(argv, "--campaign"))
    parts = reservation.parts
    if (len(parts) != 5 or parts[0] != "work" or parts[2].split("-")[0] != "attempt"
            or parts[3] != ".qraft" or parts[4] != "controller-reservation.json"
            or reservation.is_absolute() or ".." in parts):
        raise Problem("PRECONDITION_FAILED")
    task_id = parts[1]
    if campaign != PurePosixPath("controller-state", task_id, "campaign.v2.json"):
        raise Problem("PRECONDITION_FAILED")
    attempt = root/Path(*parts[:3])
    state_dir = root/"controller-state"/task_id
    plan = loads((attempt/STAGE_PLAN).read_bytes())
    if (not isinstance(plan, dict) or set(plan) != _PLAN_KEYS or plan["schema_version"] != 1
            or type(plan["bundle"]) is not str or type(plan["reserved_cpus"]) is not int):
        raise Problem("PRECONDITION_FAILED")
    relative = PurePosixPath(plan["bundle"])
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        raise Problem("PRECONDITION_FAILED")
    bundle = inspect_bundle(attempt/Path(*relative.parts), expected_sha256=plan["bundle_sha256"],
                            expected_profile_sha256=plan["profile_sha256"], reserved_cpus=plan["reserved_cpus"],
                            allowed_targets=CONTROLLER_TARGETS)
    if not state_dir.is_dir() or not (state_dir/"owner.json").is_file():
        raise Problem("PRECONDITION_FAILED")  # QRAFT must have claimed the directory first
    if {item.name for item in state_dir.iterdir()} - {"owner.json"}:
        return verify_staged(bundle, state_dir)
    findings = final_root_findings(bundle, state_dir)
    if findings:
        print("dftlab-hf1-controller: campaign initialized outside its final root " + str(state_dir)
              + ": " + ", ".join(findings), file=sys.stderr)
        raise Problem("PRECONDITION_FAILED")
    return stage_bundle(bundle, state_dir)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    try:
        stage(Path.cwd(), argv)
    except (Problem, OSError, ValueError, KeyError) as exc:
        print(f"dftlab-hf1-controller: {exc}", file=sys.stderr)
        return 2
    return importlib.import_module("hubbardflow.api.controller").main(argv)
