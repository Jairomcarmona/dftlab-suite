import numpy as np
kB=1.380649e-23; h=6.62607015e-34; c=2.99792458e10; NA=6.02214076e23; R=kB*NA; amu=1.66053907e-27
m=2.01588*amu; P=1e5
def S_trans(T): 
    lam=h/np.sqrt(2*np.pi*m*kB*T); return R*(np.log(kB*T/P/lam**3)+2.5)
def S_vib(T,nu):
    th=h*c*nu/kB; x=th/T; return R*(x/np.expm1(x)-np.log1p(-np.exp(-x)))
def H_vib(T,nu):
    th=h*c*nu/kB; x=th/T; return R*th/np.expm1(x)
def rot(T,B,Jmax=60):
    th=h*c*B/kB
    out={}
    for name,par in (('p',0),('o',1)):
        Js=np.arange(par,Jmax,2); q=(2*Js+1)*np.exp(-th*Js*(Js+1)/T); Z=q.sum()
        E=(q*th*Js*(Js+1)).sum()/Z  # en K
        out[name]=(Z,E)
    return out
def S_rot_normal(T,B):
    r=rot(T,B); res=0
    for name,x,gn in (('p',.25,1),('o',.75,3)):
        Z,E=r[name]; S=R*(np.log(Z)+E/T)   # sin degeneracion de espin nuclear
        res+=x*S
    return res
def S_total(T,B,nu): return S_trans(T)+S_rot_normal(T,B)+S_vib(T,nu)
import sys
print("Validacion de formulas con constantes experimentales (B=60.853 cm-1, nu=4401.2):")
for T,ref in ((298.15,130.68),(1000.0,166.216)):
    print(f"  T={T}: S={S_total(T,60.853,4401.2):.3f} J/mol/K  JANAF={ref}")
print("\nCon constantes de SIESTA 5.4.2 (PBE, TZP, 300 Ry):")
r=0.7721662731889086e-10; mu=m/4; I=mu*r**2; B=h/(8*np.pi**2*c*I)/1.0   # h/(8 pi^2 c I) en cm-1 (c en cm/s)
k=31.1489*1.602176634e-19/1e-20            # eV/A^2 -> N/m
nu=np.sqrt(k/mu)/(2*np.pi*c)
print(f"  r={r*1e10:.4f} A, B={B:.2f} cm-1 (exp 60.85), k={k:.1f} N/m, nu={nu:.0f} cm-1 (exp 4401, error {100*(nu-4401.2)/4401.2:.1f} %)")
for T,ref in ((298.15,130.68),(1000.0,166.216)):
    s=S_total(T,B,nu); print(f"  T={T}: S={s:.3f}  JANAF={ref}  diff={s-ref:+.2f}")
def H_tot(T,B,nu):
    r=rot(T,B); Erot=.25*r['p'][1]+.75*r['o'][1]   # en K
    return (2.5*R*T + R*Erot + H_vib(T,nu))/1000.0     # kJ/mol; sin ZPE
print("\nH(T)-H(0) (kJ/mol), sin ZPE; en 0 K el rotor ortho tiene E=2B*h*c*NA ~ +1.1 kJ/mol de offset ortho")
for T,ref in ((298.15,8.468),(1000.0,29.148)):
    for lab,(BB,nn) in (("exp",(60.853,4401.2)),("SIESTA",(B,nu))):
        print(f"  T={T} {lab}: {H_tot(T,BB,nn):.3f}  JANAF={ref}")
