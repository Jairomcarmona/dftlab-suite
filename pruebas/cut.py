import sys, time, numpy as np
from ase.build import bulk
from common import *
name,a,ke,mode = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
nk = int(sys.argv[5]) if len(sys.argv)>5 else 4
proto={'MgO':'rocksalt','C':'diamond','LiF':'rocksalt','Si':'diamond','GaAs':'zincblende','NaCl':'rocksalt'}[name]
at=bulk(name,proto,a=a)
kw={} if ke<=0 else {'ke_cutoff':ke}
cell=make_cell(at,'gth-dzvp',**kw); kpts=cell.make_kpts([nk]*3)
mf=dft.KRKS(cell,kpts); mf.xc='pbe'
if mode=='mg': mf=mf.multigrid_numint()
t=time.time(); mf.kernel(); em=np.array(mf.mo_energy)*HA; n=cell.nelectron//2
print(name,'ke',ke,'mesh',cell.mesh,mode,'nk',nk,'t',round(time.time()-t,1),'E',round(mf.e_tot,6),'gap_mesh',round(em[:,n:].min()-em[:,:n].max(),3), flush=True)
