"""Dedicated Linux child host, with subreaping and PID-reuse-safe shutdown.

Only the process started by this host and its descendants are touched. This
does not prove remote ranks, scheduler termination or distributed fencing.
Instantiation is restricted to an isolated dedicated installed worker process.
"""
import ctypes
import os
from pathlib import Path
import signal
import sys
import time

from .domain import Problem


class OwnedLinuxChildren:
    def __init__(self):
        if not sys.platform.startswith("linux") or not sys.flags.isolated or not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
            raise Problem("ENGINE_UNAVAILABLE")
        libc = ctypes.CDLL(None, use_errno=True)
        # PR_SET_CHILD_SUBREAPER changes this dedicated host only. It lets the
        # host retain/reap orphaned descendants after an MPI launcher exits.
        if libc.prctl(36, 1, 0, 0, 0) != 0:
            raise Problem("ENGINE_UNAVAILABLE")
        self.root, self.uid = os.getpid(), os.getuid()
        self.observed = set()

    @staticmethod
    def _entry(pid):
        try:
            root = Path("/proc")/str(pid)
            fields = (root/"stat").read_text().rpartition(") ")[2].split()
            uid = next(line for line in (root/"status").read_text().splitlines() if line.startswith("Uid:")).split()[1:]
            return (int(pid), int(fields[1]), int(fields[19]), fields[0], tuple(map(int, uid)))
        except (OSError, ValueError, IndexError, StopIteration):
            return None

    def descendants(self):
        entries = {}
        scanned = 0
        for path in Path("/proc").iterdir():
            if path.name.isdecimal():
                scanned += 1
                if scanned > 65536:
                    raise Problem("PAYLOAD_TOO_LARGE")
                row = self._entry(int(path.name))
                if row:
                    entries[row[0]] = row
        owned, parents = {}, {self.root}
        while True:
            fresh = {pid: row for pid, row in entries.items() if row[1] in parents and pid not in owned}
            if not fresh:
                break
            if len(owned)+len(fresh) > 512:
                raise Problem("PAYLOAD_TOO_LARGE")
            for pid, row in fresh.items():
                if any(uid != self.uid for uid in row[4]):
                    raise Problem("PRECONDITION_FAILED")
                owned[pid] = row
                self.observed.add((pid, row[2]))
            parents.update(fresh)
        return owned

    def _signal(self, row, number):
        pid, _, started, _, _ = row
        try:
            descriptor = os.pidfd_open(pid, 0)
        except ProcessLookupError:
            return
        try:
            current = self._entry(pid)
            if current is None:
                return
            if current[2] != started or (pid, started) not in self.observed or any(uid != self.uid for uid in current[4]):
                raise Problem("PRECONDITION_FAILED")
            signal.pidfd_send_signal(descriptor, number)
        except ProcessLookupError:
            pass
        finally:
            os.close(descriptor)

    def close(self, *, grace_seconds=2):
        """Called after the direct Popen child has been waited by its owner.

        Reaps this dedicated process's orphan children only. Repeat snapshots
        close newly adopted grandchildren; signal handles cannot target reused
        PIDs. A timeout is failure, never proof that all children disappeared.
        """
        if type(grace_seconds) not in (int, float) or not 0 <= grace_seconds <= 10:
            raise ValueError("Bounded shutdown grace required")
        started = time.monotonic()
        while True:
            children = self.descendants()
            if not children:
                return
            number = signal.SIGTERM if time.monotonic()-started < grace_seconds else signal.SIGKILL
            for row in children.values():
                if row[3] != "Z":
                    self._signal(row, number)
            # Native direct child has already been waited. Only adopted
            # descendants remain; retain unrelated process namespaces untouched.
            while True:
                try:
                    if os.waitpid(-1, os.WNOHANG)[0] == 0:
                        break
                except ChildProcessError:
                    break
            if time.monotonic()-started > grace_seconds+10:
                raise Problem("PRECONDITION_FAILED")
            time.sleep(0.02)

    def signal_all(self, number):
        for row in self.descendants().values():
            if row[3] != "Z":
                self._signal(row, number)
