"""Immutable draft materialization; no engine, scheduler or admission effects."""
from typing import Protocol

from .domain import Principal, envelope, identifier, now


class DraftRepository(Protocol):
    def create(self, owner: Principal, project_id: str, request: dict) -> tuple[dict, bool]: ...
    def revise(self, owner: Principal, draft_id: str, request: dict) -> tuple[dict, bool]: ...
    def get(self, owner: Principal, draft_id: str) -> dict: ...
    def get_revision(self, owner: Principal, draft_id: str, revision: int) -> dict: ...
    def list(self, owner: Principal, project_id: str) -> list[dict]: ...


def materialize(project_id, content, provenance, previous=None, *, contracts):
    def wrap(schema, payload):
        return envelope(schema, project_id, payload, contracts=contracts)
    old = previous["draft"]["payload"] if previous else None
    draft_id = old["draft_id"] if old else identifier()
    old_structure = previous["structure"]["payload"] if previous else None
    fields = {k: v for k, v in old_structure.items() if k not in {"structure_id", "revision", "parent_revision"}} if old_structure else None
    if fields == content["structure"]:
        structure = previous["structure"]
    else:
        structure = wrap("structure-revision", {
            **content["structure"], "structure_id": old_structure["structure_id"] if old else identifier(),
            "revision": old_structure["revision"]+1 if old else 1,
            "parent_revision": old_structure["revision"] if old else None})
    intent = None
    template = content["intent"]
    if template is not None:
        prior = previous["intent"] if previous else None
        if prior and prior["physical_model"]["payload"] == template["physical_model"]:
            model = prior["physical_model"]
        else:
            model = wrap("physical-model", template["physical_model"])
        if prior and prior["numerical_policy"]["payload"] == template["numerical_policy"]:
            policy = prior["numerical_policy"]
        else:
            policy = wrap("numerical-policy", template["numerical_policy"])
        payload = {"intent_id": identifier(), "draft_id": draft_id, "operation": template["operation"],
            "purpose": content["purpose"], "structure": {"structure_id": structure["payload"]["structure_id"], "revision": structure["payload"]["revision"]},
            "physical_model_ref": model["record_id"], "numerical_policy_ref": policy["record_id"],
            "protocol": template["protocol"], "promoted_from": None}
        origin = content["origin"]
        if origin["kind"] == "LEARNING_PROMOTION":
            payload["promoted_from"] = {"learning_dataset_id": origin["learning_dataset_id"], "exported_kind": origin["exported_kind"]}
        if prior and {k: v for k, v in prior["run_intent"]["payload"].items() if k != "intent_id"} == {k: v for k, v in payload.items() if k != "intent_id"}:
            run_intent = prior["run_intent"]
        else:
            run_intent = wrap("run-intent", payload)
        intent = {"run_intent": run_intent, "physical_model": model, "numerical_policy": policy}
    draft = wrap("draft", {"draft_id": draft_id, "revision": old["revision"]+1 if old else 1,
        "title": content["title"], "origin": content["origin"], "purpose": content["purpose"],
        "provenance_state": provenance, "scientific_assessment": "NOT_EVALUATED",
        "structure": {"structure_id": structure["payload"]["structure_id"], "revision": structure["payload"]["revision"]},
        "intent_id": intent["run_intent"]["payload"]["intent_id"] if intent else None, "updated_at": now()})
    return {"draft": draft, "structure": structure, "intent": intent}
