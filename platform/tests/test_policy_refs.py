"""R1 uses the delivered document, contractual JCS and a lossless mapping."""
from types import SimpleNamespace
import unittest
from dftlab_platform.policy_refs import versioned_id, native_id, policy_reference
from dftlab_platform.contracts import digest


class PolicyRefs(unittest.TestCase):
    def test_literal_roundtrip_and_digest_of_delivered_document(self):
        for literal in ('qraft.electronic.policy@1','qraft.preset.s-01@1','operator.mesh.policy@12'):
            self.assertEqual(native_id(versioned_id(literal)).encode(),literal.encode())
        document={'threshold':1.0,'scope':['synthetic']}
        api=SimpleNamespace(scientific_policy_document=lambda literal:document)
        ref, raw=policy_reference(api,'operator.mesh.policy@12')
        self.assertEqual(ref,{'policy_id':'operator.mesh.policy','version':'12.0.0','digest':digest(document)})
        self.assertIs(raw,document)

    def test_no_policy_document_fallback_or_ambiguous_conversion(self):
        with self.assertRaises(AttributeError):
            policy_reference(SimpleNamespace(),'qraft.electronic.policy@1')
        for literal in ('qraft.x@01','qraft.x@1 ','qraft.x@1.0','legacy_M1_V1'):
            with self.assertRaises(ValueError):
                versioned_id(literal)
        with self.assertRaises(ValueError):
            native_id({'id':'qraft.x','version':'1.2.0'})
