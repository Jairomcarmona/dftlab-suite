cd /opt/run/gr
for xc in lda pbe drsll vv; do for d in 2.9 3.1 3.25 3.4 3.6 3.9 4.4 5.0 6.0 10.0; do D=${xc}_$d; grep -q "Job completed" $D/g.out 2>/dev/null && continue; mkdir -p $D
case $xc in lda) F=LDA;A=PW92;P=lda;; pbe) F=GGA;A=PBE;P=pbe;; drsll) F=VDW;A=DRSLL;P=pbe;; vv) F=VDW;A=VV;P=pbe;; esac
c=$(python3 -c "print(2*$d)"); kz=$(python3 -c "print(4 if $d<5 else (2 if $d<7 else 1))")
cat > $D/g.fdf <<EOT
SystemLabel g
NumberOfAtoms 4
NumberOfSpecies 1
%block ChemicalSpeciesLabel
 1 6 C_$P
%endblock ChemicalSpeciesLabel
LatticeConstant 1.0 Ang
%block LatticeParameters
 2.4610 2.4610 $c 90.0 90.0 120.0
%endblock LatticeParameters
AtomicCoordinatesFormat Fractional
%block AtomicCoordinatesAndAtomicSpecies
 0.0 0.0 0.0 1
 0.0 0.0 0.5 1
 0.333333333 0.666666667 0.0 1
 0.666666667 0.333333333 0.5 1
%endblock AtomicCoordinatesAndAtomicSpecies
PAO.BasisSize DZP
PAO.EnergyShift 50 meV
MeshCutoff 300 Ry
%block kgrid_Monkhorst_Pack
 12 0 0 0.0
 0 12 0 0.0
 0 0 $kz 0.0
%endblock kgrid_Monkhorst_Pack
ElectronicTemperature 25 meV
DM.Tolerance 1e-5
SCF.Mixer.Method Pulay
SCF.Mixer.Weight 0.2
XC.functional $F
XC.authors $A
EOT
cp C_$P.psml $D/; (cd $D && OMP_NUM_THREADS=4 /opt/siesta/bin/siesta g.fdf > g.out 2>&1); echo "$D $(grep 'siesta:         Total =' $D/g.out)"; done; done
echo GRDONE
