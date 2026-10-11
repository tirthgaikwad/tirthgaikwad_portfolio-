// ==========================================
// COLLEGE-HUB-WORK.JS — On the notice board and the group cards: polls, "confirm you have read this",
// work handed in by groups (with marks and feedback) and weekly check-ins.
// Loaded before college-hub.js, which calls the functions here; everything runs only after the page has loaded.
// It also holds what the three extra files share: the action table and the file upload.
// ==========================================

// data-act values handled outside college-hub.js: act -> function(button). college-hub.js looks here first.
const hubActions = {};
// change handlers for <select>s and inputs the extra files draw: each returns true when it handled the event
const hubChangeHandlers = [];

// A file for a resource or a submission goes through the chat upload, which keeps it on the API server
async function uploadHubFile(file) {
  const form = new FormData();
  form.append('file', file, file.name);
  const res = await fetch(`${API_BASE}/api/upload/chat-file`, { method: 'POST', credentials: 'include', body: form });
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (res.status === 401) { handleLoggedOut(); throw new Error('Please log in again.'); }
  if (!res.ok || !data) throw new Error(data && typeof data.detail === 'string' ? data.detail : 'Upload failed. Please try again.');
  return { url: data.url, name: data.filename || file.name };
}

// A file field inside the pop-up: picks, uploads at once, and remembers the result on the element
function fileFieldHtml(id, current) {
  return `<div><span class="ch-field-label">Or attach a file <small>(PDF, slides, documents, images; up to the chat file limit)</small></span>
    <div class="ch-file" style="margin-top:5px">
      <label class="ch-btn line small" style="margin:0">${icon('attach_file')}Choose file<input type="file" id="${id}" class="ch-hidden"></label>
      <span class="ch-file-name" id="${id}Name">${current && current.url ? escapeHtml(current.name || 'Attached file') : 'No file'}</span>
      <button type="button" class="ch-icon-btn danger ${current && current.url ? '' : 'ch-hidden'}" id="${id}Clear" title="Remove file" aria-label="Remove file"><span class="material-symbols-outlined">close</span></button>
    </div></div>`;
}

function bindFileField(id, current) {
  const input = el(id);
  input.hubFile = current && current.url ? { url: current.url, name: current.name } : null;
  const show = () => {
    el(`${id}Name`).textContent = input.hubFile ? input.hubFile.name : 'No file';
    el(`${id}Clear`).classList.toggle('ch-hidden', !input.hubFile);
  };
  input.addEventListener('change', async () => {
    if (!input.files[0]) return;
    input.hubUploading = true;
    el(`${id}Name`).textContent = `Uploading ${input.files[0].name}…`;
    try {
      input.hubFile = await uploadHubFile(input.files[0]);
    } catch (err) {
      showModalError(err.message);
    } finally {
      input.hubUploading = false;
      input.value = '';
      show();
    }
  });
  el(`${id}Clear`).addEventListener('click', () => { input.hubFile = null; show(); });
}

const fileLinkHtml = (url, name) => `<a class="msg-link" href="${escapeHtml(mediaUrl(url))}" target="_blank" rel="noopener">${escapeHtml(name || 'Open file')}</a>`;
const webLinkHtml = (url) => `<a class="msg-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url.replace(/^https?:\/\//i, '').slice(0, 60))}</a>`;

// The Monday of the week a date falls in, as YYYY-MM-DD (the server names a check-in's week the same way)
function weekStartOf(isoDate) {
  const day = new Date(`${isoDate}T00:00:00`);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day.toLocaleDateString('en-CA');
}
const today = () => (hub && hub.today) || todayIso();
const thisWeek = () => weekStartOf(today());

function downloadCsv(rows, filename) {
  const cell = (value) => `"${String(value === null || value === undefined ? '' : value).replace(/"/g, '""')}"`;
  const file = new Blob(['﻿' + rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  downloadBlob(file, filename);
  window.__lastCsv = { filename, rows };   // lets a check read what was written without opening the file
}

function downloadBlob(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

const fileSafe = (text) => String(text || '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'college-hub';

// ==========================================
// 1. POLLS
// ==========================================
function pollHtml(post) {
  if (!post.poll_options || !post.poll_options.length) return '';
  const counts = post.poll_counts || post.poll_options.map(() => 0);
  const total = post.poll_total || 0;
  const mine = new Set(post.my_votes || []);
  const canVote = hub.me.role === 'student';
  const most = Math.max(1, ...counts);
  const rows = post.poll_options.map((option, n) => {
    const share = total ? Math.round(counts[n] / total * 100) : 0;
    const chosen = mine.has(n);
    const voters = isTeacher() && post.poll_voters ? post.poll_voters[n].map(nameOf) : [];
    const inner = `<span class="ch-poll-fill${counts[n] === most && counts[n] ? ' top' : ''}" style="width:${share}%"></span>
      <span class="ch-poll-label">${canVote ? `<span class="ch-poll-box${post.poll_multi ? ' square' : ''}${chosen ? ' on' : ''}" aria-hidden="true"></span>` : ''}${escapeHtml(option)}</span>
      <span class="ch-poll-count">${share}% · ${counts[n]}</span>`;
    return canVote
      ? `<button type="button" class="ch-poll-row${chosen ? ' is-chosen' : ''}" data-act="vote" data-id="${post.id}" data-option="${n}" aria-pressed="${chosen}">${inner}</button>`
      : `<div class="ch-poll-row" title="${escapeHtml(voters.join(', ') || 'No votes yet')}">${inner}</div>`;
  }).join('');
  const who = isTeacher() && total
    ? `<details class="ch-poll-who"><summary>Who voted</summary>${post.poll_options.map((option, n) => `<p><b>${escapeHtml(option)}:</b> ${escapeHtml((post.poll_voters ? post.poll_voters[n] : []).map(nameOf).join(', ') || 'nobody')}</p>`).join('')}</details>`
    : '';
  return `<div class="ch-poll" data-poll="${post.id}">
    <h4>${icon('ballot')}Poll <small>${post.poll_multi ? 'Pick any that apply' : 'Pick one'}</small></h4>
    ${rows}
    <p class="ch-poll-foot">${plural(total, 'student has', 'students have')} voted${canVote && mine.size ? ' · Tap your choice again to take it back' : ''}</p>
    ${who}</div>`;
}

hubActions.vote = (button) => {
  const post = hub.posts.find(item => item.id === Number(button.dataset.id));
  if (!post) return;
  const option = Number(button.dataset.option);
  const mine = new Set(post.my_votes || []);
  if (post.poll_multi) { if (mine.has(option)) mine.delete(option); else mine.add(option); }
  else if (mine.has(option)) mine.clear();
  else { mine.clear(); mine.add(option); }
  button.disabled = true;
  api(`/api/college-hub/posts/${post.id}/vote`, { method: 'POST', body: { options: [...mine] } })
    .then(result => {
      Object.assign(post, { poll_counts: result.counts, poll_total: result.total, my_votes: result.my_votes });
      cacheSet('collegeHub', hub);
      if (view.tab === 'board') renderBoard();
    })
    .catch(err => { showToast(err.message); button.disabled = false; });
};

// Someone voted: students patch the numbers; teachers fetch again, because they also see the names
function applyPollEvent(data) {
  const post = hub.posts.find(item => item.id === data.post_id);
  if (!post) return;
  if (isTeacher()) return queueHubReload();
  post.poll_counts = data.counts;
  post.poll_total = data.total;
  if (view.tab === 'board') renderBoard();
}

// ==========================================
// 2. "CONFIRM YOU HAVE READ THIS"
// ==========================================
function ackHtml(post) {
  if (!post.needs_ack) return '';
  if (!isTeacher()) {
    if (hub.me.role !== 'student') return '';
    return post.acked
      ? `<div class="ch-ack done">${icon('task_alt')}<span>You confirmed that you have read this.</span></div>`
      : `<div class="ch-ack">${icon('mark_email_unread')}<span>Your teacher asks you to confirm that you have read this.</span><button class="ch-btn solid small" type="button" data-act="ack" data-id="${post.id}">${icon('done')}I have read it</button></div>`;
  }
  const audience = audienceOf(post);
  const seen = new Set(post.ack_ids || []);
  const count = audience.filter(person => seen.has(person.id)).length;
  const missing = audience.length - count;
  return `<div class="ch-ack teacher">
    <div class="ch-ack-line">${icon('visibility')}<span><b>Seen by ${count} of ${audience.length}</b></span>
      ${missing ? `<button class="ch-btn line small" type="button" data-act="ack-missing" data-id="${post.id}">Who has not</button>
      <button class="ch-btn line small" type="button" data-act="ack-remind" data-id="${post.id}">${icon('notifications_active')}Remind ${missing}</button>` : '<span class="ch-chip green">Everyone</span>'}</div>
    <div class="ch-meter"><i style="width:${audience.length ? Math.round(count / audience.length * 100) : 0}%"></i></div>
  </div>`;
}

hubActions.ack = (button) => {
  const post = hub.posts.find(item => item.id === Number(button.dataset.id));
  if (!post) return;
  button.disabled = true;
  api(`/api/college-hub/posts/${post.id}/ack`, { method: 'POST' })
    .then(() => { post.acked = true; cacheSet('collegeHub', hub); renderBoard(); showToast('Thanks. Your teacher can see that you have read it.'); })
    .catch(err => { showToast(err.message); button.disabled = false; });
};

hubActions['ack-missing'] = (button) => {
  const post = hub.posts.find(item => item.id === Number(button.dataset.id));
  if (!post) return;
  const seen = new Set(post.ack_ids || []);
  const missing = audienceOf(post).filter(person => !seen.has(person.id));
  openHubModal({
    title: 'Not read yet',
    confirmText: 'Close',
    body: `<p class="ch-muted">${escapeHtml(post.title)}</p>
      <div class="ch-namelist">${missing.map(person => `<div>${avatarOf(person)}<span>${escapeHtml(person.name)}<small>${escapeHtml(classLabel(person))}</small></span></div>`).join('')}</div>`,
    onConfirm: async () => {}
  });
};

hubActions['ack-remind'] = (button) => {
  const id = Number(button.dataset.id);
  run(() => api(`/api/college-hub/posts/${id}/ack-remind`, { method: 'POST' }), (result) => `Reminder sent to ${plural(result.reminded, 'student', 'students')}.`);
};

function applyAckEvent(data) {
  const post = hub.posts.find(item => item.id === data.post_id);
  if (!post || !isTeacher()) return;
  post.ack_ids = [...new Set([...(post.ack_ids || []), data.user_id])];
  if (view.tab === 'board') renderBoard();
}

// ==========================================
// 3. WORK HANDED IN BY GROUPS
// ==========================================
const submissionsOf = (activityId) => (hub.submissions || []).filter(row => row.activity_id === activityId);
const submissionOf = (activityId, groupId) => (hub.submissions || []).find(row => row.activity_id === activityId && row.group_id === groupId) || null;
const marksText = (row, activity) => (activity.max_marks && row.marks !== null && row.marks !== undefined ? `${row.marks}/${activity.max_marks}` : '');

function workHtml(activity) {
  if (!activity.accepts_work) return '';
  const due = activity.submit_by;
  const passed = deadlinePassed(due);
  const chips = `<div class="ch-rules">
    <span class="ch-chip ${passed ? 'warn' : 'indigo'}">${icon('upload_file')}${due ? (passed ? `Hand-in date passed (${formatDate(due)})` : `Hand in by ${formatDate(due)}`) : 'Groups hand in their work here'}</span>
    ${activity.max_marks ? `<span class="ch-chip indigo">${icon('grade')}Marked out of ${activity.max_marks}</span>` : ''}</div>`;

  if (isTeacher()) {
    const groups = groupsOf(activity.id);
    const rows = submissionsOf(activity.id);
    const late = rows.filter(row => row.late).length;
    const graded = rows.filter(row => row.graded).length;
    return `${chips}<div class="ch-work">
      <span><b>${rows.length} of ${plural(groups.length, 'group', 'groups')}</b> handed in${late ? ` · <span class="ch-warn-text">${late} late</span>` : ''} · ${graded} reviewed</span>
      ${groups.length ? `<button class="ch-btn line small" type="button" data-act="review-work" data-id="${activity.id}">${icon('rate_review')}Review work</button>` : ''}</div>`;
  }

  const group = groupByStudent(activity.id).get(hub.me.id);
  if (!group) return `${chips}<div class="ch-work"><span>Join a group for this activity to hand in work.</span></div>`;
  const row = submissionOf(activity.id, group.id);
  if (!row) {
    return `${chips}<div class="ch-work"><span><b>${escapeHtml(group.name)}</b> has not handed in yet.</span>
      <button class="ch-btn solid small" type="button" data-act="submit-work" data-id="${activity.id}">${icon('upload')}Hand in work</button></div>`;
  }
  const result = row.graded ? `<div class="ch-feedback">${icon('rate_review')}<div><b>Reviewed${marksText(row, activity) ? `: ${marksText(row, activity)}` : ''}</b>${row.feedback ? `<p>${linkify(row.feedback)}</p>` : ''}</div></div>` : '';
  return `${chips}<div class="ch-work done">
    <span>${icon('task_alt')}Handed in ${escapeHtml(formatTime(row.updated_at))} by ${escapeHtml(row.submitted_by === hub.me.id ? 'you' : nameOf(row.submitted_by))}${row.late ? ' <span class="ch-chip warn">Late</span>' : ''}</span>
    <span class="ch-work-links">${row.link ? webLinkHtml(row.link) : ''}${row.file_url ? fileLinkHtml(row.file_url, row.file_name) : ''}</span>
    ${row.graded ? '' : `<span class="ch-work-buttons"><button class="ch-btn line small" type="button" data-act="submit-work" data-id="${activity.id}">Replace</button>
    <button class="ch-btn line small danger" type="button" data-act="unsubmit-work" data-sub="${row.id}">Take back</button></span>`}
  </div>${result}`;
}

// The small line on a group card
function groupWorkChip(group, activity) {
  if (!activity || !activity.accepts_work) return '';
  const row = submissionOf(activity.id, group.id);
  if (!row) return deadlinePassed(activity.submit_by) ? `<span class="ch-chip warn">${icon('upload_file')}Not handed in</span>` : `<span class="ch-chip">${icon('upload_file')}Not handed in yet</span>`;
  if (row.graded) return `<span class="ch-chip green">${icon('grade')}Reviewed${marksText(row, activity) ? ` ${marksText(row, activity)}` : ''}</span>`;
  return `<span class="ch-chip ${row.late ? 'warn' : 'indigo'}">${icon('task_alt')}Handed in${row.late ? ' late' : ''}</span>`;
}

hubActions['submit-work'] = (button) => {
  const activity = activityById(button.dataset.id);
  if (!activity) return;
  const group = groupByStudent(activity.id).get(hub.me.id);
  const row = group ? submissionOf(activity.id, group.id) : null;
  openHubModal({
    title: row ? 'Replace your group\'s work' : 'Hand in your group\'s work',
    confirmText: row ? 'Replace' : 'Hand in',
    body: `<p class="ch-muted">${escapeHtml(activity.title)} · for ${escapeHtml(group ? group.name : '')}. Everyone in the group sees what is handed in${activity.submit_by ? `; the date is ${formatDate(activity.submit_by)}` : ''}.</p>
      <label>Link <small>(Google Drive, GitHub, a document…)</small><input class="ch-input" id="workLink" type="url" maxlength="1000" placeholder="https://" value="${escapeHtml(row ? row.link : '')}"></label>
      ${fileFieldHtml('workFile', row ? { url: row.file_url, name: row.file_name } : null)}
      <label>Note for the teacher <small>(optional)</small><textarea class="ch-textarea" id="workNote" maxlength="2000">${escapeHtml(row ? row.note : '')}</textarea></label>`,
    onOpen: () => bindFileField('workFile', row ? { url: row.file_url, name: row.file_name } : null),
    onConfirm: async () => {
      const input = el('workFile');
      if (input.hubUploading) throw new Error('Wait for the file to finish uploading.');
      const file = input.hubFile;
      const link = el('workLink').value.trim();
      if (!link && !file) throw new Error('Add a link or a file.');
      const result = await api(`/api/college-hub/activities/${activity.id}/submission`, { method: 'PUT', body: {
        link, file_url: file ? file.url : '', file_name: file ? file.name : '', note: el('workNote').value
      } });
      showToast(result.late ? 'Handed in, after the date. Your teacher will see it as late.' : 'Handed in. Your group has been told.');
    }
  });
};

hubActions['unsubmit-work'] = (button) => {
  const id = Number(button.dataset.sub);
  confirmThen('Take back this work?', 'The work your group handed in is removed. You can hand it in again.', 'Take back',
    () => run(() => api(`/api/college-hub/submissions/${id}`, { method: 'DELETE' }), 'Taken back.'));
};

function reviewRowHtml(activity, group) {
  const row = submissionOf(activity.id, group.id);
  const names = studentIdsOf(group).map(nameOf).join(', ') || 'No students';
  if (!row) {
    return `<div class="ch-review-row"><div class="ch-review-head"><b>${escapeHtml(group.name)}</b><span class="ch-chip ${deadlinePassed(activity.submit_by) ? 'warn' : ''}">Not handed in</span></div><p class="ch-muted">${escapeHtml(names)}</p></div>`;
  }
  return `<div class="ch-review-row" data-review="${row.id}">
    <div class="ch-review-head"><b>${escapeHtml(group.name)}</b>${row.late ? '<span class="ch-chip warn">Late</span>' : ''}${row.graded ? '<span class="ch-chip green">Reviewed</span>' : ''}<time>${escapeHtml(formatTime(row.updated_at))}</time></div>
    <p class="ch-muted">${escapeHtml(names)} · handed in by ${escapeHtml(nameOf(row.submitted_by))}</p>
    <p class="ch-work-links">${row.link ? webLinkHtml(row.link) : ''}${row.file_url ? fileLinkHtml(row.file_url, row.file_name) : ''}</p>
    ${row.note ? `<p class="ch-review-note">${linkify(row.note)}</p>` : ''}
    <div class="ch-review-grade">
      ${activity.max_marks ? `<label>Marks <small>/ ${activity.max_marks}</small><input class="ch-input" type="number" min="0" max="${activity.max_marks}" data-marks="${row.id}" value="${row.marks === null || row.marks === undefined ? '' : row.marks}"></label>` : ''}
      <label style="flex:1">Feedback<textarea class="ch-textarea" data-feedback="${row.id}" maxlength="2000" rows="2" style="min-height:44px">${escapeHtml(row.feedback || '')}</textarea></label>
    </div>
    <div class="ch-review-actions">
      <button class="ch-btn solid small" type="button" data-review-act="grade" data-sub="${row.id}">${icon('done')}${row.graded ? 'Update review' : 'Save review'}</button>
      <button class="ch-btn line small danger" type="button" data-review-act="reopen" data-sub="${row.id}" title="Remove it so the group can hand in again">Let them hand in again</button>
    </div>
  </div>`;
}

function openReview(activity) {
  const draw = () => {
    const groups = groupsOf(activity.id);
    el('reviewList').innerHTML = groups.length ? groups.map(group => reviewRowHtml(activity, group)).join('') : '<p class="ch-muted">No groups yet.</p>';
  };
  openHubModal({
    title: `Work for: ${activity.title}`,
    confirmText: 'Done',
    wide: true,
    body: `<div class="ch-review-tools"><span class="ch-muted">${activity.submit_by ? `Hand-in date: ${formatDate(activity.submit_by)}. ` : ''}${activity.max_marks ? `Marked out of ${activity.max_marks}. ` : 'Feedback only, no marks. '}Each group is told when you save its review.</span>
      <button class="ch-btn line small" type="button" data-review-act="csv">${icon('download')}Download CSV</button></div>
      <div id="reviewList" class="ch-review-list"></div>`,
    onOpen: () => {
      draw();
      el('hubModalBody').onclick = async (e) => {
        const button = e.target.closest('[data-review-act]');
        if (!button) return;
        const id = Number(button.dataset.sub);
        try {
          if (button.dataset.reviewAct === 'csv') return downloadSubmissions(activity);
          button.disabled = true;
          if (button.dataset.reviewAct === 'grade') {
            const marksBox = el('hubModalBody').querySelector(`[data-marks="${id}"]`);
            await api(`/api/college-hub/submissions/${id}/grade`, { method: 'PUT', body: {
              marks: marksBox && marksBox.value !== '' ? Number(marksBox.value) : null,
              feedback: el('hubModalBody').querySelector(`[data-feedback="${id}"]`).value
            } });
            showToast('Review saved. The group has been told.');
          } else {
            await api(`/api/college-hub/submissions/${id}`, { method: 'DELETE' });
            showToast('Removed. The group can hand in again.');
          }
          showModalError('');
          await loadHub();
          draw();
        } catch (err) {
          showModalError(err.message);
          button.disabled = false;
        }
      };
    },
    onConfirm: async () => {}
  });
}

hubActions['review-work'] = (button) => {
  const activity = activityById(button.dataset.id);
  if (activity) openReview(activity);
};

function downloadSubmissions(activity) {
  const rows = [['Group', 'Students', 'Handed in', 'Late', 'Link', 'File', 'Note', 'Marks', 'Out of', 'Feedback']].concat(groupsOf(activity.id).map(group => {
    const row = submissionOf(activity.id, group.id);
    return [group.name, studentIdsOf(group).map(nameOf).join('; '), row ? new Date(row.updated_at).toLocaleString() : 'No', row && row.late ? 'Yes' : '',
      row ? row.link : '', row && row.file_url ? mediaUrl(row.file_url) : '', row ? row.note : '',
      row && row.marks !== null && row.marks !== undefined ? row.marks : '', activity.max_marks || '', row ? row.feedback : ''];
  }));
  downloadCsv(rows, `${fileSafe(activity.title)}-work.csv`);
}

// ==========================================
// 4. WEEKLY CHECK-INS
// ==========================================
const latestCheckin = (groupId) => (hub.checkins || []).find(row => row.group_id === groupId) || null;
const checkedInThisWeek = (groupId) => { const row = latestCheckin(groupId); return Boolean(row) && row.week_start === thisWeek(); };

// On the activity's post: how many groups wrote this week (teachers only)
function checkinSummaryHtml(activity) {
  if (!activity.weekly_checkins || !isTeacher()) return '';
  const groups = groupsOf(activity.id);
  if (!groups.length) return '';
  const done = groups.filter(group => checkedInThisWeek(group.id)).length;
  return `<div class="ch-work"><span>${icon('event_repeat')}<b>${done} of ${plural(groups.length, 'group', 'groups')}</b> checked in this week</span>
    ${done < groups.length ? `<button class="ch-btn line small" type="button" data-act="checkin-remind" data-id="${activity.id}">${icon('notifications_active')}Remind ${groups.length - done}</button>` : ''}</div>`;
}

// On a group card: the check-in line and its buttons
function groupCheckinHtml(group, activity) {
  if (!activity || !activity.weekly_checkins) return '';
  const mine = iAmIn(group) && !isTeacher();
  if (!mine && !isTeacher()) return '';
  const row = latestCheckin(group.id);
  const fresh = checkedInThisWeek(group.id);
  return `<div class="ch-checkin-line${fresh ? ' done' : ''}">
    ${icon(fresh ? 'event_available' : 'event_busy')}
    <span>${fresh ? 'Checked in this week' : (row ? `Last check-in: week of ${formatDate(row.week_start)}` : 'No check-in yet')}${row && row.has_note ? ' · teacher replied' : ''}</span>
    <span class="ch-spacer"></span>
    ${mine ? `<button class="ch-btn line small" type="button" data-act="checkin" data-group="${group.id}">${fresh ? 'Edit' : 'Check in'}</button>` : ''}
    ${row ? `<button class="ch-btn line small" type="button" data-act="checkins" data-group="${group.id}">Progress</button>` : ''}
  </div>`;
}

hubActions['checkin-remind'] = (button) => {
  const id = Number(button.dataset.id);
  run(() => api(`/api/college-hub/activities/${id}/checkin-remind`, { method: 'POST' }), (result) => `Reminder sent to ${plural(result.reminded, 'student', 'students')} in ${plural(result.groups, 'group', 'groups')}.`);
};

hubActions.checkin = async (button) => {
  const group = hub.groups.find(item => item.id === Number(button.dataset.group));
  if (!group) return;
  let current = null;
  if (checkedInThisWeek(group.id)) {
    try {
      const data = await api(`/api/college-hub/groups/${group.id}/checkins`);
      current = data.checkins.find(row => row.week_start === data.this_week) || null;
    } catch (err) { return showToast(err.message); }
  }
  openHubModal({
    title: `Check-in: ${group.name}`,
    confirmText: current ? 'Save changes' : 'Check in',
    body: `<p class="ch-muted">Week of ${formatDate(thisWeek())}. One check-in per group per week; anyone in the group can write or change it. Your teachers read it.</p>
      <label>What we did this week<textarea class="ch-textarea" id="ciDone" maxlength="2000" placeholder="For example: finished the survey, wrote the introduction">${escapeHtml(current ? current.done : '')}</textarea></label>
      <label>What we will do next<textarea class="ch-textarea" id="ciNext" maxlength="2000">${escapeHtml(current ? current.next_steps : '')}</textarea></label>
      <label>Anything blocking us <small>(optional)</small><textarea class="ch-textarea" id="ciBlockers" maxlength="2000" style="min-height:60px">${escapeHtml(current ? current.blockers : '')}</textarea></label>`,
    onConfirm: async () => {
      const body = { done: el('ciDone').value, next_steps: el('ciNext').value, blockers: el('ciBlockers').value };
      if (!Object.values(body).some(value => value.trim())) throw new Error('Write at least one line about this week.');
      await api(`/api/college-hub/groups/${group.id}/checkin`, { method: 'PUT', body });
      showToast('Check-in saved.');
    }
  });
};

function checkinEntryHtml(row) {
  const part = (label, text) => text ? `<div><h5>${label}</h5><p>${linkify(text)}</p></div>` : '';
  return `<article class="ch-checkin">
    <div class="ch-review-head"><b>Week of ${escapeHtml(formatDate(row.week_start))}</b><span class="ch-muted">by ${escapeHtml(row.author_name)}</span><time>${escapeHtml(formatTime(row.updated_at))}</time></div>
    ${part('Done', row.done)}${part('Next', row.next_steps)}${part('Blocking', row.blockers)}
    ${isTeacher()
      ? `<div class="ch-review-grade"><label style="flex:1">Your note to the group<textarea class="ch-textarea" data-note="${row.id}" rows="2" maxlength="2000" style="min-height:44px">${escapeHtml(row.teacher_note)}</textarea></label></div>
         <div class="ch-review-actions"><button class="ch-btn solid small" type="button" data-note-save="${row.id}">${icon('send')}Save note</button></div>`
      : (row.teacher_note ? `<div class="ch-feedback">${icon('school')}<div><b>${escapeHtml(row.teacher_name || 'Teacher')}</b><p>${linkify(row.teacher_note)}</p></div></div>` : '')}
  </article>`;
}

hubActions.checkins = async (button) => {
  const group = hub.groups.find(item => item.id === Number(button.dataset.group));
  if (!group) return;
  let data;
  try { data = await api(`/api/college-hub/groups/${group.id}/checkins`); } catch (err) { return showToast(err.message); }
  openHubModal({
    title: `Progress: ${group.name}`,
    confirmText: 'Close',
    wide: true,
    body: `<div class="ch-review-list">${data.checkins.length ? data.checkins.map(checkinEntryHtml).join('') : '<p class="ch-muted">No check-ins yet.</p>'}</div>`,
    onOpen: () => {
      el('hubModalBody').onclick = async (e) => {
        const save = e.target.closest('[data-note-save]');
        if (!save) return;
        const id = Number(save.dataset.noteSave);
        save.disabled = true;
        try {
          await api(`/api/college-hub/checkins/${id}/note`, { method: 'PUT', body: { teacher_note: el('hubModalBody').querySelector(`[data-note="${id}"]`).value } });
          showModalError('');
          showToast('Note saved. The group has been told.');
        } catch (err) { showModalError(err.message); }
        save.disabled = false;
      };
    },
    onConfirm: async () => {}
  });
};
