import numpy as np,sisl,json
g=sisl.get_sile('si.RHO').read_grid(); rho=g.grid/0.529177**-3*1.0  # placeholder
B=0.529177
rho_A=g.grid                     # e/Å^3
cell=g.lattice.cell              # Å, rows
N=np.array(rho_A.shape)
F=np.fft.fftn(rho_A)/rho_A.size
idx=[np.fft.fftfreq(n,1/n) for n in N]
m1,m2,m3=np.meshgrid(*idx,indexing='ij')
rec=2*np.pi*np.linalg.inv(cell).T   # rows b_i, b_i·a_j=2πδ
Gv=m1[...,None]*rec[0]+m2[...,None]*rec[1]+m3[...,None]*rec[2]
keep=np.abs(F)>1e-9*np.abs(F).max()
Fk=F[keep]; Gk=Gv[keep]; print(keep.sum())
a=5.43; nu,nv=90,64
u=np.linspace(0,a*np.sqrt(2),nu); v=np.linspace(0,a,nv)
U,V=np.meshgrid(u,v,indexing='xy')
R=(U[...,None]*np.array([1,1,0])/np.sqrt(2)+V[...,None]*np.array([0,0,1])).reshape(-1,3)
ph=np.exp(1j*R@Gk.T)
r=(ph@Fk).real
gr=np.stack([((ph*(1j*Gk[:,i]))@Fk).real for i in range(3)],-1)
rb=r*B**3; gb=np.linalg.norm(gr,axis=1)*B**4      # e/bohr^3, e/bohr^4
rb=np.maximum(rb,1e-6)
rs=(3/(4*np.pi*rb))**(1/3); kF=(3*np.pi**2*rb)**(1/3); s=gb/(2*kF*rb)
print(rb.min(),rb.max(),rs.min(),rs.max(),s.min(),s.max(),np.median(s))
# atoms in (1-10) plane: positions in conventional cell with x==y
at=[]
for p in [(0,0,0),(.5,.5,0),(.25,.25,.25),(.75,.75,.25),(0,0,.5),(.5,.5,.5),(.25,.25,.75),(.75,.75,.75),(1,1,0),(1,1,.5),(0,0,1),(.5,.5,1),(1,1,1)]:
    p=np.array(p)*a; at.append([round(float(np.hypot(p[0],p[1])),4),round(float(p[2]),4)])
json.dump(dict(nu=nu,nv=nv,W=round(a*np.sqrt(2),4),Hh=a,rho=np.round(rb.reshape(nv,nu),5).tolist(),rs=np.round(rs.reshape(nv,nu),3).tolist(),s=np.round(s.reshape(nv,nu),3).tolist(),atoms=at),open('xcmap.json','w'))
