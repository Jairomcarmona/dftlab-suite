import sys
f=float(sys.argv[1]); mode=sys.argv[2]; mc=sys.argv[3]; extra=sys.argv[4] if len(sys.argv)>4 else ""
a=5.43*f**(1/3)
fmt = "Fractional" if mode=="frac" else "Ang"
if mode=="frac":
    lat=f"LatticeConstant {a:.8f} Ang"; coords="0.0 0.0 0.0 1\n0.25 0.25 0.25 1"
elif mode=="angtrap":   # scale only LatticeConstant, keep Cartesian Ang coords of ref
    lat=f"LatticeConstant {a:.8f} Ang"; coords=f"0.0 0.0 0.0 1\n{5.43/4:.8f} {5.43/4:.8f} {5.43/4:.8f} 1"
print(f"""SystemLabel si
NumberOfSpecies 1
NumberOfAtoms 2
%block ChemicalSpeciesLabel
1 14 Si
%endblock ChemicalSpeciesLabel
PAO.BasisSize SZP
XC.functional GGA
XC.authors PBE
{lat}
%block LatticeVectors
0.0 0.5 0.5
0.5 0.0 0.5
0.5 0.5 0.0
%endblock LatticeVectors
AtomicCoordinatesFormat {fmt}
%block AtomicCoordinatesAndAtomicSpecies
{coords}
%endblock AtomicCoordinatesAndAtomicSpecies
%block kgrid.MonkhorstPack
6 0 0 0.5
0 6 0 0.5
0 0 6 0.5
%endblock kgrid.MonkhorstPack
Mesh.Cutoff {mc} Ry
DM.Tolerance 1e-5
{extra}
""")
