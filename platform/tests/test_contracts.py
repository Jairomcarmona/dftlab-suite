"""Shared authoritative fixtures, installed resource and transport adversaries."""
import copy
import hashlib
import unittest
from dftlab_platform.contracts import Contracts, ContractError, canonical, consumer_state, digest, loads, resource_json


class ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contracts = Contracts()

    def test_all_shared_fixtures_and_consumer_semantics(self):
        entries = resource_json("fixtures/manifest.json")["fixtures"]
        self.assertEqual(len(entries), 169)
        for entry in entries:
            with self.subTest(path=entry["path"]):
                value = resource_json(entry["path"])
                if entry["expect"] == "valid":
                    self.contracts.validate(entry["schema"], value)
                else:
                    with self.assertRaises(ContractError):
                        self.contracts.validate(entry["schema"], value)
                if "consumer" in entry:
                    result = consumer_state(entry["schema"], value, valid=entry["expect"] == "valid")
                    for key, expected in entry["consumer"].items():
                        self.assertEqual(result[key], expected)

    def test_cross_language_canonicalization(self):
        expected = resource_json("fixtures/canonicalization/expected.json")
        for example in resource_json("fixtures/canonicalization/inputs.json"):
            encoded = canonical(example["input"])
            self.assertEqual(encoded.decode(), expected[example["name"]]["canonical"])
            self.assertEqual(hashlib.sha256(encoded).hexdigest(), expected[example["name"]]["sha256"])
        # UTF-16 sorting differs from Python code point order.
        self.assertEqual(canonical({"\ue000": 1, "\U0001f600": 2}), '{"\U0001f600":2,"\ue000":1}'.encode())

    def test_transport_rejects_duplicates_nonfinite_unsafe_and_surrogates(self):
        for text in ['{"x":1,"x":2}', '{"x":NaN}', '{"x":1e999}', '{"x":9007199254740992}', '{"x":"\\ud800"}']:
            with self.subTest(text=text), self.assertRaises((ValueError, UnicodeError)):
                loads(text)

    def test_cached_bundle_does_not_share_mutable_contract_documents(self):
        first, second = Contracts(), Contracts()
        first.openapi["paths"].clear()
        first._schemas.clear()
        self.assertTrue(second.openapi["paths"])
        self.assertTrue(second._schemas)
        self.assertTrue(resource_json("openapi/dftlab-api.v1.json")["paths"])

    def test_forged_verified_digest_is_rejected(self):
        value = resource_json("fixtures/envelope/valid/verified-digest.json")
        value = copy.deepcopy(value)
        value["payload"]["forged"] = True
        with self.assertRaises(ContractError):
            self.contracts.validate("envelope", value)

    def test_openapi_inline_request_and_response_are_validated(self):
        self.contracts.validate_ref(self.contracts.api_ref("createProject"), {"name": "test", "idempotency_key": "abcdefghijklmnop"})
        with self.assertRaises(ContractError):
            self.contracts.validate_ref(self.contracts.api_ref("createProject"), {"name": "test", "idempotency_key": "abcdefghijklmnop", "owner_principal_id": "other"})
        self.contracts.validate_ref(self.contracts.api_ref("getHealth", status=200), {"status": "OK", "api_version": "0.1.0"})

    def test_native_refs_round_trip_without_recanonicalizing_digests(self):
        value = resource_json("fixtures/native-contract-ref/valid/qraft-workflow-lock.json")
        before = copy.deepcopy(value)
        self.contracts.validate("native-contract-ref", value)
        self.assertEqual(before, value)
        self.assertNotEqual(resource_json("fixtures/native-digests/two-algorithms.json")["qraft.content-sha256-v1"], resource_json("fixtures/native-digests/two-algorithms.json")["hubbardflow.plan-digest-v1"])


if __name__ == "__main__":
    unittest.main()
