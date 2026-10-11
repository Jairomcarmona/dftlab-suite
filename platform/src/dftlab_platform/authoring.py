"""Typed local application handlers, independent of HTTP and the engine DAG.

Recipes own scientific translation/validation through the pinned motor facade.
These handlers bind their outputs to authorized immutable inputs. Registration
is explicit; the default service never acquires execution capabilities here.
"""
from __future__ import annotations

import hashlib
from typing import Protocol

from .contracts import BASE, canonical
from .domain import Principal, Problem, identifier
from .engines import engine_lock
from .local_effects import LocalEffect, LocalProduct


class AuthoringPort(Protocol):
    """Trusted installed adapter. No client-provided callbacks or host paths."""
    def validate(self, owner: Principal, bundle: dict, snapshot: dict) -> dict: ...
    def compile(self, owner: Principal, bundle: dict, receipt: dict, snapshot: dict) -> dict: ...
    def prepare(self, owner: Principal, native_plan: dict, profile_id: str) -> dict: ...


class AuthoringHandlers:
    def __init__(self, repository, drafts, artifacts, authoring: AuthoringPort, *, input_limit=8*1024**2):
        if type(input_limit) is not int or not 1 <= input_limit <= 8*1024**2:
            raise ValueError("Invalid authoring input limit")
        self.repository, self.drafts, self.artifacts = repository, drafts, artifacts
        self.authoring, self.limit = authoring, input_limit
        self.contracts = repository.contracts

    def handlers(self):
        return {"VALIDATE_INPUT": self.validate, "CREATE_CAMPAIGN": self.campaign,
                "CREATE_PLAN": self.plan, "PREPARE_PACKAGE": self.package}

    def _context(self, action, operation, request):
        if operation["payload"]["action"] != action or request["action"] != action or operation["project_id"] != request["project_id"]:
            raise Problem("PRECONDITION_FAILED")
        self.contracts.validate_ref(BASE+"schemas/operation-request.schema.json#/$defs/"+
                                    {"VALIDATE_INPUT": "validate_input_payload", "CREATE_CAMPAIGN": "create_campaign_payload",
                                     "CREATE_PLAN": "create_plan_payload", "PREPARE_PACKAGE": "prepare_package_payload"}[action], request["payload"])
        owner = Principal(operation["payload"]["owner_principal_id"])
        self.repository.project(owner, request["project_id"])
        return owner

    def _draft(self, owner, project, reference):
        bundle = self.drafts.get_revision(owner, reference["draft_id"], reference["revision"])
        if bundle["draft"]["project_id"] != project:
            raise Problem("NOT_FOUND")
        return bundle

    def _ref(self, owner, project, reference):
        self.contracts.validate("artifact-ref", reference)
        record = self.artifacts.metadata(owner, reference["artifact_id"])
        payload = record["payload"]
        if record["project_id"] != project or record["integrity"]["status"] != "VERIFIED" or payload["sha256"] != reference["sha256"] or payload["media_type"] != reference["media_type"] or payload["integrity_state"] != "VERIFIED" or not self.artifacts.verify(owner, reference["artifact_id"]):
            raise Problem("PRECONDITION_FAILED")
        return record

    def _snapshot(self, owner, project, bundle, operation_id):
        data = canonical(bundle)
        if len(data) > self.limit:
            raise Problem("PAYLOAD_TOO_LARGE")
        upload = self.artifacts.stage(owner, {"project_id": project, "idempotency_key": "draft-snapshot-"+operation_id, "media_type": "application/json",
                                              "kind": "dftlab.draft-snapshot", "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        start = upload["received_bytes"]
        while start < len(data):
            end = min(len(data), start+65536)
            self.artifacts.write(owner, upload["upload_id"], start, end-1, len(data), data[start:end])
            start = end
        record = self.artifacts.commit(owner, upload["upload_id"])
        return {key: record["payload"][key] for key in ("artifact_id", "sha256", "media_type")}

    def _receipt(self, owner, project, receipt, bundle, snapshot=None):
        self.contracts.validate("validation-receipt", receipt)
        if receipt["project_id"] != project or receipt["integrity"]["status"] != "VERIFIED":
            raise Problem("PRECONDITION_FAILED")
        expected = hashlib.sha256(canonical(bundle)).hexdigest()
        bound = False
        for reference in receipt["payload"]["input_refs"]:
            record = self._ref(owner, project, reference)
            if record["payload"]["kind"] == "dftlab.draft-snapshot" and reference["sha256"] == expected:
                if snapshot is None or reference == snapshot:
                    bound = True
        if not bound:
            raise Problem("PRECONDITION_FAILED")

    def _native_plan(self, owner, project, reference):
        self.contracts.validate("native-contract-ref", reference)
        pin = engine_lock()["engines"]["qraft"]
        if reference["engine"] != "qraft" or reference["distribution"] != pin["distribution"] or reference["version"] != pin["declared_version"] or reference["commit"] != pin["commit"] or reference["contract"] != "siestaflow.workflow-lock@1.0" or reference["digest"]["algorithm"] != "qraft.content-sha256-v1" or reference["verification"]["status"] != "VERIFIED" or reference["artifact"]["media_type"] != "application/json":
            raise Problem("PRECONDITION_FAILED")
        self._ref(owner, project, reference["artifact"])

    def validate(self, operation, request):
        owner = self._context("VALIDATE_INPUT", operation, request)
        project = request["project_id"]
        bundle = self._draft(owner, project, request["payload"]["draft"])
        snapshot = self._snapshot(owner, project, bundle, operation["payload"]["operation_id"])
        inputs_before = canonical([bundle, snapshot])
        receipt = self.authoring.validate(owner, bundle, snapshot)
        if canonical([bundle, snapshot]) != inputs_before:
            raise Problem("PRECONDITION_FAILED")
        self._receipt(owner, project, receipt, bundle, snapshot)
        return LocalEffect((LocalProduct("VALIDATION_RECEIPT", receipt["record_id"], 1, receipt),))

    def campaign(self, operation, request):
        owner = self._context("CREATE_CAMPAIGN", operation, request)
        project, payload = request["project_id"], request["payload"]
        for reference in payload["drafts"]:
            self._draft(owner, project, reference)
        campaign_id = identifier()
        document = {"campaign_id": campaign_id, "project_id": project, "revision": 1,
                    "name": payload["name"], "drafts": payload["drafts"]}
        return LocalEffect((LocalProduct("CAMPAIGN", campaign_id, 1, document),))

    def plan(self, operation, request):
        owner = self._context("CREATE_PLAN", operation, request)
        project, payload = request["project_id"], request["payload"]
        campaign = self.repository.local_product(owner, "CAMPAIGN", request["target"]["id"])
        if campaign.document["project_id"] != project or payload["draft"] not in campaign.document["drafts"]:
            raise Problem("PRECONDITION_FAILED")
        bundle = self._draft(owner, project, payload["draft"])
        if bundle["intent"] is None or bundle["intent"]["run_intent"]["payload"]["intent_id"] != payload["intent_id"]:
            raise Problem("PRECONDITION_FAILED")
        receipt = self.repository.local_product(owner, "VALIDATION_RECEIPT", payload["validation_receipt_id"]).document
        self._receipt(owner, project, receipt, bundle)
        if receipt["payload"]["authority"] != "AUTHORITATIVE" or receipt["payload"]["decision"] == "BLOCKED" or any(
                finding["severity"] == "BLOCKING" and finding["rule_kind"] == "HARD_RULE"
                for finding in receipt["payload"]["diagnostics"]):
            raise Problem("PRECONDITION_FAILED")
        # Reuse the validated immutable snapshot, never generate an equivalent
        # artifact with a different identity to conceal a binding mismatch.
        snapshot = next(ref for ref in receipt["payload"]["input_refs"]
                        if ref["sha256"] == hashlib.sha256(canonical(bundle)).hexdigest()
                        and self.artifacts.metadata(owner, ref["artifact_id"])["payload"]["kind"] == "dftlab.draft-snapshot")
        inputs_before = canonical([bundle, receipt, snapshot])
        native = self.authoring.compile(owner, bundle, receipt, snapshot)
        if canonical([bundle, receipt, snapshot]) != inputs_before:
            raise Problem("PRECONDITION_FAILED")
        self._native_plan(owner, project, native)
        return LocalEffect((LocalProduct("PLAN", identifier(), 1, native),))

    def package(self, operation, request):
        owner = self._context("PREPARE_PACKAGE", operation, request)
        project = request["project_id"]
        native = self.repository.local_product(owner, "PLAN", request["target"]["id"]).document
        self._native_plan(owner, project, native)
        if request["payload"]["expected_plan_digest"] != native["digest"]:
            raise Problem("PRECONDITION_FAILED")
        reference_before = canonical(native)  # platform ref bytes, not native digest
        record = self.authoring.prepare(owner, native, request["profile_ref"])
        if canonical(native) != reference_before:
            raise Problem("PRECONDITION_FAILED")
        self.contracts.validate("artifact-record", record)
        payload = record["payload"]
        reference = {key: payload[key] for key in ("artifact_id", "sha256", "media_type")}
        stored = self._ref(owner, project, reference)
        if record != stored or payload["kind"] != "qraft.run-package" or payload["media_type"] != "application/zip":
            raise Problem("PRECONDITION_FAILED")
        return LocalEffect((LocalProduct("PACKAGE", payload["artifact_id"], 1, record),))
