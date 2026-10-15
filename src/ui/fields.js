// Form field builders with labels, hints and inline messages.
import { h, icon } from './dom.js';

let uid = 0;
const nextId = (p) => `${p}-${++uid}`;

/** Wraps a control with a label, optional hint, and a slot for error/warning text. */
export function field(name, label, control, { hint } = {}) {
  const id = control.id || nextId(name);
  control.id = id;
  const msgId = `${id}-msg`;
  control.setAttribute('aria-describedby', msgId);
  return h(
    'div',
    { class: 'field', 'data-field': name },
    h('label', { for: id, class: 'field-label' }, label),
    control,
    hint ? h('p', { class: 'field-hint' }, hint) : null,
    h('p', { class: 'field-msg', id: msgId }),
  );
}

export function textInput(name, value = '', attrs = {}) {
  return h('input', { type: 'text', name, value, autocomplete: 'off', class: 'input', ...attrs });
}

export function dateInput(name, value = '', attrs = {}) {
  return h('input', { type: 'date', name, value, class: 'input', ...attrs });
}

export function timeInput(name, value = '', attrs = {}) {
  return h('input', { type: 'time', name, value, class: 'input', step: 300, ...attrs });
}

export function select(name, options, value, attrs = {}) {
  return h(
    'select',
    { name, class: 'input', ...attrs },
    options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)),
  );
}

/** Number with big − / + buttons. format(n) gives the visible text. */
export function stepper(name, value, { min, max, step = 1, format = (n) => String(n), label }) {
  const input = h('input', { type: 'hidden', name, value: String(value) });
  const out = h('output', { class: 'stepper-value', 'aria-live': 'polite' }, format(value));
  const set = (n) => {
    const v = Math.min(max, Math.max(min, Math.round(n / step) * step));
    input.value = String(v);
    out.textContent = format(v);
    minus.disabled = v <= min;
    plus.disabled = v >= max;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const minus = h(
    'button',
    { type: 'button', class: 'stepper-btn', 'aria-label': `Less ${label}`, onclick: () => set(Number(input.value) - step) },
    '−',
  );
  const plus = h(
    'button',
    { type: 'button', class: 'stepper-btn', 'aria-label': `More ${label}`, onclick: () => set(Number(input.value) + step) },
    '+',
  );
  minus.disabled = value <= min;
  plus.disabled = value >= max;
  const wrap = h('div', { class: 'stepper', role: 'group' }, minus, out, plus, input);
  wrap.setValue = set;
  return wrap;
}

/** Row of pill buttons acting as radio buttons (or checkboxes when multiple). */
export function chips(name, options, selected, { multiple = false, label } = {}) {
  const sel = new Set([].concat(selected).map(String));
  const group = h('div', { class: 'chips', role: multiple ? 'group' : 'radiogroup', 'aria-label': label });
  for (const o of options) {
    const input = h('input', {
      type: multiple ? 'checkbox' : 'radio',
      name,
      value: String(o.value),
      checked: sel.has(String(o.value)),
      class: 'visually-hidden',
    });
    group.append(h('label', { class: 'chip' }, input, h('span', {}, o.label)));
  }
  return group;
}

/** Shows errors (blocking) and warnings (gentle) under the matching fields. */
export function showMessages(form, { errors = {}, warnings = {} }) {
  for (const f of form.querySelectorAll('.field[data-field]')) {
    const name = f.dataset.field;
    const msg = f.querySelector('.field-msg');
    if (!msg) continue;
    const text = errors[name] ?? warnings[name] ?? '';
    msg.textContent = text;
    f.classList.toggle('has-error', Boolean(errors[name]));
    f.classList.toggle('has-warning', !errors[name] && Boolean(warnings[name]));
  }
  const firstError = form.querySelector('.field.has-error');
  if (firstError) {
    firstError.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const ctl = firstError.querySelector('input:not([type=hidden]), select, button');
    ctl?.focus({ preventScroll: true });
  }
}

/** Big round "add" button pinned above the tab bar. */
export function fab(label, onclick) {
  return h('button', { type: 'button', class: 'fab', onclick }, icon('plus', 24), h('span', {}, label));
}

/** Gentle empty state. */
export function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, icon('peak', 40), h('h3', {}, title), h('p', {}, text), action ?? null);
}
