"""Genera ../pseudos.cases.json. Uso: RUNS=<directorio con runs/ps> python3 build_pseudo_cases.py (desde la raíz del repositorio)
Cabeceras PSML leídas con xml.etree (independiente del oráculo, que usa expresiones regulares) y hechos de corridas reales
de SIESTA 5.4.2 con Si: avisos de xc_check, archivo de pseudo elegido y errores fatales."""
import json, os, re
import xml.etree.ElementTree as ET

R = os.environ['RUNS'].rstrip('/') + '/runs/ps/'
LIBXC = {1: 'LDA_X', 9: 'LDA_C_PZ', 12: 'LDA_C_PW', 101: 'GGA_X_PBE', 130: 'GGA_C_PBE', 116: 'GGA_X_PBE_SOL', 133: 'GGA_C_PBE_SOL'}
XC_AUTHORS = {'LDA': {'CA': [1, 9], 'PZ': [1, 9], 'PW92': [1, 12]}, 'GGA': {'PBE': [101, 130], 'PBESOL': [116, 133]}}


def header(path):
    """Texto del PSML hasta </exchange-correlation>: lo que necesita el preflight, sin las tablas radiales."""
    t = open(path).read()
    return t[:t.index('</exchange-correlation>') + len('</exchange-correlation>')] + '\n'


def info(path):
    root = ET.parse(path).getroot()
    local = lambda e: e.tag.rsplit('}', 1)[-1]
    spec = next(e for e in root.iter() if local(e) in ('pseudo-atom-spec', 'header'))
    funcs = [e for e in root.iter() if local(e) == 'functional']
    rank = lambda f: 0 if 'exchange' in f.get('type').lower() else 1 if 'correlation' in f.get('type').lower() else 2
    ids = [int(f.get('id')) for f in sorted(funcs, key=rank)]
    return {'label': spec.get('atomic-label'), 'z': int(spec.get('atomic-number')), 'z_valence': float(spec.get('z-pseudo')),
            'relativity': spec.get('relativity'), 'core_corrections': spec.get('core-corrections') == 'yes',
            'libxc_ids': ids, 'xc': [LIBXC.get(i, f'LIBXC_{i}') for i in ids]}


cases = []
def C(**k): cases.append(k)

for cid, path, title in (('ps-psml-pbe-si', 'app/dftlab/data/pseudos/pbe/Si.psml', 'Biblioteca, PBE, Si'),
                         ('ps-psml-lda-si', 'app/dftlab/data/pseudos/lda/Si.psml', 'Biblioteca, LDA (CA-PZ), Si'),
                         ('ps-psml-pbe-fe', 'app/dftlab/data/pseudos/pbe/Fe.psml', 'Biblioteca, PBE, Fe con semicore'),
                         ('ps-psml-soft', 'app/tests/siesta/fixtures/pseudo/Si.soft.psml', 'PSML 1.0: <header>, tipos XC_EXCHANGE y relatividad «no»')):
    C(id=cid, kind='psml', title=title, psml=header(path), expect=info(path))


def fdf_xc(d):
    t = open(R + d + '/si.fdf').read()
    return {'functional': re.search(r'^XC.functional\s+(\S+)', t, re.M).group(1), 'authors': re.search(r'^XC.authors\s+(\S+)', t, re.M).group(1)}


def warned(d):
    return 'xc_check: WARNING' in open(R + d + '/out').read()


for cid, d, folder, title in (('ps-xc-pbe', 'pbe_ok', 'pbe', 'GGA PBE con pseudo PBE'),
                              ('ps-xc-lda-ca', 'lda_ok', 'lda', 'LDA CA con pseudo LDA CA-PZ'),
                              ('ps-xc-lda-pw92', 'lda_pw92', 'lda', 'LDA PW92 con pseudo CA-PZ: SIESTA solo avisa'),
                              ('ps-xc-pbe-on-lda', 'pbe_on_lda', 'lda', 'GGA PBE con pseudo LDA: SIESTA solo avisa'),
                              ('ps-xc-lda-on-pbe', 'lda_ca', 'pbe', 'LDA CA con pseudo PBE: SIESTA solo avisa')):
    run = fdf_xc(d)
    ids = XC_AUTHORS[run['functional'].upper()][run['authors'].upper()]
    p = info(f'app/dftlab/data/pseudos/{folder}/Si.psml')
    # El esperado sale de SIESTA: hay aviso de xc_check si y solo si los funcionales difieren.
    exp = {'status': 'FAIL', 'code': 'PSEUDO_XC_MISMATCH', 'run_libxc_ids': ids, 'mismatched': ['Si']} if warned(d) else {'status': 'PASS', 'run_libxc_ids': ids}
    assert (p['libxc_ids'] != ids) == warned(d), d
    C(id=cid, kind='xc', title=title, run=run, pseudos={'Si': {'libxc_ids': p['libxc_ids']}}, expect=exp)
C(id='ps-xc-unknown', kind='xc', title='XC.authors fuera de la tabla', run={'functional': 'GGA', 'authors': 'XYZ'}, pseudos={}, expect={'status': 'FAIL', 'code': 'XC_UNKNOWN'})

out = open(R + 'both/out').read()
lines = [l for l in out.split('\n') if l.startswith('xc_check')]
C(id='ps-stdout-warning', kind='stdout', title='Aviso de xc_check en la salida (psf LDA con corrida PBE)', stdout='\n'.join(lines),
  expect=[re.search(r'generated with (.+?) functional', l).group(1) for l in lines if 'WARNING' in l])
C(id='ps-stdout-clean', kind='stdout', title='Sin aviso', stdout='\n'.join(l for l in open(R + 'pbe_ok/out').read().split('\n') if l.startswith('xc_check')), expect=[])


def chosen(d):
    o = open(R + d + '/out').read()
    if 'Pseudopotential file not found' in o:
        return {'error': 'PSEUDO_FILE_NOT_FOUND'}
    m = re.search(r'Reading pseudopotential information in (?:formatted form|PSML) from:\s*\n\s*(\S+)', o)
    return {'file': m.group(1)}


for cid, d, label, title in (('ps-file-label', 'label', 'Si1', 'Etiqueta Si1 con solo Si.psml: SIESTA aborta'),
                             ('ps-file-both', 'both', 'Si', 'Si.psf y Si.psml: SIESTA usa Si.psf sin avisar'),
                             ('ps-file-psf', 'psfonly', 'Si', 'Solo Si.psf'),
                             ('ps-file-alias', 'alias', 'Si1', 'Alias Si1 y Si2 con copias del mismo PSML'),
                             ('ps-file-psml', 'pbe_ok', 'Si', 'Solo Si.psml')):
    files = sorted(f for f in os.listdir(R + d) if f.endswith(('.psml', '.psf', '.vps')))
    exp = chosen(d)
    if 'file' in exp:
        exp['ambiguous'] = sum(f'{label}.{e}' in files for e in ('vps', 'psf', 'psml')) > 1
    C(id=cid, kind='file', title=title, label=label, files=files, expect=exp)

for cid, entries, title in (('ps-manifest-prefix', [{'species': 'S', 'filename': 'Si.psml'}], 'Especie S con Si.psml: QRAFT lo acepta por prefijo; SIESTA buscaría S.psml'),
                            ('ps-manifest-suffix', [{'species': 'Si', 'filename': 'Si_old.psml'}], 'Especie Si con Si_old.psml'),
                            ('ps-manifest-alias', [{'species': 'Si1', 'filename': 'Si1.psml'}, {'species': 'Si2', 'filename': 'Si2.psml'}], 'Un archivo por etiqueta')):
    bad = [f"SPECIES_FILENAME_MISMATCH:{e['species']}:{e['filename']}" for e in entries if re.sub(r'\.(psml|psf|vps)$', '', e['filename'], flags=re.I) != e['species']]
    C(id=cid, kind='manifest', title=title, entries=entries, expect={'status': 'FAIL' if bad else 'PASS', 'findings': bad})

doc = {'schema': 'dftlab.protocol-vectors@1', 'protocol': 'PSEUDOS', 'ficha': 'docs/scientific-protocols/PSEUDOS.md',
       'oracle': 'docs/scientific-protocols/vectors/pseudo-oracle.mjs', 'engine': 'SIESTA 5.4.2 (siesta-env conda-forge)',
       'arithmetic_tolerance': {'rel': 1e-12}, 'cases': cases}
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pseudos.cases.json'), 'w').write(json.dumps(doc, ensure_ascii=False, indent=1) + '\n')
print(len(cases), 'casos')
for c in cases:
    print(c['id'], json.dumps(c['expect'])[:160])
