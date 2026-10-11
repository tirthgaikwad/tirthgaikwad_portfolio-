// ==========================================
// PAGES-COMMON.JS — Small helpers shared by the role, plan and business pages
// (apply-teacher, apply-admin, verify, founder, pricing, billing, recruiter, institution).
// Loaded after shared.js and chat-common.js (api, el, escapeHtml, showToast, formatTime, avatarHtml, mediaUrl, linkify).
// They reuse the component classes of college-hub.css (ch-panel, ch-btn, ch-chip, ch-input, ch-tabs, ch-empty ...).
// ==========================================

const icon = (name) => `<span class="material-symbols-outlined ch-ico">${name}</span>`;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const avatarOf = (person) => `<span class="ch-avatar">${avatarHtml(person && person.profile_pic ? mediaUrl(person.profile_pic) : '', person ? person.name : '?', '')}</span>`;

// ₹ amounts: paise in, Indian digit grouping out (₹1,49,999)
function inr(paise, withPaise) {
  const rupees = (paise || 0) / 100;
  return '₹' + rupees.toLocaleString('en-IN', { minimumFractionDigits: withPaise ? 2 : 0, maximumFractionDigits: withPaise ? 2 : 0 });
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? new Date(`${isoDate}T00:00:00`) : new Date(isoDate);
  return day.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_CHIPS = {
  pending: ['indigo', 'Waiting for review'], needs_info: ['warn', 'Question for you'], approved: ['green', 'Approved'],
  declined: ['warn', 'Declined'], withdrawn: ['', 'Withdrawn'], revoked: ['warn', 'Access removed'],
  active: ['green', 'Active'], expired: ['', 'Ended'], cancelled: ['warn', 'Cancelled'],
  paid: ['green', 'Paid'], refunded: ['warn', 'Refunded'], failed: ['warn', 'Failed'], created: ['', 'Not paid'],
  new: ['indigo', 'New'], contacted: ['', 'Contacted'], won: ['green', 'Won'], lost: ['', 'Lost'],
  verified: ['green', 'Verified'], rejected: ['warn', 'Rejected'], appealed: ['indigo', 'Appealed']
};
const statusChip = (status) => { const [kind, label] = STATUS_CHIPS[status] || ['', status]; return `<span class="ch-chip ${kind}">${escapeHtml(label)}</span>`; };

// A file chosen in a form is uploaded at once through the chat upload; the field remembers {url, name}
async function uploadFile(file) {
  const form = new FormData();
  form.append('file', file, file.name);
  const res = await fetch(`${API_BASE}/api/upload/chat-file`, { method: 'POST', credentials: 'include', body: form });
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (res.status === 401) { handleLoggedOut(); throw new Error('Please log in again.'); }
  if (!res.ok || !data) throw new Error(data && typeof data.detail === 'string' ? data.detail : 'Upload failed. Please try again.');
  return { url: data.url, name: data.filename || file.name };
}

function fileInputHtml(id, label, hint, required) {
  return `<div class="ap-field"><span class="ch-field-label">${escapeHtml(label)}${required ? '' : ' <small>(optional)</small>'}</span>
    <div class="ch-file ap-file">
      <label class="ch-btn line small">${icon('upload_file')}Choose file<input type="file" id="${id}" class="ch-hidden" accept="image/*,.pdf"></label>
      <span class="ch-file-name" id="${id}Name">No file yet</span>
    </div>
    ${hint ? `<small class="ap-hint">${escapeHtml(hint)}</small>` : ''}</div>`;
}

function bindFileInput(id, current, onChange) {
  const input = el(id);
  input.picked = current || null;
  const show = (text) => { el(`${id}Name`).innerHTML = text; };
  if (input.picked) show(`<a class="msg-link" href="${escapeHtml(mediaUrl(input.picked.url))}" target="_blank" rel="noopener">${escapeHtml(input.picked.name || 'Attached')}</a>`);
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    input.uploading = true;
    show(`Uploading ${escapeHtml(file.name)}…`);
    try {
      input.picked = await uploadFile(file);
      show(`<a class="msg-link" href="${escapeHtml(mediaUrl(input.picked.url))}" target="_blank" rel="noopener">${escapeHtml(input.picked.name)}</a> ${icon('check_circle')}`);
      if (onChange) onChange(input.picked);
    } catch (err) {
      show(`<span class="ch-form-error">${escapeHtml(err.message)}</span>`);
    } finally {
      input.uploading = false;
      input.value = '';
    }
  });
}

function downloadCsv(rows, filename) {
  const cell = (value) => `"${String(value === null || value === undefined ? '' : value).replace(/"/g, '""')}"`;
  const blob = new Blob(['﻿' + rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  window.__lastCsv = { filename, rows };
}

// The one pop-up of these pages (#pgModal): onConfirm throws an Error to show a message in it
let pgModalSubmit = null;
function openModal({ title, body, confirmText, onConfirm, onOpen, wide, hideConfirm }) {
  el('pgModalTitle').textContent = title;
  el('pgModalBody').onclick = null;
  el('pgModalBody').innerHTML = body;
  el('pgModalError').classList.add('ch-hidden');
  el('pgModalConfirm').textContent = confirmText || 'Save';
  el('pgModalConfirm').disabled = false;
  el('pgModalConfirm').classList.toggle('ch-hidden', Boolean(hideConfirm));
  el('pgModal').querySelector('.ch-modal').classList.toggle('ch-modal-wide', Boolean(wide));
  pgModalSubmit = onConfirm || null;
  el('pgModal').classList.add('active');
  if (onOpen) onOpen();
}
function closeModal() { el('pgModal').classList.remove('active'); pgModalSubmit = null; }
function modalError(message) { el('pgModalError').textContent = message; el('pgModalError').classList.toggle('ch-hidden', !message); }
function bindModal() {
  el('pgModalCancel').addEventListener('click', closeModal);
  el('pgModal').addEventListener('click', (e) => { if (e.target === el('pgModal')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el('pgModal').classList.contains('active')) closeModal(); });
  el('pgModalConfirm').addEventListener('click', async () => {
    if (!pgModalSubmit) return closeModal();
    el('pgModalConfirm').disabled = true;
    modalError('');
    try { await pgModalSubmit(); closeModal(); } catch (err) { modalError(err.message); el('pgModalConfirm').disabled = false; }
  });
}

const confirmThen = (title, text, button, action) => window.showSystemModal(title, escapeHtml(text), 'confirm', action, button);

// Runs a change and reports it; problems become a toast
async function attempt(action, done) {
  try {
    const result = await action();
    if (done) showToast(typeof done === 'function' ? done(result) : done);
    return result;
  } catch (err) {
    showToast(err.message);
    return null;
  }
}

function stateBlock(iconName, title, text, extra) {
  return `<div class="ch-empty">${icon(iconName)}<h3>${escapeHtml(title)}</h3><p>${text}</p>${extra || ''}</div>`;
}

// Tabs drawn as .ch-tab buttons with data-tab; the current one is mirrored in ?tab=
function bindTabs(containerId, tabs, onChange, initial) {
  const params = new URLSearchParams(location.search);
  let current = tabs.includes(params.get('tab')) ? params.get('tab') : initial || tabs[0];
  const paint = () => el(containerId).querySelectorAll('[data-tab]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.tab === current)));
  el(containerId).addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (!tab) return;
    current = tab.dataset.tab;
    const query = new URLSearchParams(location.search);
    query.set('tab', current);
    history.replaceState(null, '', `${location.pathname}?${query}`);
    paint();
    onChange(current);
  });
  paint();
  return () => current;
}
