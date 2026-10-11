import time, numpy as np
from pyscf.pbc import gto, dft
from pyscf.pbc.tools import pyscf_ase, k2gamma
HA=27.211386
def make_cell(at, basis='gth-dzvp', pseudo='gth-pbe', spin=0, **kw):
    cell = gto.Cell(); cell.atom = pyscf_ase.ase_atoms_to_pyscf(at); cell.a = np.array(at.cell[:])
    cell.basis = basis; cell.pseudo=pseudo; cell.verbose=0; cell.spin=spin
    for k,v in kw.items(): setattr(cell,k,v)
    cell.build(); return cell

def realspace_H(cell, kpts, nk, mats):
    """mats: (nk_tot, nao, nao) k-space matrices on the MP mesh -> H(R) list with R vectors"""
    scell, phase = k2gamma.get_phase(cell, kpts)  # phase: (nR, nk)
    nR = phase.shape[0]
    # H(R) = sum_k e^{-ikR} H(k) / Nk  ; phase[R,k]=e^{ikR}/sqrt(Nk)
    HR = np.einsum('Rk,kij->Rij', phase.conj(), mats)/np.sqrt(len(kpts))
    Rs = k2gamma.translation_vectors_for_kmesh(cell, nk) if hasattr(k2gamma,'translation_vectors_for_kmesh') else None
    return HR, Rs

def interp(HR, Rs, kabs):
    ph = np.exp(1j*np.dot(kabs, Rs.T))  # (nk', nR)
    return np.einsum('kR,Rij->kij', ph, HR)
