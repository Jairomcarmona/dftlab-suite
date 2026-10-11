"""Offline JSON Schema 2020-12 validation and JCS for platform documents only.

Schemas are bundled verbatim from contracts/ at build time. Native digests are
opaque values: this module never computes or rewrites them.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import hashlib
from importlib.resources import files
import json
import math
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry
from referencing.jsonschema import DRAFT202012
import rfc8785

BASE = "https://dftlab.invalid/contracts/"
API_URI = BASE + "openapi/dftlab-api.v1.json"


def resource_json(relative: str) -> Any:
    return json.loads(files("dftlab_platform").joinpath("resources/contracts", relative).read_text("utf-8"))


def _json_tree(value: Any, depth: int = 0) -> None:
    if depth > 64:
        raise ValueError("JSON nesting limit exceeded")
    if value is None or type(value) is bool:
        return
    if type(value) in (int, float):
        if not math.isfinite(value) or (type(value) is int and abs(value) > 9007199254740991):
            raise ValueError("Nonfinite or unsafe integer; use a decimal/big-int string")
        return
    if type(value) is str:
        value.encode("utf-8", errors="strict")
        return
    if type(value) is list:
        for item in value:
            _json_tree(item, depth + 1)
        return
    if type(value) is dict and all(type(key) is str for key in value):
        for key, item in value.items():
            _json_tree(key, depth + 1)
            _json_tree(item, depth + 1)
        return
    raise ValueError("Only JSON values are admitted")


def loads(data: str | bytes) -> Any:
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate JSON key")
            result[key] = value
        return result
    def bad_constant(value):
        raise ValueError("Nonfinite JSON number")
    value = json.loads(data, object_pairs_hook=pairs, parse_constant=bad_constant)
    _json_tree(value)
    return value


def canonical(value: Any) -> bytes:
    _json_tree(value)
    return rfc8785.dumps(value)


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


@dataclass(frozen=True)
class Issue:
    pointer: str
    code: str
    message: str


class ContractError(ValueError):
    def __init__(self, issues: tuple[Issue, ...]):
        self.issues = issues
        # Do not include imported values, filesystem paths or secrets.
        super().__init__("Document does not satisfy the platform contract")


@lru_cache(maxsize=1)
def _bundled_schema_bytes() -> tuple[bytes, ...]:
    # Installed bundle is immutable for this process. Cache only original bytes,
    # never a mutable schema/document supplied to a caller. Meta-schema checking
    # belongs at bundle load, not at every record or HTTP error construction.
    directory = files("dftlab_platform").joinpath("resources/contracts/schemas")
    documents = tuple(p.read_bytes() for p in directory.iterdir() if p.name.endswith(".schema.json"))
    for document in documents:
        Draft202012Validator.check_schema(json.loads(document))
    return documents


class Contracts:
    def __init__(self):
        schemas = [json.loads(data) for data in _bundled_schema_bytes()]
        self._schemas = {s["$id"]: s for s in schemas}
        api = resource_json("openapi/dftlab-api.v1.json")
        self.openapi = api
        # No retrieve callback: a reference outside this bundle fails closed.
        self._registry = Registry().with_resources(
            [(uri, DRAFT202012.create_resource(s)) for uri, s in self._schemas.items()]
            + [(API_URI, DRAFT202012.create_resource(api))]
        )
        self._validators = {}

    def validate_ref(self, ref: str, value: Any, *, integrity: bool = True) -> Any:
        try:
            _json_tree(value)
        except (ValueError, UnicodeError, OverflowError, RecursionError):
            raise ContractError((Issue("", "VALIDATION_FAILED", "Invalid JSON value"),)) from None
        if isinstance(value, dict) and "schema_version" in value:
            version = value["schema_version"]
            if not isinstance(version, str) or not version.startswith("0.1."):
                raise ContractError((Issue("/schema_version", "UNSUPPORTED_SCHEMA_VERSION", "Only platform minor 0.1 is supported"),))
        validator = self._validators.get(ref)
        if validator is None:
            validator = Draft202012Validator({"$ref": ref}, registry=self._registry, format_checker=FormatChecker())
            self._validators[ref] = validator
        errors = list(validator.iter_errors(value))
        if errors:
            issues = tuple(Issue("/" + "/".join(str(p).replace("~", "~0").replace("/", "~1") for p in e.absolute_path) if e.absolute_path else "", "VALIDATION_FAILED", f"Schema rule: {e.validator}") for e in errors[:32])
            raise ContractError(issues)
        if integrity and isinstance(value, dict) and value.get("integrity", {}).get("status") == "VERIFIED":
            unsigned = {k: v for k, v in value.items() if k != "integrity"}
            if value["integrity"]["digest"] != digest(unsigned):
                raise ContractError((Issue("/integrity/digest", "PRECONDITION_FAILED", "Envelope digest mismatch"),))
        return value

    def validate(self, name: str, value: Any, *, integrity: bool = True) -> Any:
        if name.removesuffix(".schema.json") not in {u.rsplit("/", 1)[1].removesuffix(".schema.json") for u in self._schemas}:
            raise ValueError("Unknown bundled schema")
        return self.validate_ref(BASE + "schemas/" + name.removesuffix(".schema.json") + ".schema.json", value, integrity=integrity)

    def api_ref(self, operation_id: str, *, status: int | None = None, media: str = "application/json") -> str:
        def escape(s):
            return s.replace("~", "~0").replace("/", "~1")
        for path, methods in self.openapi["paths"].items():
            for method, operation in methods.items():
                if operation.get("operationId") == operation_id:
                    pointer = f"/paths/{escape(path)}/{method}"
                    if status is None:
                        pointer += "/requestBody/content/"
                    else:
                        response = operation["responses"][str(status)]
                        pointer = response["$ref"][1:] if "$ref" in response else pointer + f"/responses/{status}"
                        pointer += "/content/"
                    return API_URI + "#" + pointer + escape(media) + "/schema"
        raise ValueError("Unknown API operation")


def consumer_state(schema: str, value: dict, *, valid: bool = True) -> dict:
    """Read-only summary; never scientific authority or execution admission."""
    if not valid:
        return {"display_state": "UNKNOWN", "is_pass": False, "is_certified": False}
    payload = value.get("payload", value.get("body", {}))
    if schema.startswith("submission-receipt"):
        return {"resubmit_allowed": False}  # reconciliation, not a UI decision
    if schema.startswith("event-record"):
        known = {"operation.state_changed", "run.projection_updated", "run.attempt_created", "run.output_segment", "artifact.committed", "assessment.recorded", "stream.resync_required"}
        return {"ignored": value["type"] not in known}
    if schema.startswith("run-projection"):
        state = payload["dimensions"]["science"]["value"]
        if state == "UNKNOWN" or any(payload["dimensions"][key]["value"] == "UNKNOWN" for key in ("execution", "scheduler")):
            return {"display_state": "UNKNOWN", "is_failed": payload["dimensions"]["execution"]["value"] == "FAILED"}
    else:
        native = payload.get("native_status", payload.get("plan_status", payload.get("numerical_status")))
        if native:
            vocab = resource_json("vocabularies/native-status-projection.json")
            state = vocab["vocabularies"].get(native["vocabulary"], {}).get("projection", {}).get(native["value"], vocab["default_projection"])
        else:
            state = payload.get("passport_state", "NOT_ESTABLISHED")
    return {"display_state": state, "is_pass": state == "PASS", "is_certified": False}
