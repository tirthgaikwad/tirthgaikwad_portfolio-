// ==========================================
// ACCOUNT.JS — Account & privacy: download my data, delete my account.
// A deletion waits a few days on the server (logging in again cancels it), then everything personal is erased.
// Loaded after shared.js and chat-common.js.
// ==========================================

async function initAccount() {
  el('exportBtn').addEventListener('click', downloadMyData);
  ['deletePassword', 'deleteConfirm', 'deleteUnderstand'].forEach(id => el(id).addEventListener('input', paintDeleteButton));
  el('deleteUnderstand').addEventListener('change', paintDeleteButton);
  el('deleteForm').addEventListener('submit', deleteMyAccount);
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
