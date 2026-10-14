// Native result presentation only: no scientific formula, grouping or gate.
export function parseNativeResult(text) {
  const raw=JSON.parse(text);
  if (!['qraft.electronic.policy@1','qraft.eos.policy@1'].includes(raw.policy_id))
    throw new Error('UNSUPPORTED_NATIVE_RESULT_POLICY');
  nativeResultSummary(raw);
  return raw;
}

export function nativeResultSummary(raw) {
  const groups=structuredClone(raw.groups||[]);
  for (const group of groups) {
    if (!Array.isArray(group.bands)||group.size!==group.bands.length||group.size<1||'individual_weights' in group)
      throw new Error('INVALID_NATIVE_GROUP_PRESENTATION');
  }
  return {policy_id:raw.policy_id, status:raw.status??null, reasons:structuredClone(raw.reasons??[]),
    scope:raw.gap?.scope??raw.scope??null, authority:raw.authority??raw.parent_electronic_state?.authority??null,
    origin:raw.origin??null, worker_environment_sha256:raw.worker_environment_sha256??null,
    gap:structuredClone(raw.gap??null), longitudinal:structuredClone(raw.longitudinal??null),
    transverse:structuredClone(raw.transverse??[]), partition:structuredClone(raw.partition??null),
    groups, native_result:structuredClone(raw)};
}

export function renderNativeResult(target,raw) {
  const summary=nativeResultSummary(raw);
  const output=target.ownerDocument.createElement('pre');
  output.textContent=JSON.stringify(summary,null,2);
  target.replaceChildren(output);
  return summary;
}
