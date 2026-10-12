"""FDF de las corridas de estructura electrónica de Si (T-036). Uso: python3 si_bands_fdf.py <pia|coop|path|fat|mass> > si.fdf
`path` hace el SCF; las demás añaden `DM.UseSaveDM T` y parten de su si.DM. Para `fat`, los .mpr van al final como comentario."""
import sys

BASE = """SystemLabel si
NumberOfSpecies 1
NumberOfAtoms 2
%block ChemicalSpeciesLabel
1 14 Si
%endblock ChemicalSpeciesLabel
PAO.BasisSize DZP
XC.functional GGA
XC.authors PBE
LatticeConstant 5.43 Ang
%block LatticeVectors
0.0 0.5 0.5
0.5 0.0 0.5
0.5 0.5 0.0
%endblock LatticeVectors
AtomicCoordinatesFormat Fractional
%block AtomicCoordinatesAndAtomicSpecies
0.0 0.0 0.0 1
0.25 0.25 0.25 1
%endblock AtomicCoordinatesAndAtomicSpecies
%block kgrid.MonkhorstPack
8 0 0 0.5
0 8 0 0.5
0 0 8 0.5
%endblock kgrid.MonkhorstPack
Mesh.Cutoff 200 Ry
DM.Tolerance 1e-6
"""


def path(n):
    pts = [(1, '0.0 0.0 0.0', r'\Gamma'), (n[0], '0.0 0.5 0.5', 'X'), (n[1], '0.25 0.5 0.75', 'W'), (n[2], '0.5 0.5 0.5', 'L'),
           (n[3], '0.0 0.0 0.0', r'\Gamma'), (n[4], '0.375 0.375 0.75', 'K')]
    return 'BandLinesScale ReciprocalLatticeVectors\n%block BandLines\n' + ''.join(f'{a} {k} {l}\n' for a, k, l in pts) + '%endblock BandLines\n'


mode = sys.argv[1]
out = BASE
if mode != 'path':
    out += 'DM.UseSaveDM T\n'
if mode == 'pia':
    out += 'BandLinesScale pi/a\n%block BandLines\n1 0 0 0 \\Gamma\n20 2 0 0 X\n%endblock BandLines\n'
elif mode == 'coop':
    out += 'COOP.Write T\nBandLinesScale ReciprocalLatticeVectors\n%block BandLines\n1 0 0 0 \\Gamma\n20 0 0.5 0.5 X\n%endblock BandLines\n'
elif mode == 'path':
    out += 'WFS.Write.For.Bands T\n' + path((200, 50, 70, 120, 100))
elif mode == 'fat':
    out += 'WFS.Write.For.Bands T\n' + path((10, 5, 7, 12, 10))
    out += '# fatsi.mpr: si / DOS / s Si_3s / p Si_3p / d Si_3d   (fat -b 1 -B 8 fatsi)\n'
    out += '# fatat.mpr: si / DOS / a1 1 / a2 2 / a2sp 2_3s 2_3p   (fat -b 1 -B 8 fatat)\n'
elif mode == 'mass':
    # Líneas en cartesianas (unidades 2π/a) pasadas a la base recíproca de la celda FCC.
    k0, d = 0.847, [i * 0.0025 for i in range(-24, 25)]
    lines = [[(k0 + t, 0, 0) for t in d], [(k0, t, 0) for t in d], [(t, 0, 0) for t in d], [(t / 3 ** .5,) * 3 for t in d]]
    out += 'BandLinesScale ReciprocalLatticeVectors\n%block BandPoints\n'
    out += ''.join(f'{(y + z) / 2:.10f} {(x + z) / 2:.10f} {(x + y) / 2:.10f}\n' for L in lines for x, y, z in L)
    out += '%endblock BandPoints\n'
else:
    sys.exit('modo desconocido')
print(out, end='')
