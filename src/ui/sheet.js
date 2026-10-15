// Bottom sheet built on <dialog>: focus trap, Esc to close, and the phone's Back button closes it.
import { h, icon } from './dom.js';

let openCount = 0;

/**
 * openSheet({ title, body, submitLabel, onSubmit, extraActions })
 * - body: a Node (usually form fields)
 * - onSubmit(form): return false to keep the sheet open (e.g. validation errors),
 *   or a function to run after the sheet has closed (e.g. navigate somewhere)
 * - extraActions: Nodes shown on the left of the footer (e.g. Delete)
 * Returns { close, closed, dialog, form }. `closed` resolves once the sheet (and its history entry) is gone,
 * so it is safe to navigate or open another sheet after awaiting it.
 */
export function openSheet({ title, body, submitLabel = 'Save', submitClass = 'btn-primary', onSubmit, extraActions = [], onClose }) {
  const titleId = `sheet-title-${Date.now()}`;
  const form = h('form', { class: 'sheet-form', novalidate: true });
  const saveBtn = h('button', { type: 'submit', class: `btn ${submitClass}` }, submitLabel);

  form.append(
    h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }),
    h(
      'header',
      { class: 'sheet-head' },
      h('h2', { id: titleId }, title),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => close() }, icon('close')),
    ),
    h('div', { class: 'sheet-body' }, body),
    h('footer', { class: 'sheet-foot' }, h('div', { class: 'sheet-extra' }, extraActions), saveBtn),
  );

  const dialog = h('dialog', { class: 'sheet', 'aria-labelledby': titleId }, form);
  document.body.append(dialog);

  let closed = false;
  let pushed = false;
  let resolveClosed;
  const closedPromise = new Promise((r) => (resolveClosed = r));

  function teardown() {
    if (closed) return;
    closed = true;
    openCount--;
    window.removeEventListener('popstate', onPop);
    dialog.classList.add('closing');
    const done = () => dialog.remove();
    // Let the slide-down animation play, but never depend on it.
    setTimeout(done, 180);
    if (dialog.open) dialog.close();
    onClose?.();
    resolveClosed();
  }

  function close() {
    if (closed) return;
    if (pushed && history.state?.ascendSheet) {
      history.back(); // popstate → teardown
    } else {
      teardown();
    }
  }

  function onPop() {
    teardown();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saveBtn.disabled) return;
    saveBtn.disabled = true;
    try {
      const res = await onSubmit?.(form);
      if (res !== false) {
        close();
        // A returned function runs once the sheet is gone (safe place to navigate).
        if (typeof res === 'function') closedPromise.then(res);
      }
    } catch (err) {
      console.error(err);
      showFormMessage(form, 'Something went wrong while saving. Please try again.');
    } finally {
      saveBtn.disabled = false;
    }
  });

  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  // Tap on the dimmed backdrop closes the sheet.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });

  openCount++;
  history.pushState({ ascendSheet: true }, '');
  pushed = true;
  window.addEventListener('popstate', onPop);
  dialog.showModal();
  // Focus the first field rather than the close button.
  const first = form.querySelector('.sheet-body input, .sheet-body select, .sheet-body textarea');
  // On touch screens, don't pop the keyboard up straight away.
  if (first && window.matchMedia('(pointer: fine)').matches) first.focus();

  return { close, closed: closedPromise, dialog, form };
}

export function isSheetOpen() {
  return openCount > 0;
}

function showFormMessage(form, text) {
  let msg = form.querySelector('.form-message');
  if (!msg) {
    msg = h('p', { class: 'form-message', role: 'alert' });
    form.querySelector('.sheet-body').prepend(msg);
  }
  msg.textContent = text;
}

/** Simple confirm sheet. Resolves true when confirmed. */
export function confirmSheet({ title, message, confirmLabel = 'Delete' }) {
  return new Promise((resolve) => {
    let confirmed = false;
    openSheet({
      title,
      body: h('p', { class: 'confirm-text' }, message),
      submitLabel: confirmLabel,
      submitClass: 'btn-danger',
      onSubmit: () => {
        confirmed = true;
      },
      onClose: () => resolve(confirmed),
    });
  });
}
