import { esc } from '../core/escape.js';
import { panel } from '../core/ui.js';
import { lruView } from './lru-view.js';

const value = item => esc(item ?? '');

function actionButton(code) {
  return `<button type="button" data-lru-action="${code}">${code}</button>`;
}

export function lruPanel(input) {
  const model = lruView(input);
  const actions = [
    model.actions.cancel && actionButton('CANCEL'),
    model.actions.resume && actionButton('RESUME'),
    model.actions.use_result && actionButton('USE_RESULT'),
  ].filter(Boolean).join('');
  const responses = model.preserved.responses.map(response =>
    `<li><span>${value(response.kind)}</span> <span>${value(response.native_status)}</span> ` +
    `<span>${value(response.passport_state)}</span> <span>${value(response.dm_reference)}</span> ` +
    `<span>${value(response.precision)}</span></li>`).join('');
  const attempts = model.attempts.map(attempt =>
    `<li><span>${value(attempt.generation)}</span> <span>${value(attempt.attempt_id)}</span> ` +
    `<span>${value(attempt.state)}</span> <span>${value(attempt.previous_attempt_id)}</span> ` +
    `<span>${value(attempt.current)}</span></li>`).join('');
  const banners = model.banners.map(code => `<li>${value(code)}</li>`).join('');
  const invalid = model.resume_plan?.invalid.map(item =>
    `<li><span>${value(item.node_id)}</span> <span>${value(item.reason)}</span></li>`).join('') ?? '';
  const seeds = model.resume_plan?.seeds.map(item =>
    `<li><span>${value(item.node_id)}</span> <span>${value(item.kind)}</span></li>`).join('') ?? '';
  const plan = model.resume_plan === null ? '' :
    `<div data-lru-plan=""><span>${value(model.resume_plan.plan_revision)}</span> ` +
    `<span>${value(model.resume_plan.from_attempt_id)}</span> <span>${value(model.resume_plan.reuse_count)}</span> ` +
    `<span>${value(model.resume_plan.pending_count)}</span><ul>${invalid}${seeds}</ul></div>`;
  const body = `<div data-lru-science=""><span>${value(model.science.state)}</span> <span>${value(model.science.basis)}</span></div>` +
    `<div data-lru-actions="">${actions}<span>${value(model.actions.resume_reason)}</span></div>` +
    `<div data-lru-preserved=""><span>${value(model.preserved.plan_digest)}</span>` +
    `<ul>${model.preserved.policy_digests.map(digest => `<li>${value(digest)}</li>`).join('')}</ul><ul>${responses}</ul></div>` +
    `<div data-lru-attempts=""><ul>${attempts}</ul></div>${plan}<ul data-lru-banners="">${banners}</ul>`;
  const markup = panel({ title: value(model.headline), sub: value(model.tone), cls: `lru-${value(model.tone)}`, body });
  const container = document.createElement('div');
  container.innerHTML = markup;
  const element = container.firstElementChild;
  for (const button of element.querySelectorAll('[data-lru-action]')) {
    button.addEventListener('click', () => {
      element.dispatchEvent(new CustomEvent('dftlab:lru-action', {
        bubbles: true,
        detail: { action: button.dataset.lruAction, idempotency_key: crypto.randomUUID() },
      }));
    });
  }
  return { element, model };
}
