"""FDF de H2O (DZP, PBE) en una caja, para la evidencia de los presets S-01 y S-07.
Uso: python3 h2o_box_fdf.py "A B C" CARGA SPIN MESH_RY [LÍNEAS EXTRA...] > in.fdf
  A B C: lados de la caja en Å (cúbica si son iguales). SPIN: non-polarized | polarized.
La molécula queda en el centro con O-H 0.957 Å; los pseudos son app/dftlab/data/pseudos/pbe/{O,H}.psml."""
import sys

a, b, c = (float(x) for x in sys.argv[1].split())
q, spin, mesh = sys.argv[2], sys.argv[3], sys.argv[4]
cx, cy, cz = a / 2, b / 2, c / 2
print(f"""SystemLabel h2o
NumberOfSpecies 2
NumberOfAtoms 3
%block ChemicalSpeciesLabel
1 8 O
2 1 H
%endblock ChemicalSpeciesLabel
PAO.BasisSize DZP
XC.functional GGA
XC.authors PBE
LatticeConstant 1 Ang
%block LatticeVectors
{a} 0 0
0 {b} 0
0 0 {c}
%endblock LatticeVectors
AtomicCoordinatesFormat Ang
%block AtomicCoordinatesAndAtomicSpecies
{cx} {cy} {cz} 1
{cx + 0.757} {cy + 0.586} {cz} 2
{cx - 0.757} {cy + 0.586} {cz} 2
%endblock AtomicCoordinatesAndAtomicSpecies
Mesh.Cutoff {mesh} Ry
NetCharge {q}
Spin {spin}""")
for extra in sys.argv[5:]:
    print(extra)
