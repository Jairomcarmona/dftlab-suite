"""Preset authoring only; scientific findings and execution belong to QRAFT.

RunIntent uses the approved lossless ID projection and wheel policy document.
"""
import copy
import hashlib
from math import isfinite
import re
import json
from pathlib import Path
import tempfile
from .contracts import canonical, Contracts
from .domain import envelope, reseal, identifier
from .policy_refs import versioned_id, native_id, policy_reference
from .engines import engine_lock
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
                  'status': 'CONTRACT_TESTED',
                  'defaults': copy.deepcopy(DEFAULTS)} for key, route in _ROUTES.items()}


def _number(value):
    if type(value) not in (int, float) or not isfinite(value):
        raise ValueError('Finite authoring number required')
    return format(value, '.16g')


def _real_token(value):
    text=_number(value)
    return text if '.' in text or 'e' in text.lower() else text+'.0'


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
    block('AtomicCoordinatesAndAtomicSpecies', [' '.join(_real_token(x) for x in s['position'])+' '+str(order[s['species_label']]) for s in geom['sites']])
    scalar('XC.functional', 'GGA' if p['xc'] == 'PBE' else 'LDA')
    scalar('XC.authors', 'PBE' if p['xc'] == 'PBE' else 'CA')
    scalar('PAO.BasisSize', p['basis']); scalar('PAO.EnergyShift', _number(p['energy_shift_meV'])+' meV')
    scalar('MeshCutoff', _number(p['mesh_Ry'])+' Ry')
    scalar('Spin', p['spin']); scalar('NetCharge', _number(p['charge']))
    block('kgrid.MonkhorstPack', [' '.join(str(p['kgrid'][i] if i==j else 0) for j in range(3))+' '+_number(p['kshift'][i]) for i in range(3)])
    if p['spin'] == 'polarized':
        if initial_spin is None or len(initial_spin) != len(geom['sites']):
            raise ValueError('Polarized authoring requires complete explicit DM.InitSpin')
        block('DM.InitSpin', [str(i+1)+' '+_real_token(value) for i, value in enumerate(initial_spin)])
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


def build_preset_intent(structure, preset_id, species, *, draft_id, physical_model,
                        numerical_policy, operation, qraft_api, native_policy_ref,
                        native_policy_bytes, purpose='EXPLORATORY', intent_id=None, **render_options):
    """Build from authorized revisions and an already stored native policy.

    The trusted installed facade validates FDF. This does not submit a run or
    claim the 26 QRAFT scientific verdicts; their authority remains upstream.
    """
    contracts=Contracts()
    contracts.validate('physical-model',physical_model)
    contracts.validate('numerical-policy',numerical_policy)
    contracts.validate('native-contract-ref',native_policy_ref)
    project=structure['project_id']
    if any(document['project_id']!=project for document in (physical_model,numerical_policy)):
        raise ValueError('Preset references must belong to the structure project')
    plan=render_preset(structure,preset_id,species,**render_options)
    p=plan['inputs']['resolved_parameters'];n=numerical_policy['payload'];model=physical_model['payload']
    if model['hubbard'] is not None or model['spin'] not in ('NONE','COLLINEAR') or model['relativistic'] not in ('NONE','SCALAR'):
        raise ValueError('This preset renderer requires a non-Hubbard scalar collinear model')
    if n['basis']['size']!=p['basis'] or n['mesh_cutoff']['unit']!='Ry' or float(n['mesh_cutoff']['value'])!=p['mesh_Ry']:
        raise ValueError('Preset numerical settings differ from the referenced NumericalPolicy')
    if n['kgrid']['kind']=='GAMMA_ONLY':
        agrees=p['kgrid']==[1]*3 and p['kshift']==[0]*3
    else:
        agrees=n['kgrid']['kind']=='MONKHORST_PACK' and n['kgrid']['divisions']==p['kgrid'] and n['kgrid']['shift']==p['kshift']
    if not agrees:
        raise ValueError('Preset kgrid differs from the referenced NumericalPolicy')
    shift=n['basis'].get('energy_shift')
    if shift is not None and (shift['unit']!='meV' or float(shift['value'])!=p['energy_shift_meV']):
        raise ValueError('Explicit preset energy shift must agree in meV')
    if model['xc']['functional']!=p['xc'] or model['total_charge']['unit']!='e' or float(model['total_charge']['value'])!=p['charge'] or (model['spin']=='NONE')!=(p['spin']=='non-polarized'):
        raise ValueError('Preset model differs from the referenced PhysicalModel')
    if n['solver']!='diagon':
        raise ValueError('This renderer requires an explicit supported diagonal solver')
    smearing=n['smearing']
    if smearing is None or smearing['method']!='FD' or smearing['width']['unit'] not in ('Ry','eV','meV') or float(smearing['width']['value'])<=0:
        raise ValueError('Explicit supported FD smearing in energy units is required; no default is inferred')
    tolerances=n['tolerances']
    if 'dm_tolerance' not in tolerances or set(tolerances)-{'dm_tolerance','h_tolerance'}:
        raise ValueError('Explicit supported SCF tolerances required')
    lines=['SolutionMethod '+n['solver'], 'OccupationFunction '+smearing['method'],
           'ElectronicTemperature '+_number(float(smearing['width']['value']))+' '+smearing['width']['unit']]
    for key,label in (('dm_tolerance','DM.Tolerance'),('h_tolerance','SCF.H.Tolerance')):
        if key not in tolerances:
            continue
        quantity=tolerances[key]
        allowed=('1',) if key=='dm_tolerance' else ('Ry','eV','meV')
        if quantity['unit'] not in allowed or float(quantity['value'])<=0:
            raise ValueError('Unsupported SCF tolerance units or value')
        lines.append(label+' '+_number(float(quantity['value']))+('' if quantity['unit']=='1' else ' '+quantity['unit']))
    plan['fdf']+='\n'.join(lines)+'\n'
    plan['inputs']['fdf_sha256']=hashlib.sha256(plan['fdf'].encode()).hexdigest()
    plan['inputs']['referenced_numerical_settings']=copy.deepcopy(n)
    plan['digest']=hashlib.sha256(canonical(plan['inputs'])).hexdigest()
    literal=plan['inputs']['preset']['protocol_id']
    policy_literal=plan['inputs']['preset']['policy_id']
    policy,document=policy_reference(qraft_api,policy_literal)
    if numerical_policy['payload']['policy']!=policy:
        raise ValueError('NumericalPolicy does not reference the wheel policy document')
    native=qraft_api.scientific_policy_evidence(policy_literal)
    native.verify()
    raw=json.loads(native_policy_bytes)
    if raw!=native.to_dict() or hashlib.sha256(native_policy_bytes).hexdigest()!=native_policy_ref['artifact']['sha256']:
        raise ValueError('Stored native policy bytes differ')
    if native_policy_ref['digest']!={'algorithm':'qraft.content-sha256-v1','value':native.content_sha256} or native_policy_ref['contract']!=str(native.contract):
        raise ValueError('Native policy reference differs from the verified envelope')
    pin=engine_lock()['engines']['qraft']
    if native_policy_ref['verification']['status']!='VERIFIED' or any(native_policy_ref[key]!=value for key,value in (
        ('engine','qraft'),('distribution',pin['distribution']),('version',pin['declared_version']),('commit',pin['commit']))):
        raise ValueError('Native policy evidence differs from the platform pin')
    payload=raw['payload']
    if payload['policy_id']!=policy_literal or literal not in payload.get('protocol_ids',[]) or payload['policy_document']!=document:
        raise ValueError('Native literal protocol/policy IDs are not preserved')
    with tempfile.TemporaryDirectory(prefix='dftlab-preset-validation-') as temporary:
        path=Path(temporary)/'input.fdf';path.write_bytes(plan['fdf'].encode('utf-8'))
        report=qraft_api.SiestaContextualValidator().validate_path(path)
        if report.status.value!='PASS':
            raise ValueError('Generated preset FDF did not pass QRAFT validation')
    projected=versioned_id(literal)
    assert native_id(projected).encode()==literal.encode()
    geometry=structure['payload']
    intent=envelope('run-intent',project,{'intent_id':intent_id or identifier(),'draft_id':draft_id,
        'operation':operation,'purpose':purpose,'structure':{'structure_id':geometry['structure_id'],'revision':geometry['revision']},
        'physical_model_ref':physical_model['record_id'],'numerical_policy_ref':numerical_policy['record_id'],
        'protocol':{'protocol_id':projected['id'],'version':projected['version']}})
    intent['native_contract_refs']=[copy.deepcopy(native_policy_ref)]
    reseal(intent);contracts.validate('run-intent',intent)
    return {'intent':intent,'plan':plan}
