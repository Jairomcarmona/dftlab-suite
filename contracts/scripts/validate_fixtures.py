"""Validate every schema against JSON Schema 2020-12 and every fixture against its schema.

Requires `jsonschema>=4.18` (with `referencing`). Optional: `openapi-spec-validator`
to check openapi/dftlab-api.v1.json. Exit code 1 on any mismatch.
Usage: python contracts/scripts/validate_fixtures.py
"""
import json
import pathlib
import sys

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

ROOT = pathlib.Path(__file__).resolve().parents[1]


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


schemas = {p.name: load(p) for p in sorted((ROOT / "schemas").glob("*.schema.json"))}
failures = []
for name, schema in schemas.items():
    try:
        Draft202012Validator.check_schema(schema)
    except Exception as exc:  # noqa: BLE001
        failures.append(f"{name}: invalid schema: {exc}")

registry = Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in schemas.values())
manifest = load(ROOT / "fixtures" / "manifest.json")["fixtures"]
counts = {"valid": 0, "invalid": 0}
for entry in manifest:
    validator = Draft202012Validator(schemas[entry["schema"]], registry=registry, format_checker=FormatChecker())
    errors = list(validator.iter_errors(load(ROOT / entry["path"])))
    ok = not errors if entry["expect"] == "valid" else bool(errors)
    counts[entry["expect"]] += 1
    if not ok:
        detail = errors[0].message if errors else "accepted"
        failures.append(f"{entry['path']}: expected {entry['expect']}, got {detail}")

try:
    from openapi_spec_validator import validate as validate_openapi
    from openapi_spec_validator.readers import read_from_filename
except ImportError:
    print("openapi-spec-validator not installed: OpenAPI not checked here (check-contracts.mjs still resolves its $refs).")
else:
    spec, base = read_from_filename(str(ROOT / "openapi" / "dftlab-api.v1.json"))
    try:
        validate_openapi(spec, base_uri=base)
        print("OpenAPI 3.1 document valid.")
    except Exception as exc:  # noqa: BLE001
        failures.append(f"openapi: {exc}")

for failure in failures:
    print("FAIL", failure)
print(f"{len(schemas)} schemas; fixtures {counts['valid']} valid + {counts['invalid']} invalid; {len(failures)} failures.")
sys.exit(1 if failures else 0)
