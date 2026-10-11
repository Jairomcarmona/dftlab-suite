cd /opt/run/xc
source <(sed -n '/^mk()/,/^}/p' /dev/null)
for xc in lda pbe; do for a in 5.25 5.30 5.35 5.40 5.45 5.50 5.55 5.60 5.65 5.70; do d=${xc}_$a; [ -f $d/si.out ] && grep -q "Job completed" $d/si.out && continue
mkdir -p $d; F=LDA; A=PW92; [ $xc = pbe ] && F=GGA && A=PBE
cat > $d/si.fdf <<EOT
SystemLabel si
%include ../si_base.fdf
LatticeConstant $a Ang
%block ChemicalSpeciesLabel
 1 14 Si_$xc
%endblock ChemicalSpeciesLabel
XC.functional $F
XC.authors $A
EOT
cp Si_$xc.psml $d/; (cd $d && OMP_NUM_THREADS=4 /opt/siesta/bin/siesta si.fdf > si.out 2>&1); done; done
echo EOSDONE
