"""One local controller, held kernel lock and transactional publication port.

This is local host authority, not a remote distributed lock. An expired record
is never replaced automatically. No HTTP endpoint or runtime capability is
enabled by this module; callers must qualify an installed native controller.
"""
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import hashlib
from functools import wraps
from pathlib import Path
import re
import time
from threading import RLock
from typing import Protocol

from .contracts import canonical
from .domain import Principal, Problem, identifier
from .local_runtime import local_lock, private_directory


def utcnow():
    return datetime.now(timezone.utc)


def stamp(value):
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() != timedelta(0):
        raise ValueError("Authority clock must be UTC")
    return value.isoformat(timespec="microseconds").replace("+00:00", "Z")


def instant(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class AuthorityStore(Protocol):
    """Private application port; publish and fencing must share one transaction."""
    def create(self, owner: Principal, project: str, run: str, attempt: str, instance: str,
               scope: str, observed: datetime, expires: datetime) -> dict: ...
    def renew(self, owner: Principal, record: dict, observed: datetime, expires: datetime) -> dict: ...
    def check(self, owner: Principal, record: dict, observed: datetime) -> None: ...
    def publish(self, owner: Principal, record: dict, clock, writer): ...


def synchronized(method):
    @wraps(method)
    def call(self, *args, **kwargs):
        with self._lock:
            return method(self, *args, **kwargs)
    return call


@dataclass
class LocalAuthority:
    """Lifetime belongs to the kernel lock context, never just to a heartbeat."""
    store: AuthorityStore
    owner: Principal
    record: dict
    clock: object
    monotonic: object
    deadline: float
    active: bool = True
    lost: bool = False
    fingerprint: str | None = None
    _lock: object = field(default_factory=RLock, repr=False)

    def _current(self):
        if not self.active or self.lost or self.monotonic() >= self.deadline:
            self.lost = True
            raise Problem("PRECONDITION_FAILED")
        observed = self.clock()
        stamp(observed)
        return observed

    @synchronized
    def check(self):
        try:
            self.store.check(self.owner, self.record, self._current())
        except BaseException:
            self.lost = True
            raise

    @synchronized
    def renew(self, seconds=30):
        if type(seconds) is not int or not 1 <= seconds <= 300:
            raise ValueError("Lease TTL must be between 1 and 300 seconds")
        try:
            observed = self._current()
            self.record = self.store.renew(self.owner, self.record, observed, observed+timedelta(seconds=seconds))
            self.deadline = self.monotonic()+seconds
        except BaseException:
            self.lost = True
            raise
        return self.record

    @synchronized
    def authority_check(self, boundary):
        """Public QRAFT callback; fail closed and sticky on denial/exception.

        Native fingerprint is opaque. Latch the first trusted callback from the
        registered controller; subsequent boundaries must belong to that same
        runtime. This callback is not exposed to a client or used as a lock.
        The surrounding kernel lock must remain held through native shutdown.
        """
        try:
            if boundary.generation != str(self.record["payload"]["generation"]) or not isinstance(boundary.runtime_fingerprint, str) or re.fullmatch(r"[0-9a-f]{64}", boundary.runtime_fingerprint) is None:
                raise Problem("PRECONDITION_FAILED")
            if self.fingerprint is not None and boundary.runtime_fingerprint != self.fingerprint:
                raise Problem("PRECONDITION_FAILED")
            self.check()
            self.fingerprint = boundary.runtime_fingerprint
            return True
        except Exception:
            self.lost = True
            return False

    @synchronized
    def publish(self, writer):
        """Trusted repository writer only, not an arbitrary user callback.

        SQL mutations and the generation/expiry guard use the same transaction.
        Files must already be staged/fsynced; native raw files are never an
        authoritative publication merely because the engine wrote them.
        """
        try:
            self._current()
            def observed():
                return self._current()
            return self.store.publish(self.owner, self.record, observed, writer)
        except BaseException:
            self.lost = True
            raise

    @synchronized
    def close(self):
        self.active = False


class LocalAuthorityManager:
    def __init__(self, store: AuthorityStore, directory: Path, *, scope: str, clock=utcnow, monotonic=time.monotonic):
        if not isinstance(scope, str) or not 1 <= len(scope) <= 4096:
            raise ValueError("Explicit local site scope required")
        self.store, self.directory, self.scope = store, private_directory(directory), scope
        self.clock, self.monotonic = clock, monotonic

    @contextmanager
    def controller(self, owner, project, run, attempt, *, seconds=30):
        if type(seconds) is not int or not 1 <= seconds <= 300:
            raise ValueError("Lease TTL must be between 1 and 300 seconds")
        # Managed kernel locks are keyed by DB/run. Callers must share this
        # directory for the same local store; it is never a client host path.
        key = hashlib.sha256(canonical([project, run])).hexdigest()
        with local_lock(self.directory/(key+".lock")):
            observed = self.clock()
            stamp(observed)
            record = self.store.create(owner, project, run, attempt, identifier(), self.scope, observed, observed+timedelta(seconds=seconds))
            authority = LocalAuthority(self.store, owner, record, self.clock, self.monotonic, self.monotonic()+seconds)
            try:
                yield authority
            finally:
                # Expiry/closure is not terminal scheduler evidence. Keep the
                # immutable identity in SQL; recovery must retire explicitly.
                authority.close()

