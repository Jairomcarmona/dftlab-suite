"""Install pinned engine archives as wheels; probe only metadata/public import/CLI help.

No checkout, PYTHONPATH, private scientific API, SIESTA process or remote job.
The owning repos are never modified; builds use disposable extracted archives.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import tomllib
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to((ROOT / "runtime").resolve()) or output == (ROOT / "runtime").resolve() or output.exists():
        parser.error("Output must be a NEW child directory under ignored runtime/")
    if platform.python_version() != "3.12.10":
        parser.error("CPython 3.12.10 required; use the isolated engine-probe uv lock")
    output.mkdir(parents=True)
    lock = json.loads((ROOT / "engine-versions.lock.json").read_text(encoding="utf-8"))
    target = "windows_native_x86_64" if os.name == "nt" else "wsl2_linux_x86_64" if "microsoft" in platform.release().lower() else "linux_x86_64"
    report = {"schema_version": 1, "scope": "installation/import/CLI help only", "target": target, "environment": {"os": platform.system(), "release": platform.release(), "machine": platform.machine(), "python": platform.python_version()}, "dependency_lock_sha256": hashlib.sha256((ROOT / lock["engine_probe_dependency_lock"]).read_bytes()).hexdigest(), "engines": {}}
    uv = shutil.which("uv")
    env = dict(os.environ)
    env.pop("PYTHONPATH", None)
    env["PYTHONNOUSERSITE"] = "1"
    env["SOURCE_DATE_EPOCH"] = "315532800"

    def run(name: str, command: list[str], cwd: Path, required: bool = True) -> dict:
        p = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)
        text = p.stdout + p.stderr
        (output / f"{name}.log").write_text(text, encoding="utf-8")
        result = {"exit_code": p.returncode, "log_sha256": hashlib.sha256(text.encode()).hexdigest(), "stdout": p.stdout.strip(), "stderr": p.stderr.strip()}
        if required and p.returncode:
            raise RuntimeError(f"{name}: exit {p.returncode}; see log")
        return result

    with tempfile.TemporaryDirectory(prefix="dftlab-engine-install-") as temporary:
        scratch = Path(temporary).resolve()
        if scratch.is_relative_to(ROOT):
            parser.error("Temporary archive extraction must be outside the checkout")
        if not uv or not run("uv-version", [uv, "--version"], scratch)["stdout"].startswith("uv 0.11.14 "):
            parser.error("uv 0.11.14 required")
        for key, engine in lock["engines"].items():
            evidence = {"source_commit": engine["commit"], "installed": False, "scientific_qualification": "PENDING", "hpc_runtime_qualification": "PENDING"}
            report["engines"][key] = evidence
            try:
                if not re.fullmatch(r"[0-9a-f]{40}", engine["commit"]) or not re.fullmatch(r"https://github.com/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+", engine["repository"]):
                    raise ValueError("Invalid immutable source identity")
                slug = engine["repository"].removeprefix("https://github.com/")
                url = f"https://api.github.com/repos/{slug}/tarball/{engine['commit']}"
                archive = output / f"{key}-{engine['commit']}.tar.gz"
                with urlopen(Request(url, headers={"User-Agent": "DFTLab-engine-install-probe"}), timeout=60) as response:
                    with archive.open("xb") as stream:
                        shutil.copyfileobj(response, stream)
                evidence["source_archive"] = {"url": url, "file": archive.name, "bytes": archive.stat().st_size, "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}
                expected_archive = engine.get("source_archive_sha256")
                if expected_archive and expected_archive != evidence["source_archive"]["sha256"]:
                    raise RuntimeError("Immutable archive hash differs from recorded lock evidence")
                extracted = scratch / key
                extracted.mkdir()
                # Distribution inputs only. Archived campaign results are not wheel
                # inputs; extracting them needlessly exceeds Windows path limits.
                packaging_files = {"pyproject.toml", "setup.py", "setup.cfg", "MANIFEST.in", "README.md", "LICENSE", "LICENSE.txt", "LICENCE", "COPYING", "NOTICE"}
                with tarfile.open(archive) as tar:
                    members = tar.getmembers()
                    roots = {PurePosixPath(member.name).parts[0] for member in members if PurePosixPath(member.name).parts}
                    if len(roots) != 1:
                        raise RuntimeError("Expected one immutable source archive root")
                    if not next(iter(roots)).endswith("-" + engine["commit"][:7]):
                        raise RuntimeError("Source archive root does not identify the requested commit")
                    selected = [member for member in members if len(PurePosixPath(member.name).parts) >= 2 and (PurePosixPath(member.name).parts[1] == "src" or len(PurePosixPath(member.name).parts) == 2 and PurePosixPath(member.name).parts[1] in packaging_files)]
                    tar.extractall(extracted, members=selected, filter="data")
                evidence["extraction_scope"] = "src/ plus packaging metadata; campaign/results archives excluded, source bytes unmodified"
                directories = list(extracted.iterdir())
                if len(directories) != 1 or not directories[0].is_dir():
                    raise RuntimeError("Expected one archive root")
                source = directories[0]
                metadata = tomllib.loads((source / "pyproject.toml").read_text(encoding="utf-8"))["project"]
                if metadata["name"] != engine["distribution"] or metadata["version"] != engine["declared_version"]:
                    raise RuntimeError("Distribution metadata differs from the pinned lock")
                evidence["declared_metadata"] = {"distribution": metadata["name"], "version": metadata["version"], "requires_python": metadata.get("requires-python"), "dependencies": metadata.get("dependencies", [])}
                destination = output / f"{key}-wheel"
                run(key+"-build", [uv,"build",str(source),"--python",sys.executable,"--no-build-isolation","--wheel","--out-dir",str(destination),"--no-create-gitignore"], scratch)
                wheels = list(destination.glob("*.whl"))
                if len(wheels) != 1:
                    raise RuntimeError("Expected one wheel")
                wheel = wheels[0]
                evidence["wheel"] = {"file": wheel.name,"bytes":wheel.stat().st_size,"sha256":hashlib.sha256(wheel.read_bytes()).hexdigest()}
                expected_wheel = engine.get("targets", {}).get(target, {}).get("wheel", {}).get("sha256")
                if expected_wheel and expected_wheel != evidence["wheel"]["sha256"]:
                    raise RuntimeError("Wheel hash differs from recorded evidence for this target")
                run(key+"-install", [uv,"pip","install","--python",sys.executable,"--no-index","--no-deps","--reinstall",str(wheel)], scratch)
                distribution = importlib.metadata.distribution(engine["distribution"])
                evidence["installed"] = True
                evidence["installed_distribution"] = distribution.metadata["Name"]
                evidence["installed_version"] = distribution.version
                evidence["installed_file_manifest_sha256"] = hashlib.sha256(distribution.read_text("RECORD").encode()).hexdigest()
                evidence["entrypoints"] = {entry.name: entry.value for entry in distribution.entry_points if entry.group == "console_scripts"}
                # Only top-level public module import: no calls to private engine APIs.
                probe = f"import importlib,json,pathlib,sys; m=importlib.import_module({engine['module']!r}); p=pathlib.Path(m.__file__).resolve(); assert p.is_relative_to(pathlib.Path(sys.prefix).resolve()); print(json.dumps({{'module':m.__name__,'installed_outside_checkout':True}}))"
                evidence["public_import"] = run(key+"-import", [sys.executable,"-I","-c",probe], scratch, required=False)
                executable = Path(sys.executable).parent / (engine["entrypoint"] + (".exe" if os.name=="nt" else ""))
                evidence["cli_help"] = run(key+"-cli-help", [str(executable),"--help"], scratch, required=False)
                evidence["status"] = "INSTALL_IMPORT_HELP_VERIFIED" if evidence["public_import"]["exit_code"] == evidence["cli_help"]["exit_code"] == 0 else "INSTALLED_WITH_IMPORT_OR_CLI_LIMITATION"
            except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired, tarfile.TarError) as error:
                evidence["status"] = "PENDING_OR_FAILED"
                evidence["error"] = str(error)
    report["dependency_versions"] = {name: importlib.metadata.version(name) for name in ["setuptools","wheel","PyYAML","numpy","jsonschema"]}
    (output / "report.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"target":target,"engines":{key:{"status":value.get("status"),"installed":value["installed"]} for key,value in report["engines"].items()}},indent=2))
    return 0 if all(e["installed"] for e in report["engines"].values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
