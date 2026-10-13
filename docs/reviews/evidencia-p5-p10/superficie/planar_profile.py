import re,struct,sys,json
import numpy as np
RY=13.605693122994; B=0.529177210903
def grid(path):
    raw=open(path,'rb').read();rec=[];o=0
    while o<len(raw):
        n=struct.unpack_from('<i',raw,o)[0];rec.append(raw[o+4:o+4+n]);o+=8+n
    cell=np.frombuffer(rec[0],'<f8').reshape(3,3)*B
    nx,ny,nz,ns=np.frombuffer(rec[1],'<i4')
    d=np.array([np.frombuffer(r,'<f4') for r in rec[2:]]).reshape(ns,nz,ny,nx)
    return cell,d
def profile(d):
    cell,data=grid(d+'/'+d+'.VH')
    out=open(d+'/out').read()
    ef=float(re.findall(r'siesta:\s+Fermi\s*=\s*([-\d.]+)',out)[-1])
    p=data[0].mean(axis=(1,2))*RY
    z=np.arange(len(p))*cell[2,2]/len(p)
    return z,p,ef,cell
if __name__=='__main__':
    for d in sys.argv[1:]:
        z,p,ef,cell=profile(d)
        print(d,'EF',ef,'n',len(p),'c',cell[2,2])
        for i in range(0,len(p),max(1,len(p)//46)): print(f'{z[i]:7.3f} {p[i]:9.4f}')
