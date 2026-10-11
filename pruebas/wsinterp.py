import numpy as np, scipy.linalg as la, itertools
def build_ws(cell, kpts, nk, mats_list):
    """Real-space AO matrices with Wigner-Seitz minimum-image weights.
    Returns function k_abs -> list of interpolated matrices."""
    A = cell.lattice_vectors(); nk=np.array(nk)
    rng=[np.arange(n) for n in nk]
    Rint = np.array(list(itertools.product(*rng)))
    Rs = Rint@A
    ph = np.exp(-1j*kpts@Rs.T)
    MR = [np.einsum('kR,kij->Rij', ph, M)/len(kpts) for M in mats_list]
    ao_atm = np.array([s[0] for s in cell.ao_labels(fmt=False)])
    tau = cell.atom_coords()
    L = np.diag(nk)@A   # supercell
    shifts = np.array(list(itertools.product([-2,-1,0,1,2],repeat=3)))@L
    nat=len(tau); terms=[]  # (R vector, atom a, atom b, weight, index R)
    for iR,R in enumerate(Rs):
        for a in range(nat):
            for b in range(nat):
                d = R + tau[b]-tau[a] + shifts
                dn = np.linalg.norm(d,axis=1); m=dn.min()
                eq = np.where(dn < m+1e-5)[0]
                for e in eq:
                    terms.append((iR, a, b, 1.0/len(eq), (R+shifts[e])))
    # group by (a,b): mask of AO blocks
    blocks={}
    for iR,a,b,w,Rv in terms: blocks.setdefault((a,b),[]).append((iR,w,Rv))
    idx={a:np.where(ao_atm==a)[0] for a in range(nat)}
    def at_k(k):
        out=[]
        for M in MR:
            Mk=np.zeros(M.shape[1:],complex)
            for (a,b),lst in blocks.items():
                ia,ib=idx[a],idx[b]
                acc=0
                for iR,w,Rv in lst: acc = acc + w*np.exp(1j*k@Rv)*M[iR][np.ix_(ia,ib)]
                Mk[np.ix_(ia,ib)]=acc
            out.append(Mk)
        return out
    return at_k
