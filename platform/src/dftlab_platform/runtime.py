"""Installed local API runtime, paired with an independently owned processor."""
import asyncio
import os
import socket
import subprocess
import sys
import time

import uvicorn
from .artifact_storage import SQLiteArtifactIndex
from .artifacts import LocalArtifactStore
from .launcher import _owned, _read, _write, HEARTBEAT_SECONDS
from .local_runtime import local_lock, private_directory
from .projection_storage import SQLiteReadModels
from .security import LocalSettings, Sessions
from .service import create_app
from .storage import SQLiteRepository


def serve(state, instance, base_path=""):
    state = private_directory(state)
    with local_lock(state / "service.guard"):
        if not _owned(state, instance):
            return 2
        # Recovery requires proof that both previous local processes ended.
        # Heartbeat/PID alone cannot grant takeover or remote submission rights.
        with local_lock(state / "processor.guard"):
            repository = SQLiteRepository(state / "state.sqlite")
            repository.recover()
        artifacts = LocalArtifactStore(state / "artifacts", SQLiteArtifactIndex(repository))
        readmodels = SQLiteReadModels(repository)
        sessions = Sessions()
        principal = repository.ensure_principal("local")
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(("127.0.0.1", 0))
        sock.listen(64)
        settings = LocalSettings(sock.getsockname()[1], base_path=base_path)
        token = sessions.issue(principal)
        # Only owner-readable file for explicit selection/paste in the operative
        # UI. No token in URL, stdout, heartbeat, logs or browser persistence.
        _write(state / "access.json", {"bootstrap_token": token, "origin": settings.origin})
        app = create_app(repository, artifacts, readmodels, settings, sessions)
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=settings.port, access_log=False, log_config=None, proxy_headers=False, ws="none", limit_concurrency=64, h11_max_incomplete_event_size=8192, timeout_keep_alive=5, lifespan="off"))
        environment = dict(os.environ)
        environment.pop("PYTHONPATH", None)
        options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {"start_new_session": True}
        processor = subprocess.Popen([sys.executable, "-I", "-m", "dftlab_platform.processor", "--state-dir", str(state), "--instance-id", instance], env=environment, cwd=state, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **options)
        async def maintain():
            while not server.started and not server.should_exit:
                await asyncio.sleep(0.05)
            while not server.should_exit:
                request = _read(state / f"stop-{instance}.json")
                if request is not None or not _owned(state, instance) or processor.poll() is not None:
                    server.should_exit = True
                    break
                _write(state / "heartbeat.json", {"instance_id": instance, "pid": os.getpid(), "processor_pid": processor.pid, "updated_at": time.time(), "url": settings.origin+settings.base_path+"/", "api_version": "0.1.0"})
                await asyncio.sleep(HEARTBEAT_SECONDS)
        async def supervised_maintain():
            try:
                await maintain()
            except Exception:
                # A failed monitor must stop the owned runtime, not silently
                # abandon stop requests while leaving an API process alive.
                server.should_exit = True
                raise
        async def main():
            task = asyncio.create_task(supervised_maintain())
            try:
                await server.serve(sockets=[sock])
            finally:
                server.should_exit = True
                task.cancel()
                results = await asyncio.gather(task, return_exceptions=True)
                if isinstance(results[0], Exception):
                    raise RuntimeError("Local runtime monitor failed") from None
        try:
            asyncio.run(main())
        finally:
            # Cooperative instance-specific shutdown only. No kill by recycled PID.
            _write(state / f"stop-{instance}.json", {"instance_id": instance})
            try:
                processor.wait(timeout=10)
            except subprocess.TimeoutExpired:
                # Lease remains reserved; no new runtime may recover or resubmit.
                return 2
            sock.close()
            (state / "access.json").unlink(missing_ok=True)
        return 0
