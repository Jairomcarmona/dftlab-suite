"""Write-ahead dispatch, independent of native packages and scheduler transport.

Only trusted installed application ports register this gateway. No endpoint,
admission or runtime capability is enabled here. A timeout/empty observation
never authorizes dispatch again; the engine retains the actual DAG.
"""
from copy import deepcopy
from typing import Protocol

from .contracts import canonical
from .domain import Problem, envelope


BINDINGS = ("operation_id", "attempt_token", "package_ref", "profile", "scheduler", "authority_generation")


class SchedulerPort(Protocol):
    """Private trusted site adapter, never a client callback or shell string.

    submit returns a verified original ACCEPTED SubmissionReceipt bound to the
    complete intent. find returns RECONCILED_FOUND with proven token, package,
    user/cluster/site context, or None for uncertainty. Never return absence
    from an empty queue. Raw observations/provenance must be retained privately.
    """
    def submit(self, intent: dict) -> dict: ...
    def find(self, intent: dict) -> dict | None: ...


class SubmissionLedger(Protocol):
    def reserve(self, operation_id: str, revision: int, processor_id: str, intent: dict) -> dict: ...
    def start(self, intent: dict) -> dict | None: ...
    def confirm(self, intent: dict, receipt: dict) -> dict: ...
    def snapshot(self, owner, operation_id: str) -> tuple[dict, str, dict | None]: ...


def check_receipt(contracts, intent, receipt, allowed):
    contracts.validate("submission-receipt", receipt)
    if receipt["integrity"]["status"] != "VERIFIED" or receipt["project_id"] != intent["project_id"] or receipt["payload"]["status"] not in allowed:
        raise Problem("PRECONDITION_FAILED")
    if any(receipt["payload"][key] != intent["payload"][key] for key in BINDINGS):
        raise Problem("PRECONDITION_FAILED")


class DurableSubmissions:
    def __init__(self, repository, ledger: SubmissionLedger, scheduler: SchedulerPort):
        self.repository, self.ledger, self.scheduler = repository, ledger, scheduler
        self.contracts = repository.contracts

    def perform(self, operation, processor_id, intent):
        """Typed internal handler boundary; no admission bypass HTTP route.

        Package preparation/profile/admission belong to the registered caller.
        Its original intent is committed with the unique run reservation before
        this gateway is allowed to call the non-idempotent scheduler port.
        """
        self.contracts.validate("effect-intent", intent)
        if intent["payload"]["action"] != "SUBMIT_RUN" or intent["payload"]["scheduler"] != "SLURM" or intent["integrity"]["status"] != "VERIFIED":
            raise Problem("PRECONDITION_FAILED")
        payload = operation["payload"]
        frozen = self.ledger.reserve(payload["operation_id"], payload["revision"], processor_id, deepcopy(intent))
        previous = self.ledger.start(frozen)
        if previous is not None:
            return {"receipt": previous}
        # DISPATCH_STARTED is committed before entering this port. A failure,
        # interruption or lost ack leaves it closed to all future submissions.
        before = canonical(frozen)
        receipt = self.scheduler.submit(frozen)
        if canonical(frozen) != before:
            raise Problem("PRECONDITION_FAILED")
        check_receipt(self.contracts, frozen, receipt, {"ACCEPTED"})
        return {"receipt": self.ledger.confirm(frozen, receipt)}

    def reconcile(self, owner, operation_id):
        operation = self.repository.operation(owner, operation_id)
        if operation["payload"]["state"] != "OUTCOME_UNKNOWN" or operation["payload"]["action"] != "SUBMIT_RUN":
            raise Problem("PRECONDITION_FAILED")
        intent, phase, saved = self.ledger.snapshot(owner, operation_id)
        if phase == "RESERVED":
            # No dispatch was started, but do not silently manufacture terminal
            # absence/recovery evidence from a potentially restored ledger.
            return operation
        if saved is not None:
            check_receipt(self.contracts, intent, saved, {"ACCEPTED", "RECONCILED_FOUND"})
            # A durable original scheduler ack proves the submit happened. It
            # does not prove current scheduler/execution/scientific run status.
            receipt = envelope("submission-receipt", intent["project_id"], {**saved["payload"], "status": "RECONCILED_FOUND"}, contracts=self.contracts)
            receipt["native_contract_refs"] = deepcopy(saved["native_contract_refs"])
            from .domain import reseal
            reseal(receipt)
        else:
            frozen = deepcopy(intent)
            receipt = self.scheduler.find(frozen)
            if canonical(frozen) != canonical(intent):
                raise Problem("PRECONDITION_FAILED")
            if receipt is None:
                return operation  # empty/unavailable query is still unknown
        check_receipt(self.contracts, intent, receipt, {"RECONCILED_FOUND"})
        confirmed = self.ledger.confirm(intent, receipt)
        return self.repository.transition(operation_id, operation["payload"]["revision"], "SUCCEEDED", result={"receipt": confirmed})
