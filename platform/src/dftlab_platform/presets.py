"""Preset authoring only; scientific findings and execution belong to QRAFT.

RunIntent construction is deliberately blocked pending the accepted IDs' @1
mapping to the existing namespaced-id/semver contract (tracking issue #99).
"""
import copy
import hashlib
from math import isfinite
import re
from .contracts import canonical, Contracts
from .slabs import render_constraints


DEFAULTS = dict(xc='PBE', basis='DZP', energy_shift_meV=20, mesh_Ry=300,
                kgrid=[4, 4, 4], kshift=[.5, .5, .5], spin='non-polarized',
                charge=0, max_force_eV_A=.02, steps=200, max_stress_GPa=.1,
                fc_displacement_A=.02)
_ROUTES = {'S-01': 'molecule', 'S-02': 'relaxation', 'S-03': 'variable-cell',
           'S-04': 'relaxation', 'S-05': 'ground-state', 'S-06': 'ground-state',
           'S-07': 'molecular-vibration', 'S-08': 'magnetic-selection'}


def preset_registry():
    """IDs and defaults are proposals for authoring, never qualification."""
    return {key: {'protocol_id': 'qraft.preset.'+key.lower()+'@1',
                  'policy_id': 'qraft.presets.policy@1', 'route': route,
                  'status': 'DESIGNED' if key in ('S-01', 'S-03', 'S-07') else 'CONTRACT_TESTED',
                  'defaults': copy.deepcopy(DEFAULTS)} for key, route in _ROUTES.items()}


def _number(value):
    if type(value) not in (int, float) or not isfinite(value):
        raise ValueError('Finite authoring number required')
    return format(value, '.16g')


def render_preset(structure, preset_id, species, *, label='siesta', parameters=None,
                  fixed=(), mesh_sizes=None, initial_spin=None, electrons=None,
                  hexagonal_axes=()):
    """Render from a contract revision, with explicit species/geometry ordering.

    Returns an internal authoring plan and digest; no accepted RunIntent or
    scientific verdict is manufactured. Defaults are bound to that digest.
    """
    Contracts().validate('structure-revision', structure)
    registry = preset_registry()
    if preset_id not in registry or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]*', label):
        raise ValueError('Unknown preset or unsafe SystemLabel')
    p = copy.deepcopy(DEFAULTS)
    supplied = parameters or {}
    if set(supplied)-set(p):
        raise ValueError('Unknown preset parameter')
    p.update(copy.deepcopy(supplied))
    if p['xc'] not in ('LDA', 'PBE') or p['basis'] not in ('SZ', 'SZP', 'DZ', 'DZP', 'TZP'):
        raise ValueError('Explicit supported XC and basis required')
    if p['spin'] not in ('non-polarized', 'polarized'):
        raise ValueError('SOC requires the separate fully-relativistic M8 route')
    if p['mesh_Ry'] <= 0 or p['energy_shift_meV'] <= 0:
        raise ValueError('Positive numerical parameters required')
    geom = structure['payload']
    if geom['cell']['unit'] != 'angstrom' or (geom['coordinates']['kind'] == 'cartesian' and geom['coordinates']['unit'] != 'angstrom'):
        raise ValueError('Authoring geometry must use Angstrom')
    if preset_id == 'S-04' and geom['physical_intent'] != 'SLAB':
        raise ValueError('Slab preset requires an authoritative slab revision')
    if not species or any(type(z) is not int or z <= 0 or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]*', name) for name, z in species.items()):
        raise ValueError('Explicit species atomic numbers required')
    if set(species) != {s['species_label'] for s in geom['sites']}:
        raise ValueError('Species must match the revision')
    if preset_id in ('S-01', 'S-07'):
        p['kgrid'], p['kshift'] = [1, 1, 1], [0, 0, 0]
    if electrons is not None and preset_id == 'S-01' and electrons % 2:
        p['spin'] = 'polarized'
    if len(p['kgrid']) != 3 or any(type(n) is not int or n < 1 for n in p['kgrid']) or len(p['kshift']) != 3:
        raise ValueError('Explicit positive 3D kgrid required')
    for axis in hexagonal_axes:
        if type(axis) is not int or axis not in (0, 1, 2):
            raise ValueError('Invalid hexagonal axis')
        p['kshift'][axis] = 0
    order = {name: i+1 for i, name in enumerate(species)}
    out = [f'SystemLabel {label}', f'NumberOfAtoms {len(geom["sites"])}', f'NumberOfSpecies {len(species)}']
    def scalar(name, value):
        out.append(name+' '+str(value))
    def block(name, rows):
        out.extend(['%block '+name, *rows, '%endblock '+name])
    block('ChemicalSpeciesLabel', [f'{order[name]} {z} {name}' for name, z in species.items()])
    scalar('LatticeConstant', '1 Ang')
    block('LatticeVectors', [' '.join(_number(x) for x in row) for row in geom['cell']['vectors']])
    scalar('AtomicCoordinatesFormat', 'Fractional' if geom['coordinates']['kind'] == 'fractional' else 'Ang')
    block('AtomicCoordinatesAndAtomicSpecies', [' '.join(_number(x) for x in s['position'])+' '+str(order[s['species_label']]) for s in geom['sites']])
    scalar('XC.functional', 'GGA' if p['xc'] == 'PBE' else 'LDA')
    scalar('XC.authors', 'PBE' if p['xc'] == 'PBE' else 'CA')
    scalar('PAO.BasisSize', p['basis']); scalar('PAO.EnergyShift', _number(p['energy_shift_meV'])+' meV')
    scalar('MeshCutoff', _number(p['mesh_Ry'])+' Ry')
    scalar('Spin', p['spin']); scalar('NetCharge', _number(p['charge']))
    block('kgrid.MonkhorstPack', [' '.join(str(p['kgrid'][i] if i==j else 0) for j in range(3))+' '+_number(p['kshift'][i]) for i in range(3)])
    if p['spin'] == 'polarized':
        if initial_spin is None or len(initial_spin) != len(geom['sites']):
            raise ValueError('Polarized authoring requires complete explicit DM.InitSpin')
        block('DM.InitSpin', [str(i+1)+' '+_number(value) for i, value in enumerate(initial_spin)])
    constraints = render_constraints(len(geom['sites']), fixed)
    if 'error' in constraints:
        raise ValueError(constraints['error'])
    if preset_id in ('S-02', 'S-03', 'S-04'):
        if type(p['steps']) is not int or p['steps'] <= 0 or p['max_force_eV_A'] <= 0:
            raise ValueError('Relaxation requires explicit positive steps and tolerance')
        scalar('MD.TypeOfRun', 'CG'); scalar('MD.Steps', p['steps'])
        scalar('MD.MaxForceTol', _number(p['max_force_eV_A'])+' eV/Ang')
        if preset_id == 'S-03':
            if mesh_sizes is None or len(mesh_sizes) != 3 or any(type(n) is not int or n <= 0 for n in mesh_sizes):
                raise ValueError('Variable-cell authoring requires the observed initial Mesh.Sizes')
            scalar('MD.VariableCell', 'T'); scalar('MD.TargetPressure', '0 GPa')
            scalar('MD.MaxStressTol', _number(p['max_stress_GPa'])+' GPa')
            scalar('Mesh.Sizes', '['+' '.join(str(n) for n in mesh_sizes)+']')
        if fixed:
            out.append(constraints['text'].rstrip())
    elif preset_id == 'S-07':
        scalar('MD.TypeOfRun', 'FC'); scalar('FC.Displacement', _number(p['fc_displacement_A'])+' Ang')
        scalar('FC.First', 1); scalar('FC.Last', len(geom['sites']))
    else:
        scalar('MD.TypeOfRun', 'CG'); scalar('MD.NumCGSteps', 0)
    scalar('Charge.Mulliken', 'end')
    required = [label+'.FC'] if preset_id == 'S-07' else []
    if preset_id == 'S-06':
        for name in ('SaveRho', 'SaveElectrostaticPotential', 'WriteDenchar', 'WriteWaveFunctions'):
            scalar(name, 'T')
        required = [label+suffix for suffix in ('.RHO', '.VH', '.PLD', '.DIM', '.WFSX')]
    fdf = '\n'.join(out)+'\n'
    inputs = dict(preset=registry[preset_id], resolved_parameters=p, structure_sha256=structure['integrity']['digest'],
                  species=species, fixed=list(fixed), mesh_sizes=mesh_sizes, initial_spin=initial_spin,
                  required_files=required, fdf_sha256=hashlib.sha256(fdf.encode()).hexdigest())
    return {'fdf': fdf, 'inputs': inputs, 'digest': hashlib.sha256(canonical(inputs)).hexdigest()}


def build_preset_intent(*args, **kwargs):
    raise ValueError('Preset RunIntent ID/version mapping requires the decision recorded in issue #99')
