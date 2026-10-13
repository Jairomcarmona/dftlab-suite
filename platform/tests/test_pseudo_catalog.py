"""Catalogue facts and alias bytes only; native science remains in QRAFT."""
from dataclasses import replace
import copy
import hashlib
import json
from pathlib import Path
import unittest

from dftlab_platform.contracts import resource_json
from dftlab_platform.pseudo_catalog import catalogue_psml, species_bundle


FIXTURE = Path(__file__).parent/'fixtures/pseudos.cases.json'


class PseudoCatalogue(unittest.TestCase):
    def setUp(self):
        self.cases = json.loads(FIXTURE.read_bytes())['cases']

    @staticmethod
    def complete_header(case):
        # Normative vectors contain header extracts, not entire PSML files.
        closing = 'header' if '<header ' in case['psml'] else 'pseudo-atom-spec'
        return (case['psml']+f'</{closing}></psml>\n').encode()

    def test_fixture_hash_and_four_source_headers(self):
        self.assertEqual(hashlib.sha256(FIXTURE.read_bytes()).hexdigest(),
            '78effa3c15fc75d725c6cc549b55ade48d5168c705b8f05ba4664de54a76ff88')
        for case in self.cases:
            if case['kind'] != 'psml':
                continue
            with self.subTest(case=case['id']):
                entry = catalogue_psml(self.complete_header(case), origin=case['id'])
                e = case['expect']
                self.assertEqual((entry.element, entry.z, entry.valence, entry.relativity, entry.nlcc, list(entry.libxc_ids)),
                    (e['label'], e['z'], e['z_valence'], e['relativity'], e['core_corrections'], e['libxc_ids']))
                self.assertEqual(entry.format, 'psml')
                self.assertEqual(entry.license, 'undeclared')
                self.assertEqual(entry.sha256, hashlib.sha256(entry.data).hexdigest())
                self.assertNotIn('data', entry.metadata())

    def species(self, label, entry):
        doc = copy.deepcopy(resource_json('fixtures/species-definition/valid/si.json'))
        doc['payload']['species_label'] = label
        doc['payload']['pseudo']['artifact']['sha256'] = entry.sha256
        return doc

    def test_aliases_preserve_origin_hash_and_private_bundle(self):
        entry = catalogue_psml(self.complete_header(self.cases[0]), origin='own-library', license='proprietary')
        docs = [self.species(label, entry) for label in ('Si1', 'Si2')]
        original = copy.deepcopy(docs)
        bundle = species_bundle(docs, [entry])
        self.assertEqual(dict(bundle.files), {'Si1.psml': entry.data, 'Si2.psml': entry.data})
        self.assertEqual(dict(bundle.origins), {'Si1': entry.sha256, 'Si2': entry.sha256})
        self.assertFalse(bundle.redistributable)
        self.assertEqual(docs, original)
        with self.assertRaises(TypeError):
            type(bundle)(bundle.files, bundle.origins, bundle.catalogue, redistributable=True)

    def test_tampering_unavailable_origin_and_unsafe_duplicate_labels_reject(self):
        entry = catalogue_psml(self.complete_header(self.cases[0]), origin='test')
        with self.assertRaisesRegex(ValueError, 'HASH_MISMATCH'):
            species_bundle([self.species('Si', entry)], [replace(entry, data=b'changed')])
        with self.assertRaisesRegex(ValueError, 'HASH_MISMATCH'):
            species_bundle([self.species('Si', entry)], [])
        with self.assertRaisesRegex(ValueError, 'SPECIES_FILENAME_MISMATCH'):
            species_bundle([self.species('Si', entry), self.species('si', entry)], [entry])


if __name__ == '__main__':
    unittest.main()
