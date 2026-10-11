# Figuras reales para las secciones de pseudopotenciales y XC (datos de /opt/pseudos y /opt/run/si)
import re, numpy as np, matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt, sisl
PS="/opt/pseudos/Si.soft.psml"; txt=open(PS).read()
def block(tag_re):
    m=re.search(tag_re+r".*?<data>(.*?)</data>",txt,re.S); return np.array(m.group(1).split(),float)
r=np.array(re.search(r"<grid-data>(.*?)</grid-data>",txt,re.S).group(1).split(),float)
V={l:block(rf'<slps n="\d" l="{l}"') for l in "spdf"}
W={l:block(rf'<pswf n="\d" l="{l}"') for l in "spd"}
rho=block(r"<valence-charge")
rc=float(re.search(r'rc="([\d.]+)"',txt).group(1))
# psf de PBE para comparar (r*V en Ry)
def psf(fn):
    L=open(fn).read().split("\n"); nr=int(L[3].split()[2]); vals=" ".join(L[4:]).split()
    # tokens: grid line header then numbers
    t=open(fn).read(); i=t.index("Radial grid follows"); s=t[i:].split("\n",1)[1]
    nums=[]; out={}
    parts=re.split(r"(Down Pseudopotential follows \(l on next line\)|Core charge follows|Valence charge follows)",s)
    rg=np.array(parts[0].split(),float)[:nr]; cur=None
    for p in parts[1:]:
        if p.startswith("Down"): cur="V"; continue
        if p.startswith("Core"): cur="core"; continue
        if p.startswith("Valence"): cur="val"; continue
        a=p.split()
        if cur=="V": out[f"V{int(a[0])}"]=np.array(a[1:1+nr],float)
        else: out[cur]=np.array(a[:nr],float)
    return rg,out
fig,ax=plt.subplots(2,3,figsize=(15,8.5)); ax=ax.ravel()
c={"s":"#c97d10","p":"#13826f","d":"#8446c4","f":"#888"}
for l in "spdf": ax[0].plot(r,V[l],c=c[l],label=f"V_{l}(r)")
ax[0].plot(r,-4/np.maximum(r,1e-3),"k--",lw=1,label="−Z_val/r (Coulomb)")
ax[0].axvline(rc,ls=":",c="gray"); ax[0].text(rc+.05,-3.5,"r_c",color="gray")
ax[0].set(xlim=(0,4),ylim=(-4,1),xlabel="r (Bohr)",ylabel="Ha",title="Si: potenciales semilocales V_l(r) (psml, TM)"); ax[0].legend(fontsize=8)
for l in "sp": ax[1].plot(r,r*W[l],c=c[l],label=f"r·R_{l}(r) pseudo")
ax[1].axvline(rc,ls=":",c="gray"); ax[1].set(xlim=(0,8),xlabel="r (Bohr)",title="Si: funciones pseudo (sin nodos dentro de r_c)"); ax[1].legend(fontsize=8)
rho=r**2*rho; ax[2].plot(r,rho,c="#1d5bc4"); ax[2].set(xlim=(0,8),xlabel="r (Bohr)",title=f"Si: carga de valencia 4πr²ρ (∫={np.trapezoid(rho,r):.3f} e)")
rg,o=psf("/opt/pseudos/O_ldau.psf")
for k,col in zip(["V0","V1","V2"],["#c97d10","#13826f","#8446c4"]): ax[3].plot(rg,o[k]/rg/2,c=col,label=k.replace("V","V_l=")+" (Ha)")
ax[3].plot(rg,-6/rg,"k--",lw=1,label="−6/r"); ax[3].set(xlim=(0,3),ylim=(-12,3),xlabel="r (Bohr)",title="O (PBE, psf): V_l(r)"); ax[3].legend(fontsize=8)
b=sisl.get_sile("/opt/run/si/Si.ion.xml").read_basis()
seen=set()
for orb in b.orbitals:
    k=(orb.l,orb.name()[-2:])
    if k in seen: continue
    seen.add(k); rr=np.linspace(0,orb.R,300); f=orb.orb.radial(rr)
    ax[4].plot(rr,rr*f,label=f"{'spd'[orb.l]} {orb.name()[-3:].lstrip('ydxz2-')}  R={orb.R:.2f}")
ax[4].set(xlabel="r (Bohr)",title="Si: base DZP real (.ion) con radios de corte"); ax[4].legend(fontsize=8)
# XC: LDA (PW92) y factor PBE
rs=np.linspace(0.5,6,200); ex=-0.458165/rs
def pw92(rs,A=0.031091,a1=0.21370,b1=7.5957,b2=3.5876,b3=1.6382,b4=0.49294):
    s=np.sqrt(rs); return -2*A*(1+a1*rs)*np.log(1+1/(2*A*(b1*s+b2*rs+b3*s**3+b4*rs**2)))
a5=ax[5]; a5.plot(rs,ex,label="ε_x LDA (Ha)"); a5.plot(rs,pw92(rs),label="ε_c LDA PW92 (Ha)")
a5.set(xlabel="r_s (Bohr)",title="XC: LDA vs r_s  |  inset: F_x(s) PBE"); a5.legend(fontsize=8,loc="lower right")
ins=a5.inset_axes([.45,.45,.5,.4]); s=np.linspace(0,3,100); k,mu=0.804,0.21951
ins.plot(s,1+k-k/(1+mu*s**2/k),label="PBE"); ins.plot(s,1+k-k/(1+(10/81)*s**2/k),label="PBEsol"); ins.axhline(1,c="k",lw=.8); ins.axhline(1.804,ls=":",c="gray")
ins.set_title("F_x(s)",fontsize=8); ins.legend(fontsize=7)
plt.tight_layout(); plt.savefig("/mnt/project-files/DFT_App/pseudo_xc/pseudo_xc_real.png",dpi=110)
print("rc",rc,"intrho",np.trapezoid(rho,r))
