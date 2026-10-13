"""Preset authoring does not duplicate scientific evaluators."""
import copy
import hashlib
import unittest
from dftlab_platform.contracts import resource_json, canonical
from dftlab_platform.domain import envelope
from dftlab_platform.presets import DEFAULTS, preset_registry, render_preset, build_preset_intent


class PresetAuthoring(unittest.TestCase):
    def setUp(self):
        structure = resource_json('fixtures/draft-create-request/valid/promote-template.json')['structure']
        self.structure = envelope('structure-revision', 'p-presets',
            {**structure, 'structure_id': 's-presets', 'revision': 1, 'parent_revision': None})

    def test_all_presets_bind_defaults_geometry_required_files_and_digest(self):
        for key in preset_registry():
            with self.subTest(preset=key):
                structure = copy.deepcopy(self.structure)
                if key == 'S-04':
                    structure = envelope('structure-revision', 'p-presets', {**structure['payload'], 'physical_intent': 'SLAB'})
                result = render_preset(structure, key, {'Si': 14}, mesh_sizes=[30]*3, fixed=[1] if key=='S-04' else [])
                self.assertEqual(result['digest'], hashlib.sha256(canonical(result['inputs'])).hexdigest())
                self.assertEqual(result['inputs']['preset']['defaults'], DEFAULTS)
                self.assertIn('Charge.Mulliken end', result['fdf'])
                self.assertNotIn('WriteMullikenPop', result['fdf'])
                self.assertNotIn('MD.FCDispl', result['fdf'])
                self.assertNotIn('Slab.DipoleCorrection', result['fdf'])
                self.assertEqual(result['inputs']['preset']['protocol_id'], 'qraft.preset.'+key.lower()+'@1')
        self.assertEqual(render_preset(self.structure, 'S-06', {'Si': 14})['inputs']['required_files'],
                         ['siesta.RHO','siesta.VH','siesta.PLD','siesta.DIM','siesta.WFSX'])

    def test_molecular_gamma_fc_and_single_point(self):
        fdf = render_preset(self.structure, 'S-01', {'Si':14})['fdf']
        self.assertIn('1 0 0 0\n0 1 0 0\n0 0 1 0', fdf)
        fc = render_preset(self.structure, 'S-07', {'Si':14})['fdf']
        self.assertIn('FC.Displacement 0.02 Ang', fc)
        self.assertIn('FC.First 1\nFC.Last 2', fc)
        single = render_preset(self.structure, 'S-05', {'Si':14})['fdf']
        self.assertIn('MD.NumCGSteps 0', single)
        self.assertNotIn('MD.Steps', single)

    def test_defaults_are_bound_and_detached_and_periodic_hex_shifts(self):
        first = render_preset(self.structure, 'S-05', {'Si':14})
        second = render_preset(self.structure, 'S-05', {'Si':14}, parameters={'mesh_Ry':350})
        self.assertNotEqual(first['digest'], second['digest'])
        second['inputs']['preset']['defaults']['kgrid'][0] = 100
        self.assertEqual(preset_registry()['S-05']['defaults']['kgrid'], [4]*3)
        hexagonal = render_preset(self.structure, 'S-02', {'Si':14}, hexagonal_axes=[0,1])
        self.assertIn('4 0 0 0\n0 4 0 0\n0 0 4 0.5', hexagonal['fdf'])

    def test_required_authoring_preconditions_and_run_intent_stop(self):
        with self.assertRaises(ValueError):
            render_preset(self.structure, 'S-03', {'Si':14})
        with self.assertRaises(ValueError):
            render_preset(self.structure, 'S-08', {'Si':14}, parameters={'spin':'polarized'})
        with self.assertRaises(ValueError):
            render_preset(self.structure, 'S-04', {'Si':14})
        with self.assertRaisesRegex(ValueError, 'issue #99'):
            build_preset_intent()
