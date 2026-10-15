// ==========================================
// ACCOUNT.JS — Account & privacy: download my data, my DPDP Act rights (consent, nominee), delete my account.
// A deletion waits a few days on the server (logging in again cancels it), then everything personal is erased.
// Loaded after shared.js and chat-common.js.
// ==========================================

async function initAccount() {
  el('exportBtn').addEventListener('click', downloadMyData);
  ['deletePassword', 'deleteConfirm', 'deleteUnderstand'].forEach(id => el(id).addEventListener('input', paintDeleteButton));
  el('deleteUnderstand').addEventListener('change', paintDeleteButton);
  el('deleteForm').addEventListener('submit', deleteMyAccount);
  initDpdpCard();
  try {
    const state = await fetchPageData('/api/me/account');
    document.querySelectorAll('[data-grace]').forEach(node => { node.textContent = state.grace_days; });
    document.querySelector('[data-plan-note]').hidden = !state.has_plan;
    document.querySelector('[data-teacher-note]').hidden = !state.is_teacher;
    if (!state.can_delete) {
      document.querySelector('[data-founder-note]').hidden = false;
      el('deleteForm').hidden = true;
    }
  } catch (err) { /* the form still works; the server checks everything again */ }
}

function confirmTyped() {
  return el('deleteConfirm').value.trim().toUpperCase() === 'DELETE';
}

function paintDeleteButton() {
  el('deleteBtn').disabled = !(el('deletePassword').value && confirmTyped() && el('deleteUnderstand').checked);
}

function showDeleteError(message) {
  const box = el('deleteError');
  box.textContent = message || '';
  box.hidden = !message;
}

// ---------- download my data ----------
async function downloadMyData() {
  const button = el('exportBtn');
  const status = el('exportStatus');
  button.disabled = true;
  status.classList.remove('is-error');
  status.textContent = 'Collecting your data…';
  try {
    const res = await fetch(`${API_BASE}/api/me/export`, { credentials: 'include' });
    if (res.status === 401) { handleLoggedOut(); return; }
    if (!res.ok) {
      let detail = res.status === 429 ? 'You have downloaded your data a few times already. Try again in an hour.' : 'Could not prepare the file. Please try again.';
      try { const data = await res.json(); if (res.status !== 429 && typeof data.detail === 'string') detail = data.detail; } catch (e) { /* not JSON */ }
      throw new Error(detail);
    }
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `connect2minds-my-data-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    status.textContent = 'Downloaded.';
  } catch (err) {
    status.classList.add('is-error');
    status.textContent = err.message === 'Failed to fetch' ? 'Could not reach the server.' : err.message;
  } finally {
    button.disabled = false;
  }
}

// ---------- DPDP Act 2023: consent and nominee ----------
let dpdpNominee = null;

function initDpdpCard() {
  el('nomineeBtn').addEventListener('click', () => openNomineeForm(true));
  el('nomCancel').addEventListener('click', () => openNomineeForm(false));
  el('nomineeForm').addEventListener('submit', saveNominee);
  el('nomRemove').addEventListener('click', removeNominee);
  el('dpAgreeBtn').addEventListener('click', agreeToNotice);
  document.addEventListener('privacyconsent', loadDpdp);    // agreed in the bar shared.js shows
  loadDpdp();
}

function readableDate(iso) {
  const date = new Date(iso);
  return isNaN(date) ? '' : date.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
}

async function loadDpdp() {
  try {
    const state = await api('/api/me/dpdp');
    paintConsent(state);
    paintNominee(state.nominee);
  } catch (err) {
    el('dpConsent').textContent = el('dpNominee').textContent = 'Could not load. Refresh the page.';
  }
}

function paintConsent(state) {
  const box = el('dpConsent');
  const agreedOn = state.consent_at ? readableDate(state.consent_at) : '';
  if (!state.consent_needed) {
    box.innerHTML = `Given on ${escapeHtml(agreedOn)}<small>Notice of ${escapeHtml(readableDate(state.current_version))}</small>`;
  } else {
    box.innerHTML = state.consent_version
      ? `Notice updated since you agreed<small>You agreed to the notice of ${escapeHtml(readableDate(state.consent_version))} on ${escapeHtml(agreedOn)}</small>`
      : 'Not yet given for the current notice<small>Your account is older than the DPDP notice</small>';
  }
  el('dpAgreeBtn').hidden = !state.consent_needed;
}

function paintNominee(nominee) {
  dpdpNominee = nominee;
  const box = el('dpNominee');
  if (!nominee) {
    box.innerHTML = 'None<small>Optional: someone who can use your rights if you cannot</small>';
  } else {
    const contact = [nominee.relation, nominee.email, nominee.phone].filter(Boolean).join(' · ');
    box.innerHTML = `${escapeHtml(nominee.name)}<small>${escapeHtml(contact)}</small>`;
  }
  el('nomineeBtn').lastChild.textContent = nominee ? 'Change nominee' : 'Add a nominee';
}

function openNomineeForm(open) {
  const form = el('nomineeForm');
  form.hidden = !open;
  el('nomineeBtn').hidden = open;
  el('nomError').hidden = true;
  if (!open) return;
  const n = dpdpNominee || {};
  el('nomName').value = n.name || '';
  el('nomRelation').value = n.relation || '';
  el('nomEmail').value = n.email || '';
  el('nomPhone').value = n.phone || '';
  el('nomRemove').hidden = !dpdpNominee;
  el('nomName').focus();
}

async function saveNominee(event) {
  event.preventDefault();
  const error = el('nomError');
  const body = { name: el('nomName').value.trim(), relation: el('nomRelation').value.trim(), email: el('nomEmail').value.trim(), phone: el('nomPhone').value.trim() };
  const fail = (message) => { error.textContent = message; error.hidden = false; };
  if (!body.name) return fail("Enter your nominee's name.");
  if (!body.email && !body.phone) return fail('Give an email or a phone number for your nominee.');
  el('nomSave').disabled = true;
  try {
    const data = await api('/api/me/nominee', { method: 'PUT', body });
    paintNominee(data.nominee);
    openNomineeForm(false);
    el('dpStatus').textContent = 'Nominee saved.';
  } catch (err) {
    fail(err.message);
  } finally {
    el('nomSave').disabled = false;
  }
}

async function removeNominee() {
  el('nomRemove').disabled = true;
  try {
    await api('/api/me/nominee', { method: 'DELETE' });
    paintNominee(null);
    openNomineeForm(false);
    el('dpStatus').textContent = 'Nominee removed.';
  } catch (err) {
    el('nomError').textContent = err.message;
    el('nomError').hidden = false;
  } finally {
    el('nomRemove').disabled = false;
  }
}

async function agreeToNotice() {
  const button = el('dpAgreeBtn');
  button.disabled = true;
  try {
    await api('/api/me/consent', { method: 'POST' });
    const bar = document.getElementById('dpNotice');
    if (bar) bar.remove();
    await loadDpdp();
    el('dpStatus').textContent = 'Thanks, your consent is recorded.';
  } catch (err) {
    el('dpStatus').textContent = err.message;
  } finally {
    button.disabled = false;
  }
}

// ---------- delete my account ----------
async function deleteMyAccount(event) {
  event.preventDefault();
  if (el('deleteBtn').disabled) return;
  showDeleteError('');
  const button = el('deleteBtn');
  button.disabled = true;
  try {
    // Not through api(): a wrong password must stay on this page, and a 401 here means already logged out
    const res = await fetch(`${API_BASE}/api/me/delete`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: el('deletePassword').value, confirm: el('deleteConfirm').value })
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (res.status === 401) { handleLoggedOut(); return; }
    if (!res.ok) {
      throw new Error(res.status === 429 ? 'Too many tries. Wait a minute and try again.'
        : (data && typeof data.detail === 'string' ? data.detail : 'Something went wrong. Please try again.'));
    }
    forgetThisDevice();
    el('deleteDate').textContent = new Date(data.delete_after).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    el('deleteCard').hidden = true;
    el('exportCard').hidden = true;
    el('deleteDone').hidden = false;
    document.getElementById('appHeader')?.querySelectorAll('[data-menu], [data-notif-btn]').forEach(node => { node.hidden = true; });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    showDeleteError(err.message === 'Failed to fetch' ? 'Could not reach the server.' : err.message);
    paintDeleteButton();
  }
}

function forgetThisDevice() {
  // Cached pages of this account and this browser's notifications go too
  try {
    Object.keys(localStorage).filter(key => key.startsWith('c2m:')).forEach(key => localStorage.removeItem(key));
    localStorage.removeItem('currentUserId');
  } catch (e) { /* storage unavailable */ }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration()
      .then(registration => registration && registration.pushManager.getSubscription())
      .then(subscription => subscription && subscription.unsubscribe())
      .catch(() => {});
  }
}
