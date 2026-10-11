"""Ephemeral process lifecycle, with no HTTP, campaigns, sessions or durable state.

The placeholder only proves an installed entry point can own/start/stop its own
process. This lease must never become an authority for runs, jobs or operations.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid

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
        os.replace(temporary, path)
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
        return {"status": "stopped", "version": __version__, "scope": "process-placeholder"}
    pulse = _read(state / "heartbeat.json")
    if pulse is None or pulse.get("instance_id") != lease["instance_id"]:
        status = "starting"
    elif 0 <= time.time() - pulse["updated_at"] <= STALE_SECONDS:
        status = "running"
    else:
        status = "unknown"  # Do not infer process death or reuse a stale lease.
    return {"status": status, "version": __version__, "scope": "process-placeholder", "instance_id": lease["instance_id"], "pid": pulse.get("pid") if pulse else None}


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


def _start(state: Path) -> tuple[dict, int]:
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
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
        child = subprocess.Popen(
            [sys.executable, "-m", "dftlab_platform.launcher", "_run", "--state-dir", str(state), "--instance-id", instance],
            cwd=state, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            **kwargs,
        )
        deadline = time.monotonic() + TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise RuntimeError(f"Placeholder exited before readiness ({child.returncode})")
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
        if _owned(state, instance):
            lock.unlink()
        raise


def _stop(state: Path) -> tuple[dict, int]:
    current = _lease(state)
    if current is None:
        return _status(state), 0
    instance = current["instance_id"]
    _request_stop(state, instance)
    if _wait_stopped(state, instance):
        # Another CLI may have started a new instance: never request its stop.
        return {"status": "stopped", "instance_id": instance, "version": __version__, "scope": "process-placeholder"}, 0
    return {"error": "STOP_TIMEOUT", **_status(state)}, 2


def _run(state: Path, instance: str) -> int:
    stop_requested = False

    def handle_signal(_number, _frame):
        nonlocal stop_requested
        stop_requested = True

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)
    try:
        while not stop_requested and _owned(state, instance):
            request = _read(state / f"stop-{instance}.json")
            if request is not None and request.get("instance_id") == instance:
                break
            _write(state / "heartbeat.json", {"instance_id": instance, "pid": os.getpid(), "updated_at": time.time()})
            time.sleep(HEARTBEAT_SECONDS)
    finally:
        # Only release the lease still owned by this child. No PID based kills.
        if _owned(state, instance):
            (state / "heartbeat.json").unlink(missing_ok=True)
            (state / "launcher.lock").unlink(missing_ok=True)
        (state / f"stop-{instance}.json").unlink(missing_ok=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="DFT Lab installation/process skeleton (no API or calculations)")
    parser.add_argument("command", choices=["start", "status", "stop", "_run"])
    parser.add_argument("--state-dir", type=Path, default=_default_state())
    parser.add_argument("--instance-id", help=argparse.SUPPRESS)
    args = parser.parse_args()
    state = args.state_dir.expanduser().resolve()
    try:
        if args.command == "_run":
            if not args.instance_id:
                raise ValueError("Missing instance ownership identifier")
            return _run(state, str(uuid.UUID(args.instance_id)))
        if args.command == "start":
            result, code = _start(state)
        elif args.command == "stop":
            result, code = _stop(state)
        else:
            result, code = _status(state), 0
        print(json.dumps(result, sort_keys=True))
        return code
    except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
        print(json.dumps({"status": "unknown", "error": "LAUNCHER_ERROR", "detail": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
