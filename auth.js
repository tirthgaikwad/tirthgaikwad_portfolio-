// ==========================================
// AUTH.JS — Shared by the login and sign-up pages (login.html, register.html)
// Server address, form helpers (field errors, the notice, busy buttons), show/hide password,
// the Caps Lock hint and the 3D network on the picture side.
// These two pages do not load shared.js, so the server address is repeated here.
// ==========================================
const API_BASE = `${window.location.protocol}//${window.location.hostname || '127.0.0.1'}:8000`;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ALERT_ICON = '<svg class="icon" aria-hidden="true"><use href="#i-alert"/></svg>';

// ==========================================
// 1. TALKING TO THE SERVER
// ==========================================

// Sends JSON and always answers { ok, status, data, message }; it never throws.
// The login cookie is set by the server, so credentials go with every call.
async function postJson(path, body) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (err) {
    return { ok: false, status: 0, data: null, message: 'Could not reach the server. Check your connection and try again.' };
  }
  let data = null;
  try { data = await res.json(); } catch (err) { /* an empty or non-JSON answer */ }
  if (res.ok) return { ok: true, status: res.status, data, message: '' };

  let message = '';
  if (res.status === 429) message = 'Too many attempts. Wait a minute and try again.';
  else if (data && typeof data.detail === 'string') message = data.detail;
  else if (data && Array.isArray(data.detail) && data.detail.length) message = 'Some details were not accepted. Check the form and try again.';
  else if (res.status >= 500) message = 'The server had a problem. Try again in a moment.';
  return { ok: false, status: res.status, data, message };
}

// ==========================================
// 2. FORM HELPERS
// ==========================================

// Marks a field wrong and writes the reason under it. An empty message clears it.
function setFieldError(input, message) {
  const field = input.closest('.field');
  if (!field) return;
  let line = field.querySelector('.error');
  field.classList.toggle('invalid', Boolean(message));
  if (!message) {
    if (line) line.remove();
    input.removeAttribute('aria-invalid');
    return;
  }
  if (!line) {
    line = document.createElement('p');
    line.className = 'error';
    line.id = `${input.id}-error`;
    line.setAttribute('role', 'alert');
    field.appendChild(line);
  }
  line.textContent = message;
  input.setAttribute('aria-invalid', 'true');
}

// The message above a form. An empty message hides it.
function showNotice(box, message) {
  box.hidden = !message;
  if (!message) return;
  box.innerHTML = `${ALERT_ICON}<span></span>`;
  box.lastElementChild.textContent = message;
  if (REDUCED_MOTION) return;
  box.classList.remove('shake');
  void box.offsetWidth;   // lets the shake run again for a second error
  box.classList.add('shake');
}

function setBusy(button, busy) {
  button.disabled = busy;
  button.classList.toggle('loading', busy);
}

// A field stops being marked wrong as soon as the person edits it
document.addEventListener('input', (e) => {
  if (e.target.closest('.field.invalid')) setFieldError(e.target, '');
});

// ==========================================
// 3. PASSWORD FIELDS: SHOW/HIDE AND CAPS LOCK
// ==========================================
document.addEventListener('click', (e) => {
  const button = e.target.closest('.peek');
  if (!button) return;
  const input = document.getElementById(button.dataset.for);
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(show));
  button.setAttribute('aria-label', show ? 'Hide' : 'Show');
  button.querySelector('use').setAttribute('href', show ? '#i-eye-off' : '#i-eye');
});

function syncCapsHint(e) {
  const input = e.target;
  if (!input.dataset || !input.dataset.caps || !e.getModifierState) return;
  document.getElementById(input.dataset.caps).hidden = !e.getModifierState('CapsLock');
}
document.addEventListener('keydown', syncCapsHint);
document.addEventListener('keyup', syncCapsHint);

// ==========================================
// 4. THE PICTURE SIDE
// ==========================================
// On a phone the picture side is not shown, so nothing is drawn there
const authNet = document.getElementById('authNet');
if (window.startNetwork && authNet.clientWidth > 0) window.startNetwork(authNet);
