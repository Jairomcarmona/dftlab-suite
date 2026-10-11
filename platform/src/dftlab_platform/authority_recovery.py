"""Explicit local authority retirement, without takeover or opening RECOVERY.

Only an operator-registered positive readonly site verifier and the original
kernel guard may retire an expired authority. Original documents are retained
in append-only history. This port never launches, cancels, renews or deletes.
"""
from copy import deepcopy
from dataclasses import dataclass
from datetime import timedelta
import hashlib
import os
from pathlib import Path
from threading import RLock
from typing import Protocol

from .authority import instant, stamp, utcnow
from .checkpoints import checked_path
from .contracts import BASE, canonical, loads
from .domain import Problem, envelope, reseal
from .native_checkpoints import original_guard
from .submissions import check_receipt


class AuthorityRetirementPort(Protocol):
    def retire(self, owner, registration, record, native_evidence, proof, observations): ...


@dataclass(frozen=True)
class RegisteredAuthorityRetirement:
    root: Path
    operation_id: str  # original confirmed dispatch, not a new resume request
    verify: object  # readonly qualified current terminal/native check, None or exception


class SQLiteNativeAuthorityRetirement:
    """Operator-only local site port; no callable/key deserialized from clients.

    verify_terminal is the registered native signature verifier; verify(root)
    must reconfirm the same original current terminal allocation/namespace.
    A fresh signature or lease expiry alone does not prove process termination.
    Retiring a restored copy does not retire the original instance or make a
    clone eligible to execute. New attempts require a subsequent explicit gate.
    """
    def __init__(self, engines, repository, artifacts, ledger, lock_directory, verify_terminal, *, clock=utcnow):
        if artifacts.index.repository.path != repository.path or ledger.repository.path != repository.path or not callable(verify_terminal):
            raise ValueError("One local repository and registered verifier required")
        self.engines, self.repository, self.artifacts, self.ledger = engines, repository, artifacts, ledger
        self.contracts = repository.contracts
        self.directory = checked_path(lock_directory)
        if not self.directory.is_dir() or (os.name != "nt" and (self.directory.stat().st_uid != os.getuid() or self.directory.stat().st_mode & 0o077)):
            raise Problem("PRECONDITION_FAILED")
        self.verify_terminal, self.clock = verify_terminal, clock
        self._clock_floor = None
        self._lock = RLock()
        with repository.transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS authority_retirement_migrations(version INTEGER PRIMARY KEY)")
            versions = [row[0] for row in db.execute("SELECT version FROM authority_retirement_migrations ORDER BY version")]
            if not versions:
                db.execute("CREATE TABLE authority_retirements(run_id TEXT NOT NULL, generation INTEGER NOT NULL, project_id TEXT NOT NULL REFERENCES projects(project_id), owner_id TEXT NOT NULL REFERENCES principals(principal_id), request_hash TEXT NOT NULL, original_document TEXT NOT NULL, retired_document TEXT NOT NULL, native_proof TEXT NOT NULL, observed_at TEXT NOT NULL, PRIMARY KEY(run_id,generation))")
                db.execute("INSERT INTO authority_retirement_migrations VALUES(1)")
            elif versions != [1]:
                raise ValueError("Explicit authority retirement migration required")

    def _current(self):
        with self._lock:
            observed = self.clock()
            stamp(observed)
            if self._clock_floor is not None and observed < self._clock_floor:
                raise Problem("PRECONDITION_FAILED")
            self._clock_floor = observed
            return observed

    def _artifacts(self, owner, project, proof, observations, original):
        if not observations or len(observations) > 64:
            raise Problem("PRECONDITION_FAILED")
        for reference in (proof, *observations):
            self.contracts.validate("artifact-ref", reference)
            record = self.artifacts.metadata(owner, reference["artifact_id"])
            if record["project_id"] != project or record["payload"]["integrity_state"] != "VERIFIED" or any(record["payload"][key] != reference[key] for key in ("artifact_id", "sha256", "media_type")) or not self.artifacts.verify(owner, reference["artifact_id"]):
                raise Problem("PRECONDITION_FAILED")
        if proof["media_type"] != "application/json" or proof["sha256"] != hashlib.sha256(original).hexdigest() or self.artifacts.metadata(owner, proof["artifact_id"])["payload"]["size_bytes"] != len(original):
            raise Problem("PRECONDITION_FAILED")

    def _verify(self, owner, registration, record, native, original, proof, observations):
        project, payload = record["project_id"], record["payload"]
        observed = self._current()
        if payload["automatic_takeover"] != "DISABLED" or payload["termination_evidence"] or payload["lease_expires_at"] is None or instant(payload["lease_expires_at"]) > observed:
            raise Problem("PRECONDITION_FAILED")
        if native.schema_version != "1.0" or native.source != "sacct" or native.active_allocation_absent is not True or native.state not in {"COMPLETED", "FAILED", "CANCELLED", "TIMEOUT", "NODE_FAIL", "OUT_OF_MEMORY", "PREEMPTED", "BOOT_FAIL", "DEADLINE", "REVOKED"}:
            raise Problem("PRECONDITION_FAILED")
        start, end = instant(native.observed_at), instant(native.expires_at)
        if not start <= observed < end or not timedelta(0) < end-start <= timedelta(seconds=120) or self.verify_terminal(native) is not True:
            raise Problem("PRECONDITION_FAILED")
        intent, phase, receipt = self.ledger.snapshot(owner, registration.operation_id)
        if phase != "ACKNOWLEDGED" or receipt is None or intent["project_id"] != project or intent["payload"]["run_id"] != payload["run_id"] or intent["payload"]["attempt_id"] != payload["attempt_id"] or intent["payload"]["authority_generation"] != payload["generation"]:
            raise Problem("PRECONDITION_FAILED")
        check_receipt(self.contracts, intent, receipt, {"ACCEPTED", "RECONCILED_FOUND"})
        if receipt["payload"]["job"] is None or any(receipt["payload"]["job"][key] != getattr(native.job, key) for key in ("job_id", "cluster", "remote_user")):
            raise Problem("PRECONDITION_FAILED")
        api = self.engines.qraft
        root = checked_path(registration.root)
        inspection = api.RunInspector().inspect(root)
        run_envelope, run = api.load_run_lock(root/"run.lock.json")
        workflow_envelope, workflow = api.load_workflow_lock(root/"workflow.lock.json")
        if inspection.status != "PREPARED_RUN_VERIFIED" or (inspection.run_id, inspection.project_id) != (payload["run_id"], project) or (run.run_id, run.project_id, run.workflow_id) != (payload["run_id"], project, workflow.workflow_id) or workflow.project_id != project or native.run_id != payload["run_id"] or native.run_lock_sha256 != run_envelope.content_sha256 or native.workflow_lock_sha256 != workflow_envelope.content_sha256 or run.workflow_lock_sha256 != workflow_envelope.content_sha256:
            raise Problem("PRECONDITION_FAILED")
        if registration.verify(root) is not None:
            raise Problem("PRECONDITION_FAILED")
        self._artifacts(owner, project, proof, observations, original)
        current = self._current()
        if not start <= current < end or self.verify_terminal(native) is not True:
            raise Problem("PRECONDITION_FAILED")
        return current

    def retire(self, owner, registration, record, native_evidence, proof, observations):
        record, proof, observations = deepcopy(record), deepcopy(proof), tuple(deepcopy(observations))
        self.contracts.validate("controller-authority-record", record)
        if record["integrity"]["status"] != "VERIFIED" or type(native_evidence) is not self.engines.qraft.TerminalSchedulerEvidence or not callable(registration.verify):
            raise Problem("PRECONDITION_FAILED")
        self.repository.project(owner, record["project_id"])
        original = self.engines.qraft_contracts().canonical_json(native_evidence).encode("utf-8")
        if len(original) > 65536:
            raise Problem("PAYLOAD_TOO_LARGE")
        payload = record["payload"]
        request_hash = hashlib.sha256(canonical({"record": record, "operation_id": registration.operation_id, "proof": proof, "observations": list(observations), "native_proof_sha256": hashlib.sha256(original).hexdigest()})).hexdigest()
        with self.repository._connection() as db:
            history = db.execute("SELECT owner_id,request_hash,retired_document FROM authority_retirements WHERE run_id=? AND generation=?", (payload["run_id"], payload["generation"])).fetchone()
            if history is not None:
                if history[0] != owner.principal_id or history[1] != request_hash:
                    raise Problem("PRECONDITION_FAILED")
                # Readonly idempotent acknowledgement confers no new permission.
                return self.contracts.validate("controller-authority-record", loads(history[2]))
        key = hashlib.sha256(canonical([record["project_id"], payload["run_id"]])).hexdigest()
        with original_guard(self.directory/(key+".lock")) as identity:
            self._verify(owner, registration, record, native_evidence, original, proof, observations)
            with self.repository.transaction() as db:
                self.repository._project(db, owner, record["project_id"])
                row = db.execute("SELECT owner_id,document,last_observed_at FROM controller_authorities WHERE project_id=? AND run_id=?", (record["project_id"], payload["run_id"])).fetchone()
                if row is None or row[0] != owner.principal_id or loads(row[1]) != record:
                    raise Problem("PRECONDITION_FAILED")
                observed = self._verify(owner, registration, record, native_evidence, original, proof, observations)
                if observed < instant(row[2]):
                    raise Problem("PRECONDITION_FAILED")
                retired = envelope("controller-authority-record", record["project_id"], {**payload, "lease_expires_at": None, "termination_evidence": [proof, *observations]}, contracts=self.contracts)
                retired["native_contract_refs"] = record["native_contract_refs"]
                reseal(retired)
                self.contracts.validate("controller-authority-record", retired)
                db.execute("INSERT INTO authority_retirements VALUES(?,?,?,?,?,?,?,?,?)", (payload["run_id"], payload["generation"], record["project_id"], owner.principal_id, request_hash, row[1], canonical(retired).decode(), original.decode(), stamp(observed)))
                db.execute("UPDATE controller_authorities SET document=?,last_observed_at=? WHERE run_id=?", (canonical(retired).decode(), stamp(observed), payload["run_id"]))
                # Revalidate after writes and before atomic commit: expiry/requeue
                # or lost/replaced guard leaves both history and current intact.
                self._verify(owner, registration, record, native_evidence, original, proof, observations)
                information = checked_path(self.directory/(key+".lock")).stat()
                if information.st_nlink != 1 or (information.st_dev, information.st_ino) != identity:
                    raise Problem("PRECONDITION_FAILED")
                return retired
