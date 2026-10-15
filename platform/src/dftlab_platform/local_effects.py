"""Application products, not a new client protocol or an engine DAG.

Engine documents remain original NativeContractRefs inside the public Plan
envelope; campaigns and plans use their accepted aggregate schemas.
"""
from dataclasses import dataclass

from .contracts import BASE, ContractError
from .domain import Problem


@dataclass(frozen=True)
class LocalProduct:
    kind: str
    product_id: str
    revision: int
    document: dict


@dataclass(frozen=True)
class LocalEffect:
    products: tuple[LocalProduct, ...]


PRODUCTS = {
    "VALIDATE_INPUT": ("VALIDATION_RECEIPT", "validation-receipt"),
    "CREATE_CAMPAIGN": ("CAMPAIGN", "campaign"),
    "CREATE_PLAN": ("PLAN", "plan"),
    "PREPARE_PACKAGE": ("PACKAGE", "artifact-record"),
    "CREATE_RESUME_PLAN": ("RESUME_PLAN", "resume-plan"),
}


def validate_products(contracts, operation, products):
    expected = PRODUCTS.get(operation["payload"]["action"])
    if expected is None or not isinstance(products, tuple) or len(products) != 1:
        raise Problem("PRECONDITION_FAILED")
    product = products[0]
    if not isinstance(product, LocalProduct) or product.kind != expected[0]:
        raise Problem("PRECONDITION_FAILED")
    contracts.validate_ref(BASE+"schemas/defs.schema.json#/$defs/id", product.product_id)
    contracts.validate_ref(BASE+"schemas/defs.schema.json#/$defs/revision", product.revision)
    # These commands create immutable products, rather than overwrite one.
    if product.revision != 1:
        raise Problem("PRECONDITION_FAILED")
    document, schema = product.document, expected[1]
    if schema:
        try:
            contracts.validate(schema, document)
        except ContractError:
            raise Problem("PRECONDITION_FAILED") from None
        if document["project_id"] != operation["project_id"] or document["integrity"]["status"] != "VERIFIED":
            raise Problem("PRECONDITION_FAILED")
        if schema == "campaign":
            payload = document["payload"]
            if payload["campaign_id"] != product.product_id or payload["revision"] != product.revision:
                raise Problem("PRECONDITION_FAILED")
            try:
                contracts.validate_ref(BASE+"schemas/operation-request.schema.json#/$defs/create_campaign_payload", {"name": payload["name"], "drafts": payload["drafts"]})
            except ContractError:
                raise Problem("PRECONDITION_FAILED") from None
        elif schema == "plan":
            payload = document["payload"]
            if payload["plan_id"] != product.product_id or payload["revision"] != product.revision or len(document["native_contract_refs"]) != 1:
                raise Problem("PRECONDITION_FAILED")
            reference = document["native_contract_refs"][0]
            try:
                contracts.validate("native-contract-ref", reference)
            except ContractError:
                raise Problem("PRECONDITION_FAILED") from None
            if reference["engine"] != "qraft" or reference["contract"] != "siestaflow.workflow-lock@1.0" or reference["verification"]["status"] != "VERIFIED":
                raise Problem("PRECONDITION_FAILED")
        else:
            field = {"validation-receipt": "record_id", "artifact-record": "artifact_id", "resume-plan": "resume_plan_id"}[schema]
            actual = document["record_id"] if field == "record_id" else document["payload"][field]
            if actual != product.product_id:
                raise Problem("PRECONDITION_FAILED")
            if schema == "resume-plan" and document["payload"]["plan_revision"] != product.revision:
                raise Problem("PRECONDITION_FAILED")
            if schema == "artifact-record" and (document["payload"]["integrity_state"] != "VERIFIED" or document["payload"]["kind"] != "qraft.run-package"):
                raise Problem("PRECONDITION_FAILED")
    else:
        if not isinstance(document, dict):
            raise Problem("PRECONDITION_FAILED")
    return [{"kind": product.kind, "id": product.product_id, "revision": product.revision}]
