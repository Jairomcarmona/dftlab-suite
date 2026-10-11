// kpath.js -- JavaScript port of seekpath 2.2.2 (HPKOT recipe) for DFT Lab.
//
// Y. Hinuma, G. Pizzi, Y. Kumagai, F. Oba, I. Tanaka, "Band structure diagram paths based on
// crystallography", Comput. Mater. Sci. 128, 140 (2017), doi:10.1016/j.commatsci.2016.10.015.
// seekpath: https://github.com/giovannipizzi/seekpath (MIT licence, (c) Giovanni Pizzi);
// band_path_data tables provided by Yoyo Hinuma. Ported function by function:
//   seekpath.hpkot.get_path            -> getPath / getPathFromStandardized
//   seekpath.getpaths.get_explicit_k_path / get_explicit_from_implicit
//   seekpath.getpaths.get_path_orig_cell / get_explicit_k_path_orig_cell
//   seekpath.hpkot.spg_mapping.get_P_matrix / get_primitive
//   seekpath.hpkot.tools.eval_expr / eval_expr_simple / extend_kparam / get_cell_params
// spglib's symmetry dataset is replaced by moyo (setting "Spglib"), whose standardized
// conventional cell (std_cell) reproduces spglib's std_lattice (same Hall setting, same
// lattice vectors and Cartesian orientation). The triclinic case uses a port of spglib's
// Niggli reduction (symmetry.js: niggliReduce).
//
// All lattices are arrays of ROW vectors; reciprocal lattices include the 2*pi factor.

import {
  analyze, det3, inv3, matmul, transpose, vecmat, dot, norm, sub, niggliReduce,
  spacegroupHasInversion, bravaisLattice, reciprocalLattice, normalizeCell,
} from './symmetry.js';

export class EdgeCaseWarning extends Error {}
export class SymmetryDetectionError extends Error {}

// band_path_data (seekpath/hpkot/band_path_data/*/{k_vector_parameters,points,path}.txt)
const BAND_PATH_DATA = {
  aP2: {
    kparams: [],
    points: {
      GAMMA: ["0", "0", "0"],
      Z: ["0", "0", "1/2"],
      Y: ["0", "1/2", "0"],
      X: ["1/2", "0", "0"],
      V: ["1/2", "1/2", "0"],
      U: ["1/2", "0", "1/2"],
      T: ["0", "1/2", "1/2"],
      R: ["1/2", "1/2", "1/2"],
    },
    path: [["GAMMA", "X"], ["Y", "GAMMA"], ["GAMMA", "Z"], ["R", "GAMMA"], ["GAMMA", "T"], ["U", "GAMMA"], ["GAMMA", "V"]],
  },
  aP3: {
    kparams: [],
    points: {
      GAMMA: ["0", "0", "0"],
      Z: ["0", "0", "1/2"],
      Y: ["0", "1/2", "0"],
      Y_2: ["0", "-1/2", "0"],
      X: ["1/2", "0", "0"],
      V_2: ["1/2", "-1/2", "0"],
      U_2: ["-1/2", "0", "1/2"],
      T_2: ["0", "-1/2", "1/2"],
      R_2: ["-1/2", "-1/2", "1/2"],
    },
    path: [["GAMMA", "X"], ["Y", "GAMMA"], ["GAMMA", "Z"], ["R_2", "GAMMA"], ["GAMMA", "T_2"], ["U_2", "GAMMA"], ["GAMMA", "V_2"]],
  },
  cF1: {
    kparams: [],
    points: {
      GAMMA: ["0", "0", "0"],
      X: ["1/2", "0", "1/2"],
      L: ["1/2", "1/2", "1/2"],
      W: ["1/2", "1/4", "3/4"],
      W_2: ["3/4", "1/4", "1/2"],
      K: ["3/8", "3/8", "3/4"],
      U: ["5/8", "1/4", "5/8"],
    },
    path: [["GAMMA", "X"], ["X", "U"], ["K", "GAMMA"], ["GAMMA", "L"], ["L", "W"], ["W", "X"], ["X", "W_2"]],
  },
  cF2: {
    kparams: [],
    points: {
      GAMMA: ["0", "0", "0"],
      X: ["1/2", "0", "1/2"],
      L: ["1/2", "1/2", "1/2"],
      W: ["1/2", "1/4", "3/4"],
      W_2: ["3/4", "1/4", "1/2"],
      K: ["3/8", "3/8", "3/4"],
      U: ["5/8", "1/4", "5/8"],
    },
    path: [["GAMMA", "X"], ["X", "U"], ["K", "GAMMA"], ["GAMMA", "L"], ["L", "W"], ["W", "X"]],
  },
  cI1: {
    kparams: [],
    points: {
      GAMMA: ["0", "0", "0"],
      H: ["1/2", "-1/2", "1/2"],
      P: ["1/4", "1/4", "1/4"],
      N: ["0", "0", "1/2"],
    },
    path: [["GAMMA", "H"], ["H", "N"], ["N", "GAMMA"], ["GAMMA", "P"], ["P", "H"], ["P", "N"]],
  },
  cP1: {
    kparams: [],
    points: {
      GAMMA: ["0", "0", "0"],
      R: ["1/2", "1/2", "1/2"],
      M: ["1/2", "1/2", "0"],
      X: ["0", "1/2", "0"],
      X_1: ["1/2", "0", "0"],
    },
    path: [["GAMMA", "X"], ["X", "M"], ["M", "GAMMA"], ["GAMMA", "R"], ["R", "X"], ["R", "M"], ["M", "X_1"]],
  },
  cP2: {
    kparams: [],
    points: {
      GAMMA: ["0", "0", "0"],
      R: ["1/2", "1/2", "1/2"],
      M: ["1/2", "1/2", "0"],
      X: ["0", "1/2", "0"],
      X_1: ["1/2", "0", "0"],
    },
    path: [["GAMMA", "X"], ["X", "M"], ["M", "GAMMA"], ["GAMMA", "R"], ["R", "X"], ["R", "M"]],
  },
  hP1: {
    kparams: [],
    points: {
      GAMMA: ["0", "0", "0"],
      A: ["0", "0", "1/2"],
      K: ["1/3", "1/3", "0"],
      H: ["1/3", "1/3", "1/2"],
      H_2: ["1/3", "1/3", "-1/2"],
      M: ["1/2", "0", "0"],
      L: ["1/2", "0", "1/2"],
    },
    path: [["GAMMA", "M"], ["M", "K"], ["K", "GAMMA"], ["GAMMA", "A"], ["A", "L"], ["L", "H"], ["H", "A"], ["L", "M"], ["H", "K"], ["K", "H_2"]],
  },
  hP2: {
    kparams: [],
    points: {
      GAMMA: ["0", "0", "0"],
      A: ["0", "0", "1/2"],
      K: ["1/3", "1/3", "0"],
      H: ["1/3", "1/3", "1/2"],
      H_2: ["1/3", "1/3", "-1/2"],
      M: ["1/2", "0", "0"],
      L: ["1/2", "0", "1/2"],
    },
    path: [["GAMMA", "M"], ["M", "K"], ["K", "GAMMA"], ["GAMMA", "A"], ["A", "L"], ["L", "H"], ["H", "A"], ["L", "M"], ["H", "K"]],
  },
  hR1: {
    kparams: [["D", "a*a/4/c/c"], ["Y", "5/6-2*D"], ["N", "1/3+D"]],
    points: {
      GAMMA: ["0", "0", "0"],
      T: ["1/2", "1/2", "1/2"],
      L: ["1/2", "0", "0"],
      L_2: ["0", "-1/2", "0"],
      L_4: ["0", "0", "-1/2"],
      F: ["1/2", "0", "1/2"],
      F_2: ["1/2", "1/2", "0"],
      S_0: ["N", "-N", "0"],
      S_2: ["1-N", "0", "N"],
      S_4: ["N", "0", "-N"],
      S_6: ["1-N", "N", "0"],
      H_0: ["1/2", "-1+Y", "1-Y"],
      H_2: ["Y", "1-Y", "1/2"],
      H_4: ["Y", "1/2", "1-Y"],
      H_6: ["1/2", "1-Y", "-1+Y"],
      M_0: ["N", "-1+Y", "N"],
      M_2: ["1-N", "1-Y", "1-N"],
      M_4: ["Y", "N", "N"],
      M_6: ["1-N", "1-N", "1-Y"],
      M_8: ["N", "N", "-1+Y"],
    },
    path: [["GAMMA", "T"], ["T", "H_2"], ["H_0", "L"], ["L", "GAMMA"], ["GAMMA", "S_0"], ["S_2", "F"], ["F", "GAMMA"]],
  },
  hR2: {
    kparams: [["Z", "1/6-c*c/9/a/a"], ["H", "1/2-2*Z"], ["N", "1/2+Z"]],
    points: {
      GAMMA: ["0", "0", "0"],
      T: ["1/2", "-1/2", "1/2"],
      P_0: ["H", "-1+H", "H"],
      P_2: ["H", "H", "H"],
      R_0: ["1-H", "-H", "-H"],
      M: ["1-N", "-N", "1-N"],
      M_2: ["N", "-1+N", "-1+N"],
      L: ["1/2", "0", "0"],
      F: ["1/2", "-1/2", "0"],
    },
    path: [["GAMMA", "L"], ["L", "T"], ["T", "P_0"], ["P_2", "GAMMA"], ["GAMMA", "F"]],
  },
  mC1: {
    kparams: [["Z", "(2+a/c*cosbeta)/4/sinbeta/sinbeta"], ["H", "1/2-2*Z*c*cosbeta/a"], ["S", "3/4-b*b/4/a/a/sinbeta/sinbeta"], ["P", "S-(3/4-S)*a*cosbeta/c"]],
    points: {
      GAMMA: ["0", "0", "0"],
      Y_2: ["-1/2", "1/2", "0"],
      Y_4: ["1/2", "-1/2", "0"],
      A: ["0", "0", "1/2"],
      M_2: ["-1/2", "1/2", "1/2"],
      V: ["1/2", "0", "0"],
      V_2: ["0", "1/2", "0"],
      L_2: ["0", "1/2", "1/2"],
      C: ["1-S", "1-S", "0"],
      C_2: ["-1+S", "S", "0"],
      C_4: ["S", "-1+S", "0"],
      D: ["-1+P", "P", "1/2"],
      D_2: ["1-P", "1-P", "1/2"],
      E: ["-1+Z", "1-Z", "1-H"],
      E_2: ["-Z", "Z", "H"],
      E_4: ["Z", "-Z", "1-H"],
    },
    path: [["GAMMA", "C"], ["C_2", "Y_2"], ["Y_2", "GAMMA"], ["GAMMA", "M_2"], ["M_2", "D"], ["D_2", "A"], ["A", "GAMMA"], ["L_2", "GAMMA"], ["GAMMA", "V_2"]],
  },
  mC2: {
    kparams: [["Z", "(a*a/b/b+(1+a/c*cosbeta)/sinbeta/sinbeta)/4"], ["M", "(1+a*a/b/b)/4"], ["D", "-a*c*cosbeta/2/b/b"], ["X", "1/2-2*Z*c*cosbeta/a"], ["P", "1+Z-2*M"], ["S", "X-2*D"]],
    points: {
      GAMMA: ["0", "0", "0"],
      Y: ["1/2", "1/2", "0"],
      A: ["0", "0", "1/2"],
      M: ["1/2", "1/2", "1/2"],
      V_2: ["0", "1/2", "0"],
      L_2: ["0", "1/2", "1/2"],
      F: ["-1+P", "1-P", "1-S"],
      F_2: ["1-P", "P", "S"],
      F_4: ["P", "1-P", "1-S"],
      H: ["-Z", "Z", "X"],
      H_2: ["Z", "1-Z", "1-X"],
      H_4: ["Z", "-Z", "1-X"],
      G: ["-M", "M", "D"],
      G_2: ["M", "1-M", "-D"],
      G_4: ["M", "-M", "-D"],
      G_6: ["1-M", "M", "D"],
    },
    path: [["GAMMA", "Y"], ["Y", "M"], ["M", "A"], ["A", "GAMMA"], ["L_2", "GAMMA"], ["GAMMA", "V_2"]],
  },
  mC3: {
    kparams: [["Z", "(a*a/b/b+(1+a/c*cosbeta)/sinbeta/sinbeta)/4"], ["R", "1-Z*b*b/a/a"], ["E", "1/2-2*Z*c*cosbeta/a"], ["F", "E/2+a*a/4/b/b+a*c*cosbeta/2/b/b"], ["U", "2*F-Z"], ["W", "c/2/a/cosbeta*(1-4*U+a*a*sinbeta*sinbeta/b/b)"], ["D", "-1/4+W/2-Z*c*cosbeta/a"]],
    points: {
      GAMMA: ["0", "0", "0"],
      Y: ["1/2", "1/2", "0"],
      A: ["0", "0", "1/2"],
      M_2: ["-1/2", "1/2", "1/2"],
      V: ["1/2", "0", "0"],
      V_2: ["0", "1/2", "0"],
      L_2: ["0", "1/2", "1/2"],
      I: ["-1+R", "R", "1/2"],
      I_2: ["1-R", "1-R", "1/2"],
      K: ["-U", "U", "W"],
      K_2: ["-1+U", "1-U", "1-W"],
      K_4: ["1-U", "U", "W"],
      H: ["-Z", "Z", "E"],
      H_2: ["Z", "1-Z", "1-E"],
      H_4: ["Z", "-Z", "1-E"],
      N: ["-F", "F", "D"],
      N_2: ["F", "1-F", "-D"],
      N_4: ["F", "-F", "-D"],
      N_6: ["1-F", "F", "D"],
    },
    path: [["GAMMA", "A"], ["A", "I_2"], ["I", "M_2"], ["M_2", "GAMMA"], ["GAMMA", "Y"], ["L_2", "GAMMA"], ["GAMMA", "V_2"]],
  },
  mP1: {
    kparams: [["Y", "(1+a/c*cosbeta)/2/sinbeta/sinbeta"], ["N", "1/2+Y*c*cosbeta/a"]],
    points: {
      GAMMA: ["0", "0", "0"],
      Z: ["0", "1/2", "0"],
      B: ["0", "0", "1/2"],
      B_2: ["0", "0", "-1/2"],
      Y: ["1/2", "0", "0"],
      Y_2: ["-1/2", "0", "0"],
      C: ["1/2", "1/2", "0"],
      C_2: ["-1/2", "1/2", "0"],
      D: ["0", "1/2", "1/2"],
      D_2: ["0", "1/2", "-1/2"],
      A: ["-1/2", "0", "1/2"],
      E: ["-1/2", "1/2", "1/2"],
      H: ["-Y", "0", "1-N"],
      H_2: ["-1+Y", "0", "N"],
      H_4: ["-Y", "0", "-N"],
      M: ["-Y", "1/2", "1-N"],
      M_2: ["-1+Y", "1/2", "N"],
      M_4: ["-Y", "1/2", "-N"],
    },
    path: [["GAMMA", "Z"], ["Z", "D"], ["D", "B"], ["B", "GAMMA"], ["GAMMA", "A"], ["A", "E"], ["E", "Z"], ["Z", "C_2"], ["C_2", "Y_2"], ["Y_2", "GAMMA"]],
  },
  oA1: {
    kparams: [["X", "(1+b*b/c/c)/4"]],
    points: {
      GAMMA: ["0", "0", "0"],
      Y: ["-1/2", "1/2", "0"],
      T: ["-1/2", "1/2", "1/2"],
      Z: ["0", "0", "1/2"],
      S: ["0", "1/2", "0"],
      R: ["0", "1/2", "1/2"],
      SIGMA_0: ["X", "X", "0"],
      C_0: ["-X", "1-X", "0"],
      A_0: ["X", "X", "1/2"],
      E_0: ["-X", "1-X", "1/2"],
    },
    path: [["GAMMA", "Y"], ["Y", "C_0"], ["SIGMA_0", "GAMMA"], ["GAMMA", "Z"], ["Z", "A_0"], ["E_0", "T"], ["T", "Y"], ["GAMMA", "S"], ["S", "R"], ["R", "Z"], ["Z", "T"]],
  },
  oA2: {
    kparams: [["X", "(1+c*c/b/b)/4"]],
    points: {
      GAMMA: ["0", "0", "0"],
      Y: ["1/2", "1/2", "0"],
      T: ["1/2", "1/2", "1/2"],
      T_2: ["1/2", "1/2", "-1/2"],
      Z: ["0", "0", "1/2"],
      Z_2: ["0", "0", "-1/2"],
      S: ["0", "1/2", "0"],
      R: ["0", "1/2", "1/2"],
      R_2: ["0", "1/2", "-1/2"],
      DELTA_0: ["-X", "X", "0"],
      F_0: ["X", "1-X", "0"],
      B_0: ["-X", "X", "1/2"],
      B_2: ["-X", "X", "-1/2"],
      G_0: ["X", "1-X", "1/2"],
      G_2: ["X", "1-X", "-1/2"],
    },
    path: [["GAMMA", "Y"], ["Y", "F_0"], ["DELTA_0", "GAMMA"], ["GAMMA", "Z"], ["Z", "B_0"], ["G_0", "T"], ["T", "Y"], ["GAMMA", "S"], ["S", "R"], ["R", "Z"], ["Z", "T"]],
  },
  oC1: {
    kparams: [["X", "(1+a*a/b/b)/4"]],
    points: {
      GAMMA: ["0", "0", "0"],
      Y: ["-1/2", "1/2", "0"],
      T: ["-1/2", "1/2", "1/2"],
      Z: ["0", "0", "1/2"],
      S: ["0", "1/2", "0"],
      R: ["0", "1/2", "1/2"],
      SIGMA_0: ["X", "X", "0"],
      C_0: ["-X", "1-X", "0"],
      A_0: ["X", "X", "1/2"],
      E_0: ["-X", "1-X", "1/2"],
    },
    path: [["GAMMA", "Y"], ["Y", "C_0"], ["SIGMA_0", "GAMMA"], ["GAMMA", "Z"], ["Z", "A_0"], ["E_0", "T"], ["T", "Y"], ["GAMMA", "S"], ["S", "R"], ["R", "Z"], ["Z", "T"]],
  },
  oC2: {
    kparams: [["X", "(1+b*b/a/a)/4"]],
    points: {
      GAMMA: ["0", "0", "0"],
      Y: ["1/2", "1/2", "0"],
      T: ["1/2", "1/2", "1/2"],
      T_2: ["1/2", "1/2", "-1/2"],
      Z: ["0", "0", "1/2"],
      Z_2: ["0", "0", "-1/2"],
      S: ["0", "1/2", "0"],
      R: ["0", "1/2", "1/2"],
      R_2: ["0", "1/2", "-1/2"],
      DELTA_0: ["-X", "X", "0"],
      F_0: ["X", "1-X", "0"],
      B_0: ["-X", "X", "1/2"],
      B_2: ["-X", "X", "-1/2"],
      G_0: ["X", "1-X", "1/2"],
      G_2: ["X", "1-X", "-1/2"],
    },
    path: [["GAMMA", "Y"], ["Y", "F_0"], ["DELTA_0", "GAMMA"], ["GAMMA", "Z"], ["Z", "B_0"], ["G_0", "T"], ["T", "Y"], ["GAMMA", "S"], ["S", "R"], ["R", "Z"], ["Z", "T"]],
  },
  oF1: {
    kparams: [["J", "(1+a*a/b/b-a*a/c/c)/4"], ["H", "(1+a*a/b/b+a*a/c/c)/4"]],
    points: {
      GAMMA: ["0", "0", "0"],
      T: ["1", "1/2", "1/2"],
      Z: ["1/2", "1/2", "0"],
      Y: ["1/2", "0", "1/2"],
      SIGMA_0: ["0", "H", "H"],
      U_0: ["1", "1-H", "1-H"],
      A_0: ["1/2", "1/2+J", "J"],
      C_0: ["1/2", "1/2-J", "1-J"],
      L: ["1/2", "1/2", "1/2"],
    },
    path: [["GAMMA", "Y"], ["Y", "T"], ["T", "Z"], ["Z", "GAMMA"], ["GAMMA", "SIGMA_0"], ["U_0", "T"], ["Y", "C_0"], ["A_0", "Z"], ["GAMMA", "L"]],
  },
  oF2: {
    kparams: [["J", "(1+c*c/a/a-c*c/b/b)/4"], ["K", "(1+c*c/a/a+c*c/b/b)/4"]],
    points: {
      GAMMA: ["0", "0", "0"],
      T: ["0", "1/2", "1/2"],
      Z: ["1/2", "1/2", "1"],
      Y: ["1/2", "0", "1/2"],
      LAMBDA_0: ["K", "K", "0"],
      Q_0: ["1-K", "1-K", "1"],
      G_0: ["1/2-J", "1-J", "1/2"],
      H_0: ["1/2+J", "J", "1/2"],
      L: ["1/2", "1/2", "1/2"],
    },
    path: [["GAMMA", "T"], ["T", "Z"], ["Z", "Y"], ["Y", "GAMMA"], ["GAMMA", "LAMBDA_0"], ["Q_0", "Z"], ["T", "G_0"], ["H_0", "Y"], ["GAMMA", "L"]],
  },
  oF3: {
    kparams: [["H", "(1+a*a/b/b-a*a/c/c)/4"], ["K", "(1+b*b/a/a-b*b/c/c)/4"], ["P", "(1+c*c/b/b-c*c/a/a)/4"]],
    points: {
      GAMMA: ["0", "0", "0"],
      T: ["0", "1/2", "1/2"],
      Z: ["1/2", "1/2", "0"],
      Y: ["1/2", "0", "1/2"],
      A_0: ["1/2", "1/2+H", "H"],
      C_0: ["1/2", "1/2-H", "1-H"],
      B_0: ["1/2+K", "1/2", "K"],
      D_0: ["1/2-K", "1/2", "1-K"],
      G_0: ["P", "1/2+P", "1/2"],
      H_0: ["1-P", "1/2-P", "1/2"],
      L: ["1/2", "1/2", "1/2"],
    },
    path: [["GAMMA", "Y"], ["Y", "C_0"], ["A_0", "Z"], ["Z", "B_0"], ["D_0", "T"], ["T", "G_0"], ["H_0", "Y"], ["T", "GAMMA"], ["GAMMA", "Z"], ["GAMMA", "L"]],
  },
  oI1: {
    kparams: [["Z", "(1+a*a/c/c)/4"], ["H", "(1+b*b/c/c)/4"], ["D", "(b*b-a*a)/4/c/c"], ["N", "(a*a+b*b)/4/c/c"]],
    points: {
      GAMMA: ["0", "0", "0"],
      X: ["1/2", "1/2", "-1/2"],
      S: ["1/2", "0", "0"],
      R: ["0", "1/2", "0"],
      T: ["0", "0", "1/2"],
      W: ["1/4", "1/4", "1/4"],
      SIGMA_0: ["-Z", "Z", "Z"],
      F_2: ["Z", "1-Z", "-Z"],
      Y_0: ["H", "-H", "H"],
      U_0: ["1-H", "H", "-H"],
      L_0: ["-N", "N", "1/2-D"],
      M_0: ["N", "-N", "1/2+D"],
      J_0: ["1/2-D", "1/2+D", "-N"],
    },
    path: [["GAMMA", "X"], ["X", "F_2"], ["SIGMA_0", "GAMMA"], ["GAMMA", "Y_0"], ["U_0", "X"], ["GAMMA", "R"], ["R", "W"], ["W", "S"], ["S", "GAMMA"], ["GAMMA", "T"], ["T", "W"]],
  },
  oI2: {
    kparams: [["Z", "(1+b*b/a/a)/4"], ["H", "(1+c*c/a/a)/4"], ["D", "(c*c-b*b)/4/a/a"], ["N", "(b*b+c*c)/4/a/a"]],
    points: {
      GAMMA: ["0", "0", "0"],
      X: ["-1/2", "1/2", "1/2"],
      S: ["1/2", "0", "0"],
      R: ["0", "1/2", "0"],
      T: ["0", "0", "1/2"],
      W: ["1/4", "1/4", "1/4"],
      Y_0: ["Z", "-Z", "Z"],
      U_2: ["-Z", "Z", "1-Z"],
      LAMBDA_0: ["H", "H", "-H"],
      G_2: ["-H", "1-H", "H"],
      K: ["1/2-D", "-N", "N"],
      K_2: ["1/2+D", "N", "-N"],
      K_4: ["-N", "1/2-D", "1/2+D"],
    },
    path: [["GAMMA", "X"], ["X", "U_2"], ["Y_0", "GAMMA"], ["GAMMA", "LAMBDA_0"], ["G_2", "X"], ["GAMMA", "R"], ["R", "W"], ["W", "S"], ["S", "GAMMA"], ["GAMMA", "T"], ["T", "W"]],
  },
  oI3: {
    kparams: [["Z", "(1+c*c/b/b)/4"], ["Y", "(1+a*a/b/b)/4"], ["D", "(a*a-c*c)/4/b/b"], ["M", "(c*c+a*a)/4/b/b"]],
    points: {
      GAMMA: ["0", "0", "0"],
      X: ["1/2", "-1/2", "1/2"],
      S: ["1/2", "0", "0"],
      R: ["0", "1/2", "0"],
      T: ["0", "0", "1/2"],
      W: ["1/4", "1/4", "1/4"],
      SIGMA_0: ["-Y", "Y", "Y"],
      F_0: ["Y", "-Y", "1-Y"],
      LAMBDA_0: ["Z", "Z", "-Z"],
      G_0: ["1-Z", "-Z", "Z"],
      V_0: ["M", "1/2-D", "-M"],
      H_0: ["-M", "1/2+D", "M"],
      H_2: ["1/2+D", "-M", "1/2-D"],
    },
    path: [["GAMMA", "X"], ["X", "F_0"], ["SIGMA_0", "GAMMA"], ["GAMMA", "LAMBDA_0"], ["G_0", "X"], ["GAMMA", "R"], ["R", "W"], ["W", "S"], ["S", "GAMMA"], ["GAMMA", "T"], ["T", "W"]],
  },
  oP1: {
    kparams: [],
    points: {
      GAMMA: ["0", "0", "0"],
      X: ["1/2", "0", "0"],
      Z: ["0", "0", "1/2"],
      U: ["1/2", "0", "1/2"],
      Y: ["0", "1/2", "0"],
      S: ["1/2", "1/2", "0"],
      T: ["0", "1/2", "1/2"],
      R: ["1/2", "1/2", "1/2"],
    },
    path: [["GAMMA", "X"], ["X", "S"], ["S", "Y"], ["Y", "GAMMA"], ["GAMMA", "Z"], ["Z", "U"], ["U", "R"], ["R", "T"], ["T", "Z"], ["X", "U"], ["Y", "T"], ["S", "R"]],
  },
  tI1: {
    kparams: [["H", "(1+c*c/a/a)/4"]],
    points: {
      GAMMA: ["0", "0", "0"],
      M: ["-1/2", "1/2", "1/2"],
      X: ["0", "0", "1/2"],
      P: ["1/4", "1/4", "1/4"],
      Z: ["H", "H", "-H"],
      Z_0: ["-H", "1-H", "H"],
      N: ["0", "1/2", "0"],
    },
    path: [["GAMMA", "X"], ["X", "M"], ["M", "GAMMA"], ["GAMMA", "Z"], ["Z_0", "M"], ["X", "P"], ["P", "N"], ["N", "GAMMA"]],
  },
  tI2: {
    kparams: [["H", "(1+a*a/c/c)/4"], ["Z", "a*a/2/c/c"]],
    points: {
      GAMMA: ["0", "0", "0"],
      M: ["1/2", "1/2", "-1/2"],
      X: ["0", "0", "1/2"],
      P: ["1/4", "1/4", "1/4"],
      N: ["0", "1/2", "0"],
      S_0: ["-H", "H", "H"],
      S: ["H", "1-H", "-H"],
      R: ["-Z", "Z", "1/2"],
      G: ["1/2", "1/2", "-Z"],
    },
    path: [["GAMMA", "X"], ["X", "P"], ["P", "N"], ["N", "GAMMA"], ["GAMMA", "M"], ["M", "S"], ["S_0", "GAMMA"], ["X", "R"], ["G", "M"]],
  },
  tP1: {
    kparams: [],
    points: {
      GAMMA: ["0", "0", "0"],
      Z: ["0", "0", "1/2"],
      M: ["1/2", "1/2", "0"],
      A: ["1/2", "1/2", "1/2"],
      R: ["0", "1/2", "1/2"],
      X: ["0", "1/2", "0"],
    },
    path: [["GAMMA", "X"], ["X", "M"], ["M", "GAMMA"], ["GAMMA", "Z"], ["Z", "R"], ["R", "A"], ["A", "Z"], ["X", "R"], ["M", "A"]],
  },
};

export { BAND_PATH_DATA };

// ---------------------------------------------------------------------------
// seekpath.hpkot.tools
// ---------------------------------------------------------------------------

/** eval_expr_simple: numeric literals used in points.txt, or an (extended) k-parameter. */
export function evalExprSimple(expr, kparam) {
  switch (expr) {
    case '0': return 0.0;
    case '1/2': return 1.0 / 2.0;
    case '1': return 1.0;
    case '-1/2': return -1.0 / 2.0;
    case '1/4': return 1.0 / 4.0;
    case '3/8': return 3.0 / 8.0;
    case '3/4': return 3.0 / 4.0;
    case '5/8': return 5.0 / 8.0;
    case '1/3': return 1.0 / 3.0;
    default:
      if (Object.prototype.hasOwnProperty.call(kparam, expr)) return kparam[expr];
      throw new Error(`Asking for evaluation of symbol '${expr}' in evalExprSimple but this has not been defined or not yet computed`);
  }
}

/** extend_kparam: adds -x, 1-x, -1+x, 1/2-x, 1/2+x for each k-parameter x. */
export function extendKparam(kparam) {
  const out = {};
  for (const [key, val] of Object.entries(kparam)) {
    out[key] = val;
    out[`-${key}`] = -val;
    out[`1-${key}`] = 1.0 - val;
    out[`-1+${key}`] = -1.0 + val;
    out[`1/2-${key}`] = 1.0 / 2.0 - val;
    out[`1/2+${key}`] = 1.0 / 2.0 + val;
  }
  return out;
}

// eval_expr: hard-coded table of the expressions appearing in k_vector_parameters.txt
const need = (kp, k) => {
  if (!Object.prototype.hasOwnProperty.call(kp, k)) {
    throw new Error(`Asking for evaluation of symbol '${k}' but this has not been defined or not yet computed`);
  }
  return kp[k];
};
const EXPRESSIONS = {
  '(a*a/b/b+(1+a/c*cosbeta)/sinbeta/sinbeta)/4': (v) => (v.a * v.a / v.b / v.b + (1.0 + v.a / v.c * v.cosbeta) / v.sinbeta / v.sinbeta) / 4.0,
  '1-Z*b*b/a/a': (v, k) => 1.0 - need(k, 'Z') * v.b * v.b / v.a / v.a,
  '1/2-2*Z*c*cosbeta/a': (v, k) => 1.0 / 2.0 - 2.0 * need(k, 'Z') * v.c * v.cosbeta / v.a,
  'E/2+a*a/4/b/b+a*c*cosbeta/2/b/b': (v, k) => need(k, 'E') / 2.0 + v.a * v.a / 4.0 / v.b / v.b + v.a * v.c * v.cosbeta / 2.0 / v.b / v.b,
  '2*F-Z': (v, k) => 2.0 * need(k, 'F') - need(k, 'Z'),
  'c/2/a/cosbeta*(1-4*U+a*a*sinbeta*sinbeta/b/b)': (v, k) => v.c / 2.0 / v.a / v.cosbeta * (1.0 - 4.0 * need(k, 'U') + v.a * v.a * v.sinbeta * v.sinbeta / v.b / v.b),
  '-1/4+W/2-Z*c*cosbeta/a': (v, k) => -1.0 / 4.0 + need(k, 'W') / 2.0 - need(k, 'Z') * v.c * v.cosbeta / v.a,
  '(2+a/c*cosbeta)/4/sinbeta/sinbeta': (v) => (2.0 + v.a / v.c * v.cosbeta) / 4.0 / v.sinbeta / v.sinbeta,
  '3/4-b*b/4/a/a/sinbeta/sinbeta': (v) => 3.0 / 4.0 - v.b * v.b / 4.0 / v.a / v.a / v.sinbeta / v.sinbeta,
  'S-(3/4-S)*a*cosbeta/c': (v, k) => need(k, 'S') - (3.0 / 4.0 - need(k, 'S')) * v.a * v.cosbeta / v.c,
  '(1+a*a/b/b)/4': (v) => (1.0 + v.a * v.a / v.b / v.b) / 4.0,
  '-a*c*cosbeta/2/b/b': (v) => -v.a * v.c * v.cosbeta / 2.0 / v.b / v.b,
  '1+Z-2*M': (v, k) => 1.0 + need(k, 'Z') - 2.0 * need(k, 'M'),
  'X-2*D': (v, k) => need(k, 'X') - 2 * need(k, 'D'),
  '(1+a/c*cosbeta)/2/sinbeta/sinbeta': (v) => (1.0 + v.a / v.c * v.cosbeta) / 2.0 / v.sinbeta / v.sinbeta,
  '1/2+Y*c*cosbeta/a': (v, k) => 1.0 / 2.0 + need(k, 'Y') * v.c * v.cosbeta / v.a,
  'a*a/4/c/c': (v) => v.a * v.a / 4.0 / v.c / v.c,
  '5/6-2*D': (v, k) => 5.0 / 6.0 - 2.0 * need(k, 'D'),
  '1/3+D': (v, k) => 1.0 / 3.0 + need(k, 'D'),
  '1/6-c*c/9/a/a': (v) => 1.0 / 6.0 - v.c * v.c / 9.0 / v.a / v.a,
  '1/2-2*Z': (v, k) => 1.0 / 2.0 - 2.0 * need(k, 'Z'),
  '1/2+Z': (v, k) => 1.0 / 2.0 + need(k, 'Z'),
  '(1+b*b/c/c)/4': (v) => (1.0 + v.b * v.b / v.c / v.c) / 4.0,
  '(1+c*c/b/b)/4': (v) => (1.0 + v.c * v.c / v.b / v.b) / 4.0,
  '(1+b*b/a/a)/4': (v) => (1.0 + v.b * v.b / v.a / v.a) / 4.0,
  '(1+a*a/b/b-a*a/c/c)/4': (v) => (1.0 + v.a * v.a / v.b / v.b - v.a * v.a / v.c / v.c) / 4.0,
  '(1+a*a/b/b+a*a/c/c)/4': (v) => (1.0 + v.a * v.a / v.b / v.b + v.a * v.a / v.c / v.c) / 4.0,
  '(1+c*c/a/a-c*c/b/b)/4': (v) => (1.0 + v.c * v.c / v.a / v.a - v.c * v.c / v.b / v.b) / 4.0,
  '(1+c*c/a/a+c*c/b/b)/4': (v) => (1.0 + v.c * v.c / v.a / v.a + v.c * v.c / v.b / v.b) / 4.0,
  '(1+b*b/a/a-b*b/c/c)/4': (v) => (1.0 + v.b * v.b / v.a / v.a - v.b * v.b / v.c / v.c) / 4.0,
  '(1+c*c/b/b-c*c/a/a)/4': (v) => (1.0 + v.c * v.c / v.b / v.b - v.c * v.c / v.a / v.a) / 4.0,
  '(1+a*a/c/c)/4': (v) => (1.0 + v.a * v.a / v.c / v.c) / 4.0,
  '(b*b-a*a)/4/c/c': (v) => (v.b * v.b - v.a * v.a) / 4.0 / v.c / v.c,
  '(a*a+b*b)/4/c/c': (v) => (v.a * v.a + v.b * v.b) / 4.0 / v.c / v.c,
  '(1+c*c/a/a)/4': (v) => (1.0 + v.c * v.c / v.a / v.a) / 4.0,
  '(c*c-b*b)/4/a/a': (v) => (v.c * v.c - v.b * v.b) / 4.0 / v.a / v.a,
  '(b*b+c*c)/4/a/a': (v) => (v.b * v.b + v.c * v.c) / 4.0 / v.a / v.a,
  '(a*a-c*c)/4/b/b': (v) => (v.a * v.a - v.c * v.c) / 4.0 / v.b / v.b,
  '(c*c+a*a)/4/b/b': (v) => (v.c * v.c + v.a * v.a) / 4.0 / v.b / v.b,
  'a*a/2/c/c': (v) => v.a * v.a / 2.0 / v.c / v.c,
};

/** eval_expr: value of a k-parameter expression for cell parameters a,b,c,cos(alpha,beta,gamma). */
export function evalExpr(expr, a, b, c, cosalpha, cosbeta, cosgamma, kparam) {
  const sinbeta = Math.sqrt(1.0 - cosbeta ** 2);
  const f = EXPRESSIONS[expr];
  if (!f) throw new Error(`Unknown expression, define a new case: ${expr}`);
  return f({ a, b, c, cosalpha, cosbeta, cosgamma, sinbeta }, kparam);
}

/** get_cell_params: (a, b, c, cosalpha, cosbeta, cosgamma) of a lattice given as rows. */
export function getCellParams(cell) {
  const [v1, v2, v3] = cell;
  const a = Math.sqrt(v1[0] ** 2 + v1[1] ** 2 + v1[2] ** 2);
  const b = Math.sqrt(v2[0] ** 2 + v2[1] ** 2 + v2[2] ** 2);
  const c = Math.sqrt(v3[0] ** 2 + v3[1] ** 2 + v3[2] ** 2);
  return [a, b, c, dot(v2, v3) / b / c, dot(v1, v3) / a / c, dot(v1, v2) / a / b];
}

/** get_reciprocal_cell_rows: rows G with dot(real, G^T) = 2 pi I. */
export function getReciprocalCellRows(realCell) {
  return reciprocalLattice(realCell, true);
}
export const getRealCellFromReciprocalRows = getReciprocalCellRows;

/** get_path_data: {kparamDef: [[name, expr]], pointsDef: {label: [e1,e2,e3]}, path: [[from,to]]}. */
export function getPathData(extBravais) {
  const d = BAND_PATH_DATA[extBravais];
  if (!d) throw new Error(`Unknown extended Bravais lattice ${extBravais}`);
  return {
    kparamDef: d.kparams.map((x) => x.slice()),
    pointsDef: Object.fromEntries(Object.entries(d.points).map(([k, v]) => [k, v.slice()])),
    path: d.path.map((x) => x.slice()),
  };
}

// ---------------------------------------------------------------------------
// seekpath.hpkot.spg_mapping
// ---------------------------------------------------------------------------

/**
 * get_P_matrix (HPKOT Table 3): (a_P, b_P, c_P) = (a, b, c) P ; x_P = P^-1 x.
 * Returns {P, invP} as arrays of rows.
 */
export function getPMatrix(bravais) {
  const h = (m, f) => m.map((r) => r.map((x) => x * f));
  const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  switch (bravais) {
    case 'cP': case 'tP': case 'hP': case 'oP': case 'mP': case 'aP':
      return { P: I, invP: I.map((r) => r.slice()) };
    case 'cF': case 'oF':
      return { P: h([[0, 1, 1], [1, 0, 1], [1, 1, 0]], 0.5), invP: [[-1, 1, 1], [1, -1, 1], [1, 1, -1]] };
    case 'cI': case 'tI': case 'oI':
      return { P: h([[-1, 1, 1], [1, -1, 1], [1, 1, -1]], 0.5), invP: [[0, 1, 1], [1, 0, 1], [1, 1, 0]] };
    case 'hR':
      return { P: h([[2, -1, -1], [1, 1, -2], [1, 1, 1]], 1.0 / 3.0), invP: [[1, 0, 1], [-1, 1, 1], [0, -1, 1]] };
    case 'oC':
      return { P: h([[1, 1, 0], [-1, 1, 0], [0, 0, 2]], 0.5), invP: [[1, -1, 0], [1, 1, 0], [0, 0, 1]] };
    case 'oA':
      return { P: h([[0, 0, 2], [1, 1, 0], [-1, 1, 0]], 0.5), invP: [[0, 1, -1], [0, 1, 1], [1, 0, 0]] };
    case 'mC':
      return { P: h([[1, -1, 0], [1, 1, 0], [0, 0, 2]], 0.5), invP: [[1, 1, 0], [-1, 1, 0], [0, 0, 1]] };
    default:
      throw new Error(`Invalid bravais_lattice ${bravais}`);
  }
}

const pymod = (x, m) => ((x % m) + m) % m;

/**
 * get_primitive: primitive cell from a crystallographic conventional cell (rows).
 * Returns {lattice, positions, types, P, invP, mapping}.
 */
export function getPrimitive({ lattice, positions, types }, bravais, wrapToZeroOne = false) {
  const threshold = 1.0e-6;
  const { P, invP } = getPMatrix(bravais);
  const volumeRatio = Math.round(det3(invP));
  const primLattice = transpose(matmul(transpose(lattice), P));
  let primPositions = positions.map((x) => [dot(invP[0], x), dot(invP[1], x), dot(invP[2], x)]);
  const n = primPositions.length;
  const close = (u, v) => [0, 1, 2].every((k) => Math.abs(pymod(u[k] - v[k] + 0.5, 1.0) - 0.5) < threshold);
  const groupsOf = [];
  for (let i = 0; i < n; i++) {
    const g = [];
    for (let j = 0; j < n; j++) if (close(primPositions[j], primPositions[i])) g.push(j);
    groupsOf.push(g.join(','));
  }
  const count = new Map();
  for (const g of groupsOf) count.set(g, (count.get(g) || 0) + 1);
  const wrong = [...count.entries()].filter(([, c]) => c !== volumeRatio).map(([g]) => `(${g})`);
  if (wrong.length) {
    throw new Error(`Problem creating primitive cell, I found the following group of atoms with len != ${volumeRatio}: ${wrong.join(', ')}`);
  }
  const groups = [...count.keys()].map((g) => g.split(',').map(Number));
  groups.sort((x, y) => { for (let k = 0; k < Math.min(x.length, y.length); k++) if (x[k] !== y[k]) return x[k] - y[k]; return x.length - y.length; });
  const bad = groups.filter((g) => new Set(g.map((i) => types[i])).size !== 1);
  if (bad.length) {
    throw new Error(`The following ids of atoms go on top of each other, but they are of different type! ${bad.map((g) => `(${g})`).join(', ')}`);
  }
  const mapping = new Array(n).fill(-1);
  groups.forEach((g, pi) => g.forEach((i) => { mapping[i] = pi; }));
  const chosen = groups.map((g) => g[0]);
  primPositions = chosen.map((i) => primPositions[i]);
  if (wrapToZeroOne) primPositions = primPositions.map((p) => p.map((x) => pymod(x, 1.0)));
  return { lattice: primLattice, positions: primPositions, types: chosen.map((i) => types[i]), P, invP, mapping };
}

// ---------------------------------------------------------------------------
// seekpath.hpkot.get_path
// ---------------------------------------------------------------------------

const HP1_GROUPS = new Set([143, 144, 145, 146, 147, 148, 149, 151, 153, 157, 159, 160, 161, 162, 163]);

/**
 * Core of HPKOT get_path, starting from an spglib-like standardized conventional cell.
 * std = {conv_lattice, conv_positions, conv_types, spacegroup_number,
 *        spacegroup_international?, rotation_matrix?, transformation_matrix?}
 * options: {withTimeReversal=true, threshold=1e-7}
 */
export function getPathFromStandardized(std, { withTimeReversal = true, threshold = 1.0e-7 } = {}) {
  const warnings = [];
  const warn = (msg) => warnings.push(msg);
  let convLattice = std.conv_lattice.map((v) => v.slice());
  let convPositions = std.conv_positions.map((v) => v.slice());
  const convTypes = std.conv_types.slice();
  const [a, b, c, cosalpha, cosbeta, cosgamma] = getCellParams(convLattice);
  const spgrpNum = std.spacegroup_number;
  const transfMatrix = std.transformation_matrix || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const volumeConvWrtOriginal = det3(transfMatrix);

  const bravaisLattice_ = bravaisLattice(spgrpNum);
  const hasInv = spacegroupHasInversion(spgrpNum);
  let extBravais;

  if (bravaisLattice_ === 'cP') {
    if (spgrpNum >= 195 && spgrpNum <= 206) extBravais = 'cP1';
    else if (spgrpNum >= 207 && spgrpNum <= 230) extBravais = 'cP2';
    else throw new Error('Internal error! should be cP, but the spacegroup number is not in the correct range');
  } else if (bravaisLattice_ === 'cF') {
    if (spgrpNum >= 195 && spgrpNum <= 206) extBravais = 'cF1';
    else if (spgrpNum >= 207 && spgrpNum <= 230) extBravais = 'cF2';
    else throw new Error('Internal error! should be cF, but the spacegroup number is not in the correct range');
  } else if (bravaisLattice_ === 'cI') {
    extBravais = 'cI1';
  } else if (bravaisLattice_ === 'tP') {
    extBravais = 'tP1';
  } else if (bravaisLattice_ === 'tI') {
    if (Math.abs(c - a) < threshold) warn('tI lattice, but a almost equal to c');
    extBravais = c <= a ? 'tI1' : 'tI2';
  } else if (bravaisLattice_ === 'oP') {
    extBravais = 'oP1';
  } else if (bravaisLattice_ === 'oF') {
    if (Math.abs(1.0 / a ** 2 - (1.0 / b ** 2 + 1.0 / c ** 2)) < threshold) warn('oF lattice, but 1/a^2 almost equal to 1/b^2 + 1/c^2');
    if (Math.abs(1.0 / c ** 2 - (1.0 / a ** 2 + 1.0 / b ** 2)) < threshold) warn('oF lattice, but 1/c^2 almost equal to 1/a^2 + 1/b^2');
    if (1.0 / a ** 2 > 1.0 / b ** 2 + 1.0 / c ** 2) extBravais = 'oF1';
    else if (1.0 / c ** 2 > 1.0 / a ** 2 + 1.0 / b ** 2) extBravais = 'oF2';
    else extBravais = 'oF3';
  } else if (bravaisLattice_ === 'oI') {
    // Python: sorted([(c,1,'c'), (b,3,'b'), (a,2,'a')])[::-1] -> largest first (ties broken by index, then name)
    const sv = [[c, 1, 'c'], [b, 3, 'b'], [a, 2, 'a']];
    sv.sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0));
    sv.reverse();
    if (Math.abs(sv[0][0] - sv[1][0]) < threshold) warn(`oI lattice, but the two longest vectors ${sv[0][2]} and ${sv[1][2]} have almost the same length`);
    extBravais = `${bravaisLattice_}${sv[0][1]}`;
  } else if (bravaisLattice_ === 'oC') {
    if (Math.abs(b - a) < threshold) warn('oC lattice, but a almost equal to b');
    extBravais = a <= b ? 'oC1' : 'oC2';
  } else if (bravaisLattice_ === 'oA') {
    if (Math.abs(b - c) < threshold) warn('oA lattice, but b almost equal to c');
    extBravais = b <= c ? 'oA1' : 'oA2';
  } else if (bravaisLattice_ === 'hP') {
    extBravais = HP1_GROUPS.has(spgrpNum) ? 'hP1' : 'hP2';
  } else if (bravaisLattice_ === 'hR') {
    if (Math.abs(Math.sqrt(3.0) * a - Math.sqrt(2.0) * c) < threshold) warn('hR lattice, but sqrt(3)a almost equal to sqrt(2)c');
    extBravais = Math.sqrt(3.0) * a <= Math.sqrt(2.0) * c ? 'hR1' : 'hR2';
  } else if (bravaisLattice_ === 'mP') {
    extBravais = 'mP1';
  } else if (bravaisLattice_ === 'mC') {
    if (Math.abs(b - a * Math.sqrt(1.0 - cosbeta ** 2)) < threshold) warn('mC lattice, but b almost equal to a*sin(beta)');
    if (b < a * Math.sqrt(1.0 - cosbeta ** 2)) {
      extBravais = 'mC1';
    } else {
      const val = -a * cosbeta / c + a ** 2 * (1.0 - cosbeta ** 2) / b ** 2;
      if (Math.abs(val - 1.0) < threshold) warn('mC lattice, but -a*cos(beta)/c + a^2*sin(beta)^2/b^2 almost equal to 1');
      extBravais = val <= 1.0 ? 'mC2' : 'mC3';
    }
  } else if (bravaisLattice_ === 'aP') {
    // First step: cell that is Niggli reduced in reciprocal space
    const reciprocalCellOrig = getReciprocalCellRows(convLattice);
    const reciprocalCell2 = niggliReduce(reciprocalCellOrig, 1e-5).lattice;
    const realCell2 = getRealCellFromReciprocalRows(reciprocalCell2);
    const [ka2, kb2, kc2, coskalpha2, coskbeta2, coskgamma2] = getCellParams(reciprocalCell2);
    const conditions = [Math.abs(kb2 * kc2 * coskalpha2), Math.abs(kc2 * ka2 * coskbeta2), Math.abs(ka2 * kb2 * coskgamma2)];
    const M2Matrices = [
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
      [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    ];
    let smallest = 0; // np.argsort(conditions)[0] (stable for ties)
    for (let i = 1; i < 3; i++) if (conditions[i] < conditions[smallest]) smallest = i;
    const M2 = M2Matrices[smallest];
    const realCell3 = transpose(matmul(transpose(realCell2), M2));
    const reciprocalCell3 = getReciprocalCellRows(realCell3);
    const [, , , coskalpha3, coskbeta3, coskgamma3] = getCellParams(reciprocalCell3);
    if (Math.abs(coskalpha3) < threshold) warn('aP lattice, but the k_alpha3 angle is almost equal to 90 degrees');
    if (Math.abs(coskbeta3) < threshold) warn('aP lattice, but the k_beta3 angle is almost equal to 90 degrees');
    if (Math.abs(coskgamma3) < threshold) warn('aP lattice, but the k_gamma3 angle is almost equal to 90 degrees');
    const A = coskalpha3, B = coskbeta3, G = coskgamma3;
    let M3;
    if (A > 0 && B > 0 && G > 0) M3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; // 1a
    else if (A <= 0 && B <= 0 && G <= 0) M3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; // 1b
    else if (A > 0 && B <= 0 && G <= 0) M3 = [[1, 0, 0], [0, -1, 0], [0, 0, -1]]; // 2a
    else if (A <= 0 && B > 0 && G > 0) M3 = [[1, 0, 0], [0, -1, 0], [0, 0, -1]]; // 2b
    else if (A <= 0 && B > 0 && G <= 0) M3 = [[-1, 0, 0], [0, 1, 0], [0, 0, -1]]; // 3a
    else if (A > 0 && B <= 0 && G > 0) M3 = [[-1, 0, 0], [0, 1, 0], [0, 0, -1]]; // 3b
    else if (A <= 0 && B <= 0 && G > 0) M3 = [[-1, 0, 0], [0, -1, 0], [0, 0, 1]]; // 4a
    else if (A > 0 && B > 0 && G <= 0) M3 = [[-1, 0, 0], [0, -1, 0], [0, 0, 1]]; // 4b
    else throw new Error('Problem identifying M3 matrix in aP lattice!');
    const realCellFinal = transpose(matmul(transpose(realCell3), M3));
    const reciprocalCellFinal = getReciprocalCellRows(realCellFinal);
    const [, , , coska, coskb, coskg] = getCellParams(reciprocalCellFinal);
    if (coska <= 0 && coskb <= 0 && coskg <= 0) extBravais = 'aP2'; // all-obtuse
    else if (coska >= 0 && coskb >= 0 && coskg >= 0) extBravais = 'aP3'; // all-acute
    else throw new Error('Unexpected aP triclinic lattice, it neither all-obtuse nor all-acute!');
    // absolute positions, then re-express in the new conventional lattice
    const convPosAbs = convPositions.map((p) => vecmat(p, convLattice));
    convLattice = realCellFinal;
    const Linv = inv3(convLattice);
    convPositions = convPosAbs.map((r) => vecmat(r, Linv));
  } else {
    throw new Error(`Unknown type '${bravaisLattice_}' for spacegroup ${spgrpNum}`);
  }

  const prim = getPrimitive({ lattice: convLattice, positions: convPositions, types: convTypes }, bravaisLattice_);

  const { kparamDef, pointsDef, path } = getPathData(extBravais);
  const kparam = {};
  for (const [name, expr] of kparamDef) {
    kparam[name] = evalExpr(expr, a, b, c, cosalpha, cosbeta, cosgamma, kparam);
  }
  const kparamExtended = extendKparam(kparam);
  const points = {};
  for (const [label, def] of Object.entries(pointsDef)) {
    points[label] = def.map((e) => evalExprSimple(e, kparamExtended));
  }

  const augmentedPath = !hasInv && !withTimeReversal;
  if (augmentedPath) {
    for (const [label, coords] of Object.entries({ ...points })) {
      if (label === 'GAMMA') continue;
      points[`${label}'`] = [-coords[0], -coords[1], -coords[2]];
    }
    const oldPath = path.map((x) => x.slice());
    for (const [s, e] of oldPath) {
      path.push([s === 'GAMMA' ? s : `${s}'`, e === 'GAMMA' ? e : `${e}'`]);
    }
  }

  const detInvP = det3(prim.invP);
  return {
    point_coords: points,
    path,
    has_inversion_symmetry: hasInv,
    augmented_path: augmentedPath,
    bravais_lattice: bravaisLattice_,
    bravais_lattice_extended: extBravais,
    conv_lattice: convLattice,
    conv_positions: convPositions,
    conv_types: convTypes,
    primitive_lattice: prim.lattice,
    primitive_positions: prim.positions,
    primitive_types: prim.types,
    reciprocal_primitive_lattice: getReciprocalCellRows(prim.lattice),
    inverse_primitive_transformation_matrix: prim.invP,
    primitive_transformation_matrix: prim.P,
    volume_original_wrt_conv: volumeConvWrtOriginal,
    volume_original_wrt_prim: volumeConvWrtOriginal * detInvP,
    spacegroup_number: spgrpNum,
    spacegroup_international: std.spacegroup_international ?? null,
    rotation_matrix: std.rotation_matrix ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    conv_prim_atoms_mapping: prim.mapping,
    warnings,
  };
}

/**
 * HPKOT path for a structure (port of seekpath.get_path / seekpath.hpkot.get_path).
 * `cell`: {lattice (rows, Angstrom), positions (fractional), numbers}.
 * options: {withTimeReversal=true, threshold=1e-7, symprec=1e-5, dataset (an analyze() result to reuse)}
 * Note: moyo has no angle_tolerance argument; seekpath's default (-1) is the spglib default as well.
 */
export function getPath(cell, { withTimeReversal = true, threshold = 1.0e-7, symprec = 1e-5, dataset = null } = {}) {
  const c = normalizeCell(cell);
  let ds;
  try {
    ds = dataset || analyze(c, { symprec, setting: 'Spglib' });
  } catch (e) {
    throw new SymmetryDetectionError(`moyo could not detect the symmetry of the system: ${e && e.message ? e.message : e}`);
  }
  const conv = ds.conventional;
  const res = getPathFromStandardized({
    conv_lattice: conv.lattice,
    conv_positions: conv.positions,
    conv_types: conv.types || conv.numbers,
    spacegroup_number: ds.number,
    spacegroup_international: ds.international,
    rotation_matrix: ds.std_rotation_matrix,
    transformation_matrix: ds.transformation_matrix,
  }, { withTimeReversal, threshold });
  if (c.types) {
    // translate symmetry types back to atomic numbers for convenience
    const m = new Map(); c.types.forEach((t, i) => m.set(t, c.numbers[i]));
    res.primitive_numbers = res.primitive_types.map((t) => m.get(t));
    res.conv_numbers = res.conv_types.map((t) => m.get(t));
  } else {
    res.primitive_numbers = res.primitive_types.slice();
    res.conv_numbers = res.conv_types.slice();
  }
  res.dataset = ds;
  return res;
}

// ---------------------------------------------------------------------------
// seekpath.getpaths
// ---------------------------------------------------------------------------

/**
 * get_explicit_from_implicit: explicit list of k-points along the path.
 * referenceDistance in 1/Angstrom (reciprocal vectors include 2*pi), default 0.025.
 */
export function getExplicitFromImplicit(seekpathOutput, referenceDistance = 0.025) {
  const kpointsRel = [];
  const kpointsLabels = [];
  const kpointsLinearcoord = [];
  let previousLinearcoord = 0.0;
  const segments = [];
  const B = seekpathOutput.reciprocal_primitive_lattice;
  for (const [startLabel, stopLabel] of seekpathOutput.path) {
    const startCoord = seekpathOutput.point_coords[startLabel];
    const stopCoord = seekpathOutput.point_coords[stopLabel];
    const startAbs = vecmat(startCoord, B);
    const stopAbs = vecmat(stopCoord, B);
    const segmentLength = norm(sub(stopAbs, startAbs));
    const numPoints = Math.max(2, Math.trunc(segmentLength / referenceDistance));
    let segmentStart = kpointsLabels.length;
    for (let i = 0; i < numPoints; i++) {
      if (i === 0 && kpointsLabels.length && kpointsLabels[kpointsLabels.length - 1] === startLabel) {
        segmentStart -= 1;
        continue;
      }
      const f = i / (numPoints - 1);
      kpointsRel.push([0, 1, 2].map((k) => startCoord[k] + (stopCoord[k] - startCoord[k]) * f));
      if (i === 0) kpointsLabels.push(startLabel);
      else if (i === numPoints - 1) kpointsLabels.push(stopLabel);
      else kpointsLabels.push('');
      // numpy.linspace(0, L, n): step*i, last point exactly L
      const lin = i === numPoints - 1 ? segmentLength : (segmentLength / (numPoints - 1)) * i;
      kpointsLinearcoord.push(previousLinearcoord + lin);
    }
    previousLinearcoord += segmentLength;
    segments.push([segmentStart, kpointsLabels.length]);
  }
  return {
    kpoints_rel: kpointsRel,
    kpoints_linearcoord: kpointsLinearcoord,
    kpoints_labels: kpointsLabels,
    kpoints_abs: kpointsRel.map((k) => vecmat(k, B)),
    segments,
  };
}

/** get_explicit_k_path: getPath() plus explicit_kpoints_{rel,abs,labels,linearcoord} and explicit_segments. */
export function getExplicitKPath(cell, { referenceDistance = 0.025, ...opts } = {}) {
  const res = getPath(cell, opts);
  const ex = getExplicitFromImplicit(res, referenceDistance);
  for (const [k, v] of Object.entries(ex)) res[`explicit_${k}`] = v;
  return res;
}

/**
 * get_path_orig_cell: special points expressed in the reciprocal basis of the ORIGINAL cell
 * (no standardization of the input). Adds is_supercell.
 */
export function getPathOrigCell(cell, opts = {}) {
  const c = normalizeCell(cell);
  const res = getPath(c, opts);
  const isSupercell = Math.abs(Math.abs(res.volume_original_wrt_prim) - 1) > 0.1;
  const warnings = res.warnings.slice();
  if (isSupercell) {
    warnings.push('The provided cell is a supercell: the returned k-path is the standard k-path of the associated primitive cell in the basis of the supercell reciprocal lattice.');
  }
  const B = res.reciprocal_primitive_lattice;
  const R = res.rotation_matrix;
  const LT = transpose(c.lattice);
  const pointsOrig = {};
  for (const [label, coords] of Object.entries(res.point_coords)) {
    const kc = vecmat(vecmat(coords, B), R);
    pointsOrig[label] = vecmat(kc, LT).map((x) => x / Math.PI / 2);
  }
  return {
    point_coords: pointsOrig,
    path: res.path,
    augmented_path: res.augmented_path,
    is_supercell: isSupercell,
    has_inversion_symmetry: res.has_inversion_symmetry,
    bravais_lattice: res.bravais_lattice,
    bravais_lattice_extended: res.bravais_lattice_extended,
    spacegroup_number: res.spacegroup_number,
    spacegroup_international: res.spacegroup_international,
    warnings,
  };
}

/** get_explicit_k_path_orig_cell. */
export function getExplicitKPathOrigCell(cell, { referenceDistance = 0.025, ...opts } = {}) {
  const c = normalizeCell(cell);
  const res = getPathOrigCell(c, opts);
  res.reciprocal_primitive_lattice = getReciprocalCellRows(c.lattice);
  const ex = getExplicitFromImplicit(res, referenceDistance);
  delete res.reciprocal_primitive_lattice;
  for (const [k, v] of Object.entries(ex)) res[`explicit_${k}`] = v;
  return res;
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

/**
 * The seekpath primitive cell as a DFT Lab cell (use it for the band-structure calculation).
 * seekpath does not wrap primitive_positions; here they are wrapped to [0,1) unless {wrap:false}.
 */
export function primitiveCellFromPath(res, { wrap = true } = {}) {
  const w = (x) => { let y = x - Math.floor(x); if (y > 1 - 1e-12) y = 0; return Math.abs(y) < 1e-14 ? 0 : y; };
  return {
    lattice: res.primitive_lattice.map((v) => v.slice()),
    positions: res.primitive_positions.map((p) => (wrap ? p.map(w) : p.slice())),
    numbers: (res.primitive_numbers || res.primitive_types).slice(),
  };
}

/** Pretty label: GAMMA -> Γ, X_1 -> X₁ (unicode); or LaTeX with {latex:true}: \Gamma, X$_1$. */
export function prettyLabel(label, { latex = false } = {}) {
  const prime = label.endsWith("'") ? "'" : '';
  const base = prime ? label.slice(0, -1) : label;
  const [name, sub_] = base.split('_');
  const sym = name === 'GAMMA' ? (latex ? '\\Gamma' : 'Γ') : name;
  if (!sub_) return sym + prime;
  if (latex) return `${sym}$_{${sub_}}$${prime}`;
  const subs = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
  return sym + [...sub_].map((ch) => subs[ch] ?? ch).join('') + prime;
}

/**
 * Tick positions/labels for a band-structure plot from an explicit path:
 * [{x, label}] with "A|B" at discontinuities.
 */
export function bandPlotTicks(explicit) {
  const labels = explicit.explicit_kpoints_labels || explicit.kpoints_labels;
  const x = explicit.explicit_kpoints_linearcoord || explicit.kpoints_linearcoord;
  const ticks = [];
  for (let i = 0; i < labels.length; i++) {
    if (!labels[i]) continue;
    const last = ticks[ticks.length - 1];
    if (last && Math.abs(last.x - x[i]) < 1e-12) {
      if (last.label !== labels[i]) last.label = `${last.label}|${labels[i]}`;
    } else ticks.push({ x: x[i], label: labels[i] });
  }
  return ticks;
}
