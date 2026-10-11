import os,sys,json,subprocess,re,numpy as np,shutil
from scipy.optimize import curve_fit
LIB='/mnt/project-files/DFT_App/app/dftlab/data/pseudos'
ROOT='/opt/run/pslib/val/runs_es20'
FCC=[(0.0,0.5,0.5),(0.5,0.0,0.5),(0.5,0.5,0.0)]
BCC=[(-0.5,0.5,0.5),(0.5,-0.5,0.5),(0.5,0.5,-0.5)]
MAT={
 'Si':   dict(lat=FCC,atoms=[('Si',(0,0,0)),('Si',(0.25,0.25,0.25))],aexp=5.431,Bexp=99.2,metal=False,k=8),
 'C':    dict(lat=FCC,atoms=[('C',(0,0,0)),('C',(0.25,0.25,0.25))],aexp=3.567,Bexp=443,metal=False,k=8),
 'Al':   dict(lat=FCC,atoms=[('Al',(0,0,0))],aexp=4.050,Bexp=76,metal=True,k=14),
 'Cu':   dict(lat=FCC,atoms=[('Cu',(0,0,0))],aexp=3.615,Bexp=140,metal=True,k=14),
 'MgO':  dict(lat=FCC,atoms=[('Mg',(0,0,0)),('O',(0.5,0,0))],aexp=4.212,Bexp=165,metal=False,k=6),
 'GaAs': dict(lat=FCC,atoms=[('Ga',(0,0,0)),('As',(0.25,0.25,0.25))],aexp=5.653,Bexp=75.6,metal=False,k=8),
 'NaCl': dict(lat=FCC,atoms=[('Na',(0,0,0)),('Cl',(0.5,0,0))],aexp=5.640,Bexp=26.6,metal=False,k=6),
 'Ni':   dict(lat=FCC,atoms=[('Ni',(0,0,0))],aexp=3.524,Bexp=186,metal=True,k=14,spin=0.6,mexp=0.61),
 'ZnO':  dict(lat=[(1.0,0.0,0.0),(-0.5,0.8660254,0.0),(0.0,0.0,1.602)],frac=True,atoms=[('Zn',(1/3,2/3,0.0)),('Zn',(2/3,1/3,0.5)),('O',(1/3,2/3,0.382)),('O',(2/3,1/3,0.882))],aexp=3.250,Bexp=143,metal=False,k=6,kv=[6,6,4]),
 'Fe':   dict(lat=BCC,atoms=[('Fe',(0,0,0))],aexp=2.867,Bexp=168,metal=True,k=14,spin=2.2,mexp=2.22),
}
Z={'H':1,'Li':3,'B':5,'C':6,'N':7,'O':8,'F':9,'Na':11,'Mg':12,'Al':13,'Si':14,'P':15,'S':16,'Cl':17,'K':19,'Ca':20,'Ti':22,'Fe':26,'Ni':28,'Cu':29,'Zn':30,'Ga':31,'Ge':32,'As':33,'Se':34,'Sr':38,'Zr':40,'Mo':42,'Ag':47,'Au':79}
def fdf(name,xc,a,mesh,extra=()):
    m=MAT[name]; sp=[]
    for e,_ in m['atoms']:
        if e not in sp: sp.append(e)
    L=[f"SystemName {name} {xc} a={a:.4f}",f"SystemLabel {name.lower()}",f"NumberOfAtoms {len(m['atoms'])}",f"NumberOfSpecies {len(sp)}",
       "%block ChemicalSpeciesLabel"]+[f" {i+1} {Z[e]} {e}" for i,e in enumerate(sp)]+["%endblock ChemicalSpeciesLabel",
       "PAO.BasisSize DZP","PAO.EnergyShift 20 meV",f"MeshCutoff {mesh} Ry",
       f"LatticeConstant {a:.5f} Ang","%block LatticeVectors"]+[" %.4f %.4f %.4f"%v for v in m['lat']]+["%endblock LatticeVectors",
       "AtomicCoordinatesFormat "+("Fractional" if m.get('frac') else "ScaledCartesian"),"%block AtomicCoordinatesAndAtomicSpecies"]+\
       [" %.5f %.5f %.5f %d"%(p[0],p[1],p[2],sp.index(e)+1) for e,p in m['atoms']]+["%endblock AtomicCoordinatesAndAtomicSpecies"]
    kv=m.get('kv',[m['k']]*3); sh=0.5 if not m['metal'] else 0.0
    if m.get('frac'): sh=0.0
    L+=["%block kgrid_Monkhorst_Pack",f" {kv[0]} 0 0 {sh}",f" 0 {kv[1]} 0 {sh}",f" 0 0 {kv[2]} {sh}","%endblock kgrid_Monkhorst_Pack"]
    L+=["XC.functional "+("LDA" if xc=='lda' else "GGA"),"XC.authors "+("CA" if xc=='lda' else "PBE")]
    L+=["SCF.Mixer.Method Pulay","SCF.Mixer.Weight 0.2","SCF.Mixer.History 6","Max.SCF.Iterations 300","DM.Tolerance 1e-5","SCF.H.Tolerance 1e-4 eV",
        "WriteMullikenPop 0","SaveHS F","WriteDM F"]
    if m['metal']:
        L+=["OccupationFunction MP","OccupationMPOrder 1","ElectronicTemperature 0.01 Ry"]
    if m.get('spin'):
        L+=["Spin polarized","%block DM.InitSpin"," 1 +","%endblock DM.InitSpin"]
    keys={e.split()[0].lower() for e in extra if e.strip()}
    L=[l for l in L if not (l.split() and l.split()[0].lower() in keys)]
    L+=list(extra)
    return "\n".join(L)+"\n"
def parse(out):
    t=open(out).read()
    if 'Job completed' not in t: return None
    E=float(re.findall(r"siesta:\s+FreeEng\s*=\s*([-\d.]+)",t)[-1]) if re.search(r"siesta:\s+FreeEng",t) else float(re.findall(r"siesta:\s+Total =\s*([-\d.]+)",t)[-1])
    mm=re.findall(r"spin moment: \{S\} , \|S\| = \{\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\}",t)
    mag=float(mm[-1][2]) if mm else None
    if mag is None:
        mm=re.findall(r"Total spin polarization \(Qup-Qdown\)\s*=\s*([-\d.]+)",t); mag=float(mm[-1]) if mm else None
    return dict(E=E,mag=mag)
def bm(V,E0,V0,B0,Bp):
    eta=(V0/V)**(2/3); return E0+9*V0*B0/16*((eta-1)**3*Bp+(eta-1)**2*(6-4*eta))
def natoms_cell(m): return 1
def vol(name,a):
    lat=np.array(MAT[name]['lat'])*a; return abs(np.linalg.det(lat))
def fit(name,As,Es):
    V=np.array([vol(name,a) for a in As]); E=np.array(Es)
    if len(V)<5:
        c=np.polyfit(As,Es,2); a0=-c[1]/(2*c[0]); return dict(a0=a0,B0_GPa=float('nan'),Bp=float('nan'),E0=float(np.polyval(c,a0)),V0=vol(name,a0),inside=bool(min(As)<a0<max(As)))
    i=np.argmin(E); p0=[E[i],V[i],0.5,4.5]
    p,_=curve_fit(bm,V,E,p0=p0,maxfev=20000)
    E0,V0,B0,Bp=p; a0=(V0/vol(name,1.0))**(1/3)
    return dict(a0=a0,B0_GPa=B0*160.21766,Bp=Bp,E0=E0,V0=V0,inside=bool(V.min()<V0<V.max()))
def run(name,xc,mesh=400,xs=None,tag='',extra=(),psdir=None,abs_a=None):
    m=MAT[name]
    if xs is None: xs=[-0.04,-0.03,-0.02,-0.01,0.0,0.01,0.02] if xc=='lda' else [-0.02,-0.01,0.0,0.01,0.02,0.03,0.04]
    res=[]
    alist=abs_a or [round(m['aexp']*(1+x),4) for x in xs]
    for a in alist:
        d=f"{ROOT}/{name}_{xc}{tag}/a{a:.4f}"; os.makedirs(d,exist_ok=True)
        out=f"{d}/run.out"
        r=parse(out) if os.path.exists(out) else None
        if r is None:
            open(f"{d}/{name.lower()}.fdf","w").write(fdf(name,xc,a,mesh,extra))
            for e,_ in m['atoms']: shutil.copy(f"{psdir or LIB+'/'+xc}/{e}.psml",f"{d}/{e}.psml")
            with open(out,"w") as fo:
                subprocess.run(["/opt/siesta/bin/siesta",f"{name.lower()}.fdf"],cwd=d,stdout=fo,stderr=subprocess.STDOUT,env=dict(os.environ,OMP_NUM_THREADS="4"))
            r=parse(out)
        print(name,xc,a,r,flush=True)
        if r: res.append((a,r['E'],r['mag']))
    As=[x[0] for x in res]; Es=[x[1] for x in res]
    f=fit(name,As,Es); f['points']=[dict(a=a,E=E,mag=mg) for a,E,mg in res]
    if m.get('spin'):
        # moment at the fitted minimum: interpolate
        mags=[x[2] for x in res]; f['mag_a0']=float(np.interp(f['a0'],As,mags))
    f['mesh']=mesh
    return f
if __name__=="__main__":
    name,xc=sys.argv[1:3]; mesh=int(sys.argv[3]) if len(sys.argv)>3 else 400
    f=run(name,xc,mesh); os.makedirs('/opt/run/pslib/val/res',exist_ok=True)
    json.dump(f,open(f'/opt/run/pslib/val/res/{name}_{xc}.json','w'),indent=1)
    print("RESULT",name,xc,"a0=%.4f B0=%.1f inside=%s"%(f['a0'],f['B0_GPa'],f['inside']),"err=%.2f%%"%(100*(f['a0']/MAT[name]['aexp']-1)),f.get('mag_a0'))
