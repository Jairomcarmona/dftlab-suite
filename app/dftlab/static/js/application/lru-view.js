const ACTIVE = new Set(['SUBMITTED', 'RUNNING', 'COLLECTING']);
const TERMINAL = new Set(['CANCELLED', 'INTERRUPTED', 'FAILED', 'COMPLETED']);

const sameSet = (left, right) => {
  if (left.length !== right.length) return false;
  const a = [...left].sort(), b = [...right].sort();
  return a.every((value, index) => value === b[index]);
};

// Pure LR-U presentation rules. Status values remain native codes; this module
// neither reads the DOM nor translates or recalculates scientific evidence.
export function lruView(input) {
  const projection = input.projection;
  const banners = [];
  const addBanner = code => { if (!banners.includes(code)) banners.push(code); };
  let science = projection.science;
  const basis = input.responses.length ? 'AUTHORITY_ASSESSMENT' : 'NONE';

  if (science === 'PASS' && (!input.responses.length || input.responses.some(response => response.passport_state !== 'PASS'))) {
    science = 'NOT_ESTABLISHED';
    addBanner('SCIENCE_PROJECTION_INCONSISTENT');
  }
  if (input.responses.some(response => response.kind === 'screened' && !response.dm_reference)) {
    addBanner('DM_REFERENCE_MISSING');
  }

  const attempts = [...input.attempts].sort((left, right) => left.generation - right.generation);
  if (attempts.some((attempt, index) => attempt.generation !== index + 1 ||
      (index === 0 ? attempt.previous_attempt_id !== null : attempt.previous_attempt_id !== attempts[index - 1].attempt_id))) {
    addBanner('ATTEMPT_CHAIN_BROKEN');
  }

  const policyChanged = input.resume_plan !== null &&
    !sameSet(input.resume_plan.policy_digests, input.run.policy_digests);
  if (policyChanged) addBanner('POLICY_CHANGED');

  const execution = projection.execution;
  let headline, tone, cancel = false;
  if (['ALTERED', 'MISSING', 'INCOMPLETE'].includes(projection.integrity)) {
    headline = 'INTEGRITY_PROBLEM';
    tone = 'error';
  } else if (execution === 'UNKNOWN' || projection.scheduler === 'SUBMISSION_UNKNOWN') {
    headline = 'OUTCOME_UNKNOWN';
    tone = 'warn';
    addBanner('RECONCILE_REQUIRED');
  } else if (input.cancel_requested && !TERMINAL.has(execution)) {
    headline = 'CANCELLING';
    tone = 'progress';
    if (projection.scheduler === 'CANCELLED') addBanner('EVIDENCE_PENDING');
  } else if (execution === 'PREPARED' || execution === 'SUBMITTED' && projection.scheduler === 'PENDING') {
    headline = 'QUEUED';
    tone = 'neutral';
    cancel = execution === 'SUBMITTED';
  } else if (ACTIVE.has(execution)) {
    headline = 'RUNNING';
    tone = 'progress';
    cancel = true;
  } else if (execution === 'CANCELLED') {
    headline = 'CANCELLED';
    tone = 'neutral';
  } else if (execution === 'INTERRUPTED') {
    headline = 'INTERRUPTED';
    tone = 'warn';
  } else if (execution === 'FAILED') {
    headline = 'FAILED';
    tone = 'error';
  } else if (execution === 'COMPLETED') {
    headline = {
      PASS: 'COMPLETED_SCIENCE_PASS',
      FAIL: 'COMPLETED_SCIENCE_FAIL',
      REVIEW: 'COMPLETED_SCIENCE_REVIEW',
    }[science] ?? 'COMPLETED_SCIENCE_NOT_ESTABLISHED';
    tone = { COMPLETED_SCIENCE_PASS: 'ok', COMPLETED_SCIENCE_FAIL: 'error' }[headline] ?? 'warn';
  } else {
    headline = 'OUTCOME_UNKNOWN';
    tone = 'warn';
    addBanner('RECONCILE_REQUIRED');
  }

  if (headline === 'COMPLETED_SCIENCE_PASS' &&
      (projection.integrity !== 'VERIFIED' || banners.includes('DM_REFERENCE_MISSING') || banners.includes('SCIENCE_PROJECTION_INCONSISTENT'))) {
    headline = 'COMPLETED_SCIENCE_NOT_ESTABLISHED';
    tone = 'warn';
  }
  const useResult = headline === 'COMPLETED_SCIENCE_PASS';

  let resume = false, resumeReason = null;
  if (!['INTERRUPTED', 'CANCELLED'].includes(execution)) resumeReason = execution === 'FAILED' ? 'EXECUTION_FAILED' : 'NOT_RESUMABLE_STATE';
  else if (!input.platform_resume_enabled) resumeReason = 'PLATFORM_RESUME_NOT_QUALIFIED';
  else if (input.resume_plan === null) resumeReason = 'NO_RESUME_PLAN';
  else if (input.resume_plan.expired) resumeReason = 'RESUME_PLAN_EXPIRED';
  else if (policyChanged) resumeReason = 'POLICY_CHANGED';
  else if (banners.includes('ATTEMPT_CHAIN_BROKEN')) resumeReason = 'ATTEMPT_CHAIN_BROKEN';
  else if (input.admission === null) resumeReason = 'ADMISSION_UNKNOWN';
  else if (input.admission.decision !== 'ADMIT') resumeReason = input.admission.reason;
  else resume = true;

  const resumePlan = input.resume_plan === null ? null : {
    plan_revision: input.resume_plan.plan_revision,
    from_attempt_id: input.resume_plan.from_attempt_id,
    reuse_count: input.resume_plan.nodes.reuse.length,
    pending_count: input.resume_plan.nodes.pending.length,
    invalid: input.resume_plan.nodes.invalid.map(item => ({ node_id: item.node_id, reason: item.reason })),
    seeds: input.resume_plan.nodes.seed_candidates.map(item => ({ node_id: item.node_id, kind: item.kind })),
  };

  return {
    headline,
    tone,
    science: { state: science, basis },
    actions: { cancel, resume, use_result: useResult, resume_reason: resume ? null : resumeReason },
    resume_plan: resumePlan,
    preserved: {
      plan_digest: input.run.plan_digest,
      policy_digests: [...input.run.policy_digests],
      responses: input.responses.map(response => ({
        kind: response.kind,
        native_status: response.native_status,
        passport_state: response.passport_state,
        dm_reference: response.dm_reference,
        precision: response.precision,
      })),
    },
    attempts: attempts.map(attempt => ({
      attempt_id: attempt.attempt_id,
      generation: attempt.generation,
      state: attempt.state,
      previous_attempt_id: attempt.previous_attempt_id,
      current: attempt.generation === attempts.length,
    })),
    banners,
  };
}
