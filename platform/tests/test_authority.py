"""Real process exclusion and atomic stale-owner publication, no engines/jobs."""
import copy
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
import subprocess
import sys
import tempfile
from threading import Event
from types import SimpleNamespace
import unittest

from dftlab_platform.authority import LocalAuthorityManager
from dftlab_platform.authority_storage import SQLiteAuthorityStore
from dftlab_platform.contracts import canonical
from dftlab_platform.domain import Problem, identifier, reseal
from dftlab_platform.storage import SQLiteRepository


class Clock:
    def __init__(self):
        self.wall = datetime(2030, 1, 1, tzinfo=timezone.utc)
        self.tick = 0.0

    def advance(self, seconds):
        self.wall += timedelta(seconds=seconds)
        self.tick += seconds


class Authority(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.repo = SQLiteRepository(self.root/"state.sqlite")
        self.owner, self.other = [self.repo.ensure_principal(name) for name in ("owner", "other")]
        self.project = self.repo.create_project(self.owner, {"name": "Synthetic authority", "idempotency_key": "authority-fixture-001"})[0]["project_id"]
        self.store = SQLiteAuthorityStore(self.repo)
        self.clock = Clock()
        self.manager = LocalAuthorityManager(self.store, self.root/"locks", scope="synthetic-local-only",
                                             clock=lambda: self.clock.wall, monotonic=lambda: self.clock.tick)
        self.run, self.attempt = identifier(), identifier()
        with self.repo.transaction() as db:
            db.execute("CREATE TABLE publication_fixture(value TEXT)")

    def tearDown(self):
        self.temporary.cleanup()

    def count(self):
        with self.repo._connection() as db:
            return db.execute("SELECT count(*) FROM publication_fixture").fetchone()[0]

    def write(self, db):
        db.execute("INSERT INTO publication_fixture VALUES('synthetic evidence')")
        return "published"

    def child(self, locks, mode):
        code = """
import os,sys
from pathlib import Path
from dftlab_platform.domain import Principal,Problem
from dftlab_platform.storage import SQLiteRepository
from dftlab_platform.authority import LocalAuthorityManager
from dftlab_platform.authority_storage import SQLiteAuthorityStore
repo=SQLiteRepository(Path(sys.argv[1]))
manager=LocalAuthorityManager(SQLiteAuthorityStore(repo),Path(sys.argv[2]),scope='synthetic-local-only')
try:
 with manager.controller(Principal(sys.argv[3]),sys.argv[4],sys.argv[5],sys.argv[6]):
  if sys.argv[7]=='crash': os._exit(77)
 sys.exit(0)
except OSError: sys.exit(21)
except Problem as error:
 sys.exit(22 if error.code=='PRECONDITION_FAILED' else 23)
"""
        return subprocess.run([sys.executable, "-I", "-c", code, str(self.repo.path), str(locks), self.owner.principal_id,
                               self.project, self.run, self.attempt, mode], capture_output=True, timeout=20)

    def test_second_process_and_second_lock_directory_cannot_acquire_even_after_expiry(self):
        with self.manager.controller(self.owner, self.project, self.run, self.attempt, seconds=1):
            self.assertEqual(self.child(self.root/"locks", "acquire").returncode, 21)
            # A different kernel inode does not bypass the SQL identity guard.
            self.assertEqual(self.child(self.root/"different-locks", "acquire").returncode, 22)
            self.clock.advance(2)
            self.assertEqual(self.child(self.root/"locks", "acquire").returncode, 21)
        with self.assertRaises(Problem):
            with self.manager.controller(self.owner, self.project, self.run, identifier()):
                self.fail("Expiry must never authorize automatic replacement")

    def test_process_crash_releases_kernel_lock_but_never_authorizes_replacement(self):
        child = self.child(self.root/"locks", "crash")
        self.assertEqual(child.returncode, 77, child.stderr.decode(errors="replace"))
        # The lock is available after process death, but its durable identity
        # remains unknown. This is not proof its launchers/jobs terminated.
        self.assertEqual(self.child(self.root/"locks", "acquire").returncode, 22)
        with self.repo._connection() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM controller_authorities").fetchone()[0], 1)

    def test_renewal_preserves_identity_and_stale_snapshot_cannot_publish(self):
        with self.manager.controller(self.owner, self.project, self.run, self.attempt) as authority:
            old = copy.deepcopy(authority.record)
            self.clock.advance(2)
            renewed = authority.renew(30)
            self.assertEqual(renewed["record_id"], old["record_id"])
            self.assertEqual(renewed["created_at"], old["created_at"])
            self.assertEqual(renewed["payload"]["generation"], 1)
            self.assertEqual(renewed["payload"]["automatic_takeover"], "DISABLED")
            self.assertEqual(renewed["payload"]["fencing"]["checked_at"], "NONE")
            with self.assertRaises(Problem):
                self.store.publish(self.owner, old, lambda: self.clock.wall, self.write)
            self.assertEqual(self.count(), 0)
            self.assertEqual(authority.publish(self.write), "published")
            self.assertEqual(self.count(), 1)
            with self.assertRaises(Problem):
                self.store.check(self.other, authority.record, self.clock.wall)
        with self.assertRaises(Problem):
            authority.publish(self.write)
        self.assertEqual(self.count(), 1)

    def test_expiry_during_publication_rolls_back_and_loss_is_sticky(self):
        with self.manager.controller(self.owner, self.project, self.run, self.attempt, seconds=2) as authority:
            def delayed(db):
                self.write(db)
                self.clock.advance(3)
            with self.assertRaises(Problem):
                authority.publish(delayed)
            self.assertEqual(self.count(), 0)
            with self.assertRaises(Problem):
                authority.renew()
            # Rolling the wall clock back cannot resurrect a lost owner.
            self.clock.advance(-3)
            with self.assertRaises(Problem):
                authority.publish(self.write)

    def test_backward_clock_and_changed_generation_fail_before_write(self):
        with self.manager.controller(self.owner, self.project, self.run, self.attempt) as authority:
            self.clock.advance(5)
            authority.renew()
            self.clock.wall -= timedelta(seconds=1)
            with self.assertRaises(Problem):
                authority.publish(self.write)
            self.assertEqual(self.count(), 0)
        with self.manager.controller(self.owner, self.project, identifier(), identifier()) as authority:
            changed = copy.deepcopy(authority.record)
            changed["payload"]["generation"] = 2
            reseal(changed)
            with self.repo.transaction() as db:
                db.execute("UPDATE controller_authorities SET document=? WHERE run_id=?", (canonical(changed).decode(), changed["payload"]["run_id"]))
            with self.assertRaises(Problem):
                authority.publish(self.write)
            self.assertEqual(self.count(), 0)

    def test_native_callback_requires_current_generation_and_one_opaque_runtime(self):
        with self.manager.controller(self.owner, self.project, self.run, self.attempt) as authority:
            boundary = SimpleNamespace(generation="1", runtime_fingerprint="a"*64, action="launch")
            self.assertTrue(authority.authority_check(boundary))
            boundary.runtime_fingerprint = "b"*64
            self.assertFalse(authority.authority_check(boundary))
            boundary.runtime_fingerprint = "a"*64
            self.assertFalse(authority.authority_check(boundary))
            with self.assertRaises(Problem):
                authority.publish(self.write)
        with self.manager.controller(self.owner, self.project, identifier(), identifier()) as authority:
            self.assertFalse(authority.authority_check(SimpleNamespace(generation="0", runtime_fingerprint="a"*64)))
        self.assertEqual(self.count(), 0)

    def test_heartbeat_cannot_replace_snapshot_during_publication(self):
        entered, started, renewed = Event(), Event(), Event()
        with self.manager.controller(self.owner, self.project, self.run, self.attempt) as authority:
            def heartbeat():
                self.assertTrue(entered.wait(5))
                started.set()
                authority.renew()
                renewed.set()
            def publish(db):
                entered.set()
                self.assertTrue(started.wait(5))
                self.assertFalse(renewed.is_set())
                return self.write(db)
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(heartbeat)
                self.assertEqual(authority.publish(publish), "published")
                future.result(timeout=5)
            self.assertTrue(renewed.is_set())
            self.assertEqual(self.count(), 1)
            authority.check()


if __name__ == "__main__":
    unittest.main()
