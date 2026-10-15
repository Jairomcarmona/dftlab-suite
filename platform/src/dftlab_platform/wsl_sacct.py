"""Narrow Windows-to-WSL bridge for trusted SLURM completion history."""
from __future__ import annotations

import os
from pathlib import Path
import posixpath
import re

from .runtime_probe import Binary, BoundedCommands, Observation, ProbeFailure


WSL_EXE = Path("/mnt/c/Windows/System32/wsl.exe")
WSL_SHA256 = "fcd08205b608b5c4831e0dcb1801dd274436cd2c8420815f18ae58a085891a18"
SACCT_COMMAND = "/usr/bin/sacct"
SACCT_PATH = Path(SACCT_COMMAND)
SACCT_SHA256 = "20632577ca462f7d570feb56adef7c811fbf5911b9b97810a67a497342e97b71"
WSL_DISTRO = "Ubuntu"
SACCT_FORMAT = "JobID,User,Cluster,State,Start,End"
HISTORY_ENVIRONMENT = {"PATH": "/usr/bin:/bin", "LC_ALL": "C", "LANG": "C", "TZ": "UTC"}


class WslSacctBridge:
    """Runs one fixed sacct completion query through native Windows wsl.exe.

    Hash commands run as the WSL user. Only the pinned ``sacct --completion``
    command runs as root. All processes receive argv directly; no shell is used.
    """

    def __init__(self, sacct: Binary, *, commands=None):
        if sacct.path != SACCT_PATH or sacct.sha256 != SACCT_SHA256:
            raise ValueError("Pinned sacct binary required")
        self.sacct = sacct
        self.wsl = Binary(WSL_EXE, WSL_SHA256)
        self.commands = commands or BoundedCommands(timeout=10, limit=262144)

    @staticmethod
    def _job_id(argv) -> str:
        expected = (SACCT_COMMAND, "--completion", None, "--noheader", "--parsable2",
                    "--format="+SACCT_FORMAT)
        if not isinstance(argv, (tuple, list)) or len(argv) != len(expected):
            raise ProbeFailure("Completion history command is outside the qualified scope")
        for actual, required in zip(argv, expected):
            if required is not None and actual != required:
                raise ProbeFailure("Completion history command is outside the qualified scope")
        match = re.fullmatch(r"--jobs=([1-9][0-9]*)", argv[2]) if isinstance(argv[2], str) else None
        if match is None:
            raise ProbeFailure("Completion history job selector is invalid")
        return match.group(1)

    @staticmethod
    def _environment(environment):
        if not isinstance(environment, dict):
            raise ProbeFailure("WSL interop environment is unavailable")
        result = {str(key): str(value) for key, value in environment.items()}
        interop = os.environ.get("WSL_INTEROP")
        if not interop or not posixpath.isabs(interop) or "\0" in interop:
            raise ProbeFailure("WSL interop environment is unavailable")
        result["WSL_INTEROP"] = interop
        return result

    def _wsl(self, arguments, *, cwd, environment) -> Observation:
        executable = self.wsl.verified()
        try:
            return self.commands.run((str(executable), *arguments), cwd=cwd, environment=environment)
        finally:
            self.wsl.verified()

    def _guest_sacct_sha256(self, *, cwd, environment) -> str:
        observation = self._wsl(("-d", WSL_DISTRO, "--exec", "/usr/bin/sha256sum", SACCT_COMMAND),
                                cwd=cwd, environment=environment)
        if observation.returncode != 0:
            raise ProbeFailure("Pinned sacct hash could not be checked in WSL")
        match = re.fullmatch(r"([0-9a-f]{64})\s+\*?/usr/bin/sacct\s*\n?", observation.output)
        if match is None:
            raise ProbeFailure("Pinned sacct hash response is invalid")
        return match.group(1)

    def run(self, argv, *, cwd, environment) -> Observation:
        job_id = self._job_id(argv)
        child_environment = self._environment(environment)
        before = self._guest_sacct_sha256(cwd=cwd, environment=child_environment)
        if before != SACCT_SHA256:
            raise ProbeFailure("Pinned sacct hash mismatch in WSL")

        root_argv = ("-d", WSL_DISTRO, "-u", "root", "--exec", SACCT_COMMAND,
                     "--completion", "--jobs="+job_id, "--noheader", "--parsable2",
                     "--format="+SACCT_FORMAT)
        failure = None
        observation = None
        try:
            observation = self._wsl(root_argv, cwd=cwd, environment=child_environment)
        except BaseException as exc:
            failure = exc
        try:
            after = self._guest_sacct_sha256(cwd=cwd, environment=child_environment)
        except BaseException as exc:
            if failure is None:
                failure = exc
            after = None
        if failure is not None:
            raise failure
        if after != SACCT_SHA256:
            raise ProbeFailure("Pinned sacct hash mismatch in WSL")
        return observation
