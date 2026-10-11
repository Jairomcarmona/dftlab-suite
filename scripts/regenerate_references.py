#!/usr/bin/env python3
"""Qualify the existing reference generators in a disposable source copy.

Never promotes generated data into the authoritative fixtures. Requires the
locked tools/reference-env environment and Node from the frontend contract.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
import tomllib

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / "tools/reference-env"
GENERATORS = (
    "app/tests/siesta/make_reference.py",
    "app/tests/siesta/make_rho_reference.py",
    "app/tests/siesta/make_fc_reference.py",
    "app/tests/crystal/make_reference.py",
)
OUTPUTS = (
    "app/tests/siesta/fixtures/reference.json",
    "app/tests/siesta/fixtures_grid/reference.json",
    "app/tests/siesta/fixtures_fc/reference.json",
    "app/tests/crystal/reference.json",
)
SUITES = (
    "app/tests/siesta/run_tests.mjs",
    "app/tests/siesta/run_rho_tests.mjs",
    "app/tests/siesta/run_outnotes_tests.mjs",
    "app/tests/siesta/run_fc_tests.mjs",
    "app/tests/siesta/run_import_tests.mjs",
    "app/tests/crystal/run_tests.mjs",
)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_manifest():
    paths = [ROOT / "app/package.json"]
    for relative in ("app/tests/siesta", "app/tests/crystal", "app/dftlab/static"):
        paths.extend(p for p in (ROOT / relative).rglob("*")
                     if p.is_file() and "__pycache__" not in p.parts)
    return {p.relative_to(ROOT).as_posix(): digest(p) for p in sorted(paths)}


def environment():
    spec = tomllib.loads((ENV / "pyproject.toml").read_text(encoding="utf-8"))
    expected_python = spec["project"]["requires-python"].removeprefix("==")
    if platform.python_version() != expected_python:
        raise RuntimeError(f"Requires Python {expected_python}; use uv run --locked")
    if sys.platform != "linux" or platform.machine() != "x86_64":
        raise RuntimeError("Qualified environment is Linux x86_64 (WSL2 on Windows)")
    if Path(sys.prefix).resolve() != (ENV / ".venv").resolve():
        raise RuntimeError("Use the isolated tools/reference-env/.venv via uv run")
    versions = {}
    for requirement in spec["project"]["dependencies"]:
        name, expected = requirement.split("==")
        actual = importlib.metadata.version(name)
        if actual != expected:
            raise RuntimeError(f"Requires {name}=={expected}; found {actual}")
        versions[name] = actual
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node is required to check regenerated references")
    node_version = subprocess.check_output([node, "--version"], text=True).strip()
    expected_node = json.loads((ROOT / "app/package.json").read_text())["engines"]["node"]
    if node_version != f"v{expected_node}":
        raise RuntimeError(f"Requires Node {expected_node}; found {node_version}")
    uv = shutil.which("uv")
    if not uv:
        raise RuntimeError("uv is required for environment provenance")
    uv_version = subprocess.check_output([uv, "--version"], text=True).strip()
    expected_uv = spec["tool"]["uv"]["required-version"].removeprefix("==")
    if uv_version.split()[1] != expected_uv:
        raise RuntimeError(f"Requires uv {expected_uv}; found {uv_version}")
    return node, {"python": platform.python_version(), "node": node_version,
                  "uv": uv_version,
                  "platform": platform.platform(), "machine": platform.machine(),
                  "packages": versions, "uv_lock_sha256": digest(ENV / "uv.lock")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", default="runtime/reference-validation",
                        help="New directory under runtime/ or outside the repository")
    args = parser.parse_args()
    target = Path(args.output_dir).resolve()
    runtime = ROOT / "runtime"
    if target == runtime or target == ROOT or ROOT.is_relative_to(target):
        parser.error("Output must be a new child directory, never a source/ancestor directory")
    if target.is_relative_to(ROOT) and not target.is_relative_to(runtime):
        parser.error("Inside the repository, output must be under runtime/")
    if target.exists():
        parser.error("Output exists; select a new directory (no automatic deletion)")

    node, report = environment()
    before = source_manifest()
    target.mkdir(parents=True)
    logs = target / "logs"
    logs.mkdir()
    report.update(schema_version=1, success=False, source_sha256=before,
                  steps=[], generated_sha256={}, changed_outputs=[])
    child_env = os.environ.copy()
    child_env.pop("PYTHONPATH", None)
    child_env.update(PYTHONUTF8="1", PYTHONNOUSERSITE="1", MPLBACKEND="Agg",
                     OPENBLAS_NUM_THREADS="1", OMP_NUM_THREADS="1", MKL_NUM_THREADS="1")

    def run(command, relative, workspace):
        log_name = relative.replace("/", "_") + ".log"
        print(f"Running {relative}", flush=True)
        step = {"script": relative, "log": f"logs/{log_name}", "returncode": None}
        report["steps"].append(step)
        with (logs / log_name).open("w", encoding="utf-8") as log:
            result = subprocess.run(command + [str(workspace / relative)],
                                    cwd=workspace, env=child_env, stdout=log,
                                    stderr=subprocess.STDOUT, timeout=300)
        step["returncode"] = result.returncode
        if result.returncode:
            raise RuntimeError(f"{relative} failed; see {logs / log_name}")

    try:
        with tempfile.TemporaryDirectory(prefix="dftlab-reference-") as scratch:
            workspace = Path(scratch).resolve()
            # Cleanup belongs only to tempfile's newly created directory.
            if workspace.parent != Path(tempfile.gettempdir()).resolve():
                raise RuntimeError("Unexpected temporary directory location")
            for relative in ("app/tests/siesta", "app/tests/crystal", "app/dftlab/static"):
                shutil.copytree(ROOT / relative, workspace / relative,
                                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
            shutil.copy2(ROOT / "app/package.json", workspace / "app/package.json")
            for relative in GENERATORS:
                run([sys.executable, "-X", "utf8"], relative, workspace)
            for relative in OUTPUTS:
                generated = workspace / relative
                json.loads(generated.read_text(encoding="utf-8"))
                report["generated_sha256"][relative] = digest(generated)
                if digest(generated) != before[relative]:
                    report["changed_outputs"].append(relative)
                destination = target / "references" / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(generated, destination)
            shutil.copytree(workspace / "app/tests/crystal/fixtures",
                            target / "references/app/tests/crystal/fixtures")
            for relative in SUITES:
                run([node], relative, workspace)
        report["success"] = True
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
        report["error"] = str(exc)
        print(str(exc), file=sys.stderr)
    finally:
        report["authoritative_sources_unchanged"] = source_manifest() == before
        if not report["authoritative_sources_unchanged"]:
            report["success"] = False
            report["error"] = "Authoritative sources changed during qualification"
        (target / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Report: {target / 'report.json'}", flush=True)
    return 0 if report["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
