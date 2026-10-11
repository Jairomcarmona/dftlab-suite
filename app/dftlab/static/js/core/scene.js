// Turn a DFT Lab cell into atoms/bonds for core/three-view.js drawStructure().
// Bonds that cross the cell boundary end on a smaller "image" atom so the picture stays readable.
import { normalizeCell, cartesianPositions, bonds as findBonds } from '../crystal/symmetry.js';
import { colorOf, covalentRadius } from '../crystal/elements.js';

export function cellScene(cellIn, { scale = 1.15, maxAtoms = 4000, images = true } = {}) {
  const cell = normalizeCell(cellIn);
  const cart = cartesianPositions(cell);
  const atoms = cart.map((p, i) => ({ pos: p, color: colorOf(cell.numbers[i]), r: 0.25 + 0.35 * covalentRadius(cell.numbers[i]), Z: cell.numbers[i], index: i }));
  if (atoms.length > maxAtoms) return { atoms, bonds: [] };
  const bl = findBonds(cell, { scale, filter: (zi, zj, d) => d < 3.6 });
  const bonds = [];
  for (const b of bl) {
    if (b.image.every((x) => x === 0)) { bonds.push([b.i, b.j]); continue; }
    if (!images) continue;
    const p = [0, 1, 2].map((k) => cart[b.i][k] + b.vector[k]);
    atoms.push({ pos: p, color: colorOf(cell.numbers[b.j]), r: 0.6 * (0.25 + 0.35 * covalentRadius(cell.numbers[b.j])), Z: cell.numbers[b.j], index: b.j, image: true });
    bonds.push([b.i, atoms.length - 1]);
  }
  return { atoms, bonds, cell: cell.lattice };
}
