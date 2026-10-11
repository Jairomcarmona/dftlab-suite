"""Application products, not a new client protocol or an engine DAG.

Engine documents remain original NativeContractRefs. Campaign is private
platform bookkeeping: no Campaign schema or read endpoint is invented.
"""
from dataclasses import dataclass

from .contracts import BASE
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
    "CREATE_CAMPAIGN": ("CAMPAIGN", None),
    "CREATE_PLAN": ("PLAN", "native-contract-ref"),
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
        contracts.validate(schema, document)
        if schema != "native-contract-ref":
            if document["project_id"] != operation["project_id"] or document["integrity"]["status"] != "VERIFIED":
                raise Problem("PRECONDITION_FAILED")
            field = {"validation-receipt": "record_id", "artifact-record": "artifact_id", "resume-plan": "resume_plan_id"}[schema]
            actual = document["record_id"] if field == "record_id" else document["payload"][field]
            if actual != product.product_id:
                raise Problem("PRECONDITION_FAILED")
            if schema == "resume-plan" and document["payload"]["plan_revision"] != product.revision:
                raise Problem("PRECONDITION_FAILED")
            if schema == "artifact-record" and (document["payload"]["integrity_state"] != "VERIFIED" or document["payload"]["kind"] != "qraft.run-package"):
                raise Problem("PRECONDITION_FAILED")
        elif document["engine"] != "qraft" or document["contract"] != "siestaflow.workflow-lock@1.0" or document["verification"]["status"] != "VERIFIED":
            raise Problem("PRECONDITION_FAILED")
    else:
        # Deliberately private, explicit bookkeeping until a public read
        # representation is agreed. Not serialized as an invented envelope.
        if not isinstance(document, dict) or set(document) != {"campaign_id", "project_id", "revision", "name", "drafts"}:
            raise Problem("PRECONDITION_FAILED")
        if document["campaign_id"] != product.product_id or document["project_id"] != operation["project_id"] or document["revision"] != product.revision:
            raise Problem("PRECONDITION_FAILED")
        contracts.validate_ref(BASE+"schemas/operation-request.schema.json#/$defs/create_campaign_payload", {"name": document["name"], "drafts": document["drafts"]})
    return [{"kind": product.kind, "id": product.product_id, "revision": product.revision}]
