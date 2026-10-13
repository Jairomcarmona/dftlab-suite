"""Accepted SLABS vectors, against the service implementation (no engines)."""
import json
from pathlib import Path
import unittest
from dftlab_platform.slabs import build_slab, slab_invariants, bottom_plane_atoms, render_constraints

class SlabVectors(unittest.TestCase):
    def test_accepted_vectors(self):
        doc = json.loads((Path(__file__).parent/'fixtures/slabs.cases.json').read_text(encoding='utf-8'))
        def compare(a, e, absolute):
            if type(e) in (int, float):
                self.assertLessEqual(abs(a-e), absolute+doc['arithmetic_tolerance']['rel']*abs(e))
            elif isinstance(e, list):
                self.assertEqual(len(a), len(e))
                for x,y in zip(a,e):compare(x,y,absolute)
            elif isinstance(e, dict):
                self.assertEqual(set(a),set(e))
                for k in e:compare(a[k],e[k],absolute)
            else:self.assertEqual(a,e)
        for c in doc['cases']:
            with self.subTest(case=c['id']):
                absolute=doc['arithmetic_tolerance']['abs_A']
                if c['kind']=='reference':
                    absolute=doc['reference_tolerance_A']
                    compare(slab_invariants(c['reference']),c['expect'],absolute)
                    actual=slab_invariants(build_slab(c['bulk'],c['spec']))
                elif c['kind']=='build':actual=build_slab(c['bulk'],c['spec'])
                elif c['kind']=='bottom_planes':actual=bottom_plane_atoms(build_slab(c['bulk'],c['spec']),c['k'])
                elif c['kind']=='constraints':actual=render_constraints(c['n_atoms'],c['fixed'])
                elif c['kind']=='invariants':actual=slab_invariants(c['geometry'])
                else:self.fail(c['kind'])
                compare(actual,c['expect'],absolute)

if __name__=='__main__':unittest.main()
