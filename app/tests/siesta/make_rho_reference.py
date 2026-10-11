#!/usr/bin/env python3
"""Referencia independiente (numpy, sin el código JS) para fixtures_grid/*.RHO|DRHO → fixtures_grid/reference.json."""
import json, struct, numpy as np, os
HERE = os.path.dirname(os.path.abspath(__file__)); F = os.path.join(HERE, 'fixtures_grid')
def read(path):
    b = open(path, 'rb').read(); o = 0; recs = []
    while o < len(b):
        n = struct.unpack('<i', b[o:o+4])[0]; recs.append(b[o+4:o+4+n]); o += n + 8
    cell = np.frombuffer(recs[0], '<f8').reshape(3, 3)
    nx, ny, nz, ns = struct.unpack('<4i', recs[1])
    rows = np.array([np.frombuffer(r, '<f4') for r in recs[2:]])      # (ns*nz*ny, nx)
    g = rows.reshape(ns, nz, ny, nx).transpose(0, 3, 2, 1)             # [spin][ix][iy][iz]
    return cell, (nx, ny, nz), ns, g.astype(np.float64)
ref = {}
for name in ('mgo.RHO', 'mgo.DRHO'):
    cell, mesh, ns, g = read(os.path.join(F, name))
    vol = abs(np.linalg.det(cell)); pts = [(0,0,0),(1,2,3),(5,7,11),(mesh[0]-1,mesh[1]-1,mesh[2]-1)]
    ref[name] = dict(cellBohr=cell.tolist(), mesh=list(mesh), nspin=ns, integral=float(g[0].sum()*vol/g[0].size),
        vmin=float(g.min()), vmax=float(g.max()), samples=[dict(i=list(p), v=float(g[0][p])) for p in pts],
        avgZ=[float(x) for x in g[0].mean(axis=(0,1))[:6]])
json.dump(ref, open(os.path.join(F, 'reference.json'), 'w'), indent=1)
print('ok', {k: (v['mesh'], round(v['integral'], 6)) for k, v in ref.items()})
