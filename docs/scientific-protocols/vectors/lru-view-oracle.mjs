// Oráculo de referencia del modelo de vista de LR-U (ficha docs/scientific-protocols/LR-U-VISTA.md, T-039).
// Reglas puras sobre la proyección del run, las evaluaciones, el plan de reanudación y la admisión de generaciones.
// Define lo que deben reproducir los vectores; no es código de producción ni de interfaz.

const ACTIVE = new Set(['SUBMITTED', 'RUNNING', 'COLLECTING']);
const TERMINAL = new Set(['CANCELLED', 'INTERRUPTED', 'FAILED', 'COMPLETED']);
const sameSet = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

export function viewModel(inp) {
  const p = inp.projection, banners = [];
  const add = code => { if (!banners.includes(code)) banners.push(code); };
  let science = p.science, basis = inp.responses.length ? 'AUTHORITY_ASSESSMENT' : 'NONE';
  // V-1: la ciencia sale solo de la proyección y de las evaluaciones; un fin correcto del proceso no la establece.
  if (science === 'PASS' && (!inp.responses.length || inp.responses.some(r => r.passport_state !== 'PASS'))) {
    science = 'NOT_ESTABLISHED'; add('SCIENCE_PROJECTION_INCONSISTENT');
  }
  // V-9: una respuesta screened sin referencia de DM no se acepta.
  if (inp.responses.some(r => r.kind === 'screened' && !r.dm_reference)) add('DM_REFERENCE_MISSING');
  // V-8: la cadena de intentos es contigua por generación.
  const attempts = [...inp.attempts].sort((a, b) => a.generation - b.generation);
  if (attempts.some((a, i) => a.generation !== i + 1 || (i === 0 ? a.previous_attempt_id !== null : a.previous_attempt_id !== attempts[i - 1].attempt_id))) add('ATTEMPT_CHAIN_BROKEN');
  // V-10: la política del plan de reanudación debe ser la del run.
  const policyChanged = inp.resume_plan !== null && !sameSet(inp.resume_plan.policy_digests, inp.run.policy_digests);
  if (policyChanged) add('POLICY_CHANGED');

  let headline, tone, cancel = false;
  const ex = p.execution;
  if (p.integrity === 'ALTERED' || p.integrity === 'MISSING' || p.integrity === 'INCOMPLETE') { headline = 'INTEGRITY_PROBLEM'; tone = 'error'; }
  else if (ex === 'UNKNOWN' || p.scheduler === 'SUBMISSION_UNKNOWN') { headline = 'OUTCOME_UNKNOWN'; tone = 'warn'; add('RECONCILE_REQUIRED'); }
  else if (inp.cancel_requested && !TERMINAL.has(ex)) { headline = 'CANCELLING'; tone = 'progress'; if (p.scheduler === 'CANCELLED') add('EVIDENCE_PENDING'); }
  else if (ex === 'PREPARED' || ex === 'SUBMITTED' && p.scheduler === 'PENDING') { headline = 'QUEUED'; tone = 'neutral'; cancel = ex === 'SUBMITTED'; }
  else if (ACTIVE.has(ex)) { headline = 'RUNNING'; tone = 'progress'; cancel = true; }
  else if (ex === 'CANCELLED') { headline = 'CANCELLED'; tone = 'neutral'; }
  else if (ex === 'INTERRUPTED') { headline = 'INTERRUPTED'; tone = 'warn'; }
  else if (ex === 'FAILED') { headline = 'FAILED'; tone = 'error'; }
  else if (ex === 'COMPLETED') {
    headline = { PASS: 'COMPLETED_SCIENCE_PASS', FAIL: 'COMPLETED_SCIENCE_FAIL', REVIEW: 'COMPLETED_SCIENCE_REVIEW' }[science] ?? 'COMPLETED_SCIENCE_NOT_ESTABLISHED';
    tone = { COMPLETED_SCIENCE_PASS: 'ok', COMPLETED_SCIENCE_FAIL: 'error' }[headline] ?? 'warn';
  } else { headline = 'OUTCOME_UNKNOWN'; tone = 'warn'; add('RECONCILE_REQUIRED'); }
  if (headline === 'COMPLETED_SCIENCE_PASS' && (p.integrity !== 'VERIFIED' || banners.includes('DM_REFERENCE_MISSING') || banners.includes('SCIENCE_PROJECTION_INCONSISTENT'))) { headline = 'COMPLETED_SCIENCE_NOT_ESTABLISHED'; tone = 'warn'; }

  // V-3: usar el resultado exige ejecución completa, ciencia PASS, integridad verificada y nada en los avisos.
  const useResult = headline === 'COMPLETED_SCIENCE_PASS';

  // V-5, V-6, V-10: reanudar. La primera condición que falla da el motivo.
  let resume = false, resumeReason = null;
  if (!['INTERRUPTED', 'CANCELLED'].includes(ex)) resumeReason = ex === 'FAILED' ? 'EXECUTION_FAILED' : 'NOT_RESUMABLE_STATE';
  else if (!inp.platform_resume_enabled) resumeReason = 'PLATFORM_RESUME_NOT_QUALIFIED';
  else if (inp.resume_plan === null) resumeReason = 'NO_RESUME_PLAN';
  else if (inp.resume_plan.expired) resumeReason = 'RESUME_PLAN_EXPIRED';
  else if (policyChanged) resumeReason = 'POLICY_CHANGED';
  else if (banners.includes('ATTEMPT_CHAIN_BROKEN')) resumeReason = 'ATTEMPT_CHAIN_BROKEN';
  else if (inp.admission === null) resumeReason = 'ADMISSION_UNKNOWN';
  else if (inp.admission.decision !== 'ADMIT') resumeReason = inp.admission.reason;
  else resume = true;
  const plan = inp.resume_plan === null ? null : {
    plan_revision: inp.resume_plan.plan_revision, from_attempt_id: inp.resume_plan.from_attempt_id,
    reuse_count: inp.resume_plan.nodes.reuse.length, pending_count: inp.resume_plan.nodes.pending.length,
    invalid: inp.resume_plan.nodes.invalid.map(x => ({ node_id: x.node_id, reason: x.reason })),
    seeds: inp.resume_plan.nodes.seed_candidates.map(x => ({ node_id: x.node_id, kind: x.kind })),
  };
  return {
    headline, tone, science: { state: science, basis },
    actions: { cancel, resume, use_result: useResult, resume_reason: resume ? null : resumeReason },
    resume_plan: plan,
    preserved: { plan_digest: inp.run.plan_digest, policy_digests: [...inp.run.policy_digests], responses: inp.responses.map(r => ({ kind: r.kind, native_status: r.native_status, passport_state: r.passport_state, dm_reference: r.dm_reference, precision: r.precision })) },
    attempts: attempts.map(a => ({ attempt_id: a.attempt_id, generation: a.generation, state: a.state, previous_attempt_id: a.previous_attempt_id, current: a.generation === attempts.length })),
    banners,
  };
}
