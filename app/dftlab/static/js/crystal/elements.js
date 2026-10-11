// elements.js -- periodic-table data for DFT Lab (browser ES module, no dependencies).
// Index = atomic number Z (index 0 is a dummy "X" entry).
// Sources (as distributed with ASE 3.29): IUPAC standard atomic masses,
// covalent radii from Cordero et al., Dalton Trans. 2832 (2008) (2.0 A placeholder for Z>96),
// Jmol and CPK colour schemes.

export const SYMBOLS = ["X", "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn", "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg", "Tl", "Pb", "Bi", "Po", "At", "Rn", "Fr", "Ra", "Ac", "Th", "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm", "Md", "No", "Lr", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds", "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og"];

export const NAMES = ["", "Hydrogen", "Helium", "Lithium", "Beryllium", "Boron", "Carbon", "Nitrogen", "Oxygen", "Fluorine", "Neon", "Sodium", "Magnesium", "Aluminium", "Silicon", "Phosphorus", "Sulfur", "Chlorine", "Argon", "Potassium", "Calcium", "Scandium", "Titanium", "Vanadium", "Chromium", "Manganese", "Iron", "Cobalt", "Nickel", "Copper", "Zinc", "Gallium", "Germanium", "Arsenic", "Selenium", "Bromine", "Krypton", "Rubidium", "Strontium", "Yttrium", "Zirconium", "Niobium", "Molybdenum", "Technetium", "Ruthenium", "Rhodium", "Palladium", "Silver", "Cadmium", "Indium", "Tin", "Antimony", "Tellurium", "Iodine", "Xenon", "Caesium", "Barium", "Lanthanum", "Cerium", "Praseodymium", "Neodymium", "Promethium", "Samarium", "Europium", "Gadolinium", "Terbium", "Dysprosium", "Holmium", "Erbium", "Thulium", "Ytterbium", "Lutetium", "Hafnium", "Tantalum", "Tungsten", "Rhenium", "Osmium", "Iridium", "Platinum", "Gold", "Mercury", "Thallium", "Lead", "Bismuth", "Polonium", "Astatine", "Radon", "Francium", "Radium", "Actinium", "Thorium", "Protactinium", "Uranium", "Neptunium", "Plutonium", "Americium", "Curium", "Berkelium", "Californium", "Einsteinium", "Fermium", "Mendelevium", "Nobelium", "Lawrencium", "Rutherfordium", "Dubnium", "Seaborgium", "Bohrium", "Hassium", "Meitnerium", "Darmastadtium", "Roentgenium", "Copernicium", "Nihonium", "Flerovium", "Moscovium", "Livermorium", "Tennessine", "Oganesson"];

/** Standard atomic masses (amu). */
export const MASSES = [1.0, 1.008, 4.002602, 6.94, 9.012183, 10.81, 12.011, 14.007, 15.999, 18.998403, 20.1797, 22.989769, 24.305, 26.981538, 28.085, 30.973762, 32.06, 35.45, 39.948, 39.0983, 40.078, 44.955908, 47.867, 50.9415, 51.9961, 54.938044, 55.845, 58.933194, 58.6934, 63.546, 65.38, 69.723, 72.63, 74.921595, 78.971, 79.904, 83.798, 85.4678, 87.62, 88.90584, 91.224, 92.90637, 95.95, 97.90721, 101.07, 102.9055, 106.42, 107.8682, 112.414, 114.818, 118.71, 121.76, 127.6, 126.90447, 131.293, 132.905452, 137.327, 138.90547, 140.116, 140.90766, 144.242, 144.91276, 150.36, 151.964, 157.25, 158.92535, 162.5, 164.93033, 167.259, 168.93422, 173.054, 174.9668, 178.49, 180.94788, 183.84, 186.207, 190.23, 192.217, 195.084, 196.966569, 200.592, 204.38, 207.2, 208.9804, 208.98243, 209.98715, 222.01758, 223.01974, 226.02541, 227.02775, 232.0377, 231.03588, 238.02891, 237.04817, 244.06421, 243.06138, 247.07035, 247.07031, 251.07959, 252.083, 257.09511, 258.09843, 259.101, 262.11, 267.122, 268.126, 271.134, 270.133, 269.1338, 278.156, 281.165, 281.166, 285.177, 286.182, 289.19, 289.194, 293.204, 293.208, 294.214];

/** Covalent radii (Angstrom). */
export const COVALENT_RADII = [0.2, 0.31, 0.28, 1.28, 0.96, 0.84, 0.76, 0.71, 0.66, 0.57, 0.58, 1.66, 1.41, 1.21, 1.11, 1.07, 1.05, 1.02, 1.06, 2.03, 1.76, 1.7, 1.6, 1.53, 1.39, 1.39, 1.32, 1.26, 1.24, 1.32, 1.22, 1.22, 1.2, 1.19, 1.2, 1.2, 1.16, 2.2, 1.95, 1.9, 1.75, 1.64, 1.54, 1.47, 1.46, 1.42, 1.39, 1.45, 1.44, 1.42, 1.39, 1.39, 1.38, 1.39, 1.4, 2.44, 2.15, 2.07, 2.04, 2.03, 2.01, 1.99, 1.98, 1.98, 1.96, 1.94, 1.92, 1.92, 1.89, 1.9, 1.87, 1.87, 1.75, 1.7, 1.62, 1.51, 1.44, 1.41, 1.36, 1.36, 1.32, 1.45, 1.46, 1.48, 1.4, 1.5, 1.5, 2.6, 2.21, 2.15, 2.06, 2.0, 1.96, 1.9, 1.87, 1.8, 1.69, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0];

/** Jmol colours as hex strings. */
export const JMOL_COLORS = ["#ff0000", "#ffffff", "#d9ffff", "#cc80ff", "#c2ff00", "#ffb5b5", "#909090", "#3050f8", "#ff0d0d", "#90e050", "#b3e3f5", "#ab5cf2", "#8aff00", "#bfa6a6", "#f0c8a0", "#ff8000", "#ffff30", "#1ff01f", "#80d1e3", "#8f40d4", "#3dff00", "#e6e6e6", "#bfc2c7", "#a6a6ab", "#8a99c7", "#9c7ac7", "#e06633", "#f090a0", "#50d050", "#c88033", "#7d80b0", "#c28f8f", "#668f8f", "#bd80e3", "#ffa100", "#a62929", "#5cb8d1", "#702eb0", "#00ff00", "#94ffff", "#94e0e0", "#73c2c9", "#54b5b5", "#3b9e9e", "#248f8f", "#0a7d8c", "#006985", "#c0c0c0", "#ffd98f", "#a67573", "#668080", "#9e63b5", "#d47a00", "#940094", "#429eb0", "#57178f", "#00c900", "#70d4ff", "#ffffc7", "#d9ffc7", "#c7ffc7", "#a3ffc7", "#8fffc7", "#61ffc7", "#45ffc7", "#30ffc7", "#1fffc7", "#00ff9c", "#00e675", "#00d452", "#00bf38", "#00ab24", "#4dc2ff", "#4da6ff", "#2194d6", "#267dab", "#266696", "#175487", "#d0d0e0", "#ffd123", "#b8b8d0", "#a6544d", "#575961", "#9e4fb5", "#ab5c00", "#754f45", "#428296", "#420066", "#007d00", "#70abfa", "#00baff", "#00a1ff", "#008fff", "#0080ff", "#006bff", "#545cf2", "#785ce3", "#8a4fe3", "#a136d4", "#b31fd4", "#b31fba", "#b30da6", "#bd0d87", "#c70066", "#cc0059", "#d1004f", "#d90045", "#e00038", "#e6002e", "#eb0026", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493"];

/** CPK colours as hex strings. */
export const CPK_COLORS = ["#ff0000", "#ffffff", "#ffc0cb", "#b22222", "#ff1493", "#00ff00", "#c8c8c8", "#8f8fff", "#f00000", "#daa520", "#ff1493", "#0000ff", "#228b22", "#808090", "#daa520", "#ffa500", "#ffc832", "#00ff00", "#ff1493", "#ff1493", "#808090", "#ff1493", "#808090", "#ff1493", "#808090", "#808090", "#ffa500", "#ff1493", "#a52a2a", "#a52a2a", "#a52a2a", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#a52a2a", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#808090", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#a020f0", "#ff1493", "#ff1493", "#ffa500", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#daa520", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ff1493", "#ffffff", "#ff1493", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493", "#ff1493"];

const SYMBOL_TO_Z = new Map();
SYMBOLS.forEach((s, z) => { SYMBOL_TO_Z.set(s, z); SYMBOL_TO_Z.set(s.toLowerCase(), z); });

/**
 * Atomic number from a symbol-like string. Accepts "Fe", "fe", "FE", "Fe2+", "Fe1", "O2-", "Si_pbe".
 * Returns 0 if the element cannot be recognised.
 */
export function atomicNumber(label) {
  if (typeof label === 'number') return label;
  if (label == null) return 0;
  const s = String(label).trim();
  if (SYMBOL_TO_Z.has(s) && s !== 'X') return SYMBOL_TO_Z.get(s);
  const caps = /^([A-Z])([A-Z])(?![A-Za-z])/.exec(s);
  if (caps) {
    const t = caps[1] + caps[2].toLowerCase();
    if (SYMBOL_TO_Z.has(t)) return SYMBOL_TO_Z.get(t);
  }
  const m = /^([A-Za-z])([a-z]?)/.exec(s);
  if (!m) return 0;
  const two = m[1].toUpperCase() + m[2];
  if (m[2] && SYMBOL_TO_Z.has(two)) return SYMBOL_TO_Z.get(two);
  const one = m[1].toUpperCase();
  if (SYMBOL_TO_Z.has(one) && one !== 'X') return SYMBOL_TO_Z.get(one);
  // all-caps two letter symbols such as "FE"
  const m2 = /^([A-Za-z]{2})/.exec(s);
  if (m2) {
    const t = m2[1][0].toUpperCase() + m2[1][1].toLowerCase();
    if (SYMBOL_TO_Z.has(t)) return SYMBOL_TO_Z.get(t);
  }
  return 0;
}

/** Chemical symbol for atomic number Z ("X" when unknown). */
export function symbolOf(z) {
  return SYMBOLS[z] || 'X';
}

export function massOf(z) {
  return MASSES[z] ?? 1.0;
}

export function covalentRadius(z) {
  return COVALENT_RADII[z] ?? 1.5;
}

/** Colour for element Z; scheme = 'jmol' (default) or 'cpk'. */
export function colorOf(z, scheme = 'jmol') {
  const t = scheme === 'cpk' ? CPK_COLORS : JMOL_COLORS;
  return t[z] || '#ff1493';
}

/** Full record for one element. */
export function elementInfo(zOrSymbol) {
  const z = typeof zOrSymbol === 'number' ? zOrSymbol : atomicNumber(zOrSymbol);
  return {
    z,
    symbol: symbolOf(z),
    name: NAMES[z] || '',
    mass: massOf(z),
    covalentRadius: covalentRadius(z),
    color: colorOf(z),
    cpkColor: colorOf(z, 'cpk'),
  };
}
