// ==========================================
// HUB-TASK.JS — The task panel: everything about one task in a drawer on the right.
// Fields save as they change. Comments (with @mentions and files), the checklist, what the task waits for,
// a timer and the task's history are here too. Opened by clicking a task anywhere in Project Hub.
// ==========================================

let drawer = null;            // { taskId, detail: { comments, activity, time }, loading }
let mentionPicks = new Map(); // name -> user id, for @mentions typed in the comment box

function openTaskDrawer(taskId) {
  const task = taskById(taskId);
  if (!task) return;
  buildDrawer();
  drawer = { taskId, detail: null, loading: true };
  document.getElementById('htDrawer').classList.add('is-open');
  document.getElementById('htDrawerBackdrop').hidden = false;
  document.body.classList.add('ht-drawer-open');
  paintDrawer();
  loadDrawerDetail(taskId);
  try { history.replaceState(null, '', setUrlParam('task', taskId)); } catch (e) { /* not allowed here */ }
}

function closeTaskDrawer() {
  if (!drawer) return;
  saveDrawerText();
  drawer = null;
  document.getElementById('htDrawer').classList.remove('is-open');
  document.getElementById('htDrawerBackdrop').hidden = true;
  document.body.classList.remove('ht-drawer-open');
  try { history.replaceState(null, '', setUrlParam('task', null)); } catch (e) { /* not allowed here */ }
}

function setUrlParam(key, value) {
  const params = new URLSearchParams(location.search);
  if (value === null || value === undefined) params.delete(key); else params.set(key, value);
  const query = params.toString();
  return location.pathname + (query ? `?${query}` : '') + location.hash;
}

async function loadDrawerDetail(taskId) {
  try {
    const detail = await api(`/api/tasks/${taskId}`);
    if (!drawer || drawer.taskId !== taskId) return;
    drawer.detail = detail;
    drawer.loading = false;
    applyTask(detail.task);
    paintDrawer();
  } catch (err) {
    if (drawer && drawer.taskId === taskId) { drawer.loading = false; drawer.error = err.message; paintDrawer(); }
  }
}

function buildDrawer() {
  if (document.getElementById('htDrawer')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="ht-drawer-backdrop" id="htDrawerBackdrop" hidden></div>
    <aside class="ht-drawer" id="htDrawer" role="dialog" aria-modal="true" aria-label="Task"></aside>
    <div id="upload-progress" class="ht-upload hidden"><span id="upload-progress-name"></span><span id="upload-progress-percent"></span><div><i id="upload-progress-bar"></i></div></div>`);
  document.getElementById('htDrawerBackdrop').addEventListener('click', closeTaskDrawer);
  const panel = document.getElementById('htDrawer');
  panel.addEventListener('click', onDrawerClick);
  panel.addEventListener('change', onDrawerChange);
  panel.addEventListener('input', onDrawerInput);
  panel.addEventListener('keydown', onDrawerKey);
  panel.addEventListener('focusout', (e) => { if (e.target.matches('[data-text-field]')) saveDrawerText(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawer && !document.querySelector('.fs-overlay')) closeTaskDrawer(); });
}

// ---------- drawing ----------
function paintDrawer() {
  if (!drawer) return;
  const task = taskById(drawer.taskId);
  const panel = document.getElementById('htDrawer');
  if (!task) { closeTaskDrawer(); return; }
  // Keep whatever the person is typing: only the parts around the text boxes are redrawn while one has focus
  const focused = document.activeElement && panel.contains(document.activeElement) ? document.activeElement.dataset.keep : null;
  const keep = focused ? { name: focused, value: document.activeElement.value, start: document.activeElement.selectionStart } : null;

  const detail = drawer.detail;
  const columns = HUB_COLUMNS.map(c => [c.id, c.name]);
  const sprints = [['', 'Backlog']].concat(hub.sprints.filter(s => s.status !== 'done' || s.id === task.sprint_id).map(s => [String(s.id), s.name + (s.status === 'active' ? ' (running)' : '')]));
  const select = (name, options, value) => `<select data-field="${name}">${options.map(([v, l]) => `<option value="${escapeHtml(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>`;
  const blockers = (task.depends_on || []).map(taskById).filter(Boolean);
  const blocking = hub.tasks.filter(t => (t.depends_on || []).includes(task.id));
  const candidates = hub.tasks.filter(t => t.id !== task.id && !(task.depends_on || []).includes(t.id));
  const checklist = task.checklist || [];
  const minutes = (hub.time || []).filter(t => t.task_id === task.id).reduce((sum, t) => sum + (t.minutes || 0), 0);
  const running = myRunningTimer();
  const timingThis = running && running.task_id === task.id;

  panel.innerHTML = `
    <div class="ht-drawer-head">
      <span class="ht-chip ${task.column === 'done' ? 'is-done' : ''}">${escapeHtml(HUB_COLUMNS.find(c => c.id === task.column)?.name || '')}</span>
      ${task.is_milestone ? `<span class="ht-badge is-milestone">${msIcon('flag')}Milestone</span>` : ''}
      <span class="ht-grow"></span>
      ${canDeleteTask(task) ? `<button type="button" class="ht-icon-btn" data-act="delete" title="Delete task">${msIcon('delete')}</button>` : ''}
      <button type="button" class="ht-icon-btn" data-act="close" title="Close (Esc)">${msIcon('close')}</button>
    </div>
    <div class="ht-drawer-body">
      <textarea class="ht-title-input" data-text-field="title" data-keep="title" rows="1" maxlength="160" aria-label="Title">${escapeHtml(task.title)}</textarea>

      <div class="ht-fields">
        <label>Status ${select('column', columns, task.column)}</label>
        <label>Priority ${select('priority', [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], task.priority)}</label>
        <label>Assignee ${select('assignee_id', [['', 'Unassigned']].concat(hub.members.map(m => [String(m.user_id), m.user_name])), task.assignee_id)}</label>
        <label>Sprint ${select('sprint_id', sprints, task.sprint_id)}</label>
        <label>Start <input type="date" data-field="start_date" value="${escapeHtml(task.start_date || '')}"></label>
        <label>Due <input type="date" data-field="due_date" value="${escapeHtml(task.due_date || '')}"></label>
        <label>Estimate (h) <input type="number" min="0" max="1000" step="0.5" data-field="estimate_hours" value="${task.estimate_hours ?? ''}" placeholder="—"></label>
        <label>Tag <input type="text" maxlength="30" data-text-field="tag" data-keep="tag" value="${escapeHtml(task.tag || '')}" placeholder="Design"></label>
        <label class="ht-check"><input type="checkbox" data-field="is_milestone" ${task.is_milestone ? 'checked' : ''}> Milestone</label>
      </div>

      <section class="ht-sec">
        <h4>${msIcon('notes')}Description</h4>
        <textarea data-text-field="description" data-keep="description" rows="4" maxlength="2000" placeholder="What needs doing, links, notes…">${escapeHtml(task.description || '')}</textarea>
      </section>

      <section class="ht-sec">
        <h4>${msIcon('checklist')}Checklist ${checklist.length ? `<small>${checklist.filter(c => c.done).length}/${checklist.length}</small>` : ''}</h4>
        ${checklist.length ? `<div class="ht-progress"><i style="width:${Math.round(100 * checklist.filter(c => c.done).length / checklist.length)}%"></i></div>` : ''}
        <ul class="ht-checklist">${checklist.map(c => `
          <li class="${c.done ? 'is-done' : ''}"><label><input type="checkbox" data-check="${escapeHtml(c.id)}" ${c.done ? 'checked' : ''}><span>${escapeHtml(c.text)}</span></label>
            <button type="button" class="ht-icon-btn is-small" data-uncheck="${escapeHtml(c.id)}" title="Remove">${msIcon('close')}</button></li>`).join('')}</ul>
        <form class="ht-inline-add" data-form="check"><input type="text" maxlength="200" placeholder="Add an item" data-keep="newcheck" aria-label="New checklist item"><button type="submit" class="ht-btn is-quiet">Add</button></form>
      </section>

      <section class="ht-sec">
        <h4>${msIcon('account_tree')}Waits for</h4>
        <div class="ht-deps">${blockers.map(t => `<span class="ht-dep ${t.column === 'done' ? 'is-done' : ''}"><button type="button" data-open="${t.id}">${msIcon(t.column === 'done' ? 'check_circle' : 'radio_button_unchecked')}${escapeHtml(t.title)}</button>
          <button type="button" class="ht-icon-btn is-small" data-undep="${t.id}" title="Stop waiting for this">${msIcon('close')}</button></span>`).join('') || '<p class="ht-muted">Nothing. It can start any time.</p>'}</div>
        ${candidates.length ? `<select data-adddep aria-label="Add a task this one waits for"><option value="">+ Add a task it waits for…</option>${candidates.map(t => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join('')}</select>` : ''}
        ${blocking.length ? `<p class="ht-muted">${msIcon('subdirectory_arrow_right')}Holding up: ${blocking.map(t => `<button type="button" class="ht-link" data-open="${t.id}">${escapeHtml(t.title)}</button>`).join(', ')}</p>` : ''}
      </section>

      <section class="ht-sec">
        <h4>${msIcon('timer')}Time ${minutes ? `<small>${minutesLabel(minutes)} logged</small>` : ''}</h4>
        <div class="ht-row">
          <button type="button" class="ht-btn ${timingThis ? 'is-danger' : ''}" data-act="${timingThis ? 'stop-timer' : 'start-timer'}">${msIcon(timingThis ? 'stop_circle' : 'play_circle')}${timingThis ? `Stop · ${timerElapsed(running)}` : 'Start timer'}</button>
          <button type="button" class="ht-btn is-quiet" data-act="log-time">${msIcon('more_time')}Log time</button>
          ${task.estimate_hours ? `<span class="ht-muted">${Math.round(100 * minutes / 60 / task.estimate_hours)}% of the estimate</span>` : ''}
        </div>
      </section>

      <section class="ht-sec">
        <h4>${msIcon('forum')}Comments</h4>
        ${!detail ? `<p class="ht-muted">${drawer.error ? escapeHtml(drawer.error) : 'Loading…'}</p>` : `
          <ul class="ht-comments">${detail.comments.map(commentHtml).join('') || '<li class="ht-muted">No comments yet.</li>'}</ul>`}
        <form class="ht-comment-form" data-form="comment">
          <div class="ht-mention-list" id="htMentions" hidden></div>
          <textarea rows="2" maxlength="3000" placeholder="Write a comment. Type @ to mention someone." data-keep="comment" aria-label="Comment"></textarea>
          <div class="ht-row"><label class="ht-btn is-quiet">${msIcon('attach_file')}File<input type="file" data-attach hidden></label><span class="ht-grow"></span><button type="submit" class="ht-btn">Send</button></div>
        </form>
      </section>

      ${detail && detail.activity.length ? `<section class="ht-sec">
        <h4>${msIcon('history')}History</h4>
        <ul class="ht-activity">${detail.activity.map(a => `<li><strong>${escapeHtml(a.name)}</strong> ${escapeHtml(a.detail)} <time>${escapeHtml(relativeTime(a.at))}</time></li>`).join('')}</ul>
      </section>` : ''}
    </div>`;

  autoGrow(panel.querySelector('.ht-title-input'));
  if (keep) {
    const box = panel.querySelector(`[data-keep="${keep.name}"]`);
    if (box) { box.value = keep.value; box.focus(); try { box.setSelectionRange(keep.start, keep.start); } catch (e) { /* not a text box */ } }
  }
}

function commentHtml(c) {
  const mine = c.user_id === currentUserId;
  const body = escapeHtml(c.body).replace(/(^|\s)@([\p{L}\p{N}._-]+(?: [\p{L}\p{N}._-]+)?)/gu, '$1<mark>@$2</mark>');
  const file = c.attachment ? `<a class="ht-file" href="${escapeHtml(c.attachment)}" target="_blank" rel="noopener">${msIcon('attach_file')}${escapeHtml(decodeURIComponent(c.attachment.split('/').pop()))}</a>` : '';
  return `<li data-comment="${c.id}">${avatarOf(c.user_id, 'h-7 w-7', 'text-[10px]') || '<span class="ht-avatar-blank"></span>'}
    <div><p class="ht-comment-meta"><strong>${escapeHtml(c.name)}</strong><time>${escapeHtml(relativeTime(c.created_at))}</time>
      ${mine || hubIsAdmin() ? `<button type="button" class="ht-link" data-uncomment="${c.id}">Delete</button>` : ''}</p>
      ${c.body ? `<p class="ht-comment-body">${body}</p>` : ''}${file}</div></li>`;
}

function autoGrow(box) {
  if (!box) return;
  box.style.height = 'auto';
  // Measured once the panel is laid out; before that scrollHeight is 0 and the box would vanish
  if (box.scrollHeight) box.style.height = `${box.scrollHeight}px`;
  else requestAnimationFrame(() => { if (box.scrollHeight) box.style.height = `${box.scrollHeight}px`; });
}

// ---------- saving ----------
const TEXT_FIELDS = { title: 160, tag: 30, description: 2000 };

function saveDrawerText() {
  if (!drawer) return;
  const task = taskById(drawer.taskId);
  const panel = document.getElementById('htDrawer');
  if (!task || !panel) return;
  const body = {};
  panel.querySelectorAll('[data-text-field]').forEach(box => {
    const field = box.dataset.textField;
    const value = box.value.replace(/\s+$/, '');
    if (value !== (task[field] || '')) body[field] = value;
  });
  if (body.title !== undefined && !body.title.trim()) { showToast('A task needs a title.'); return; }
  if (Object.keys(body).length) patchTask(task.id, body);
}

async function onDrawerChange(e) {
  if (!drawer) return;
  const task = taskById(drawer.taskId);
  const target = e.target;
  if (target.dataset.field) {
    const field = target.dataset.field;
    let body;
    if (field === 'column') {
      const others = sortedColumnTasks(target.value);
      body = { column: target.value, position: others.length ? others[others.length - 1].position + 1 : 1 };
    } else if (field === 'assignee_id') {
      body = target.value ? { assignee_id: parseInt(target.value, 10) } : { clear_assignee: true };
    } else if (field === 'sprint_id') {
      body = target.value ? { sprint_id: parseInt(target.value, 10) } : { to_backlog: true };
    } else if (field === 'estimate_hours') {
      body = target.value === '' ? { clear_estimate: true } : { estimate_hours: Number(target.value) };
    } else if (field === 'is_milestone') {
      body = { is_milestone: target.checked };
    } else {
      body = { [field]: target.value };
    }
    if (!(await patchTask(task.id, body))) paintDrawer();
  } else if (target.dataset.check !== undefined) {
    const list = (task.checklist || []).map(c => c.id === target.dataset.check ? { ...c, done: target.checked } : c);
    patchTask(task.id, { checklist: list });
  } else if (target.dataset.adddep !== undefined && target.value) {
    const deps = (task.depends_on || []).concat(parseInt(target.value, 10));
    if (!(await patchTask(task.id, { depends_on: deps }))) paintDrawer();
  } else if (target.dataset.attach !== undefined && target.files.length) {
    const file = target.files[0];
    target.value = '';
    try {
      const upload = await uploadChatFile(file);
      setUploadProgress('', null);
      await sendComment('', upload.url);
    } catch (err) {
      setUploadProgress('', null);
      showToast(err.message);
    }
  }
}

function onDrawerInput(e) {
  if (e.target.classList.contains('ht-title-input')) autoGrow(e.target);
  if (e.target.closest('[data-form="comment"]') && e.target.tagName === 'TEXTAREA') showMentionList(e.target);
}

function onDrawerKey(e) {
  if (e.target.classList.contains('ht-title-input') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  if (e.target.closest('[data-form="comment"]') && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.target.closest('form').requestSubmit(); }
}

async function onDrawerClick(e) {
  if (!drawer) return;
  const task = taskById(drawer.taskId);
  const t = e.target;
  const act = t.closest('[data-act]');
  if (act) {
    const name = act.dataset.act;
    if (name === 'close') return closeTaskDrawer();
    if (name === 'delete') return confirmDeleteTask(task.id);
    if (name === 'start-timer') return startTimer(task.id);
    if (name === 'stop-timer') return stopTimer();
    if (name === 'log-time') return logTimeSheet(task.id);
  }
  const open = t.closest('[data-open]');
  if (open) { saveDrawerText(); return openTaskDrawer(parseInt(open.dataset.open, 10)); }
  const undep = t.closest('[data-undep]');
  if (undep) return patchTask(task.id, { depends_on: (task.depends_on || []).filter(id => id !== parseInt(undep.dataset.undep, 10)) });
  const uncheck = t.closest('[data-uncheck]');
  if (uncheck) return patchTask(task.id, { checklist: (task.checklist || []).filter(c => c.id !== uncheck.dataset.uncheck) });
  const uncomment = t.closest('[data-uncomment]');
  if (uncomment) {
    try {
      await api(`/api/comments/${uncomment.dataset.uncomment}`, { method: 'DELETE' });
      drawer.detail.comments = drawer.detail.comments.filter(c => c.id !== parseInt(uncomment.dataset.uncomment, 10));
      paintDrawer();
    } catch (err) { showToast(err.message); }
    return;
  }
  const pick = t.closest('[data-mention]');
  if (pick) return insertMention(pick.dataset.mention, parseInt(pick.dataset.id, 10));
}

document.addEventListener('submit', async (e) => {
  const form = e.target.closest && e.target.closest('#htDrawer form');
  if (!form || !drawer) return;
  e.preventDefault();
  const task = taskById(drawer.taskId);
  if (form.dataset.form === 'check') {
    const input = form.querySelector('input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await patchTask(task.id, { checklist: (task.checklist || []).concat({ id: Math.random().toString(36).slice(2, 10), text, done: false }) });
    form.querySelector('input')?.focus();
  } else if (form.dataset.form === 'comment') {
    const box = form.querySelector('textarea');
    if (!box.value.trim()) return;
    await sendComment(box.value.trim(), '');
  }
});

async function sendComment(body, attachment) {
  const taskId = drawer.taskId;
  // Mentions picked from the list whose name is still in the text
  const mentions = [...mentionPicks.entries()].filter(([name]) => body.includes(`@${name}`)).map(([, id]) => id);
  try {
    const comment = await api(`/api/tasks/${taskId}/comments`, { method: 'POST', body: { body, attachment, mentions } });
    mentionPicks = new Map();
    if (drawer && drawer.taskId === taskId && drawer.detail && !drawer.detail.comments.some(c => c.id === comment.id)) {
      drawer.detail.comments.push(comment);
    }
    const box = document.querySelector('#htDrawer [data-keep="comment"]');
    if (box) box.value = '';
    paintDrawer();
  } catch (err) {
    showToast(err.message);
  }
}

// ---------- @mentions ----------
function showMentionList(box) {
  const list = document.getElementById('htMentions');
  const before = box.value.slice(0, box.selectionStart);
  const match = /(^|\s)@([^\s@]{0,20})$/.exec(before);
  if (!match) { list.hidden = true; return; }
  const query = match[2].toLowerCase();
  const people = hub.members.filter(m => m.user_id !== currentUserId && m.user_name.toLowerCase().includes(query)).slice(0, 6);
  list.hidden = people.length === 0;
  list.innerHTML = people.map(m => `<button type="button" data-mention="${escapeHtml(m.user_name)}" data-id="${m.user_id}">${memberAvatarHtml(m, 'h-6 w-6', 'text-[9px]')}${escapeHtml(m.user_name)}</button>`).join('');
}

function insertMention(name, userId) {
  const box = document.querySelector('#htDrawer [data-keep="comment"]');
  const before = box.value.slice(0, box.selectionStart).replace(/@([^\s@]{0,20})$/, `@${name} `);
  box.value = before + box.value.slice(box.selectionStart);
  mentionPicks.set(name, userId);
  document.getElementById('htMentions').hidden = true;
  box.focus();
  box.setSelectionRange(before.length, before.length);
}

// ---------- live updates ----------
function hubDrawerHasComment(commentId) {
  return !!(drawer && drawer.detail && drawer.detail.comments.some(c => c.id === commentId));
}

function hubDrawerEvent(data) {
  if (!drawer) return;
  if (data.type === 'comment_added' && data.comment.task_id === drawer.taskId && drawer.detail && !hubDrawerHasComment(data.comment.id)) {
    drawer.detail.comments.push(data.comment);
    paintDrawer();
  } else if (data.type === 'comment_deleted' && drawer.detail) {
    drawer.detail.comments = drawer.detail.comments.filter(c => c.id !== data.id);
    paintDrawer();
  } else if (data.type === 'time_changed' || data.type === 'time_deleted' || data.type === 'sprint_saved') {
    paintDrawer();
  }
}

hubTaskListeners.push((taskId, deleted) => {
  if (!drawer) return;
  if (deleted && taskId === drawer.taskId) { closeTaskDrawer(); return; }
  paintDrawer();   // a change to this task, or to one it waits for
});

// A link from a notification (…&task=ID) opens that task once the board is in
(function openLinkedTask() {
  const wanted = parseInt(new URLSearchParams(location.search).get('task'), 10);
  if (!wanted) return;
  const wait = setInterval(() => {
    if (hub && taskById(wanted)) { clearInterval(wait); openTaskDrawer(wanted); }
  }, 300);
  setTimeout(() => clearInterval(wait), 20000);
})();
