cd /opt/run/gr

for xc in lda pbe drsll vv; do for d in 2.9 3.1 3.25 3.4 3.6 3.9 4.4 5.0 6.0; do D=gh_${xc}_$d; grep -q "Job completed" $D/g.out 2>/dev/null && continue; mkdir -p $D
case $xc in lda) F=LDA;A=PW92;P=lda;; pbe) F=GGA;A=PBE;P=pbe;; drsll) F=VDW;A=DRSLL;P=pbe;; vv) F=VDW;A=VV;P=pbe;; esac
sed -e 's/^NumberOfSpecies 1/NumberOfSpecies 2/' -e "s/^ 1 6 C_$P\$/ 1 6 C_$P\n 2 -6 C_${P}_g/" -e 's/^ 0.0 0.0 0.5 1$/ 0.0 0.0 0.5 2/' -e 's/^ 0.666666667 0.333333333 0.5 1$/ 0.666666667 0.333333333 0.5 2/' -e 's/SystemLabel g/SystemLabel g/' ${xc}_$d/g.fdf > $D/g.fdf
[ $xc = vv ] && printf "SCF.H.Tolerance 5e-3 eV\nMaxSCFIterations 300\n" >> $D/g.fdf; cp C_$P.psml $D/; cp C_$P.psml $D/C_${P}_g.psml
(cd $D && OMP_NUM_THREADS=4 /opt/siesta/bin/siesta g.fdf > g.out 2>&1); echo "$D $(grep 'siesta:         Total =' $D/g.out)"; done; done
echo GHDONE
