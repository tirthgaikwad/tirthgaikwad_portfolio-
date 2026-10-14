// ==========================================
// HUB-DOCS.JS — Shared pages and meeting notes.
// Pages: specs, research, how-tos, written in simple Markdown (headings, lists, [ ] checkboxes, **bold**, links, tables).
// Meetings: date, who came, the agenda, notes, and action items that can be turned into tasks with one click.
// Saving checks that nobody else changed the page meanwhile (saveHubItem in hub-tools.js).
// ==========================================

const docState = { id: null, editing: false, dirty: false, preview: false };

function docList() {
  const pages = itemsOf('doc').sort((a, b) => (!!b.data.pinned - !!a.data.pinned) || b.updated_at.localeCompare(a.updated_at));
  const meetings = itemsOf('meeting').sort((a, b) => (b.data.date || '').localeCompare(a.data.date || '') || b.id - a.id);
  return { pages, meetings };
}

function renderDocs() {
  const view = el('view-docs');
  if (docState.editing && view.querySelector('#docEditor')) return;    // never redraw over unsaved typing
  const { pages, meetings } = docList();
  let current = hub.items.find(i => i.id === docState.id && (i.kind === 'doc' || i.kind === 'meeting'));
  if (!current) { current = pages[0] || meetings[0] || null; docState.id = current ? current.id : null; docState.editing = false; }

  view.innerHTML = `
    ${toolHead('Docs & meetings', 'Write things down once, in one place, for the whole team.',
      `<button type="button" class="ht-btn is-quiet" data-doc="new-meeting">${msIcon('event_note')}Meeting notes</button><button type="button" class="ht-btn" data-doc="new-page">${msIcon('note_add')}New page</button>`)}
    <div class="ht-docs">
      <nav class="ht-card ht-doc-list" aria-label="Pages and meetings">
        <h4>${msIcon('article')}Pages <small>${pages.length}</small></h4>
        ${pages.map(p => `<button type="button" class="ht-doc-link${p.id === docState.id ? ' is-on' : ''}" data-pick="${p.id}">${msIcon(p.data.pinned ? 'push_pin' : 'description')}<span>${escapeHtml(p.title)}</span></button>`).join('') || '<p class="ht-muted">No pages yet.</p>'}
        <h4>${msIcon('groups')}Meetings <small>${meetings.length}</small></h4>
        ${meetings.map(m => { const open = (m.data.actions || []).filter(a => !a.done).length; return `<button type="button" class="ht-doc-link${m.id === docState.id ? ' is-on' : ''}" data-pick="${m.id}">${msIcon('event')}<span>${escapeHtml(m.title)}<small>${escapeHtml(dayLabel(m.data.date, true))}${open ? ` · ${open} to do` : ''}</small></span></button>`; }).join('') || '<p class="ht-muted">No meeting notes yet.</p>'}
      </nav>
      <article class="ht-card ht-doc-main">${!current ? toolEmpty('article', 'Nothing written yet', 'Start a page for your spec, research or setup steps, or take notes at your next meeting.')
        : current.kind === 'doc' ? docHtml(current) : meetingHtml(current)}</article>
    </div>`;
}

// ---------- pages ----------
function docHtml(doc) {
  if (docState.editing) {
    return `<form id="docEditor" class="ht-doc-editor">
      <div class="ht-row"><input class="ht-doc-title" name="title" maxlength="160" value="${escapeHtml(doc.title)}" aria-label="Title" required>
        <label class="ht-check"><input type="checkbox" name="pinned" ${doc.data.pinned ? 'checked' : ''}> Pin</label></div>
      <div class="ht-md-toolbar" role="toolbar" aria-label="Formatting">
        ${[['h', 'title', 'Heading'], ['b', 'format_bold', 'Bold'], ['i', 'format_italic', 'Italic'], ['ul', 'format_list_bulleted', 'List'], ['ol', 'format_list_numbered', 'Numbered list'],
           ['check', 'check_box', 'Checkbox'], ['link', 'link', 'Link'], ['code', 'code', 'Code'], ['table', 'table', 'Table']].map(([k, ic, t]) => `<button type="button" class="ht-icon-btn" data-md="${k}" title="${t}">${msIcon(ic)}</button>`).join('')}
        <span class="ht-grow"></span>
        <button type="button" class="ht-btn is-quiet is-small" data-doc="preview">${msIcon(docState.preview ? 'edit' : 'visibility')}${docState.preview ? 'Write' : 'Preview'}</button>
      </div>
      <textarea name="body" class="ht-md-input" rows="18" maxlength="60000" ${docState.preview ? 'hidden' : ''} placeholder="# Heading&#10;&#10;Write here. Use - for lists and - [ ] for checkboxes.">${escapeHtml(doc.data.body || '')}</textarea>
      <div class="ht-md" ${docState.preview ? '' : 'hidden'}>${renderMarkdown(doc.data.body || '')}</div>
      <div class="ht-row"><span class="ht-muted" id="docStatus">${docState.dirty ? 'Not saved yet' : ''}</span><span class="ht-grow"></span>
        <button type="button" class="ht-btn is-quiet" data-doc="cancel">Cancel</button><button type="submit" class="ht-btn">${msIcon('save')}Save</button></div>
      <input type="hidden" name="base" value="${escapeHtml(doc.updated_at)}">
    </form>`;
  }
  return `<div class="ht-doc-top"><div><h2>${escapeHtml(doc.title)}</h2>
      <p class="ht-muted">${doc.updated_by ? `Edited by ${escapeHtml(memberName(doc.updated_by))} ${escapeHtml(relativeTime(doc.updated_at))}` : ''}</p></div>
    <div class="ht-head-actions"><button type="button" class="ht-icon-btn" data-doc="delete" title="Delete page">${msIcon('delete')}</button>
      <button type="button" class="ht-btn" data-doc="edit">${msIcon('edit')}Edit</button></div></div>
    <div class="ht-md">${doc.data.body ? renderMarkdown(doc.data.body) : '<p class="ht-muted">This page is empty. Press Edit to write.</p>'}</div>`;
}

function wrapSelection(box, kind) {
  const { selectionStart: s, selectionEnd: e, value } = box;
  const picked = value.slice(s, e);
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const insert = {
    b: [`**${picked || 'bold text'}**`], i: [`*${picked || 'text'}*`], code: [picked.includes('\n') ? `\`\`\`\n${picked}\n\`\`\`` : `\`${picked || 'code'}\``],
    link: [`[${picked || 'link text'}](https://)`], table: [`\n| Column | Column |\n|---|---|\n| | |\n`],
  }[kind];
  if (insert) {
    box.setRangeText(insert[0], s, e, 'end');
  } else {
    const prefix = { h: '## ', ul: '- ', ol: '1. ', check: '- [ ] ' }[kind];
    box.setRangeText(prefix, lineStart, lineStart, 'end');
  }
  box.focus();
  docState.dirty = true;
}

async function saveDoc(form) {
  const doc = hub.items.find(i => i.id === docState.id);
  const data = new FormData(form);
  try {
    const saved = await saveHubItem({ id: doc.id, kind: 'doc', title: data.get('title'), base: data.get('base'),
      data: { body: form.elements.body.value, pinned: form.elements.pinned.checked } });
    if (saved) { docState.editing = false; docState.dirty = false; renderDocs(); showToast('Page saved.'); }
  } catch (err) {
    el('docStatus').textContent = err.message;
  }
}

// ---------- meetings ----------
function meetingHtml(m) {
  const d = m.data;
  const actions = d.actions || [];
  return `<div class="ht-doc-top"><div><h2>${escapeHtml(m.title)}</h2>
      <p class="ht-muted">${msIcon('event')}${escapeHtml(dayLabel(d.date, true))}${d.time ? ` · ${escapeHtml(d.time)}` : ''}</p></div>
    <div class="ht-head-actions"><button type="button" class="ht-icon-btn" data-doc="delete" title="Delete">${msIcon('delete')}</button>
      <button type="button" class="ht-btn" data-doc="edit-meeting">${msIcon('edit')}Edit</button></div></div>
    <div class="ht-attendees">${(d.attendees || []).map(id => `<span class="ht-person">${avatarOf(id)}${escapeHtml(memberName(id))}</span>`).join('') || '<span class="ht-muted">No attendees noted.</span>'}</div>
    <div class="ht-meeting-grid">
      <section><h4>${msIcon('list')}Agenda</h4><div class="ht-md">${d.agenda ? renderMarkdown(d.agenda) : '<p class="ht-muted">—</p>'}</div></section>
      <section><h4>${msIcon('edit_note')}Notes</h4><div class="ht-md">${d.notes ? renderMarkdown(d.notes) : '<p class="ht-muted">—</p>'}</div></section>
    </div>
    <section><h4>${msIcon('task_alt')}Action items <small>${actions.filter(a => !a.done).length} open</small></h4>
      <ul class="ht-actions">${actions.map(a => {
        const task = a.task_id ? taskById(a.task_id) : null;
        return `<li class="${a.done ? 'is-done' : ''}"><label><input type="checkbox" data-action-done="${escapeHtml(a.id)}" ${a.done ? 'checked' : ''}><span>${escapeHtml(a.text)}</span></label>
          <span class="ht-muted">${a.owner_id ? escapeHtml(memberName(a.owner_id)) : ''}${a.due ? ` · ${escapeHtml(dayLabel(a.due))}` : ''}</span>
          ${task ? `<button type="button" class="ht-link" data-open="${task.id}">${msIcon('link')}Task</button>` : `<button type="button" class="ht-btn is-quiet is-small" data-action-task="${escapeHtml(a.id)}">${msIcon('add_task')}Make it a task</button>`}</li>`; }).join('') || '<li class="ht-muted">No action items.</li>'}</ul>
      <form class="ht-inline-add" data-form="action"><input type="text" maxlength="300" placeholder="Add an action item" aria-label="New action item">
        <select aria-label="Owner">${memberOptions(null, 'Owner').map(([v, l]) => `<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`).join('')}</select>
        <input type="date" aria-label="Due"><button type="submit" class="ht-btn is-quiet">Add</button></form>
    </section>`;
}

function meetingSheet(meeting) {
  const d = meeting ? meeting.data : { date: todayIso(), attendees: [currentUserId] };
  openSheet({
    title: meeting ? 'Edit meeting notes' : 'New meeting notes',
    fields: [
      { name: 'title', label: 'Meeting', required: true, maxlength: 160, value: meeting ? meeting.title : `Team meeting ${dayLabel(todayIso())}` },
      { name: 'date', label: 'Date', type: 'date', half: true, value: d.date || '' },
      { name: 'time', label: 'Time', type: 'time', half: true, value: d.time || '' },
      ...hub.members.map(m => ({ name: `at_${m.user_id}`, label: m.user_name, type: 'checkbox', half: true, value: (d.attendees || []).includes(m.user_id) })),
      { name: 'agenda', label: 'Agenda', type: 'textarea', maxlength: 4000, value: d.agenda || '', placeholder: '1. What we did\n2. What is blocked\n3. Next steps' },
      { name: 'notes', label: 'Notes', type: 'textarea', maxlength: 20000, value: d.notes || '' },
    ],
    onSubmit: async (v) => {
      const attendees = hub.members.filter(m => v[`at_${m.user_id}`]).map(m => m.user_id);
      const saved = await saveHubItem({ id: meeting && meeting.id, kind: 'meeting', title: v.title, base: meeting && meeting.updated_at,
        data: { date: v.date, time: v.time, attendees, agenda: v.agenda, notes: v.notes, actions: meeting ? meeting.data.actions || [] : [] } });
      if (saved) { docState.id = saved.id; renderDocs(); }
    },
  });
}

async function saveMeetingActions(meeting, actions) {
  try {
    await saveHubItem({ id: meeting.id, kind: 'meeting', title: meeting.title, data: { actions } });
    renderDocs();
  } catch (err) { showToast(err.message); }
}

// ---------- events ----------
function initDocEvents() {
  const view = el('view-docs');
  const confirmLeave = (then) => {
    if (!docState.editing || !docState.dirty) { docState.editing = false; return then(); }
    hubConfirm('Leave without saving?', 'Your changes to this page are not saved yet.', 'Leave', () => { docState.editing = false; docState.dirty = false; then(); });
  };
  view.addEventListener('click', async (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) return confirmLeave(() => { docState.id = parseInt(pick.dataset.pick, 10); docState.preview = false; renderDocs(); });
    const open = e.target.closest('[data-open]');
    if (open) return openTaskDrawer(parseInt(open.dataset.open, 10));
    const md = e.target.closest('[data-md]');
    if (md) return wrapSelection(view.querySelector('.ht-md-input'), md.dataset.md);
    const makeTask = e.target.closest('[data-action-task]');
    if (makeTask) {
      const meeting = hub.items.find(i => i.id === docState.id);
      const action = meeting.data.actions.find(a => a.id === makeTask.dataset.actionTask);
      const task = await createTask({ title: action.text.slice(0, 160), due_date: action.due || '', ...(action.owner_id ? { assignee_id: action.owner_id } : {}),
                                      description: `From the meeting “${meeting.title}” (${meeting.data.date || ''})` });
      if (task) saveMeetingActions(meeting, meeting.data.actions.map(a => a.id === action.id ? { ...a, task_id: task.id } : a));
      return;
    }
    const act = e.target.closest('[data-doc]');
    if (!act) return;
    const current = hub.items.find(i => i.id === docState.id);
    switch (act.dataset.doc) {
      case 'new-page':
        return confirmLeave(async () => {
          try {
            const saved = await saveHubItem({ kind: 'doc', title: 'Untitled page', data: { body: '', pinned: false } });
            docState.id = saved.id; docState.editing = true; docState.dirty = false; docState.preview = false;
            renderDocs();
            view.querySelector('.ht-doc-title').select();
          } catch (err) { showToast(err.message); }
        });
      case 'new-meeting': return confirmLeave(() => meetingSheet(null));
      case 'edit': docState.editing = true; docState.dirty = false; docState.preview = false; return renderDocs();
      case 'edit-meeting': return meetingSheet(current);
      case 'cancel': return confirmLeave(() => renderDocs());
      case 'preview': {
        const box = view.querySelector('.ht-md-input');
        docState.preview = !docState.preview;
        const previewBox = view.querySelector('.ht-md');
        previewBox.innerHTML = renderMarkdown(box.value);
        box.hidden = docState.preview; previewBox.hidden = !docState.preview;
        act.innerHTML = `${msIcon(docState.preview ? 'edit' : 'visibility')}${docState.preview ? 'Write' : 'Preview'}`;
        return;
      }
      case 'delete': return deleteHubItem(current, current.kind === 'doc' ? 'page' : 'meeting notes');
    }
  });
  view.addEventListener('input', (e) => {
    if (e.target.closest('#docEditor')) { docState.dirty = true; const s = el('docStatus'); if (s) s.textContent = 'Not saved yet'; }
  });
  view.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && e.target.closest('#docEditor')) { e.preventDefault(); saveDoc(el('docEditor')); }
  });
  view.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id === 'docEditor') return saveDoc(e.target);
    if (e.target.dataset.form === 'action') {
      const [text, owner, due] = [...e.target.querySelectorAll('input[type=text], select, input[type=date]')].map(x => x.value);
      if (!text.trim()) return;
      const meeting = hub.items.find(i => i.id === docState.id);
      saveMeetingActions(meeting, (meeting.data.actions || []).concat({ id: Math.random().toString(36).slice(2, 10), text: text.trim(), owner_id: owner ? parseInt(owner, 10) : null, due, done: false }));
    }
  });
  view.addEventListener('change', (e) => {
    const box = e.target.closest('[data-action-done]');
    if (!box) return;
    const meeting = hub.items.find(i => i.id === docState.id);
    saveMeetingActions(meeting, meeting.data.actions.map(a => a.id === box.dataset.actionDone ? { ...a, done: box.checked } : a));
  });
  window.addEventListener('beforeunload', (e) => { if (docState.editing && docState.dirty) { e.preventDefault(); e.returnValue = ''; } });
}

registerHubTool('docs', { render: renderDocs });
document.addEventListener('DOMContentLoaded', initDocEvents);
