"""Local installed API/processor lifecycle. Never a remote controller authority."""

from __future__ import annotations

import argparse
import ctypes
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid
import webbrowser

from . import __version__

HEARTBEAT_SECONDS = 0.2
STALE_SECONDS = 3.0
TIMEOUT_SECONDS = 10.0


def _default_state() -> Path:
    if os.name == "nt":
        return Path(os.environ.get("LOCALAPPDATA", Path.home())) / "DFTLabPlatform" / "launcher"
    return Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state")) / "dftlab-platform" / "launcher"


def _read(path: Path) -> dict | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError("Launcher record is not an object")
        return value
    except FileNotFoundError:
        return None


def _write(path: Path, data: dict) -> None:
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as stream:
            json.dump(data, stream)
        deadline = time.monotonic()+1.0
        while True:
            try:
                os.replace(temporary, path)
                break
            except PermissionError as error:
                # Windows readers can briefly deny rename of an open heartbeat.
                # Retry this owned atomic write, never truncate the live record.
                if os.name != "nt" or error.winerror not in {5, 32} or time.monotonic() >= deadline:
                    raise
                time.sleep(0.01)
    finally:
        temporary.unlink(missing_ok=True)


def _lease(state: Path) -> dict | None:
    record = _read(state / "launcher.lock")
    if record is not None:
        # This is an ownership identifier, not an authentication/session token.
        uuid.UUID(record["instance_id"])
    return record


def _status(state: Path) -> dict:
    lease = _lease(state)
    if lease is None:
        return {"status": "stopped", "version": __version__, "scope": "local-api"}
    pulse = _read(state / "heartbeat.json")
    if pulse is None or pulse.get("instance_id") != lease["instance_id"]:
        status = "starting"
    elif 0 <= time.time() - pulse["updated_at"] <= STALE_SECONDS:
        status = "running"
    else:
        status = "unknown"  # Do not infer process death or reuse a stale lease.
    return {"status": status, "version": __version__, "scope": "local-api", "instance_id": lease["instance_id"], "pid": pulse.get("pid") if pulse else None, "url": pulse.get("url") if pulse else None, "api_version": pulse.get("api_version") if pulse else None}


def _owned(state: Path, instance: str) -> bool:
    current = _lease(state)
    return current is not None and current["instance_id"] == instance


def _request_stop(state: Path, instance: str) -> None:
    _write(state / f"stop-{instance}.json", {"instance_id": instance})


def _wait_stopped(state: Path, instance: str) -> bool:
    deadline = time.monotonic() + TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if not _owned(state, instance):
            return True
        time.sleep(HEARTBEAT_SECONDS)
    return False


def _start(state: Path, base_path="", local_run_options=None) -> tuple[dict, int]:
    from .local_runtime import private_directory
    state = private_directory(state)
    instance = str(uuid.uuid4())
    lock = state / "launcher.lock"
    try:
        descriptor = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return {"error": "INSTANCE_ALREADY_RESERVED", **_status(state)}, 2
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump({"instance_id": instance}, stream)
    environment = dict(os.environ)
    environment.pop("PYTHONPATH", None)
    kwargs = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {"start_new_session": True}
    try:
        command = [sys.executable, "-I", "-m", "dftlab_platform.launcher", "_run", "--state-dir", str(state), "--instance-id", instance, "--base-path", base_path]
        if local_run_options is not None:
            command.append("--local-run")
            for option, key in (("--site-config", "site_config"), ("--profile", "profile"),
                                ("--pseudo", "pseudo"), ("--wheelhouse", "wheelhouse")):
                command.extend((option, str(local_run_options[key])))
        child = subprocess.Popen(
            command,
            cwd=state.parent, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            **kwargs,
        )
        deadline = time.monotonic() + TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise RuntimeError("Local runtime exited before readiness")
            status = _status(state)
            if status["status"] == "running" and status.get("instance_id") == instance:
                return status, 0
            time.sleep(HEARTBEAT_SECONDS)
        _request_stop(state, instance)
        _wait_stopped(state, instance)
        return {"error": "START_TIMEOUT", **_status(state)}, 2
    except OSError:
        if _owned(state, instance):
            lock.unlink()
        raise
    except RuntimeError:
        # The API may have started a processor before failing. Keep the lease
        # until recover-local proves both local kernel locks are free.
        raise


def _stop(state: Path) -> tuple[dict, int]:
    current = _lease(state)
    if current is None:
        return _status(state), 0
    instance = current["instance_id"]
    handle = None
    if os.name == "nt":
        pulse = _read(state / "heartbeat.json")
        if pulse and pulse.get("instance_id") == instance:
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
            kernel.OpenProcess.restype = ctypes.c_void_p
            handle = kernel.OpenProcess(0x00100000, False, pulse["pid"])
    try:
        _request_stop(state, instance)
        if _wait_stopped(state, instance):
            # Wait only; never terminate a PID. Capture the Windows process
            # handle before cooperative stop so PID recycling cannot change it.
            if handle:
                kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
                kernel.WaitForSingleObject.restype = ctypes.c_uint32
                if kernel.WaitForSingleObject(handle, int(TIMEOUT_SECONDS*1000)) != 0:
                    return {"error": "STOP_TIMEOUT", "status": "unknown"}, 2
            return {"status": "stopped", "instance_id": instance, "version": __version__, "scope": "local-api"}, 0
        return {"error": "STOP_TIMEOUT", **_status(state)}, 2
    finally:
        if handle:
            kernel.CloseHandle.argtypes = [ctypes.c_void_p]
            kernel.CloseHandle(handle)


def _run(state: Path, instance: str, base_path="", local_run_options=None) -> int:
    from .runtime import serve
    code = serve(state, instance, base_path, local_run_options=local_run_options)
    if code == 0:
        # Only release the lease still owned by this child. No PID based kills.
        if _owned(state, instance):
            (state / "heartbeat.json").unlink(missing_ok=True)
            (state / "launcher.lock").unlink(missing_ok=True)
        (state / f"stop-{instance}.json").unlink(missing_ok=True)
    return code


def _recover_local(state: Path):
    from .local_runtime import local_lock, private_directory
    state = private_directory(state)
    with local_lock(state / "service.guard"), local_lock(state / "processor.guard"):
        lease = _lease(state)
        if lease is None:
            return _status(state), 0
        # Kernel locks prove no previous API/processor is alive; this repairs
        # only local runtime bookkeeping, never remote run authority.
        instance = lease["instance_id"]
        if _owned(state, instance):
            for name in ("access.json", "heartbeat.json", "launcher.lock", f"stop-{instance}.json"):
                (state / name).unlink(missing_ok=True)
        return {"status": "stopped", "scope": "local-api", "version": __version__}, 0


def main() -> int:
    parser = argparse.ArgumentParser(description="DFT Lab local API and durable processor")
    parser.add_argument("command", choices=["start", "status", "stop", "recover-local", "budget", "_run"])
    parser.add_argument("budget_command", nargs="?", choices=["add"])
    parser.add_argument("--state-dir", type=Path, default=_default_state())
    parser.add_argument("--instance-id", help=argparse.SUPPRESS)
    parser.add_argument("--base-path", default="")
    parser.add_argument("--open", action="store_true", help="Open the operative distribution in the browser")
    parser.add_argument("--local-run", action="store_true", help="Enable the explicit exploratory WSL/SLURM Si recipe")
    parser.add_argument("--site-config", type=Path)
    parser.add_argument("--profile", type=Path)
    parser.add_argument("--pseudo", type=Path)
    parser.add_argument("--wheelhouse", type=Path)
    parser.add_argument("--project")
    parser.add_argument("--cpu-seconds", type=int)
    parser.add_argument("--expires-hours", type=int, default=24)
    args = parser.parse_args()
    state = args.state_dir.expanduser().absolute()
    try:
        if args.command == "_run":
            if not args.instance_id:
                raise ValueError("Missing instance ownership identifier")
            options = _local_run_options(args, parser)
            return _run(state, str(uuid.UUID(args.instance_id)), args.base_path, options)
        if args.command == "start":
            options = _local_run_options(args, parser)
            result, code = _start(state, args.base_path, options)
            if code == 0 and args.open:
                webbrowser.open(result["url"])
        elif args.command == "budget":
            if args.budget_command != "add" or not args.project or args.cpu_seconds is None:
                parser.error("budget add requires --project and --cpu-seconds")
            if args.local_run or any((args.site_config, args.profile, args.pseudo, args.wheelhouse)):
                parser.error("runtime options are only valid with start")
            result, code = _budget_add(state, args.project, args.cpu_seconds, args.expires_hours)
        elif args.command == "stop":
            result, code = _stop(state)
        elif args.command == "recover-local":
            result, code = _recover_local(state)
        else:
            result, code = _status(state), 0
        print(json.dumps(result, sort_keys=True))
        return code
    except (OSError, ValueError, KeyError, TypeError, RuntimeError):
        print(json.dumps({"status": "unknown", "error": "LAUNCHER_ERROR"}), file=sys.stderr)
        return 2


def _local_run_options(args, parser):
    supplied = (args.site_config, args.profile, args.pseudo, args.wheelhouse)
    if not args.local_run:
        if any(supplied):
            parser.error("--site-config, --profile, --pseudo and --wheelhouse require --local-run")
        return None
    if args.command not in {"start", "_run"} or any(value is None for value in supplied):
        parser.error("--local-run requires --site-config, --profile, --pseudo and --wheelhouse")
    return {"site_config": args.site_config.expanduser().absolute(),
            "profile": args.profile.expanduser().absolute(),
            "pseudo": args.pseudo.expanduser().absolute(),
            "wheelhouse": args.wheelhouse.expanduser().absolute()}


def _budget_add(state: Path, project_id: str, cpu_seconds: int, expires_hours: int):
    from datetime import datetime, timedelta, timezone
    from .budgets import SQLiteBudgetHolds
    from .local_runtime import private_directory
    from .storage import SQLiteRepository
    if type(cpu_seconds) is not int or cpu_seconds < 1 or type(expires_hours) is not int or not 1 <= expires_hours <= 720:
        raise ValueError("Invalid budget bounds")
    state = private_directory(state)
    repository = SQLiteRepository(state / "state.sqlite")
    owner = repository.ensure_principal("local")
    expires_at = datetime.now(timezone.utc) + timedelta(hours=expires_hours)
    account = SQLiteBudgetHolds(repository).register(owner, project_id, cpu_seconds, expires_at)
    return {"budget_id": account.budget_id, "project_id": account.project_id,
            "unit": account.unit, "cpu_seconds": account.capacity,
            "expires_at": account.expires_at}, 0


if __name__ == "__main__":
    raise SystemExit(main())
