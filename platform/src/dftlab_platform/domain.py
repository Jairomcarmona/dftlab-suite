"""Platform identities and operation rules, independent of HTTP and SQL.

No engine DAG, scientific gate or scheduler is implemented in this domain.
"""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timezone
import uuid
from typing import Any, Protocol

from .contracts import Contracts, canonical, digest, resource_json
from . import __version__


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def identifier() -> str:
    return str(uuid.uuid4())


@dataclass(frozen=True)
class Principal:
    principal_id: str


class Problem(Exception):
    def __init__(self, code: str):
        self.code = code
        self.status = resource_json("errors/error-codes.json")["codes"][code]["status"]
        super().__init__(code)

    def document(self, request_id: str | None = None) -> dict:
        return {"type": "urn:dftlab:problem:" + self.code.lower().replace("_", "-"), "title": self.code.replace("_", " "), "status": self.status, "code": self.code, "request_id": request_id or identifier()}


def envelope(schema: str, project: str, payload: dict, *, record_id: str | None = None, contracts: Contracts | None = None) -> dict:
    value = {"schema_id": "dftlab." + schema, "schema_version": "0.1.0", "record_id": record_id or identifier(), "project_id": project, "producer": {"package": "dftlab-platform", "version": __version__.replace(".dev", "-dev."), "commit": None, "algorithm": None}, "created_at": now(), "payload": payload, "native_contract_refs": []}
    value["integrity"] = {"status": "VERIFIED", "canonicalization": "jcs-rfc8785", "algorithm": "sha-256", "digest": digest(value)}
    (contracts or Contracts()).validate(schema, value)
    return value


def reseal(value: dict) -> dict:
    value["integrity"]["digest"] = digest({k: v for k, v in value.items() if k != "integrity"})
    return value


def transition_guard(operation: dict, destination: str, result: dict | None, error: dict | None, *, no_effect: bool = False, effect_intent: dict | None = None) -> None:
    source = operation["payload"]["state"]
    allowed = {(t["from"], t["to"]) for t in resource_json("transitions/operation-transitions.json")["transitions"]}
    if (source, destination) not in allowed:
        raise Problem("PRECONDITION_FAILED")
    if source == "PENDING" and destination in ("REJECTED", "CANCELLED") and not no_effect:
        raise Problem("PRECONDITION_FAILED")
    if destination in ("FAILED", "REJECTED"):
        if error is None:
            raise Problem("PRECONDITION_FAILED")
        Contracts().validate("problem", error)
    if destination == "FAILED" and source == "RUNNING" and (not no_effect or not result):
        raise Problem("PRECONDITION_FAILED")
    if destination == "FAILED" and source == "RUNNING" and effect_intent is not None:
        raise Problem("PRECONDITION_FAILED")
    if destination == "SUCCEEDED" and (not isinstance(result, dict) or not result):
        raise Problem("PRECONDITION_FAILED")
    if destination == "SUCCEEDED" and operation["payload"]["action"] in {"SUBMIT_RUN", "EXECUTE_RESUME_PLAN"}:
        receipt = result.get("receipt")
        if not receipt:
            raise Problem("PRECONDITION_FAILED")
        Contracts().validate("submission-receipt", receipt)
        if receipt["integrity"]["status"] != "VERIFIED":
            raise Problem("PRECONDITION_FAILED")
        if receipt["project_id"] != operation["project_id"] or receipt["payload"]["operation_id"] != operation["payload"]["operation_id"] or receipt["payload"]["status"] not in {"ACCEPTED", "RECONCILED_FOUND"}:
            raise Problem("PRECONDITION_FAILED")
    if source == "OUTCOME_UNKNOWN":
        receipt = (result or {}).get("receipt")
        if not receipt:
            raise Problem("PRECONDITION_FAILED")
        if destination == "FAILED" and (error or {}).get("code") != "OPERATION_INTERRUPTED":
            raise Problem("PRECONDITION_FAILED")
        if receipt.get("schema_id") == "dftlab.operation-resolution-receipt":
            Contracts().validate("operation-resolution-receipt", receipt)
            payload = receipt["payload"]
            if receipt["integrity"]["status"] != "VERIFIED" or receipt["project_id"] != operation["project_id"] or payload["operation_id"] != operation["payload"]["operation_id"] or payload["action"] != operation["payload"]["action"] or payload["resulting_state"] != destination:
                raise Problem("PRECONDITION_FAILED")
            if payload["effect_class"] == "EXTERNAL_SUBMISSION" and effect_intent is not None:
                raise Problem("PRECONDITION_FAILED")
            return
        if operation["payload"]["action"] not in {"SUBMIT_RUN", "EXECUTE_RESUME_PLAN"} or effect_intent is None:
            raise Problem("PRECONDITION_FAILED")
        Contracts().validate("submission-receipt", receipt)
        if receipt["integrity"]["status"] != "VERIFIED":
            raise Problem("PRECONDITION_FAILED")
        expected = "RECONCILED_FOUND" if destination == "SUCCEEDED" else "RECONCILED_ABSENT_WITH_EVIDENCE"
        if receipt["project_id"] != operation["project_id"] or receipt["payload"]["status"] != expected or receipt["payload"]["operation_id"] != operation["payload"]["operation_id"]:
            raise Problem("PRECONDITION_FAILED")
    if operation["payload"]["action"] in {"SUBMIT_RUN", "EXECUTE_RESUME_PLAN"} and destination in {"SUCCEEDED", "FAILED"} and (source == "OUTCOME_UNKNOWN" or destination == "SUCCEEDED"):
        receipt = (result or {}).get("receipt")
        if effect_intent is None:
            raise Problem("PRECONDITION_FAILED")
        for key in ("operation_id", "attempt_token", "package_ref", "profile", "scheduler", "authority_generation"):
            if receipt["payload"][key] != effect_intent["payload"][key]:
                raise Problem("PRECONDITION_FAILED")


class Repository(Protocol):
    """Port for SQLite local / PostgreSQL web. No SQL crosses this interface."""
    def ensure_principal(self, handle: str) -> Principal: ...
    def create_project(self, owner: Principal, body: dict) -> tuple[dict, bool]: ...
    def list_projects(self, owner: Principal) -> list[dict]: ...
    def project(self, owner: Principal, project_id: str) -> dict: ...
    def accept(self, owner: Principal, request: dict) -> tuple[dict, bool]: ...
    def operation(self, owner: Principal, operation_id: str) -> dict: ...
    def request_for_processor(self, operation_id: str, processor_id: str) -> dict: ...
    def claim(self, processor_id: str) -> dict | None: ...
    def transition(self, operation_id: str, revision: int, destination: str, *, result: dict | None = None, error: dict | None = None, no_effect: bool = False, processor_id: str | None = None) -> dict: ...
    def persist_effect_intent(self, operation_id: str, revision: int, processor_id: str, document: dict) -> dict: ...
    def complete_local(self, operation_id: str, revision: int, processor_id: str, products: tuple) -> dict: ...
    def local_products(self, owner: Principal, operation_id: str) -> tuple: ...
    def recover(self) -> int: ...
    def checkpoint(self, destination: Any) -> None: ...


class Operations:
    def __init__(self, repository: Repository):
        self.repository = repository
        self.contracts = Contracts()

    def accept(self, principal: Principal, request: dict) -> tuple[dict, bool]:
        self.contracts.validate("operation-request", request)
        return self.repository.accept(principal, request)


class Processor:
    """Separate durable consumer. Handlers must be qualified application ports.

Unknown effects never retry automatically. Default has no scientific handlers;
registration of engine operations waits for the contracts/adapters of Ola 3.
"""
    def __init__(self, repository: Repository, handlers: dict | None = None):
        self.repository = repository
        self.handlers = handlers or {}
        self.processor_id = identifier()

    def once(self) -> bool:
        operation = self.repository.claim(self.processor_id)
        if operation is None:
            return False
        payload = operation["payload"]
        handler = self.handlers.get(payload["action"])
        if handler is None:
            # No handler and no effect started: fail with explicit evidence.
            self.repository.transition(payload["operation_id"], payload["revision"], "FAILED", error=Problem("ENGINE_UNAVAILABLE").document(), result={"no_effect": "handler_not_installed"}, no_effect=True, processor_id=self.processor_id)
            return True
        try:
            request = self.repository.request_for_processor(payload["operation_id"], self.processor_id)
            result = handler(operation, request)
            from .local_effects import LocalEffect, PRODUCTS
            if payload["action"] in PRODUCTS:
                if not isinstance(result, LocalEffect):
                    raise Problem("PRECONDITION_FAILED")
                self.repository.complete_local(payload["operation_id"], payload["revision"], self.processor_id, result.products)
            else:
                self.repository.transition(payload["operation_id"], payload["revision"], "SUCCEEDED", result=result, processor_id=self.processor_id)
        except Exception:
            # Catching an exception proves neither remote failure nor absence.
            self.repository.transition(payload["operation_id"], payload["revision"], "OUTCOME_UNKNOWN", processor_id=self.processor_id)
        return True
