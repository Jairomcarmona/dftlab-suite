"""Explicit local qualification of installed authoring/package APIs, no jobs.

Not invoked by CI/unit tests or by mounting a view. Does not qualify runtime,
admission, restore, or science. Engine/SLURM installations are not modified.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wheelhouse", type=Path, required=True)
    parser.add_argument("--platform-wheel", type=Path, required=True)
    parser.add_argument("--profile", type=Path, required=True)
    parser.add_argument("--pseudo", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--case", choices=("authoring", "handlers"), default="authoring")
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists() or output == ROOT/"runtime" or not output.is_relative_to(ROOT/"runtime"):
        parser.error("Output must be a NEW child directory under ignored runtime/")
    uv = shutil.which("uv")
    if not uv or sys.version_info[:3] != (3, 12, 10):
        parser.error("uv 0.11.14 and Python 3.12.10 required")
    output.mkdir(parents=True)
    environment = dict(os.environ)
    environment.pop("PYTHONPATH", None)
    environment["PYTHONNOUSERSITE"] = "1"
    report = {"success": False, "scope": "installed public authoring/compiler/package/inspector only; runtime and science PENDING", "commands": []}
    if args.case == "handlers":
        report["scope"] = "installed service-internal typed handlers and public authoring/package; runtime/admission/science PENDING"
    def run(name, command, cwd):
        result = subprocess.run(command, cwd=cwd, env=environment, capture_output=True, timeout=180)
        log = result.stdout+result.stderr
        (output/(name+".log")).write_bytes(log)
        report["commands"].append({"name": name, "exit_code": result.returncode, "log_sha256": hashlib.sha256(log).hexdigest()})
        if result.returncode:
            raise RuntimeError(name+": failed; see private log")
        return result.stdout.decode("utf-8").strip()
    try:
        with tempfile.TemporaryDirectory(prefix="dftlab-native-qualified-") as temporary:
            scratch = Path(temporary).resolve()
            if scratch.is_relative_to(ROOT):
                raise RuntimeError("Consumer must be outside checkout")
            if not run("uv-version", [uv, "--version"], scratch).startswith("uv 0.11.14 "):
                raise RuntimeError("uv version mismatch")
            run("consumer-venv", [uv, "venv", "--python", sys.executable, str(scratch/"venv")], scratch)
            python = scratch/"venv"/("Scripts/python.exe" if os.name == "nt" else "bin/python")
            requirements = output/"requirements.txt"
            run("lock-export", [uv, "export", "--project", str(ROOT/"platform"), "--locked", "--no-dev", "--no-emit-project", "--extra", "engines", "--format", "requirements-txt", "--output-file", str(requirements)], scratch)
            run("dependencies", [uv, "pip", "install", "--python", str(python), "--require-hashes", "-r", str(requirements)], scratch)
            run("platform-install", [uv, "pip", "install", "--python", str(python), "--no-index", "--no-deps", str(args.platform_wheel.resolve())], scratch)
            lock = json.loads((ROOT/"engine-versions.lock.json").read_bytes())
            target = "windows_native_x86_64" if os.name == "nt" else "wsl2_linux_x86_64"
            for name in ("qraft", "hubbardflow"):
                engine = lock["engines"][name]
                expected = engine["targets"][target]["wheel"]
                wheel = args.wheelhouse.resolve()/expected["file"]
                if hashlib.sha256(wheel.read_bytes()).hexdigest() != expected["sha256"] or wheel.stat().st_size != expected["bytes"]:
                    raise RuntimeError("Engine wheel identity mismatch")
                run(name+"-install", [uv, "pip", "install", "--python", str(python), "--no-index", "--no-deps", str(wheel)], scratch)
            run("dependency-consistency", [uv, "pip", "check", "--python", str(python)], scratch)
            shutil.copyfile(args.profile, scratch/"profile.json")
            shutil.copyfile(args.pseudo, scratch/"Si.psml")
            driver = Path(__file__).with_name("qualify_native_authoring.py" if args.case == "authoring" else "qualify_native_handlers.py")
            result = run("native-authoring", [str(python), "-I", str(driver), str(scratch), str(args.wheelhouse.resolve())], scratch)
            observation = json.loads(result)
            report["observation"] = observation
            report["platform_wheel_sha256"] = hashlib.sha256(args.platform_wheel.read_bytes()).hexdigest()
            report["engine_lock_sha256"] = hashlib.sha256((ROOT/"engine-versions.lock.json").read_bytes()).hexdigest()
            for relative in ("workflow.lock.json", "packages/native-qualification-run.zip"):
                source = scratch/relative
                shutil.copyfile(source, output/source.name)
            if args.case == "handlers":
                shutil.copytree(scratch/"evidence", output/"evidence")
                report["evidence_files"] = [{"file": str(path.relative_to(output)), "bytes": path.stat().st_size,
                                             "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                                            for path in sorted((output/"evidence").iterdir()) if path.is_file()]
            report["success"] = True
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        report["error"] = str(error)
    (output/"report.json").write_bytes((json.dumps(report, indent=2)+"\n").encode())
    print(json.dumps({"success": report["success"], "scope": report["scope"]}))
    return 0 if report["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
