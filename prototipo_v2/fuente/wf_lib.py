import numpy as np,sisl
N=28
def cube_from_prim(H,kf,n,sign=1):
    g=H.geometry; es=H.eigenstate(kf)
    G=sisl.Grid((N,N,N),lattice=g.lattice,dtype=np.complex128); es.sub(n).wavefunction(G); p=G.grid
    i=np.arange(N); n1,n2,n3=np.meshgrid(i,i,i,indexing='ij')
    F=np.stack([-n1+n2+n3, n1-n2+n3, n1+n2-n3])  # fractional*N in primitive basis (cell rows = a/2*(0,1,1)...)
    R=np.floor_divide(F,N); f=F-R*N
    kR=2*np.pi*(kf[0]*R[0]+kf[1]*R[1]+kf[2]*R[2])
    return p[f[0],f[1],f[2]]*np.exp(sign*1j*kR), es.eig[n]
