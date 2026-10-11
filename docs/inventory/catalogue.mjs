const js = 'app/dftlab/static/js/';
const ui = 'app/tests/ui/';
const si = 'app/tests/siesta/';
const lifecycle = [ui+'browser_lifecycle.mjs',ui+'browser_resources.mjs'];
const basic = [si+'run_tests.mjs'];
const reader = (module, formats, tests=basic) => ({file:js+'siesta/'+module.split(':')[0], symbol:module.split(':')[1]?.trim() || 'detectAndParse → runset → pack', formats, tests});
const structure = (direction,format,symbols) => ({direction,format,symbols,file:js+'crystal/formats.js',consumer:'estructura.js, postproc.js; readStructure también phonons.js',tests:['app/tests/crystal/run_tests.mjs','app/tests/crystal/browser_smoke.mjs'],preservation:'Conservar celda, especies, convenciones y unidades; aliases no se cuentan como nuevas familias.'});
const dataset = (origin, tests=lifecycle) => ({origin,tests});
export const catalogue = {
  viewTests: Object.fromEntries(['inicio','ks','pseudos','xc','base','scf','solvers','bandas','dftu','densidad','potencial','espin','lectura','fonones','fuerzas','beyond','estructura','calc','post'].map(id=>[id,[...lifecycle,...(id==='calc'?[ui+'run_calc_tests.mjs',ui+'browser_regressions.mjs']:id==='estructura'?[ui+'browser_offline.mjs','app/tests/crystal/run_tests.mjs']:id==='post'?[ui+'browser_import.mjs',ui+'browser_bands.mjs']:[])]])),
  readers: {
    out:reader('out.js: parseOut','.out/.log/.stdout + detección por cabecera'),
    fdf:reader('out.js: parseFDF','.fdf'), bands:reader('bands.js: parseBands','.bands',[...basic,si+'run_bands_path_tests.mjs',ui+'browser_bands.mjs']),
    eig:reader('eig.js: parseEIG','.EIG + .KP',[...basic,si+'run_import_tests.mjs',ui+'browser_import.mjs']),
    kp:reader('eig.js: parseKP','.KP/.BZ_KP'), 'pdos-kp':reader('eig.js: parseKP','.PDOS.KP; cobertura de parser KP, alias sin fixture dedicado'),
    pdos:reader('pdos.js: parsePDOS','.PDOS/.PDOS.xml o cabecera XML'), 'pdos-text':reader('pdos.js: parsePDOSText','.dat/.txt con cabecera PDOS; rama sin fixture nominal dedicado'),
    dos:reader('dos.js: parseDOS','.DOS o columnas numéricas'), epsimg:reader('epsimg.js: parseEPSIMG','.EPSIMG'),
    'epsimg-contrib':reader('epsimg.js: parseContribEPSIMG','.contrib.EPSIMG; comprobar cobertura individual antes de migrar'),
    'ion-xml':reader('ion.js: parseIonXML','.ion.xml o cabecera <ion>'), ion:reader('ion.js: parseIon','.ion'), psf:reader('pseudo.js: parsePSF','.psf'), psml:reader('pseudo.js: parsePSML','.psml'),
    mde:reader('mde.js: parseMDE','.MDE'), ani:reader('mde.js: parseANI','.ANI / XYZ por sniff'), fa:reader('mde.js: parseFA','.FA/.FAC'), xv:reader('mde.js: parseXV','.XV'), struct:reader('mde.js: parseStructOut','.STRUCT_OUT/.STRUCT_IN/.STRUCT_NEXT_ITER'),
    'dftlab-pack':reader('index.js','.dftlab.json / JSON con clave dftlab; expansión en pack.js/runset.js',[...basic,si+'run_import_tests.mjs',ui+'browser_import.mjs']),
    fc:reader('fc.js: parseFC','.FC',[si+'run_fc_tests.mjs']),
    grid:reader('rho.js: parseGrid','.RHO/.DRHO/.RHOXC/.BADER/.TOTAL_CHARGE/.VH/.VT/.VNA/.VXC/.LDOS/.IORHO',[si+'run_rho_tests.mjs',si+'run_import_tests.mjs',ui+'browser_import.mjs']),
  },
  calculators: {
    doCell2:{description:'Celda → malla k / FFT y MeshCutoff (Å, Å⁻¹, Ry)',tests:[ui+'run_calc_tests.mjs',ui+'browser_regressions.mjs']},
    doBM:{description:'Ajuste Birch–Murnaghan E(V), V0/a0/E0/B0/B′/RMS (Å³, Å, eV, GPa); sin suite numérica independiente',tests:lifecycle},
    doMass:{description:'Curvatura de banda / masa efectiva (eV, Å⁻¹, m*/me); sin suite numérica independiente',tests:lifecycle},
    doSmear:{description:'Ocupaciones Fermi–Dirac/Gauss/MP (eV); sin suite numérica independiente',tests:lifecycle},
    doUnits:{description:'Conversión energía/longitud/presión/fuerza; sin suite numérica independiente',tests:lifecycle},
    doGas:{description:'Gas de electrones: n, rs, kF, EF, TF (Å/Bohr/eV/K); sin suite numérica independiente',tests:lifecycle},
    doF:{description:'Energía de formación con μ por especie (eV, eV/átomo); sin suite numérica independiente',tests:lifecycle},
  },
  structureFormats:[structure('read','CIF',['readCIF','readCIFAll']),structure('read','XYZ/extXYZ',['readXYZ','readXYZAll']),structure('read','POSCAR/CONTCAR/.vasp',['readPOSCAR']),structure('read','XV',['readXV']),structure('read','STRUCT_OUT/STRUCT_IN',['readStructOut']),structure('read','FDF',['readFDF']),structure('write','CIF',['writeCIF']),structure('write','XYZ',['writeXYZ']),structure('write','extXYZ',['writeExtXYZ']),structure('write','POSCAR/.vasp',['writePOSCAR']),structure('write','FDF',['writeFDF']),structure('write','STRUCT_IN/struct',['writeStructIn'])],
  datasets: {
    'beyond_dft.json':dataset('Compilación bibliográfica: referencias dentro del JSON; no nuevas corridas de GW/HSE.'),
    'conv.json':dataset('Corridas archivadas: corridas/conv.tar.gz; reconstrucción exacta pendiente.'),
    'espin.json':dataset('corridas/espin_gen_json.mjs + espin.tar.gz; histórico conservado.'),
    'examples.json':dataset('Paquetes de ejemplos comprimidos; fixtures SIESTA en app/tests/siesta/fixtures; generador exacto pendiente.',[si+'run_tests.mjs',ui+'browser_import.mjs']),
    'fuerzas.json':dataset('corridas/fuerzas_gen_json.mjs + fuerzas.tar.gz; histórico conservado.'),
    'nio.json':dataset('corridas/nio.tar.gz; script externo de generación exacta no localizado. F regenera referencias de tests, no este dataset.'),
    'out_fe.json':dataset('corridas/out_gen_json.mjs; .out de Fe dentro de espin.tar.gz (ver argumentos del generador).',[si+'run_outnotes_tests.mjs',...lifecycle]),
    'potencial.json':dataset('corridas/wf_gen_json.mjs + wf.tar.gz; las mallas VH/VT grandes no se archivaron, según corridas/LEEME.txt.',[si+'run_rho_tests.mjs',...lifecycle]),
    'pseudo_lib.json':dataset('Biblioteca PSML y validación: app/dftlab/data/pseudos; generador exacto/identidad de todos los runs pendiente.'),
    'pseudo_xc.json':dataset('Material conservado en pseudo_xc/, prototipo_v2/pseudos/ y corridas/xc.tar.gz; generación exacta pendiente.'),
    'rho.json':dataset('corridas/rho_gen_json.mjs + rho.tar.gz y dens.tar.gz.',[si+'run_rho_tests.mjs',...lifecycle]),
    'scf_runs.json':dataset('corridas/scf.tar.gz, scfpack.tar.gz, si_scf.tar.gz; generación exacta pendiente.'),
    'si_fonones.json':dataset('corridas/fonones_gen_json.mjs + fonones.tar.gz.',[si+'run_fc_tests.mjs',...lifecycle]),
    'si_lda.json':dataset('Si histórico; corridas/si.tar.gz; reconstrucción exacta pendiente.'),
    'si_wf.json':dataset('Funciones de onda empaquetadas de Si; generador exacto pendiente. corridas/wf* es función trabajo, NO origen demostrado de si_wf.'),
    'solvers.json':dataset('corridas/solv.tar.gz y solv2.tar.gz; generación exacta pendiente.'),
  },
};
