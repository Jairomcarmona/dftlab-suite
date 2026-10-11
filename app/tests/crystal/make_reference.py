#!/usr/bin/env python3
"""Build the reference data for the DFT Lab crystal JS tests.

Structures are built with ASE / spglib; references are computed with spglib 2.x and
seekpath 2.x (HPKOT).  Output: reference.json (read by run_tests.mjs) and the CIF/SIESTA
fixtures in fixtures/.

    python3 make_reference.py            # writes reference.json next to this file
"""
import io
import json
import os
import warnings

import numpy as np
import spglib
import seekpath
from seekpath.brillouinzone.brillouinzone import BZ
from ase import Atoms
from ase.build import bulk, make_supercell
from ase.spacegroup import crystal
import ase.io

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, 'fixtures')
os.makedirs(FIX, exist_ok=True)
warnings.simplefilter('ignore')

rng = np.random.default_rng(20261009)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def tolist(x):
    return np.asarray(x).tolist()


def random_rotation():
    q = rng.normal(size=4)
    q /= np.linalg.norm(q)
    a, b, c, d = q
    return np.array([
        [a*a+b*b-c*c-d*d, 2*(b*c-a*d), 2*(b*d+a*c)],
        [2*(b*c+a*d), a*a-b*b+c*c-d*d, 2*(c*d-a*b)],
        [2*(b*d-a*c), 2*(c*d+a*b), a*a-b*b-c*c+d*d]])


def from_hall(hall, nsites=2, scramble=True):
    """Random structure in the given Hall setting: symmetrized random metric, general positions."""
    sym = spglib.get_symmetry_from_database(hall)
    R, T = sym['rotations'], sym['translations']
    L = np.diag(rng.uniform(3, 8, 3)) + rng.uniform(-1.5, 1.5, (3, 3))
    G = L.T @ L
    Gs = sum(r.T @ G @ r for r in R) / len(R)
    # Gs = U^T U with U = cholesky(Gs).T; columns of U are the lattice vectors -> rotate, store as rows
    lat = (random_rotation() @ np.linalg.cholesky(Gs).T).T
    pos, typ = [], []
    for t in range(nsites):
        x = rng.uniform(0, 1, 3)
        for r, tt in zip(R, T):
            y = (r @ x + tt) % 1.0
            if all(np.linalg.norm(((y - p + 0.5) % 1) - 0.5) > 1e-4 for p in pos):
                pos.append(y)
                typ.append([14, 8, 26, 1][t])
    pos = np.array(pos)
    if scramble:
        while True:
            M = rng.integers(-1, 2, (3, 3))
            if round(abs(np.linalg.det(M))) == 1:
                break
        lat = M @ lat
        pos = (np.linalg.inv(M).T @ pos.T).T % 1.0
    return lat, pos, typ


def hall_numbers_of(number):
    return [h for h in range(1, 531) if spglib.get_spacegroup_type(h).number == number]


def atoms_to_cell(atoms):
    return (atoms.cell.array.copy(), atoms.get_scaled_positions(wrap=False), list(atoms.numbers))


# ---------------------------------------------------------------------------
# reference computation
# ---------------------------------------------------------------------------
def reference(cell, symprec=1e-5):
    lat, pos, num = cell
    ds = spglib.get_symmetry_dataset((lat, pos, num), symprec=symprec)
    res = seekpath.get_explicit_k_path((lat, pos, num), symprec=symprec)
    ref = dict(
        number=int(ds.number), international=ds.international, hall_number=int(ds.hall_number),
        wyckoffs=list(ds.wyckoffs), site_symmetry_symbols=list(ds.site_symmetry_symbols), equivalent_atoms=tolist(ds.equivalent_atoms),
        n_operations=len(ds.rotations),
        std_lattice=tolist(ds.std_lattice), std_positions=tolist(ds.std_positions), std_types=tolist(ds.std_types),
        transformation_matrix=tolist(ds.transformation_matrix), std_rotation_matrix=tolist(ds.std_rotation_matrix),
    )
    sp = {k: res[k] for k in ['has_inversion_symmetry', 'augmented_path', 'bravais_lattice', 'bravais_lattice_extended',
                              'spacegroup_number', 'spacegroup_international']}
    for k in ['conv_lattice', 'conv_positions', 'conv_types', 'primitive_lattice', 'primitive_positions', 'primitive_types',
              'reciprocal_primitive_lattice', 'primitive_transformation_matrix', 'inverse_primitive_transformation_matrix',
              'explicit_kpoints_rel', 'explicit_kpoints_linearcoord', 'explicit_segments']:
        sp[k] = tolist(res[k])
    sp['volume_original_wrt_prim'] = float(res['volume_original_wrt_prim'])
    sp['volume_original_wrt_conv'] = float(res['volume_original_wrt_conv'])
    sp['explicit_kpoints_labels'] = list(res['explicit_kpoints_labels'])
    sp['path'] = [list(p) for p in res['path']]
    sp['point_coords'] = {k: tolist(v) for k, v in res['point_coords'].items()}
    ref['seekpath'] = sp
    # no time-reversal (augmented) path
    if not res['has_inversion_symmetry']:
        r2 = seekpath.get_path((lat, pos, num), with_time_reversal=False, symprec=symprec)
        ref['seekpath_no_tr'] = dict(path=[list(p) for p in r2['path']],
                                     point_coords={k: tolist(v) for k, v in r2['point_coords'].items()})
    # path in the original cell
    ro = seekpath.get_path_orig_cell((lat, pos, num), symprec=symprec)
    ref['seekpath_orig'] = dict(point_coords={k: tolist(v) for k, v in ro['point_coords'].items()},
                                is_supercell=bool(ro['is_supercell']))
    if True:
        try:
            b = np.array(res['reciprocal_primitive_lattice'])
            bz = BZ(b[0], b[1], b[2])
            ref['bz'] = dict(vertices=tolist(bz.triangles_vertices), n_faces=len(bz.faces))
        except Exception as e:  # pragma: no cover
            ref['bz'] = dict(error=str(e))
    return ref


cases = []


def add_case(name, cell, group, symprec=1e-5, note='', extra=None):
    lat, pos, num = cell
    c = dict(name=name, group=group, symprec=symprec, note=note,
             lattice=tolist(lat), positions=tolist(pos), numbers=[int(x) for x in num])
    c['ref'] = reference((np.array(lat), np.array(pos), list(num)), symprec=symprec)
    if extra:
        c.update(extra)
    cases.append(c)
    return c


# ---------------------------------------------------------------------------
# 1) one structure per extended Bravais lattice (two space groups each when possible)
# ---------------------------------------------------------------------------
# candidate space groups per case (spglib sorts the axes when the group allows it, so e.g. oC2
# needs a group without a<->b freedom such as Cmcm); the first two groups that work are used
EXT_TARGETS = {
    'cP1': [195, 200], 'cP2': [221, 215], 'cF1': [196, 202], 'cF2': [225, 216], 'cI1': [229, 217],
    'tP1': [123, 99], 'tI1': [139, 107], 'tI2': [139, 107], 'oP1': [47, 25],
    'oF1': [69, 42], 'oF2': [43, 42, 22, 70], 'oF3': [69, 42],
    'oI1': [71, 44], 'oI2': [74, 46, 45, 72, 73], 'oI3': [71, 44, 74, 46],
    'oC1': [65, 35], 'oC2': [63, 36, 64, 37, 67], 'oA1': [38, 40], 'oA2': [38, 40],
    'hP1': [147, 143], 'hP2': [191, 187], 'hR1': [166, 160], 'hR2': [166, 160],
    'mP1': [10, 6], 'mC1': [12, 8], 'mC2': [12, 8], 'mC3': [12, 8], 'aP2': [2, 1], 'aP3': [2, 1],
}
for ext, groups in EXT_TARGETS.items():
    done = 0
    for sg in groups:
        if done == 2:
            break
        halls = hall_numbers_of(sg)
        found = None
        for attempt in range(600):
            h = halls[attempt % len(halls)]
            cell = from_hall(h)
            r = seekpath.get_path(cell)
            if r['bravais_lattice_extended'] == ext and r['spacegroup_number'] == sg:
                found = cell
                break
        if found is None:
            continue
        add_case(f'{ext} (SG {sg})', found, 'ext-bravais', note=f'random cell, Hall {h}, scrambled basis')
        done += 1
    if done == 0:
        print('could not generate', ext)

# seekpath's own example POSCARs (Materials Project structures, one per case)
base = os.path.join(os.path.dirname(seekpath.__file__), 'hpkot', 'band_path_data')
for ext in sorted(os.listdir(base)):
    for f in sorted(os.listdir(os.path.join(base, ext))):
        if f.startswith('POSCAR'):
            at = ase.io.read(os.path.join(base, ext, f), format='vasp')
            add_case(f'{ext} {f.replace("POSCAR_", "")}', atoms_to_cell(at), 'seekpath-examples')

# ---------------------------------------------------------------------------
# 2) real materials
# ---------------------------------------------------------------------------
si = bulk('Si', 'diamond', a=5.431)
materials = {
    'Si (diamond, primitive)': si,
    'GaAs (zincblende)': bulk('GaAs', 'zincblende', a=5.653),
    'NaCl (rocksalt)': bulk('NaCl', 'rocksalt', a=5.64),
    'graphite (AB)': crystal(['C', 'C'], [(0, 0, 0.25), (1/3, 2/3, 0.25)], spacegroup=194,
                             cellpar=[2.464, 2.464, 6.711, 90, 90, 120]),
    'ZnO (wurtzite)': bulk('ZnO', 'wurtzite', a=3.25, c=5.207),
    'TiO2 (rutile)': crystal(['Ti', 'O'], [(0, 0, 0), (0.3048, 0.3048, 0)], spacegroup=136,
                             cellpar=[4.594, 4.594, 2.959, 90, 90, 90]),
    'SrTiO3 (cubic perovskite)': crystal(['Sr', 'Ti', 'O'], [(0, 0, 0), (0.5, 0.5, 0.5), (0.5, 0.5, 0)], spacegroup=221,
                                         cellpar=[3.905, 3.905, 3.905, 90, 90, 90]),
    'Fe (bcc)': bulk('Fe', 'bcc', a=2.867),
    'Mg (hcp)': bulk('Mg', 'hcp', a=3.209, c=5.211),
    'Bi2Se3 (R-3m, hexagonal cell)': crystal(['Bi', 'Se', 'Se'], [(0, 0, 0.4008), (0, 0, 0), (0, 0, 0.2117)], spacegroup=166,
                                             cellpar=[4.143, 4.143, 28.636, 90, 90, 120]),
    'MoS2 (2H)': crystal(['Mo', 'S'], [(1/3, 2/3, 0.25), (1/3, 2/3, 0.621)], spacegroup=194,
                         cellpar=[3.16, 3.16, 12.29, 90, 90, 120]),
    'Si 2x2x2 supercell': make_supercell(si, 2 * np.eye(3)),
}
for name, at in materials.items():
    extra = None
    if 'supercell' in name:
        extra = dict(supercell_of=tolist(si.cell.array), supercell_of_positions=tolist(si.get_scaled_positions()),
                     supercell_of_numbers=[14, 14], supercell_matrix=[2, 2, 2])
    add_case(name, atoms_to_cell(at), 'materials', extra=extra)

# Bi2Se3 primitive rhombohedral input and a rotated + scrambled rutile
bi_prim = spglib.find_primitive(atoms_to_cell(materials['Bi2Se3 (R-3m, hexagonal cell)']))
add_case('Bi2Se3 (rhombohedral primitive input)', bi_prim, 'materials')
lat, pos, num = atoms_to_cell(materials['TiO2 (rutile)'])
M = np.array([[1, 1, 0], [0, 1, 0], [1, 0, 1]])
add_case('TiO2 rutile (rotated, non-standard basis)', ((random_rotation() @ (M @ lat).T).T, (np.linalg.inv(M).T @ pos.T).T % 1, num),
         'materials')

# distorted cell: symprec behaviour
conv_si = bulk('Si', 'diamond', a=5.431, cubic=True)
d = conv_si.copy()
d.positions += rng.normal(scale=1.0, size=d.positions.shape) * 0.0005
for sp in [1e-5, 1e-2]:
    add_case(f'Si conv. distorted ~0.001 A (symprec={sp:g})', atoms_to_cell(d), 'symprec', symprec=sp)
# slightly strained hexagonal: tetragonal-ish tolerance
lat = np.array([[3.0, 0, 0], [0, 3.0004, 0], [0, 0, 4.0]])
for sp in [1e-5, 1e-3]:
    add_case(f'nearly tetragonal (b/a-1=1.3e-4, symprec={sp:g})', (lat, [[0, 0, 0], [0.5, 0.5, 0.5]], [26, 26]), 'symprec', symprec=sp)


# ---------------------------------------------------------------------------
# 3) CIF fixtures (symmetry-expanded on reading) -- reference parsed with ASE
# ---------------------------------------------------------------------------
def frac_str(x):
    x = x % 1.0
    for d in [1, 2, 3, 4, 6, 8, 12]:
        n = round(x * d)
        if abs(n / d - x) < 1e-8:
            return '' if n == 0 else f'{n}/{d}'
    return f'{x:.6f}'


def symop_str(r, t, style):
    comps = []
    for i in range(3):
        s = ''
        for j, v in enumerate('xyz'):
            c = r[i][j]
            if c == 0:
                continue
            s += ('-' if c < 0 else ('+' if s else '')) + v
        tr = frac_str(t[i])
        if tr:
            s = (tr + ('+' if s[0] != '-' else '') + s) if style == 'prefix' else (s + '+' + tr)
        comps.append(s)
    return (', ' if style == 'prefix' else ',').join(comps)


def cif_text(title, hall, cellpar, sites, style='cod', with_ops=True, hm=None):
    sym = spglib.get_symmetry_from_database(hall)
    st = spglib.get_spacegroup_type(hall)
    a, b, c, al, be, ga = cellpar
    out = [f'data_{title}']
    if style == 'cod':
        out += ['_journal_name_full               \'Test data\'',
                f"_symmetry_space_group_name_H-M   '{hm or st.international_full}'",
                f"_symmetry_space_group_name_Hall  '{st.hall_symbol}'",
                f'_symmetry_Int_Tables_number      {st.number}',
                f'_cell_length_a                   {a:.4f}(3)', f'_cell_length_b                   {b:.4f}(3)',
                f'_cell_length_c                   {c:.4f}(5)', f'_cell_angle_alpha                {al:g}',
                f'_cell_angle_beta                 {be:g}', f'_cell_angle_gamma                {ga:g}',
                '_cell_formula_units_Z            2', '']
        if with_ops:
            out += ['loop_', '_space_group_symop_id', '_space_group_symop_operation_xyz']
            out += [f'{i + 1} {symop_str(r, t, "suffix")}' for i, (r, t) in enumerate(zip(sym['rotations'], sym['translations']))]
        out += ['', 'loop_', '_atom_site_label', '_atom_site_type_symbol', '_atom_site_fract_x', '_atom_site_fract_y',
                '_atom_site_fract_z', '_atom_site_occupancy', '_atom_site_U_iso_or_equiv']
        for lab, el, (x, y, z) in sites:
            out.append(f'{lab} {el} {x:.5f}(4) {y:.5f}(4) {z:.5f}(6) 1 0.0062(3)')
    else:  # ICSD-like
        out += ['_database_code_ICSD 999999', f"_chemical_name_systematic '{title}'",
                f"_symmetry_space_group_name_H-M '{hm or st.international_full}'",
                f'_cell_length_a {a:.4f}(2)', f'_cell_length_b {b:.4f}(2)', f'_cell_length_c {c:.4f}(3)',
                f'_cell_angle_alpha {al:g}', f'_cell_angle_beta {be:g}', f'_cell_angle_gamma {ga:g}',
                '_cell_volume 113.01', '_symmetry_Int_Tables_number ' + str(st.number), '#End of data_', '']
        if with_ops:
            out += ['loop_', '_symmetry_equiv_pos_site_id', '_symmetry_equiv_pos_as_xyz']
            out += [f"  {i + 1}\t'{symop_str(r, t, 'prefix')}'" for i, (r, t) in enumerate(zip(sym['rotations'], sym['translations']))]
        out += ['loop_', '_atom_type_symbol', '_atom_type_oxidation_number',
                ] + [f'{el}{"4+" if el in ("Si", "Ti") else "2-"} {4 if el in ("Si", "Ti") else -2}' for el in sorted({s[1] for s in sites})]
        out += ['loop_', '_atom_site_label', '_atom_site_type_symbol', '_atom_site_symmetry_multiplicity',
                '_atom_site_Wyckoff_symbol', '_atom_site_fract_x', '_atom_site_fract_y', '_atom_site_fract_z',
                '_atom_site_B_iso_or_equiv', '_atom_site_occupancy', '_atom_site_attached_hydrogens']
        for lab, el, (x, y, z) in sites:
            ox = '4+' if el in ('Si', 'Ti') else '2-'
            out.append(f'{lab} {el}{ox} 3 a {x:.5f}(5) {y:.5f}(4) {z:.5f} 0.5 1. 0')
    return '\n'.join(out) + '\n'


cif_fixtures = {
    'rutile_cod.cif': cif_text('rutile_TiO2', 419, [4.5937, 4.5937, 2.9587, 90, 90, 90],
                               [('Ti1', 'Ti', (0, 0, 0)), ('O1', 'O', (0.30478, 0.30478, 0))], style='cod'),
    'quartz_icsd.cif': cif_text('alpha_quartz', hall_numbers_of(154)[0], [4.9134, 4.9134, 5.4052, 90, 90, 120],
                                [('Si1', 'Si', (0.4697, 0, 0)), ('O1', 'O', (0.4135, 0.2669, 0.1191))], style='icsd'),
    'monoclinic_p21c_cod.cif': cif_text('generic_P21c', 81, [5.1, 6.2, 7.3, 90, 103.5, 90],
                                        [('Ti1', 'Ti', (0.1234, 0.2345, 0.3456)), ('O1', 'O', (0.4321, 0.1111, 0.0789)),
                                         ('O2', 'O', (0, 0, 0))], style='cod'),
}
# CIF without symmetry operations, only the H-M symbol (operations generated from the symbol)
cif_fixtures['nacl_hm_only.cif'] = cif_text('NaCl_HM_only', 523, [5.64, 5.64, 5.64, 90, 90, 90],
                                            [('Na1', 'Na', (0, 0, 0)), ('Cl1', 'Cl', (0.5, 0.5, 0.5))], style='cod', with_ops=False,
                                            hm='F m -3 m')
# Materials-Project-like CIF (P1 setting, all atoms listed, cell vectors not in standard orientation)
mp = bulk('GaN', 'wurtzite', a=3.19, c=5.19)
ase.io.write(os.path.join(FIX, 'gan_mp_style_p1.cif'), mp, format='cif')
with open(os.path.join(FIX, 'gan_mp_style_p1.cif')) as f:
    cif_fixtures['gan_mp_style_p1.cif'] = f.read()

# hand-written CIF2/mmCIF-style file: dotted tags, semicolon text field, comments, uncertainties,
# oxidation-state type symbols, '?' values and a dummy atom; reference built directly with ASE
MESSY_CIF = """# comment line
data_messy_ZnO
_audit_creation_method
;
  hand-written test file
  with a semicolon text field; and 'quotes'
;
_chemical_formula_sum            'O2 Zn2'
_space_group.name_H-M_alt        'P 63 m c'
_space_group.IT_number           186
_cell.length_a                   3.2500(2)
_cell.length_b                   3.2500(2)
_cell.length_c                   5.2070(4)
_cell.angle_alpha                90.
_cell.angle_beta                 90.
_cell.angle_gamma                120.00
_cell.volume                     ?
loop_
_space_group_symop.id
_space_group_symop.operation_xyz
1 'x, y, z'
2 '-y, x-y, z'
3 '-x+y, -x, z'
4 '-x, -y, z+1/2'
5 'y, -x+y, z+1/2'
6 'x-y, x, z+1/2'
7 '-y, -x, z'
8 '-x+y, y, z'
9 'x, x-y, z'
10 'y, x, z+1/2'
11 'x-y, -y, z+1/2'
12 '-x, -x+y, z+1/2'
loop_
_atom_site.label
_atom_site.type_symbol
_atom_site.fract_x
_atom_site.fract_y
_atom_site.fract_z
_atom_site.occupancy
_atom_site.calc_flag
Zn1 Zn2+ 0.333333 0.666667 0.0 1.0 d
O1 O2- 0.333333 0.666667 0.3825(3) 1 d   # oxygen
X1 ? 0.0 0.0 0.0 0 dum
"""
with open(os.path.join(FIX, 'zno_cif2_messy.cif'), 'w') as f:
    f.write(MESSY_CIF)
zno_ref = crystal(['Zn', 'O'], [(1/3, 2/3, 0), (1/3, 2/3, 0.3825)], spacegroup=186, cellpar=[3.25, 3.25, 5.207, 90, 90, 120])
add_case('CIF zno_cif2_messy.cif', atoms_to_cell(zno_ref), 'cif', symprec=1e-3,
         extra=dict(cif_file='zno_cif2_messy.cif', cif_natoms=len(zno_ref)))

for fname, text in cif_fixtures.items():
    with open(os.path.join(FIX, fname), 'w') as f:
        f.write(text)
    at = ase.io.read(os.path.join(FIX, fname), format='cif')
    add_case(f'CIF {fname}', atoms_to_cell(at), 'cif', extra=dict(cif_file=fname, cif_natoms=len(at)))

# ---------------------------------------------------------------------------
# 4) one random structure for every space group (random Hall setting, scrambled basis)
# ---------------------------------------------------------------------------
for sg in range(1, 231):
    halls = hall_numbers_of(sg)
    h = halls[int(rng.integers(len(halls)))]
    add_case(f'SG {sg} (Hall {h})', from_hall(h), 'all-230')

# ---------------------------------------------------------------------------
# 5) format fixtures: files written by ASE and SIESTA-style files with known content
# ---------------------------------------------------------------------------
fmt_cases = []
rut = materials['TiO2 (rutile)']
for fmtname, kw in [('vasp', dict(direct=True)), ('vasp', dict(direct=False)), ('extxyz', {})]:
    b = io.StringIO()
    ase.io.write(b, rut, format=fmtname, **kw)
    fmt_cases.append(dict(name=f'ASE {fmtname} {kw}', format='xyz' if fmtname == 'extxyz' else 'poscar', text=b.getvalue(),
                          lattice=tolist(rut.cell.array), positions=tolist(rut.get_scaled_positions()), numbers=tolist(rut.numbers)))

BOHR = 0.529177
lat = materials['ZnO (wurtzite)'].cell.array
zno = materials['ZnO (wurtzite)']
cart = zno.positions
spec = {30: 1, 8: 2}
xv = ''.join(f'{v[0] / BOHR:18.9f}{v[1] / BOHR:18.9f}{v[2] / BOHR:18.9f}{0:18.9f}{0:18.9f}{0:18.9f}\n' for v in lat)
xv += f'{len(zno):12d}\n'
xv += ''.join(f'{spec[z]:3d}{z:6d}{r[0] / BOHR:18.9f}{r[1] / BOHR:18.9f}{r[2] / BOHR:18.9f}{0:18.9f}{0:18.9f}{0:18.9f}\n'
              for z, r in zip(zno.numbers, cart))
fmt_cases.append(dict(name='SIESTA .XV (Bohr)', format='xv', text=xv, lattice=tolist(lat),
                      positions=tolist(zno.get_scaled_positions()), numbers=tolist(zno.numbers)))
so = ''.join(f'{v[0]:16.9f}{v[1]:16.9f}{v[2]:16.9f}\n' for v in lat) + f'{len(zno):13d}\n'
so += ''.join(f'{spec[z]:5d}{z:6d}{p[0]:16.9f}{p[1]:16.9f}{p[2]:16.9f}\n' for z, p in zip(zno.numbers, zno.get_scaled_positions()))
fmt_cases.append(dict(name='SIESTA .STRUCT_OUT', format='struct', text=so, lattice=tolist(lat),
                      positions=tolist(zno.get_scaled_positions()), numbers=tolist(zno.numbers)))
# fdf: LatticeParameters + ScaledCartesian
a0 = 5.431
si_conv = conv_si
fdf1 = f"""SystemName   Si conventional
SystemLabel  si8
NumberOfAtoms 8
NumberOfSpecies 1
%block Chemical_Species_Label
 1 14 Si   # silicon
%endblock Chemical_Species_Label
LatticeConstant {a0} Ang
%block LatticeParameters
  1.0 1.0 1.0 90. 90. 90.
%endblock LatticeParameters
AtomicCoordinatesFormat ScaledCartesian
%block AtomicCoordinatesAndAtomicSpecies
""" + ''.join(f'  {p[0] / a0:.8f} {p[1] / a0:.8f} {p[2] / a0:.8f} 1\n' for p in si_conv.positions) + """%endblock AtomicCoordinatesAndAtomicSpecies
"""
fmt_cases.append(dict(name='fdf LatticeParameters + ScaledCartesian', format='fdf', text=fdf1, lattice=tolist(si_conv.cell.array),
                      positions=tolist(si_conv.get_scaled_positions()), numbers=tolist(si_conv.numbers)))
# fdf: LatticeVectors in Bohr + NotScaledCartesianBohr with two species
fdf2 = """# ZnO wurtzite
LatticeConstant 1.0 Bohr
%block LatticeVectors
""" + ''.join(f'  {v[0] / BOHR:.9f} {v[1] / BOHR:.9f} {v[2] / BOHR:.9f}\n' for v in lat) + """%endblock LatticeVectors
Atomic-Coordinates-Format   NotScaledCartesianBohr
%block ChemicalSpeciesLabel
  1  30  Zn
  2   8  O
%endblock ChemicalSpeciesLabel
%block AtomicCoordinatesAndAtomicSpecies
""" + ''.join(f'  {r[0] / BOHR:.9f} {r[1] / BOHR:.9f} {r[2] / BOHR:.9f} {spec[z]}\n' for z, r in zip(zno.numbers, cart)) + \
    '%endblock AtomicCoordinatesAndAtomicSpecies\n'
fmt_cases.append(dict(name='fdf LatticeVectors (Bohr) + NotScaledCartesianBohr', format='fdf', text=fdf2, lattice=tolist(lat),
                      positions=tolist(zno.get_scaled_positions()), numbers=tolist(zno.numbers)))
# fdf: Fractional
fdf3 = """LatticeConstant 3.25 Ang
%block LatticeVectors
""" + ''.join(f'  {v[0] / 3.25:.10f} {v[1] / 3.25:.10f} {v[2] / 3.25:.10f}\n' for v in lat) + """%endblock LatticeVectors
AtomicCoordinatesFormat Fractional
%block ChemicalSpeciesLabel
  1  30  Zn
  2   8  O
%endblock ChemicalSpeciesLabel
%block AtomicCoordinatesAndAtomicSpecies
""" + ''.join(f'  {p[0]:.10f} {p[1]:.10f} {p[2]:.10f} {spec[z]}\n' for z, p in zip(zno.numbers, zno.get_scaled_positions())) + \
    '%endblock AtomicCoordinatesAndAtomicSpecies\n'
fmt_cases.append(dict(name='fdf LatticeVectors (Ang) + Fractional', format='fdf', text=fdf3, lattice=tolist(lat),
                      positions=tolist(zno.get_scaled_positions()), numbers=tolist(zno.numbers)))

# k-grid reference (k-spacing 0.2 1/A including 2*pi)
kgrid = []
for name in ['Si (diamond, primitive)', 'graphite (AB)', 'TiO2 (rutile)']:
    at = materials[name]
    B = 2 * np.pi * np.linalg.inv(at.cell.array).T
    kgrid.append(dict(name=name, lattice=tolist(at.cell.array),
                      grid=[int(max(1, np.ceil(np.linalg.norm(b) / 0.2 - 1e-9))) for b in B]))

def rounded(o):
    # 12 significant digits keep every comparison (>= 1e-9) meaningful and halve the file size
    if isinstance(o, float):
        return float(f'{o:.12g}')
    if isinstance(o, dict):
        return {k: rounded(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [rounded(v) for v in o]
    return o


with open(os.path.join(HERE, 'reference.json'), 'w') as f:
    json.dump(rounded(dict(generator=dict(spglib=spglib.__version__, seekpath=seekpath.__version__ if hasattr(seekpath, '__version__') else '2.x'),
                   cases=cases, format_cases=fmt_cases, kgrid=kgrid)), f, separators=(',', ':'))
print(f'{len(cases)} structure cases, {len(fmt_cases)} format cases written')
