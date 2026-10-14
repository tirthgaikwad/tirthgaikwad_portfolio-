// ==========================================
// FORMSHEET.JS — one small pop-up form, used by the study pages (My Study, Notes, Practice, Resume).
// openSheet({ title, fields, submitLabel, onSubmit, onDelete, deleteLabel, note })
//   fields: [{ name, label, type, value, options, placeholder, required, min, max, step, maxlength, half, hint }]
//     type: text (default), number, date, time, select, textarea, checkbox, file
//     options (select): [[value, label], ...]      half: two fields share a row
//   onSubmit(values) / onDelete() may be async; throw an Error to show its message and keep the form open,
//   or return false to keep it open without a message.
// Styled by formsheet.css. Needs escapeHtml from shared.js.
// ==========================================
let sheetState = null;

function closeSheet() {
  if (!sheetState) return;
  document.removeEventListener('keydown', sheetState.onKey);
  sheetState.overlay.remove();
  if (sheetState.opener && document.contains(sheetState.opener)) sheetState.opener.focus();
  sheetState = null;
}

function sheetFieldHtml(field) {
  const id = `sheet-${field.name}`;
  const value = field.value === undefined || field.value === null ? '' : field.value;
  const common = `id="${id}" name="${field.name}" ${field.required ? 'required' : ''}`;
  let control;
  if (field.type === 'select') {
    control = `<select ${common}>${field.options.map(([optionValue, label]) =>
      `<option value="${escapeHtml(optionValue)}" ${String(optionValue) === String(value) ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>`;
  } else if (field.type === 'textarea') {
    control = `<textarea ${common} rows="3" maxlength="${field.maxlength || 1000}" placeholder="${escapeHtml(field.placeholder || '')}">${escapeHtml(value)}</textarea>`;
  } else if (field.type === 'checkbox') {
    return `<label class="fs-check${field.half ? ' fs-half' : ''}"><input type="checkbox" ${common} ${value ? 'checked' : ''}/><span>${escapeHtml(field.label)}</span></label>`;
  } else if (field.type === 'file') {
    control = `<input type="file" ${common} ${field.accept ? `accept="${escapeHtml(field.accept)}"` : ''}/>`;
  } else {
    const extra = ['min', 'max', 'step', 'maxlength'].filter(key => field[key] !== undefined).map(key => `${key}="${escapeHtml(field[key])}"`).join(' ');
    control = `<input type="${field.type || 'text'}" ${common} value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder || '')}" ${extra} autocomplete="off"/>`;
  }
  return `<div class="fs-field${field.half ? ' fs-half' : ''}"><label for="${id}">${escapeHtml(field.label)}</label>${control}${field.hint ? `<small>${escapeHtml(field.hint)}</small>` : ''}</div>`;
}

function sheetValues(form, fields) {
  const values = {};
  for (const field of fields) {
    const input = form.elements[field.name];
    if (field.type === 'checkbox') values[field.name] = input.checked;
    else if (field.type === 'file') values[field.name] = input.files[0] || null;
    else if (field.type === 'number') values[field.name] = input.value.trim() === '' ? null : Number(input.value);
    else values[field.name] = input.value.trim();
  }
  return values;
}

function openSheet(options) {
  closeSheet();
  const overlay = document.createElement('div');
  overlay.className = 'fs-overlay';
  overlay.innerHTML = `
    <form class="fs-sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle" novalidate>
      <div class="fs-head"><h3 id="sheetTitle">${escapeHtml(options.title)}</h3>
        <button type="button" class="fs-close" data-sheet-close aria-label="Close">&times;</button></div>
      ${options.note ? `<p class="fs-note">${escapeHtml(options.note)}</p>` : ''}
      <div class="fs-fields">${options.fields.map(sheetFieldHtml).join('')}</div>
      <p class="fs-error" role="alert" hidden></p>
      <div class="fs-actions">
        ${options.onDelete ? `<button type="button" class="fs-btn fs-danger" data-sheet-delete>${escapeHtml(options.deleteLabel || 'Delete')}</button>` : ''}
        <span class="fs-gap"></span>
        <button type="button" class="fs-btn fs-quiet" data-sheet-close>Cancel</button>
        <button type="submit" class="fs-btn fs-primary">${escapeHtml(options.submitLabel || 'Save')}</button>
      </div>
    </form>`;
  const form = overlay.querySelector('form');
  const error = overlay.querySelector('.fs-error');
  const buttons = [...overlay.querySelectorAll('.fs-btn')];
  let busy = false;

  const run = async (work) => {
    if (busy) return;
    busy = true;
    error.hidden = true;
    buttons.forEach(button => { button.disabled = true; });
    try {
      // A handler that returns false changed its mind (a declined "are you sure"): the form stays open
      if (await work() === false) {
        busy = false;
        buttons.forEach(button => { button.disabled = false; });
        return;
      }
      closeSheet();
    } catch (err) {
      error.textContent = err.message || 'Something went wrong. Try again.';
      error.hidden = false;
      busy = false;
      buttons.forEach(button => { button.disabled = false; });
    }
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const missing = options.fields.find(field => field.required && field.type !== 'checkbox' && !(field.type === 'file' ? form.elements[field.name].files.length : form.elements[field.name].value.trim()));
    if (missing) {
      error.textContent = `Fill in: ${missing.label}.`;
      error.hidden = false;
      return form.elements[missing.name].focus();
    }
    run(() => options.onSubmit(sheetValues(form, options.fields)));
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-sheet-close]')) { if (!busy) closeSheet(); }
    else if (e.target.closest('[data-sheet-delete]')) run(() => options.onDelete());
  });
  const onKey = (e) => { if (e.key === 'Escape' && !busy) closeSheet(); };
  document.addEventListener('keydown', onKey);

  sheetState = { overlay, onKey, opener: document.activeElement };
  document.body.appendChild(overlay);
  if (options.onOpen) options.onOpen(form);
  const first = form.querySelector('input:not([type=checkbox]):not([type=file]), select, textarea');
  if (first && window.matchMedia('(min-width: 768px)').matches) first.focus();
  return form;
}
