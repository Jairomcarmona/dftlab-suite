"""Genera ../lru-view.cases.json. Uso: python3 build_lru_view_cases.py
Entradas escritas a mano con la forma de run-projection, assessment-record, resume-plan y la admisión de generaciones
(ADR-017 Adenda 12); los esperados se calculan aquí de forma independiente del oráculo JS."""
import copy, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
H = 'hubbardflow.NodeState'
D1, D2 = 'a' * 64, 'b' * 64


def resp(kind='screened', state='PASS', dm='dm-ref-0001', precision='float64', value='VALIDATED'):
    return dict(kind=kind, native_status=dict(authority='hubbardflow', vocabulary=H, value=value), passport_state=state,
                dm_reference=dm, precision=precision)


def attempts(n, last_state='RUNNING'):
    out = []
    for g in range(1, n + 1):
        out.append(dict(attempt_id=f'attempt-{g:04d}', generation=g, state=last_state if g == n else 'INTERRUPTED',
                        previous_attempt_id=None if g == 1 else f'attempt-{g - 1:04d}'))
    return out


def plan(**kw):
    p = dict(plan_revision=2, from_attempt_id='attempt-0001', expired=False, policy_digests=[D1, D2],
             nodes=dict(reuse=['reference', 'pert-1'], invalid=[], pending=['pert-2', 'pert-3'], seed_candidates=[dict(node_id='pert-2', kind='DM')]))
    p.update(kw); return p


def base(**kw):
    i = dict(projection=dict(scheduler='RUNNING', execution='RUNNING', integrity='VERIFIED', science='UNKNOWN'), cancel_requested=False,
             platform_resume_enabled=True, admission=None, resume_plan=None, run=dict(plan_digest='c' * 64, policy_digests=[D1, D2]),
             responses=[], attempts=attempts(1))
    for k, v in kw.items():
        if k == 'projection': i['projection'].update(v)
        else: i[k] = v
    return i


ACTIVE = {'SUBMITTED', 'RUNNING', 'COLLECTING'}
TERMINAL = {'CANCELLED', 'INTERRUPTED', 'FAILED', 'COMPLETED'}


def model(inp):
    p = inp['projection']; banners = []
    def add(b):
        if b not in banners: banners.append(b)
    sci = p['science']; basis = 'AUTHORITY_ASSESSMENT' if inp['responses'] else 'NONE'
    if sci == 'PASS' and (not inp['responses'] or any(r['passport_state'] != 'PASS' for r in inp['responses'])):
        sci = 'NOT_ESTABLISHED'; add('SCIENCE_PROJECTION_INCONSISTENT')
    if any(r['kind'] == 'screened' and not r['dm_reference'] for r in inp['responses']): add('DM_REFERENCE_MISSING')
    at = sorted(inp['attempts'], key=lambda a: a['generation'])
    for i, a in enumerate(at):
        want_prev = None if i == 0 else at[i - 1]['attempt_id']
        if a['generation'] != i + 1 or a['previous_attempt_id'] != want_prev: add('ATTEMPT_CHAIN_BROKEN'); break
    broken = 'ATTEMPT_CHAIN_BROKEN' in banners
    pol_changed = inp['resume_plan'] is not None and sorted(inp['resume_plan']['policy_digests']) != sorted(inp['run']['policy_digests'])
    if pol_changed: add('POLICY_CHANGED')
    ex = p['execution']; cancel = False
    if p['integrity'] in ('ALTERED', 'MISSING', 'INCOMPLETE'): head, tone = 'INTEGRITY_PROBLEM', 'error'
    elif ex == 'UNKNOWN' or p['scheduler'] == 'SUBMISSION_UNKNOWN': head, tone = 'OUTCOME_UNKNOWN', 'warn'; add('RECONCILE_REQUIRED')
    elif inp['cancel_requested'] and ex not in TERMINAL:
        head, tone = 'CANCELLING', 'progress'
        if p['scheduler'] == 'CANCELLED': add('EVIDENCE_PENDING')
    elif ex == 'PREPARED' or (ex == 'SUBMITTED' and p['scheduler'] == 'PENDING'): head, tone, cancel = 'QUEUED', 'neutral', ex == 'SUBMITTED'
    elif ex in ACTIVE: head, tone, cancel = 'RUNNING', 'progress', True
    elif ex == 'CANCELLED': head, tone = 'CANCELLED', 'neutral'
    elif ex == 'INTERRUPTED': head, tone = 'INTERRUPTED', 'warn'
    elif ex == 'FAILED': head, tone = 'FAILED', 'error'
    elif ex == 'COMPLETED':
        head = {'PASS': 'COMPLETED_SCIENCE_PASS', 'FAIL': 'COMPLETED_SCIENCE_FAIL', 'REVIEW': 'COMPLETED_SCIENCE_REVIEW'}.get(sci, 'COMPLETED_SCIENCE_NOT_ESTABLISHED')
        tone = {'COMPLETED_SCIENCE_PASS': 'ok', 'COMPLETED_SCIENCE_FAIL': 'error'}.get(head, 'warn')
    else: head, tone = 'OUTCOME_UNKNOWN', 'warn'; add('RECONCILE_REQUIRED')
    if head == 'COMPLETED_SCIENCE_PASS' and (p['integrity'] != 'VERIFIED' or 'DM_REFERENCE_MISSING' in banners or 'SCIENCE_PROJECTION_INCONSISTENT' in banners):
        head, tone = 'COMPLETED_SCIENCE_NOT_ESTABLISHED', 'warn'
    reason = None; resume = False
    rp, adm = inp['resume_plan'], inp['admission']
    if ex not in ('INTERRUPTED', 'CANCELLED'): reason = 'EXECUTION_FAILED' if ex == 'FAILED' else 'NOT_RESUMABLE_STATE'
    elif not inp['platform_resume_enabled']: reason = 'PLATFORM_RESUME_NOT_QUALIFIED'
    elif rp is None: reason = 'NO_RESUME_PLAN'
    elif rp['expired']: reason = 'RESUME_PLAN_EXPIRED'
    elif pol_changed: reason = 'POLICY_CHANGED'
    elif broken: reason = 'ATTEMPT_CHAIN_BROKEN'
    elif adm is None: reason = 'ADMISSION_UNKNOWN'
    elif adm['decision'] != 'ADMIT': reason = adm['reason']
    else: resume = True
    rpv = None if rp is None else dict(plan_revision=rp['plan_revision'], from_attempt_id=rp['from_attempt_id'], reuse_count=len(rp['nodes']['reuse']),
                                      pending_count=len(rp['nodes']['pending']), invalid=[dict(node_id=x['node_id'], reason=x['reason']) for x in rp['nodes']['invalid']],
                                      seeds=[dict(node_id=x['node_id'], kind=x['kind']) for x in rp['nodes']['seed_candidates']])
    return dict(headline=head, tone=tone, science=dict(state=sci, basis=basis),
                actions=dict(cancel=cancel, resume=resume, use_result=head == 'COMPLETED_SCIENCE_PASS', resume_reason=None if resume else reason),
                resume_plan=rpv,
                preserved=dict(plan_digest=inp['run']['plan_digest'], policy_digests=list(inp['run']['policy_digests']),
                               responses=[dict(kind=r['kind'], native_status=r['native_status'], passport_state=r['passport_state'], dm_reference=r['dm_reference'], precision=r['precision']) for r in inp['responses']]),
                attempts=[dict(attempt_id=a['attempt_id'], generation=a['generation'], state=a['state'], previous_attempt_id=a['previous_attempt_id'], current=a['generation'] == len(at)) for a in at],
                banners=banners)


cases = []
def add(i, title, inp): cases.append(dict(id=i, title=title, input=inp, expect=model(inp)))
P = lambda **kw: dict(projection=kw)
ok = [resp('bare', 'PASS', None, 'float64'), resp('screened', 'PASS')]
adm = dict(decision='ADMIT', reason='NEXT_GENERATION')

add('lru-queued', 'En cola: se puede cancelar, nada que reanudar', base(projection=dict(scheduler='PENDING', execution='SUBMITTED')))
add('lru-prepared', 'Preparado sin enviar: no hay nada que cancelar', base(projection=dict(scheduler='NOT_SUBMITTED', execution='PREPARED')))
add('lru-running', 'Corriendo: cancelar disponible; la ciencia aún sin establecer', base())
add('lru-cancelling', 'Cancelación pedida durante actividad interna: CANCELLING hasta que haya evidencia del motor', base(cancel_requested=True))
add('lru-cancel-evidence-pending', 'El scheduler dice CANCELLED pero el controlador aún no cerró: sigue CANCELLING con aviso', base(cancel_requested=True, projection=dict(scheduler='CANCELLED', execution='RUNNING')))
add('lru-cancelled-resumable', 'Cancelado con plan, política igual y admisión ADMIT: reanudar disponible', base(projection=dict(scheduler='CANCELLED', execution='CANCELLED'), resume_plan=plan(), admission=adm, attempts=attempts(1, 'CANCELLED')))
add('lru-interrupted-resumable', 'Interrumpido: plan con nodos reutilizados, inválidos y semillas', base(projection=dict(scheduler='NODE_FAIL', execution='INTERRUPTED'), resume_plan=plan(nodes=dict(reuse=['reference'], invalid=[dict(node_id='pert-1', reason='pseudo cambiado')], pending=['pert-2'], seed_candidates=[dict(node_id='pert-2', kind='DM')])), admission=adm, attempts=attempts(2, 'INTERRUPTED')))
add('lru-resume-not-qualified', 'Reanudación por la plataforma no calificada (#93): nunca se ofrece', base(projection=dict(execution='INTERRUPTED'), platform_resume_enabled=False, resume_plan=plan(), admission=adm))
add('lru-resume-no-plan', 'Interrumpido sin plan de reanudación', base(projection=dict(execution='INTERRUPTED')))
add('lru-resume-expired', 'Plan caducado', base(projection=dict(execution='CANCELLED'), resume_plan=plan(expired=True), admission=adm))
add('lru-resume-policy-changed', 'La política del plan no es la del run: se muestra el cambio y no se reanuda', base(projection=dict(execution='INTERRUPTED'), resume_plan=plan(policy_digests=[D1, 'd' * 64]), admission=adm))
add('lru-resume-refused', 'La plataforma rechaza la generación: se muestra su motivo', base(projection=dict(execution='INTERRUPTED'), resume_plan=plan(), admission=dict(decision='REFUSE', reason='PREVIOUS_TERMINATION_NOT_PROVEN')))
add('lru-failed', 'Ejecución fallida: no se ofrece reanudar', base(projection=dict(scheduler='FAILED', execution='FAILED'), resume_plan=plan(), admission=adm))
add('lru-completed-exit0-not-established', 'Terminó con código 0 pero la ciencia no está establecida: nunca verde, no se puede usar', base(projection=dict(scheduler='COMPLETED', execution='COMPLETED', science='NOT_ESTABLISHED'), responses=[resp('bare', 'NOT_ESTABLISHED', None, 'float64', 'NOT_ESTABLISHED'), resp('screened', 'NOT_ESTABLISHED', 'dm-ref-0001', 'float64', 'NOT_ESTABLISHED')]))
add('lru-completed-pass', 'Completado, ciencia PASS, íntegro: se puede usar y se conservan bare/screened, referencia DM y precisión', base(projection=dict(scheduler='COMPLETED', execution='COMPLETED', science='PASS'), responses=ok))
add('lru-completed-pass-altered', 'Ciencia PASS pero integridad ALTERED: problema de integridad', base(projection=dict(scheduler='COMPLETED', execution='COMPLETED', science='PASS', integrity='ALTERED'), responses=ok))
add('lru-completed-pass-inconsistent', 'La proyección dice PASS y una respuesta no: se cae a NOT_ESTABLISHED con aviso', base(projection=dict(scheduler='COMPLETED', execution='COMPLETED', science='PASS'), responses=[resp('bare', 'PASS', None), resp('screened', 'NOT_ESTABLISHED', 'dm-ref-0001', 'float64', 'NOT_ESTABLISHED')]))
add('lru-completed-pass-no-dm', 'Respuesta screened sin referencia de DM: no se acepta como PASS', base(projection=dict(scheduler='COMPLETED', execution='COMPLETED', science='PASS'), responses=[resp('bare', 'PASS', None), resp('screened', 'PASS', None)]))
add('lru-completed-fail', 'Ciencia FAIL', base(projection=dict(scheduler='COMPLETED', execution='COMPLETED', science='FAIL'), responses=[resp('screened', 'FAIL', 'dm-ref-0001', 'float64', 'REJECTED')]))
add('lru-unknown', 'Envío sin resultado conocido: reconciliar, sin acciones', base(projection=dict(scheduler='SUBMISSION_UNKNOWN', execution='UNKNOWN')))
add('lru-attempt-chain-broken', 'Cadena de intentos rota: se avisa y se conservan todos', base(projection=dict(execution='INTERRUPTED'), attempts=[dict(attempt_id='attempt-0001', generation=1, state='INTERRUPTED', previous_attempt_id=None), dict(attempt_id='attempt-0003', generation=3, state='INTERRUPTED', previous_attempt_id='attempt-0002')], resume_plan=plan(), admission=adm))
add('lru-three-attempts', 'Tres intentos: mapa completo, el último es el actual', base(projection=dict(execution='RUNNING'), attempts=attempts(3)))

doc = dict(schema='dftlab.protocol-vectors@1', protocol='LRU_VIEW', ficha='docs/scientific-protocols/LR-U-VISTA.md',
           oracle='docs/scientific-protocols/vectors/lru-view-oracle.mjs', engine='reglas puras (sin motor)', arithmetic_tolerance=dict(rel=0, abs=0), cases=cases)
path = os.path.join(HERE, '..', 'lru-view.cases.json')
json.dump(doc, open(path, 'w'), ensure_ascii=False, indent=1); open(path, 'a').write('\n')
print(len(cases), 'casos')
for c in cases: print(c['id'], c['expect']['headline'], c['expect']['actions'], c['expect']['banners'])
