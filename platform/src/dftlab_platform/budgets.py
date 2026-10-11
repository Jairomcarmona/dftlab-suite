"""Private, conservative capacity holds; not the pending C3 admission API.

The registered operator supplies allocated CPU seconds explicitly. This module
never converts MPI ranks, wall time, currency or scheduler TRES into a cost.
There is deliberately no release/consume/expiry sweep or admission endpoint.
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from .authority import instant, stamp, utcnow
from .contracts import digest, loads
from .domain import Problem, identifier


MAX_AMOUNT = 2**53-1
UNIT = "allocated_cpu_second"


def amount(value):
    if type(value) is not int or not 1 <= value <= MAX_AMOUNT:
        raise Problem("VALIDATION_FAILED")
    return value


@dataclass(frozen=True)
class BudgetAccount:
    budget_id: str
    project_id: str
    owner_id: str
    revision: int
    unit: str
    capacity: int
    expires_at: str


@dataclass(frozen=True)
class BudgetHold:
    reservation_id: str
    budget_id: str
    operation_id: str
    request_hash: str
    amount: int
    unit: str
    budget_revision: int
    reserved_at: str


class BudgetPort(Protocol):
    def reserve(self, owner, budget_id, operation_id, revision, processor_id, quantity) -> BudgetHold: ...
    def get(self, owner, budget_id) -> tuple[BudgetAccount, int]: ...


class SQLiteBudgetHolds:
    """Immutable operator budgets and one durable hold per original operation.

    reserve commits before returning; any later failure leaves the hold intact.
    A retry acknowledges the same hold, never grants permission to dispatch.
    Account expiry blocks new holds but does not establish effect termination.
    Accounts cannot be edited, topped up, reassigned or replaced in this port.
    RECOVERY prevents new effects, while existing acknowledgements stay readable.
    """
    def __init__(self, repository, *, clock=utcnow):
        self.repository, self.clock = repository, clock
        with repository.transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS budget_migrations(version INTEGER PRIMARY KEY)")
            versions = [row[0] for row in db.execute("SELECT version FROM budget_migrations ORDER BY version")]
            if not versions:
                db.execute("CREATE TABLE budget_accounts(budget_id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(project_id), owner_id TEXT NOT NULL REFERENCES principals(principal_id), revision INTEGER NOT NULL CHECK(revision=1), unit TEXT NOT NULL CHECK(unit='allocated_cpu_second'), capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 9007199254740991), expires_at TEXT NOT NULL)")
                db.execute("CREATE TABLE budget_holds(reservation_id TEXT PRIMARY KEY NOT NULL, budget_id TEXT NOT NULL REFERENCES budget_accounts(budget_id), operation_id TEXT NOT NULL UNIQUE REFERENCES operations(operation_id), request_hash TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 9007199254740991), unit TEXT NOT NULL CHECK(unit='allocated_cpu_second'), budget_revision INTEGER NOT NULL CHECK(budget_revision=1), reserved_at TEXT NOT NULL)")
                db.execute("CREATE TABLE budget_clock(singleton INTEGER PRIMARY KEY CHECK(singleton=1), observed_at TEXT)")
                db.execute("INSERT INTO budget_clock VALUES(1,NULL)")
                db.execute("INSERT INTO budget_migrations VALUES(1)")
            elif versions != [1]:
                raise ValueError("Explicit budget migration required")

    def _observed(self, db):
        value = self.clock()
        encoded = stamp(value)  # rejects naive/non-UTC clocks
        row = db.execute("SELECT observed_at FROM budget_clock WHERE singleton=1").fetchone()
        if row is None or (row[0] is not None and value < instant(row[0])):
            raise Problem("PRECONDITION_FAILED")
        db.execute("UPDATE budget_clock SET observed_at=? WHERE singleton=1", (encoded,))
        return value

    def _account(self, db, owner, budget_id):
        row = db.execute("SELECT budget_id,project_id,owner_id,revision,unit,capacity,expires_at FROM budget_accounts WHERE budget_id=? AND owner_id=?", (budget_id, owner.principal_id)).fetchone()
        if row is None:
            raise Problem("NOT_FOUND")
        self.repository._project(db, owner, row[1])
        return BudgetAccount(*row)

    def register(self, owner, project_id, capacity, expires_at: datetime, *, unit=UNIT):
        """Trusted operator configuration only, not data accepted from HTTP."""
        amount(capacity)
        if unit != UNIT:
            raise Problem("VALIDATION_FAILED")
        expiry = stamp(expires_at)
        with self.repository.transaction() as db:
            self.repository._execution_ready(db)
            self.repository._project(db, owner, project_id)
            if expires_at <= self._observed(db):
                raise Problem("PRECONDITION_FAILED")
            account = BudgetAccount(identifier(), project_id, owner.principal_id, 1, unit, capacity, expiry)
            db.execute("INSERT INTO budget_accounts VALUES(?,?,?,?,?,?,?)", tuple(account.__dict__.values()))
            if self._observed(db) >= expires_at:
                raise Problem("PRECONDITION_FAILED")
            return account

    def get(self, owner, budget_id):
        with self.repository._connection() as db:
            # One read snapshot, not two unrelated autocommit reads.
            db.execute("BEGIN")
            account = self._account(db, owner, budget_id)
            held = db.execute("SELECT COALESCE(SUM(amount),0) FROM budget_holds WHERE budget_id=?", (budget_id,)).fetchone()[0]
            if held > account.capacity:
                raise Problem("PRECONDITION_FAILED")
            return account, held

    def reserve(self, owner, budget_id, operation_id, revision, processor_id, quantity):
        amount(quantity)
        with self.repository.transaction() as db:
            account = self._account(db, owner, budget_id)
            row = db.execute("SELECT owner_id,project_id,request,request_hash,document FROM operations WHERE operation_id=?", (operation_id,)).fetchone()
            if row is None or row[0] != owner.principal_id or row[1] != account.project_id:
                raise Problem("NOT_FOUND")
            request = loads(row[2])
            if digest(request) != row[3] or request.get("budget_ref") != budget_id or request["action"] not in {"SUBMIT_RUN", "EXECUTE_RESUME_PLAN"}:
                raise Problem("PRECONDITION_FAILED")
            previous = db.execute("SELECT reservation_id,budget_id,operation_id,request_hash,amount,unit,budget_revision,reserved_at FROM budget_holds WHERE operation_id=?", (operation_id,)).fetchone()
            if previous is not None:
                hold = BudgetHold(*previous)
                if (hold.budget_id, hold.request_hash, hold.amount, hold.unit, hold.budget_revision) != (budget_id, row[3], quantity, account.unit, account.revision):
                    raise Problem("PRECONDITION_FAILED")
                return hold  # readonly acknowledgement, not new permission
            self.repository._execution_ready(db)
            operation = self.repository._operation_document(row[4])["payload"]
            claim = db.execute("SELECT processor_id FROM outbox WHERE operation_id=?", (operation_id,)).fetchone()
            if operation["state"] != "RUNNING" or operation["revision"] != revision or not claim or claim[0] != processor_id:
                raise Problem("PRECONDITION_FAILED")
            observed = self._observed(db)
            if observed >= instant(account.expires_at):
                raise Problem("PRECONDITION_FAILED")
            held = db.execute("SELECT COALESCE(SUM(amount),0) FROM budget_holds WHERE budget_id=?", (budget_id,)).fetchone()[0]
            if held + quantity > account.capacity:
                raise Problem("PRECONDITION_FAILED")
            hold = BudgetHold(identifier(), budget_id, operation_id, row[3], quantity, account.unit, account.revision, stamp(observed))
            db.execute("INSERT INTO budget_holds VALUES(?,?,?,?,?,?,?,?)", tuple(hold.__dict__.values()))
            if self._observed(db) >= instant(account.expires_at):
                raise Problem("PRECONDITION_FAILED")
            return hold
