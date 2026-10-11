"""Explicit POSIX installed-consumer observation; never a job submission.

Use only operator-created configuration in a private local workspace. A profile
byte hash correlates evidence, it does not validate its native execution policy.
RunPreparer/admission must separately validate and bind that policy before use.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import sys

from dftlab_platform.contracts import loads
from dftlab_platform.local_runtime import private_directory
from dftlab_platform.runtime_probe import Binary, ProbeSettings, SlurmRuntimeProbe


def write(path, value):
    # Destination is a new private directory, no existing evidence is replaced.
    with path.open("xb") as stream:
        stream.write((json.dumps(value, indent=2)+"\n").encode("utf-8"))
        stream.flush()
        os.fsync(stream.fileno())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--profile-bytes", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()
    if platform.python_version() != "3.12.10" or os.name == "nt":
        raise RuntimeError("Requires the qualified POSIX Python 3.12.10 worker")
    if arguments.output.exists():
        raise RuntimeError("Evidence output already exists")
    config = loads(arguments.config.read_bytes())
    required = {"project_id", "profile_id", "revision", "executable", "mpi", "sinfo", "scontrol", "sbatch", "partition", "node", "ranks", "threads_per_rank", "memory_mb"}
    if set(config) != required:
        raise RuntimeError("Operator configuration keys differ")
    def binary(name):
        value = config[name]
        if value is None and name == "mpi":
            return None
        if set(value) != {"path", "sha256"}:
            raise RuntimeError("Operator binary pin keys differ")
        return Binary(Path(value["path"]), value["sha256"])
    profile_bytes = arguments.profile_bytes.read_bytes()
    settings = ProbeSettings(config["profile_id"], config["revision"], hashlib.sha256(profile_bytes).hexdigest(),
                             binary("executable"), binary("mpi"), binary("sinfo"), binary("scontrol"), binary("sbatch"),
                             config["partition"], config["node"], config["ranks"], config["threads_per_rank"], config["memory_mb"],
                             arguments.output.absolute()/"workspace")
    settings.validate()
    private_directory(arguments.output)
    result = SlurmRuntimeProbe().observe(config["project_id"], settings)
    write(arguments.output/"runtime-probe-receipt.json", result.receipt)
    write(arguments.output/"private-observations.json", result.evidence)
    module = Path(sys.modules["dftlab_platform.runtime_probe"].__file__).resolve()
    report = {"success": True, "python": platform.python_version(), "system": platform.platform(),
              "installed_module": str(module), "isolated_python": bool(sys.flags.isolated),
              "receipt_sha256": hashlib.sha256((arguments.output/"runtime-probe-receipt.json").read_bytes()).hexdigest(),
              "observations_sha256": hashlib.sha256((arguments.output/"private-observations.json").read_bytes()).hexdigest(),
              "profile_sha256": settings.profile_sha256, "profile_policy_validated": False,
              "submission_performed": False, "scientific_assessment": "NOT_ESTABLISHED"}
    write(arguments.output/"report.json", report)
    descriptor = os.open(arguments.output, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    print(json.dumps({key: value for key, value in report.items() if key != "installed_module"}))


if __name__ == "__main__":
    main()
