import { loadPyodide } from './rel/pyodide/pyodide.mjs';
import fs from 'fs';
const t0 = Date.now();
const py = await loadPyodide({ indexURL: './rel/pyodide/' });
console.log('pyodide', py.version, 'arranque', ((Date.now() - t0) / 1000).toFixed(1), 's');
const t1 = Date.now();
await py.loadPackage(['numpy', 'scipy', 'micropip', 'matplotlib', 'packaging']);
console.log('numpy+scipy+matplotlib+micropip', ((Date.now() - t1) / 1000).toFixed(1), 's');
const wheel = fs.readFileSync('./whl/ase-3.29.0-py3-none-any.whl');
py.FS.writeFile('/ase-3.29.0-py3-none-any.whl', wheel);
const t2 = Date.now();
await py.runPythonAsync(`
import micropip
await micropip.install('emfs:/ase-3.29.0-py3-none-any.whl', deps=False)
`);
console.log('ase instalado', ((Date.now() - t2) / 1000).toFixed(1), 's');
py.FS.writeFile('/body.py', `
import io, numpy as np
import ase
from ase.build import bulk, fcc111
from ase.neighborlist import neighbor_list
from ase.io import write
si = bulk('Si', 'diamond', a=5.43)
i, j, d = neighbor_list('ijd', si, 2.6)
slab = fcc111('Al', size=(1,1,5), vacuum=10.0, a=4.05)
b = io.StringIO(); write(b, slab, format='extxyz'); ext = b.getvalue()
c = io.BytesIO(); write(c, si, format='cif'); cif = c.getvalue()
dz = sorted(set(round(float(z),3) for z in slab.positions[:,2]))
RES = f"ase {ase.__version__}; Si vecinos<2.6: {len(d)} d={d.mean():.3f}; slab Al(111): {len(slab)} atomos, celda z={slab.cell[2,2]:.3f}, planos z={dz}; extxyz {len(ext)} bytes; cif {len(cif)} bytes"
`);
const out = await py.runPythonAsync(`
import traceback
try:
    exec(open('/body.py').read(), globals())
    print(RES)
except Exception:
    traceback.print_exc()
`);
console.log('total', ((Date.now() - t0) / 1000).toFixed(1), 's');
