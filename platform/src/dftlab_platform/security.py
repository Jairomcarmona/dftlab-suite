"""Local bootstrap/session port, origin checks and bounded ASGI transport."""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import hashlib
import secrets
import threading
import time

from .domain import Principal, Problem


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class LocalSettings:
    port: int
    base_path: str = ""
    max_json: int = 1024**2
    max_chunk: int = 8*1024**2

    def __post_init__(self):
        if type(self.port) is not int or not 1 <= self.port <= 65535 or self.base_path and (not self.base_path.startswith("/") or self.base_path.endswith("/") or any(part in {"", ".", ".."} for part in self.base_path[1:].split("/"))):
            raise ValueError("Invalid local bind settings")
        if any(c not in "/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for c in self.base_path):
            raise ValueError("Invalid base path")

    @property
    def host(self):
        return f"127.0.0.1:{self.port}"

    @property
    def origin(self):
        return "http://" + self.host


@dataclass(frozen=True)
class Session:
    principal: Principal
    csrf_hash: str
    expires: float
    csrf_token: str = field(repr=False)
    expires_at: str


class Sessions:
    def __init__(self, *, bootstrap_seconds=120, session_seconds=3600, clock=time.monotonic):
        self.bootstrap_seconds, self.session_seconds, self.clock = bootstrap_seconds, session_seconds, clock
        self._bootstrap, self._sessions = {}, {}
        self._lock = threading.Lock()

    def _prune(self):
        now = self.clock()
        self._bootstrap = {key: value for key, value in self._bootstrap.items() if value[1] > now}
        self._sessions = {key: value for key, value in self._sessions.items() if value.expires > now}

    def issue(self, principal: Principal) -> str:
        # Trusted native launcher only; there is deliberately no HTTP issuer.
        with self._lock:
            self._prune()
            if len(self._bootstrap) >= 16:
                raise Problem("RATE_LIMITED")
            token = secrets.token_urlsafe(48)
            self._bootstrap[token_hash(token)] = (principal, self.clock()+self.bootstrap_seconds)
            return token

    def exchange(self, token: str) -> tuple[str, dict]:
        with self._lock:
            self._prune()
            entry = self._bootstrap.pop(token_hash(token), None)
            if entry is None:
                raise Problem("NOT_AUTHENTICATED")
            if len(self._sessions) >= 32:
                raise Problem("RATE_LIMITED")
            cookie, csrf = secrets.token_urlsafe(48), secrets.token_urlsafe(48)
            deadline = (datetime.now(timezone.utc)+timedelta(seconds=self.session_seconds)).isoformat().replace("+00:00", "Z")
            self._sessions[token_hash(cookie)] = Session(entry[0], token_hash(csrf), self.clock()+self.session_seconds, csrf, deadline)
            return cookie, {"principal_id": entry[0].principal_id, "csrf_token": csrf, "expires_at": deadline}

    def current(self, cookie: str) -> dict:
        with self._lock:
            self._prune()
            session = self._sessions.get(token_hash(cookie))
            if session is None:
                raise Problem("NOT_AUTHENTICATED")
            return {"principal_id": session.principal.principal_id, "csrf_token": session.csrf_token, "expires_at": session.expires_at}

    def authenticate(self, cookie: str, csrf: str | None = None) -> Principal:
        with self._lock:
            self._prune()
            session = self._sessions.get(token_hash(cookie))
            if session is None:
                raise Problem("NOT_AUTHENTICATED")
            if csrf is not None and not secrets.compare_digest(session.csrf_hash, token_hash(csrf)):
                raise Problem("CSRF_REJECTED")
            return session.principal

    def revoke(self, cookie: str):
        with self._lock:
            self._sessions.pop(token_hash(cookie), None)


def single_header(scope: dict, name: bytes) -> str | None:
    values = [value for key, value in scope["headers"] if key.lower() == name]
    if len(values) > 1:
        raise Problem("VALIDATION_FAILED")
    return values[0].decode("latin1") if values else None


def session_cookie(scope: dict) -> str:
    raw = single_header(scope, b"cookie") or ""
    values = []
    for part in raw.split(";"):
        name, separator, value = part.strip().partition("=")
        if name == "dftlab_session" and separator:
            values.append(value)
    if len(values) != 1 or len(values[0]) > 256:
        raise Problem("NOT_AUTHENTICATED")
    return values[0]


class SecurityMiddleware:
    def __init__(self, app, settings: LocalSettings):
        self.app, self.settings = app, settings

    async def __call__(self, scope, receive, send):
        if scope["type"] not in {"http", "websocket"}:
            return await self.app(scope, receive, send)
        from starlette.responses import JSONResponse
        try:
            if single_header(scope, b"host") != self.settings.host:
                raise Problem("ORIGIN_REJECTED")
            origin = single_header(scope, b"origin")
            if origin is not None and origin != self.settings.origin:
                raise Problem("ORIGIN_REJECTED")
            if scope["type"] == "websocket":
                # No privileged terminal/WS implementation before X9. Never
                # accept a socket merely because it came from loopback.
                if origin != self.settings.origin:
                    raise Problem("ORIGIN_REJECTED")
                raise Problem("FORBIDDEN")
            if scope["method"] not in {"GET", "HEAD", "OPTIONS"} and origin != self.settings.origin:
                raise Problem("ORIGIN_REJECTED")
            if scope.get("query_string") and scope["path"].endswith("/session"):
                raise Problem("VALIDATION_FAILED")  # no token via query
            if scope["method"] == "GET" and scope["path"].endswith("/session") and single_header(scope, b"sec-fetch-site") not in {None, "same-origin"}:
                raise Problem("ORIGIN_REJECTED")
            if single_header(scope, b"content-encoding") not in (None, "identity"):
                raise Problem("VALIDATION_FAILED")  # no decompression bombs
            maximum = self.settings.max_chunk if scope["method"] == "PUT" else self.settings.max_json
            length = single_header(scope, b"content-length")
            if length is not None and (not length.isdecimal() or int(length) > maximum):
                raise Problem("PAYLOAD_TOO_LARGE")
        except Problem as error:
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 4403})
            else:
                await JSONResponse(error.document(), error.status, media_type="application/problem+json")(scope, receive, send)
            return
        received = 0
        async def bounded_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > maximum:
                    raise Problem("PAYLOAD_TOO_LARGE")
            return message
        async def protected_send(message):
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                headers.extend([(b"cache-control", b"no-store"), (b"x-content-type-options", b"nosniff"), (b"referrer-policy", b"no-referrer"), (b"content-security-policy", b"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")])
            await send(message)
        await self.app(scope, bounded_receive, protected_send)


class PrivateErrors:
    """Outer ASGI boundary: never log request bodies or exception values."""
    def __init__(self, app):
        self.app = app
        self.state = app.state

    async def __call__(self, scope, receive, send):
        started = False
        async def tracked(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)
        try:
            await self.app(scope, receive, tracked)
        except Exception:
            # ServerErrorMiddleware may already have sent the generic problem.
            # Do not re-raise its secret-bearing traceback into server logs.
            if not started and scope["type"] == "http":
                from starlette.responses import JSONResponse
                error = Problem("INTERNAL")
                await JSONResponse(error.document(), 500, media_type="application/problem+json")(scope, receive, send)
            elif scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1011})
