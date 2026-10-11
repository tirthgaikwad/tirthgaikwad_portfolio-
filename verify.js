// ==========================================
// VERIFY.JS — The Verification desk (verify.html), for admins and the founder.
// An admin sees pending accounts of their college for the departments the founder gave them, and can approve,
// reject with a reason, ask for a new ID photo, or pass the account on to the right department.
// Loaded after shared.js, chat-common.js and pages-common.js.
// ==========================================

const V = { summary: null, people: [], tab: 'mine', query: '', dept: '', selected: new Set(), focus: 0, loading: false };

async function loadDesk() {
  try {
    const [summary, queue] = await Promise.all([api('/api/verify/summary'), api(`/api/verify/queue?tab=${V.tab}`)]);
    V.summary = summary;
    V.people = queue.people;
    V.selected = new Set([...V.selected].filter(id => V.people.some(p => p.id === id)));
    renderDesk();
  } catch (err) {
    if (err.status === 403) {
      el('deskHead').innerHTML = '';
      el('deskList').innerHTML = stateBlock('lock', 'For admins only', 'The Verification desk is for admins approved by the founder. You can apply from your account menu.', '<a class="ch-btn solid" href="apply-admin.html">Apply as admin</a>');
      el('deskTabs').classList.add('ch-hidden');
      el('deskBar').innerHTML = '';
      return;
    }
    el('deskList').innerHTML = stateBlock('cloud_off', 'Could not load the desk', escapeHtml(err.message), '<button class="ch-btn solid" type="button" onclick="loadDesk()">Try again</button>');
  }
}

function renderDesk() {
  const s = V.summary;
  const today = s.today || {};
  el('deskScope').innerHTML = s.founder
    ? `<span class="c2m-badge founder">★ Founder</span><span>You can verify every account. "Unassigned" lists departments no admin covers yet.</span>`
    : `<span class="c2m-badge admin">Admin</span><span><b>${escapeHtml(s.college)}</b>: ${escapeHtml(s.departments.join(', ') || 'no departments yet')}</span>`;
  el('deskHead').innerHTML = [
    [s.waiting, 'waiting'], [s.needs_info, 'asked for a new photo'], [today.approve || 0, 'approved today'],
    [today.reject || 0, 'rejected today'], [today.pass || 0, 'passed on today']
  ].concat(s.founder ? [[s.unassigned, 'unassigned']] : []).map(([n, label]) => `<div class="ch-stat"><b>${n}</b><span>${label}</span></div>`).join('');
  el('tabUnassigned').classList.toggle('ch-hidden', !s.founder);
  el('deskTabs').querySelectorAll('[data-tab]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.tab === V.tab)));

  const departments = [...new Set(V.people.map(p => p.routed_department || p.department).filter(Boolean))].sort();
  const list = filtered();
  el('deskBar').innerHTML = `
    <h2 class="ch-bar-title">${{ mine: 'Waiting for you', needs_info: 'Waiting for the student', unassigned: 'No admin for these departments' }[V.tab]}<small>${list.length}</small></h2>
    <input class="ch-input" id="deskSearch" type="search" placeholder="Search name or roll number" value="${escapeHtml(V.query)}" aria-label="Search">
    <select class="ch-select" id="deskDept" aria-label="Department"><option value="">All departments</option>${departments.map(d => `<option ${d === V.dept ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}</select>
    ${V.tab !== 'needs_info' && list.length ? `<button class="ch-btn line" type="button" data-act="select-all">${icon('select_all')}${V.selected.size ? 'Clear selection' : 'Select all'}</button>
    <button class="ch-btn solid" type="button" data-act="bulk" ${V.selected.size ? '' : 'disabled'}>${icon('done_all')}Approve ${V.selected.size || ''} selected</button>` : ''}`;

  el('deskList').innerHTML = list.length ? list.map((p, n) => cardHtml(p, n)).join('')
    : stateBlock('task_alt', V.tab === 'needs_info' ? 'Nobody is waiting on a new photo' : 'All caught up', V.tab === 'mine' ? 'No account in your departments is waiting. New sign-ups appear here by themselves.' : 'Nothing here right now.');
}

function filtered() {
  const q = norm(V.query);
  return V.people.filter(p => (!q || norm(`${p.name} ${p.roll_no}`).includes(q)) && (!V.dept || (p.routed_department || p.department) === V.dept));
}

function waited(p) {
  if (!p.joined) return '';
  const days = Math.floor((Date.now() - Date.parse(p.joined)) / 86400000);
  return days <= 0 ? 'joined today' : `waiting ${plural(days, 'day', 'days')}`;
}

function cardHtml(p, n) {
  const last = p.last;
  const lastLine = last ? {
    pass: `Passed from ${escapeHtml(last.from)} to ${escapeHtml(last.to)} by ${escapeHtml(last.by)}${last.reason ? `: “${escapeHtml(last.reason)}”` : ''}`,
    needs_info: `${escapeHtml(last.by)} asked: “${escapeHtml(last.reason)}”`,
    reject: `Rejected by ${escapeHtml(last.by)}: ${escapeHtml(last.reason)}`,
    approve: `Approved by ${escapeHtml(last.by)}`, reverse: `Sent back for review by the founder`
  }[last.action] || '' : '';
  return `<article class="ch-panel vd-card${V.focus === n ? ' is-focus' : ''}" data-card="${p.id}" tabindex="0">
    ${V.tab !== 'needs_info' ? `<label class="vd-pick" title="Select"><input type="checkbox" data-select="${p.id}" ${V.selected.has(p.id) ? 'checked' : ''}></label>` : ''}
    ${avatarOf(p)}
    <div class="vd-main">
      <h3><a href="profile.html?id=${p.id}" target="_blank" rel="noopener">${escapeHtml(p.name || 'Unnamed')}</a> ${statusChip(p.status)} ${p.account_type === 'professional' ? '<span class="ch-chip">Professional</span>' : ''}</h3>
      <p class="vd-meta">${icon('apartment')}${escapeHtml(p.college || 'No college')} · ${icon('domain')}${escapeHtml(p.routed_department || p.department || 'No department')}${p.routed_department && p.routed_department !== p.department ? ` <span class="ch-chip">profile says ${escapeHtml(p.department || '—')}</span>` : ''}</p>
      <p class="vd-meta">${p.division ? `Div ${escapeHtml(p.division)} · ` : ''}${p.roll_no ? `Roll ${escapeHtml(p.roll_no)} · ` : ''}${escapeHtml(waited(p))}${p.profession && p.profession !== 'Student' ? ` · ${escapeHtml(p.profession)}` : ''}</p>
      ${lastLine ? `<p class="vd-last">${icon('history')}${lastLine}</p>` : ''}
    </div>
    <div class="vd-actions">
      <button class="ch-btn line small" type="button" data-act="id" data-id="${p.id}" ${p.has_id_card ? '' : 'disabled title="No ID uploaded"'}>${icon('badge')}ID card</button>
      ${V.tab === 'needs_info' ? '' : `<button class="ch-btn solid small" type="button" data-act="approve" data-id="${p.id}" title="Approve (A)">${icon('check')}Approve</button>`}
      <button class="ch-btn line small danger" type="button" data-act="reject" data-id="${p.id}" title="Reject (R)">${icon('close')}Reject</button>
      <button class="ch-btn line small" type="button" data-act="pass" data-id="${p.id}" title="Not my department (N)">${icon('alt_route')}Not my department</button>
      ${V.tab === 'needs_info' ? '' : `<button class="ch-btn line small" type="button" data-act="ask" data-id="${p.id}">${icon('photo_camera')}Ask for new photo</button>`}
    </div>
  </article>`;
}

async function act(id, body, message) {
  const result = await attempt(() => api(`/api/verify/${id}`, { method: 'POST', body }), message);
  if (result) {
    V.people = V.people.filter(p => p.id !== id);
    V.selected.delete(id);
    loadDesk();
  }
  return result;
}

function openReject(p) {
  const reasons = V.summary.reasons;
  const labels = { unreadable: 'ID photo cannot be read', mismatch: 'Details do not match the profile', not_student: 'Not a student of this college', fake: 'Document does not look genuine', other: 'Something else' };
  openModal({
    title: `Reject ${p.name}?`, confirmText: 'Reject',
    body: `<p class="ch-muted">If the only problem is the department, use “Not my department” instead: the student stays pending and goes to the right admin.</p>
      <label>Reason<select class="ch-select" id="rejReason">${Object.keys(reasons).map(key => `<option value="${key}">${labels[key] || key}</option>`).join('')}</select></label>
      <label>Note to the student <small>(required for “Something else”)</small><textarea class="ch-textarea" id="rejNote" maxlength="500"></textarea></label>
      <p class="ch-muted">The student is told the reason and can fix their profile and appeal.</p>`,
    onConfirm: async () => {
      const result = await api(`/api/verify/${p.id}`, { method: 'POST', body: { action: 'reject', reason: el('rejReason').value, note: el('rejNote').value } });
      showToast(`${p.name} rejected.`);
      V.people = V.people.filter(x => x.id !== p.id);
      loadDesk();
      return result;
    }
  });
}

async function openPass(p) {
  let data;
  try { data = await api(`/api/verify/${p.id}/departments`); } catch (err) { return showToast(err.message); }
  const current = norm(p.routed_department || p.department);
  const options = data.departments.filter(d => norm(d.name) !== current);
  openModal({
    title: 'Not my department', confirmText: 'Pass it on',
    body: `<p class="ch-muted">${escapeHtml(p.name)} stays <b>pending</b> and moves to the admins of the department you pick. If that department has no admin yet, the founder handles it.</p>
      <label>Department it belongs to<select class="ch-select" id="passDept"><option value="">Pick one</option>${options.map(d => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}${d.has_admin ? '' : ' (no admin yet: goes to the founder)'}</option>`).join('')}<option value="__other">Another department…</option></select></label>
      <label id="passOtherWrap" class="ch-hidden">Department name<input class="ch-input" id="passOther" maxlength="120"></label>
      <label>Note for the next admin <small>(optional)</small><textarea class="ch-textarea" id="passNote" maxlength="500" placeholder="For example: ID card says Mechanical, profile says Computer."></textarea></label>`,
    onOpen: () => el('passDept').addEventListener('change', (e) => el('passOtherWrap').classList.toggle('ch-hidden', e.target.value !== '__other')),
    onConfirm: async () => {
      const department = el('passDept').value === '__other' ? el('passOther').value.trim() : el('passDept').value;
      if (!department) throw new Error('Pick the department.');
      await api(`/api/verify/${p.id}`, { method: 'POST', body: { action: 'pass', department, note: el('passNote').value } });
      showToast(`Passed to ${department}.`);
      V.people = V.people.filter(x => x.id !== p.id);
      loadDesk();
    }
  });
}

function openAsk(p) {
  openModal({
    title: `Ask ${p.name} for a new photo`, confirmText: 'Send',
    body: `<label>What should they fix?<textarea class="ch-textarea" id="askNote" maxlength="500" placeholder="For example: the photo is blurred; please upload the front of the ID in good light."></textarea></label>
      <p class="ch-muted">They get a notification and a button on their profile to upload a new photo. The account then comes back to your queue.</p>`,
    onConfirm: async () => {
      const note = el('askNote').value.trim();
      if (!note) throw new Error('Tell the student what to fix.');
      await api(`/api/verify/${p.id}`, { method: 'POST', body: { action: 'needs_info', note } });
      showToast('Asked for a new photo.');
      V.people = V.people.filter(x => x.id !== p.id);
      loadDesk();
    }
  });
}

async function showId(p) {
  try {
    const data = await api(`/api/verify/${p.id}/id-card`);
    openModal({
      title: `ID card: ${p.name}`, confirmText: 'Close', wide: true, hideConfirm: false,
      body: `<div class="vd-id"><img src="${escapeHtml(safeUrl(data.image))}" alt="ID card of ${escapeHtml(p.name)}"></div>
        <dl class="ap-summary"><dt>Name on profile</dt><dd>${escapeHtml(p.name)}</dd><dt>College</dt><dd>${escapeHtml(p.college)}</dd><dt>Department</dt><dd>${escapeHtml(p.department)}</dd><dt>Roll number</dt><dd>${escapeHtml(p.roll_no || '—')}</dd></dl>`,
      onConfirm: async () => {}
    });
  } catch (err) { showToast(err.message); }
}

el('deskTabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (!tab) return;
  V.tab = tab.dataset.tab;
  V.selected.clear();
  V.focus = 0;
  el('deskList').innerHTML = '<div class="skeleton" style="height:110px"></div>';
  loadDesk();
});

document.querySelector('main').addEventListener('click', (e) => {
  const button = e.target.closest('[data-act]');
  if (!button) return;
  const p = V.people.find(x => x.id === Number(button.dataset.id));
  const what = button.dataset.act;
  if (what === 'select-all') {
    if (V.selected.size) V.selected.clear(); else filtered().forEach(x => V.selected.add(x.id));
    return renderDesk();
  }
  if (what === 'bulk') {
    const ids = [...V.selected];
    return confirmThen(`Approve ${plural(ids.length, 'account', 'accounts')}?`, 'Each one is marked verified and told so. Make sure you looked at their ID cards.', 'Approve all',
      () => attempt(async () => { const r = await api('/api/verify/bulk', { method: 'POST', body: { ids } }); V.selected.clear(); await loadDesk(); return r; },
        (r) => `${plural(r.approved, 'account', 'accounts')} approved${r.skipped ? `, ${r.skipped} skipped` : ''}.`));
  }
  if (!p) return;
  if (what === 'id') return showId(p);
  if (what === 'approve') return act(p.id, { action: 'approve' }, `${p.name} verified.`);
  if (what === 'reject') return openReject(p);
  if (what === 'pass') return openPass(p);
  if (what === 'ask') return openAsk(p);
});

document.querySelector('main').addEventListener('change', (e) => {
  if (e.target.dataset.select) {
    const id = Number(e.target.dataset.select);
    if (e.target.checked) V.selected.add(id); else V.selected.delete(id);
    return renderDesk();
  }
  if (e.target.id === 'deskDept') { V.dept = e.target.value; renderDesk(); }
});
document.querySelector('main').addEventListener('input', (e) => {
  if (e.target.id !== 'deskSearch') return;
  V.query = e.target.value;
  renderDesk();
  const box = el('deskSearch');
  box.focus();
  box.setSelectionRange(box.value.length, box.value.length);
});

// Keyboard: J/K to move, A approve, R reject, N not my department (not while typing or in a pop-up)
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select') || el('pgModal').classList.contains('active') || document.getElementById('systemModal').classList.contains('active')) return;
  const list = filtered();
  if (!list.length) return;
  const key = e.key.toLowerCase();
  if (key === 'j' || key === 'k') {
    V.focus = Math.max(0, Math.min(list.length - 1, V.focus + (key === 'j' ? 1 : -1)));
    renderDesk();
    document.querySelector(`[data-card="${list[V.focus].id}"]`).scrollIntoView({ block: 'nearest' });
    return;
  }
  const p = list[Math.min(V.focus, list.length - 1)];
  if (key === 'a' && V.tab !== 'needs_info') act(p.id, { action: 'approve' }, `${p.name} verified.`);
  if (key === 'r') openReject(p);
  if (key === 'n') openPass(p);
});

// The founder console can open the desk on the unassigned queue
const startTab = sessionStorage.getItem('deskTab') || new URLSearchParams(location.search).get('tab');
if (['mine', 'needs_info', 'unassigned'].includes(startTab)) V.tab = startTab;
sessionStorage.removeItem('deskTab');

bindModal();
loadDesk();
