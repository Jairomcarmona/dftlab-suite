"""Build locked platform artifacts and test a wheel installed outside the checkout."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "runtime" / "platform-qualification")
    parser.add_argument("--source-commit", help="Explicit Git identity when building a source copy or a WSL-mounted Windows worktree")
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to((ROOT / "runtime").resolve()) or output == (ROOT / "runtime").resolve() or output.exists():
        parser.error("Output must be a NEW child directory under ignored runtime/")
    output.mkdir(parents=True)
    report = {"schema_version": 1, "success": False, "target": {"os": platform.system(), "release": platform.release(), "machine": platform.machine(), "python": platform.python_version()}, "commands": [], "artifacts": []}
    environment = dict(os.environ)
    environment.pop("PYTHONPATH", None)
    environment["PYTHONNOUSERSITE"] = "1"
    environment["SOURCE_DATE_EPOCH"] = "315532800"  # reproducible archive timestamps (1980-01-01)
    uv = shutil.which("uv")

    def run(name: str, command: list[str], cwd: Path = ROOT) -> str:
        result = subprocess.run(command, cwd=cwd, env=environment, text=True, encoding="utf-8", errors="replace", capture_output=True, timeout=180)
        text = result.stdout + result.stderr
        (output / f"{name}.log").write_text(text, encoding="utf-8")
        report["commands"].append({"name": name, "argv": command, "exit_code": result.returncode, "log_sha256": hashlib.sha256(text.encode()).hexdigest()})
        if result.returncode:
            raise RuntimeError(f"{name}: exit {result.returncode}; see its log")
        return result.stdout.strip()

    try:
        if platform.python_version() != "3.12.10":
            raise RuntimeError("Run through uv's locked CPython 3.12.10 environment")
        if not uv or not run("uv-version", [uv, "--version"]).startswith("uv 0.11.14 "):
            raise RuntimeError("uv 0.11.14 required")
        if args.source_commit:
            if not re.fullmatch(r"[0-9a-f]{40}", args.source_commit):
                raise RuntimeError("Source commit must be a full SHA; source contents are hashed separately")
            report["source_commit"] = args.source_commit
            report["source_identity_origin"] = "explicit_cli; source contents verified by manifest"
            report["source_tree_dirty"] = None  # Git metadata not available in this mode.
        else:
            report["source_commit"] = run("source-commit", ["git", "rev-parse", "HEAD"])
            report["source_identity_origin"] = "git_worktree"
            report["source_tree_dirty"] = bool(run("source-status", ["git", "status", "--porcelain"]))
        source_paths = [p for p in (ROOT / "platform").rglob("*") if p.is_file() and ".venv" not in p.parts and "__pycache__" not in p.parts]
        before = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in source_paths}
        report["source_sha256"] = before
        build = output / "artifacts"
        run("build", [uv, "build", str(ROOT / "platform"), "--python", sys.executable, "--no-build-isolation", "--wheel", "--sdist", "--out-dir", str(build), "--no-create-gitignore"])
        wheels = list(build.glob("*.whl"))
        if len(wheels) != 1 or len(list(build.glob("*.tar.gz"))) != 1:
            raise RuntimeError("Expected exactly one wheel and one source archive")
        wheel = wheels[0]
        with zipfile.ZipFile(wheel) as archive:
            bundled = {p.relative_to(ROOT / "contracts").as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT / "contracts").rglob("*") if p.is_file()}
            for relative, expected in bundled.items():
                if hashlib.sha256(archive.read("dftlab_platform/resources/contracts/" + relative)).hexdigest() != expected:
                    raise RuntimeError("Bundled contracts differ from authoritative sources")
            report["bundled_contract_sha256"] = bundled
        for artifact in sorted(build.iterdir()):
            report["artifacts"].append({"file": artifact.name, "bytes": artifact.stat().st_size, "sha256": hashlib.sha256(artifact.read_bytes()).hexdigest()})
        with tempfile.TemporaryDirectory(prefix="dftlab-installed-") as temporary:
            isolated = Path(temporary).resolve()
            if isolated.is_relative_to(ROOT):
                raise RuntimeError("Installation test must live outside the checkout")
            rebuilt = isolated / "rebuilt"
            source_archive = next(build.glob("*.tar.gz"))
            run("rebuild-sdist", [uv, "build", str(source_archive), "--python", sys.executable, "--no-build-isolation", "--wheel", "--out-dir", str(rebuilt), "--no-create-gitignore"], cwd=isolated)
            rebuilt_wheels = list(rebuilt.glob("*.whl"))
            if len(rebuilt_wheels) != 1 or hashlib.sha256(rebuilt_wheels[0].read_bytes()).digest() != hashlib.sha256(wheel.read_bytes()).digest():
                raise RuntimeError("Rebuilt source distribution differs from the tested wheel")
            report["sdist_rebuild_matches_wheel"] = True
            venv = isolated / "venv"
            run("clean-venv", [uv, "venv", "--python", sys.executable, str(venv)], cwd=isolated)
            python = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            requirements = isolated / "requirements.txt"
            run("runtime-lock-export", [uv, "export", "--project", str(ROOT / "platform"), "--locked", "--no-dev", "--no-emit-project", "--format", "requirements-txt", "--output-file", str(requirements)])
            run("runtime-dependencies", [uv, "pip", "install", "--python", str(python), "--require-hashes", "-r", str(requirements)], cwd=isolated)
            run("wheel-install", [uv, "pip", "install", "--python", str(python), "--no-index", "--no-deps", str(wheel)], cwd=isolated)
            shutil.copytree(ROOT / "platform" / "tests", isolated / "tests", ignore=shutil.ignore_patterns("__pycache__"))
            # -I excludes cwd and environment paths; only unittest's explicit
            # test directory is added, never the platform source checkout.
            script = "import unittest,sys; suite=unittest.defaultTestLoader.discover(sys.argv[1]); result=unittest.TextTestRunner(verbosity=2).run(suite); sys.exit(not result.wasSuccessful())"
            run("installed-tests", [str(python), "-I", "-c", script, str(isolated / "tests")], cwd=isolated)
        after = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in source_paths}
        report["authoritative_sources_unchanged"] = before == after
        if before != after:
            raise RuntimeError("Platform sources changed during qualification")
        report["installed_without_checkout_or_pythonpath"] = True
        report["scope"] = "installed platform and bundled contracts; no scientific/HPC qualification"
        report["success"] = True
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
        report["error"] = str(error)
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
