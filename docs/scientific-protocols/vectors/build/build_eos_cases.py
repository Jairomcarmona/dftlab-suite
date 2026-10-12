"""Genera ../wf-eos.cases.json. Uso: RUNS=<directorio con runs/eos/{bfix,b154,frac}_*> python3 build_eos_cases.py
Las corridas se reproducen con docs/reviews/evidencia-p5-p10/si_eos_fdf.py (SIESTA 5.4.2). Requiere numpy."""
import json, os, copy
import numpy as np
HERE=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(HERE,'eos_tables.py')).read().replace("S='RUNS/runs/'","S=os.environ['RUNS'].rstrip('/')+'/runs/'")
exec(src)   # define table() y bm3()
T={"fix":table('bfix',1.075),"var":table('b154',1.075),"out80":table('frac',1.0)}
EV=160.21766208
POLICY={"policy_id":"qraft.eos.policy@1","energy_quantity":"free_energy","relaxation_mode":"fixed-fractional",
        "min_points":7,"min_points_each_side":2,"max_rms_meV_per_atom":0.5,"max_rel_dV0":0.005,"max_rel_dB0":0.05}
a=5.43
si_ref={"cell":[[0,a/2,a/2],[a/2,0,a/2],[a/2,a/2,0]],"atoms":[{"id":"Si1","species":"Si","cart":[0,0,0]},{"id":"Si2","species":"Si","cart":[a/4,a/4,a/4]}]}
f=1.06; s=f**(1/3)
good={"cell":[[v*s for v in r] for r in si_ref["cell"]],"atoms":[dict(at,cart=[v*s for v in at["cart"]]) for at in si_ref["atoms"]]}
trap={"cell":good["cell"],"atoms":copy.deepcopy(si_ref["atoms"])}
swap={"cell":good["cell"],"atoms":[good["atoms"][1],good["atoms"][0]]}
aniso={"cell":[si_ref["cell"][0],si_ref["cell"][1],[v*f for v in si_ref["cell"][2]]],"atoms":good["atoms"]}
# hexagonal (wurtzite-like, synthetic) with internal parameter u
ah,ch,u=3.19,5.19,0.377
hcell=[[ah,0,0],[-ah/2,ah*np.sqrt(3)/2,0],[0,0,ch]]
def cart(fr): return [float(sum(fr[i]*hcell[i][j] for i in range(3))) for j in range(3)]
hex_ref={"cell":hcell,"atoms":[{"id":"Ga1","species":"Ga","cart":cart([1/3,2/3,0])},{"id":"Ga2","species":"Ga","cart":cart([2/3,1/3,0.5])},
                               {"id":"N1","species":"N","cart":cart([1/3,2/3,u])},{"id":"N2","species":"N","cart":cart([2/3,1/3,0.5+u])}]}
fh=0.94; sh=fh**(1/3)
hex_good={"cell":[[v*sh for v in r] for r in hcell],"atoms":[dict(at,cart=[v*sh for v in at["cart"]]) for at in hex_ref["atoms"]]}
TOL={"cell_A":1e-9,"fractional":1e-10}
cases=[]
def C(**k): cases.append(k)
C(id="eos-geom-01",kind="deformation",title="Si en Å cartesianos a +6 %: celda y átomos escalados",reference=si_ref,factor=f,candidate=good,tolerance=TOL,expect=None)
C(id="eos-geom-02",kind="deformation",title="Trampa de LatticeConstant: celda escalada, átomos no",reference=si_ref,factor=f,candidate=trap,tolerance=TOL,expect="FRACTIONAL_NOT_PRESERVED")
C(id="eos-geom-03",kind="deformation",title="Celda hexagonal con parámetro interno a −6 %",reference=hex_ref,factor=fh,candidate=hex_good,tolerance=TOL,expect=None)
C(id="eos-geom-04",kind="deformation",title="Átomos reordenados: el atom map se pierde",reference=si_ref,factor=f,candidate=swap,tolerance=TOL,expect="ATOM_MAP_MISMATCH")
C(id="eos-geom-05",kind="deformation",title="Solo un vector escalado (no isotrópico)",reference=si_ref,factor=f,candidate=aniso,tolerance=TOL,expect="CELL_NOT_SCALED")
al_out="\n".join(["siesta: FreeEng =       -74.078893","SCF cycle converged after 4 iterations","siesta: E_KS(eV) =              -74.0791",
 "siesta: FreeEng =       -74.079164","siesta: Final energy (eV):","siesta:         Total =     -74.079115","Job completed"])
C(id="eos-energy-01",kind="energy",title="Al con Methfessel–Paxton: energía libre, última aparición",stdout=al_out,quantity="free_energy",expect={"value":-74.079164})
C(id="eos-energy-02",kind="energy",title="Al: energía total con 6 decimales, no E_KS(eV)",stdout=al_out,quantity="total_energy",expect={"value":-74.079115})
C(id="eos-energy-03",kind="energy",title="Sin prueba de convergencia SCF",stdout=al_out.replace("SCF cycle converged after 4 iterations",""),quantity="free_energy",expect={"error":"SCF_NOT_PROVEN"})
C(id="eos-energy-04",kind="energy",title="Solo E_KS(eV) con 4 decimales: no se acepta",stdout="SCF cycle converged after 4 iterations\nsiesta: E_KS(eV) =              -74.0791\nJob completed",quantity="free_energy",expect={"error":"ENERGY_MISSING"})
C(id="eos-energy-05",kind="energy",title="Cantidad no declarada en la ficha",stdout=al_out,quantity="e_ks",expect={"error":"ENERGY_QUANTITY_UNKNOWN"})
def tab(points,quantity="free_energy",n=2): return {"quantity":quantity,"n_atoms":n,"points":points}
fx=bm3([p["volume_A3"] for p in T["fix"]],[p["energy_eV"] for p in T["fix"]])
srt=sorted(T["fix"],key=lambda p:p["volume_A3"])
sens=[bm3([p["volume_A3"] for p in sub],[p["energy_eV"] for p in sub]) for sub in (srt[1:],srt[:-1])]
dV=max(abs(x["V0_A3"]/fx["V0_A3"]-1) for x in sens); dB=max(abs(x["B0_GPa"]/fx["B0_GPa"]-1) for x in sens)
C(id="eos-table-01",kind="table",title="Si SZP/PBE, malla fija 30³: ajuste establecido",policy=POLICY,table=tab(T["fix"]),
  expect={"status":"ESTABLISHED","reasons":[],"fit":fx,"sensitivity":{"max_rel_dV0":dV,"max_rel_dB0":dB},"per_atom":{"V0_A3":fx["V0_A3"]/2,"E0_eV":fx["E0_eV"]/2}})
C(id="eos-table-02",kind="table",title="Si con MeshCutoff fijo: la malla salta 24³→30³",policy=POLICY,table=tab(T["var"]),expect={"status":"REJECTED","reasons":["MESH_INCONSISTENT"]})
C(id="eos-table-03",kind="table",title="Si centrado en 5.43 Å: el mínimo del modelo cae fuera",policy=POLICY,table=tab(T["out80"]),expect={"status":"NOT_ESTABLISHED","reasons":["MINIMUM_OUTSIDE_RANGE"]})
kc=copy.deepcopy(T["fix"]); kc[3]["kgrid"]={"kind":"Cutoff","cutoff_A":10.0}
C(id="eos-table-04",kind="table",title="Un punto con kgrid.Cutoff",policy=POLICY,table=tab(kc),expect={"status":"REJECTED","reasons":["KGRID_NOT_FIXED"]})
C(id="eos-table-05",kind="table",title="Tabla en energía total con política de energía libre",policy=POLICY,table=tab(T["fix"],"total_energy"),expect={"status":"REJECTED","reasons":["ENERGY_QUANTITY_MISMATCH"]})
C(id="eos-table-06",kind="table",title="Solo cinco volúmenes",policy=POLICY,table=tab(T["fix"][1:6]),expect={"status":"REJECTED","reasons":["TOO_FEW_POINTS"]})
km=copy.deepcopy(T["fix"]); km[0]["relaxation_mode"]="internal"
C(id="eos-table-07",kind="table",title="Modos de relajación mezclados",policy=POLICY,table=tab(km),expect={"status":"REJECTED","reasons":["RELAXATION_MODE_MISMATCH"]})
# synthetic exact BM3
E0,V0,B0g,Bp=-100.0,40.0,100.0,4.5; B0=B0g/EV
def bmE(V): e=(V0/V)**(2/3)-1; return E0+9*V0*B0/16*(e**3*Bp+e**2*(6-4*(V0/V)**(2/3)))
def synth(vs): return [{"volume_factor":round(v/V0,10),"volume_A3":v,"energy_eV":bmE(v),"mesh":[30,30,30],"kgrid":{"kind":"MonkhorstPack","block":[[6,0,0,0.5],[0,6,0,0.5],[0,0,6,0.5]]},"relaxation_mode":"fixed-fractional"} for v in vs]
vs=[V0*x for x in (0.94,0.96,0.98,1.0,1.02,1.04,1.06)]
sy=bm3([p["volume_A3"] for p in synth(vs)],[p["energy_eV"] for p in synth(vs)])
C(id="eos-fit-01",kind="table",title="BM3 sintético exacto: el ajuste recupera E0, V0, B0 y B0′",policy=POLICY,table=tab(synth(vs)),
  expect={"status":"ESTABLISHED","reasons":[],"fit":{"E0_eV":E0,"V0_A3":V0,"B0_GPa":B0g,"B0_prime":Bp,"rms_meV":0.0}})
vs2=[V0*x for x in (0.995,1.01,1.03,1.05,1.07,1.09,1.11)]
C(id="eos-table-08",kind="table",title="Mínimo entre el primer y el segundo punto: un solo punto por debajo",policy=POLICY,table=tab(synth(vs2)),expect={"status":"NOT_ESTABLISHED","reasons":["MINIMUM_NOT_BRACKETED"]})
nz=copy.deepcopy(T["fix"]); nz[3]["energy_eV"]+=0.004
C(id="eos-table-09",kind="table",title="Un punto con +4 meV de error: residuo y B0 sensible",policy=POLICY,table=tab(nz),expect={"status":"NOT_ESTABLISHED","reasons":["RESIDUAL_TOO_LARGE","B0_SENSITIVE"]})
doc={"schema":"dftlab.protocol-vectors@1","protocol":"WF-EOS","ficha":"docs/scientific-protocols/WF-EOS.md","oracle":"docs/scientific-protocols/vectors/eos-oracle.mjs",
 "provenance":"Tablas Si de docs/reviews/evidencia-p5-p10 (SIESTA 5.4.2, SZP/PBE, un hilo); energías FreeEng finales. Valores esperados calculados con numpy (lstsq) independientemente del oráculo.",
 "arithmetic_tolerance":{"rel":1e-7,"abs_meV":1e-6},"cases":cases}
open(os.path.join(HERE,'..','wf-eos.cases.json'),'w').write(json.dumps(doc,indent=1,ensure_ascii=False)+"\n")
print(len(cases), sy)
r=bm3([p["volume_A3"] for p in nz],[p["energy_eV"] for p in nz]); print('noisy rms/atom',r['rms_meV']/2)
