// ==========================================
// HUB-BRIEF.JS — Defining the project:
//   Brief: the problem, goals, scope, deliverables, how success is measured, the deadline.
//   Risks & decisions: a risk register on a likelihood × impact grid, and a log of decisions with their reasons.
//   Roles & workload: who is Responsible / Accountable / Consulted / Informed for each area, and how much open work each person has.
// ==========================================

const LEVELS = { 1: 'Low', 2: 'Medium', 3: 'High' };
const BRIEF_LISTS = [
  ['goals', 'Goals', 'flag', 'What the project must achieve'],
  ['deliverables', 'Deliverables', 'inventory_2', 'What will be handed over'],
  ['scope_in', 'In scope', 'check_circle', 'What we will do'],
  ['scope_out', 'Out of scope', 'do_not_disturb_on', 'What we will not do (this time)'],
  ['success', 'Success looks like', 'military_tech', 'How we will know it worked'],
  ['stakeholders', 'Stakeholders', 'groups', 'Guide, client, users, judges…'],
];
let briefEditing = false;

// ==========================================
// 1. BRIEF
// ==========================================
function renderBrief() {
  const view = el('view-brief');
  const brief = itemsOf('brief')[0];
  if (!brief && !briefEditing) {
    view.innerHTML = toolHead('Project brief', 'One page everyone agrees on before the work starts.') +
      toolEmpty('description', 'No brief yet', 'Write down the problem, the goals, what is in and out of scope and the deadline. It keeps the whole team pointed the same way.',
        `<div class="ht-row ht-center"><button type="button" class="ht-btn" data-brief="edit">${msIcon('edit')}Write the brief</button>
         <button type="button" class="ht-btn is-quiet" data-brief="template">${msIcon('auto_awesome')}Start from a template</button></div>`);
    return;
  }
  const d = brief ? brief.data : {};
  if (briefEditing) {
    view.innerHTML = toolHead('Project brief', 'Write one item per line in the lists.', `<button type="button" class="ht-btn is-quiet" data-brief="cancel">Cancel</button><button type="button" class="ht-btn" data-brief="save">${msIcon('save')}Save</button>`) + `
      <form class="ht-card ht-form" id="briefForm">
        <label class="ht-field"><span>The problem</span><textarea name="problem" rows="4" maxlength="3000" placeholder="What is wrong today, and for whom?">${escapeHtml(d.problem || '')}</textarea></label>
        <label class="ht-field"><span>Who it is for</span><textarea name="audience" rows="2" maxlength="1000">${escapeHtml(d.audience || '')}</textarea></label>
        <div class="ht-form-grid">${BRIEF_LISTS.map(([key, label, , hint]) => `
          <label class="ht-field"><span>${escapeHtml(label)}</span><textarea name="${key}" rows="4" placeholder="${escapeHtml(hint)}">${escapeHtml((d[key] || []).join('\n'))}</textarea></label>`).join('')}</div>
        <label class="ht-field ht-field-short"><span>Deadline</span><input type="date" name="deadline" value="${escapeHtml(d.deadline || '')}"></label>
        <label class="ht-field"><span>Notes</span><textarea name="notes" rows="3" maxlength="4000">${escapeHtml(d.notes || '')}</textarea></label>
      </form>`;
    view.dataset.base = brief ? brief.updated_at : '';
    return;
  }
  const daysLeft = d.deadline ? daysBetween(todayIso(), d.deadline) : null;
  const done = hub.tasks.filter(t => t.column === 'done').length;
  view.innerHTML = toolHead('Project brief', brief.updated_by ? `Last changed by ${memberName(brief.updated_by)} ${relativeTime(brief.updated_at)}` : '',
      `<button type="button" class="ht-btn is-quiet" data-brief="print">${msIcon('print')}Print</button><button type="button" class="ht-btn" data-brief="edit">${msIcon('edit')}Edit</button>`) + `
    <div class="ht-brief">
      <div class="ht-brief-top">
        <section class="ht-card ht-brief-problem"><h4>${msIcon('help')}The problem</h4>${d.problem ? `<p>${escapeHtml(d.problem)}</p>` : '<p class="ht-muted">Not written yet.</p>'}
          ${d.audience ? `<h4>${msIcon('person')}Who it is for</h4><p>${escapeHtml(d.audience)}</p>` : ''}</section>
        <section class="ht-card ht-brief-deadline">
          ${d.deadline ? `<span class="ht-big${daysLeft < 0 ? ' is-late' : daysLeft <= 7 ? ' is-warn' : ''}">${Math.abs(daysLeft)}</span>
            <span>${daysLeft < 0 ? 'days past the deadline' : daysLeft === 1 ? 'day to the deadline' : 'days to the deadline'}</span>
            <strong>${escapeHtml(dayLabel(d.deadline, true))}</strong>` : '<span class="ht-muted">No deadline set</span>'}
          <div class="ht-progress"><i style="width:${hub.tasks.length ? Math.round(100 * done / hub.tasks.length) : 0}%"></i></div>
          <small class="ht-muted">${done} of ${hub.tasks.length} tasks done</small>
        </section>
      </div>
      <div class="ht-brief-grid">${BRIEF_LISTS.map(([key, label, icon]) => `
        <section class="ht-card"><h4>${msIcon(icon)}${escapeHtml(label)}</h4>
          ${(d[key] || []).length ? `<ul>${d[key].map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : '<p class="ht-muted">—</p>'}</section>`).join('')}</div>
      ${d.notes ? `<section class="ht-card"><h4>${msIcon('notes')}Notes</h4><p class="ht-pre">${escapeHtml(d.notes)}</p></section>` : ''}
    </div>`;
}

async function saveBrief() {
  const form = el('briefForm');
  const values = Object.fromEntries(new FormData(form).entries());
  const data = { problem: values.problem, audience: values.audience, deadline: values.deadline, notes: values.notes };
  BRIEF_LISTS.forEach(([key]) => { data[key] = values[key].split('\n').map(x => x.trim()).filter(Boolean); });
  const brief = itemsOf('brief')[0];
  try {
    const saved = await saveHubItem({ id: brief && brief.id, kind: 'brief', title: 'Project brief', data, base: el('view-brief').dataset.base || null });
    if (saved) { briefEditing = false; renderBrief(); }
  } catch (err) {
    showToast(err.message);
  }
}

// ==========================================
// 2. RISKS AND DECISIONS
// ==========================================
let riskFilter = null;      // "likelihood-impact" from the grid

function riskScore(risk) {
  return (risk.data.likelihood || 1) * (risk.data.impact || 1);
}

function riskLevel(score) {
  return score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low';
}

function renderRisks() {
  const view = el('view-risks');
  const risks = itemsOf('risk').sort((a, b) => ((a.data.status === 'closed') - (b.data.status === 'closed')) || riskScore(b) - riskScore(a));
  const open = risks.filter(r => !['closed', 'mitigated'].includes(r.data.status));
  const shown = riskFilter ? risks.filter(r => `${r.data.likelihood}-${r.data.impact}` === riskFilter) : risks;
  const decisions = itemsOf('decision').sort((a, b) => (b.data.date || b.created_at).localeCompare(a.data.date || a.created_at));
  const grid = [3, 2, 1].map(l => [1, 2, 3].map(i => {
    const here = open.filter(r => r.data.likelihood === l && r.data.impact === i);
    const key = `${l}-${i}`;
    return `<button type="button" class="ht-matrix-cell is-${riskLevel(l * i)}${riskFilter === key ? ' is-picked' : ''}" data-riskcell="${key}" title="Likelihood ${LEVELS[l]}, impact ${LEVELS[i]}">${here.length || ''}</button>`;
  }).join('')).join('');

  view.innerHTML = `
    ${toolHead('Risks', `${open.length} open risk${open.length === 1 ? '' : 's'}. Think about what could go wrong before it does.`, `<button type="button" class="ht-btn" data-risk="new">${msIcon('add')}Add a risk</button>`)}
    <div class="ht-risk-layout">
      <div class="ht-card ht-matrix-card">
        <div class="ht-matrix"><span class="ht-matrix-y">Likelihood</span>${grid}<span class="ht-matrix-x">Impact</span></div>
        <div class="ht-matrix-legend"><span>Low</span><span>→</span><span>High</span></div>
        ${riskFilter ? `<button type="button" class="ht-link" data-riskcell="">Show all risks</button>` : '<p class="ht-muted">Click a square to see its risks.</p>'}
      </div>
      <div class="ht-risk-list">${shown.map(r => `
        <article class="ht-card ht-risk is-${riskLevel(riskScore(r))}${['closed', 'mitigated'].includes(r.data.status) ? ' is-closed' : ''}">
          <div class="ht-risk-score" title="Likelihood × impact">${riskScore(r)}</div>
          <div class="ht-risk-main">
            <h4><button type="button" class="ht-link" data-risk="edit" data-id="${r.id}">${escapeHtml(r.title)}</button> <span class="ht-chip">${escapeHtml(r.data.status || 'open')}</span></h4>
            <p class="ht-muted">Likelihood ${LEVELS[r.data.likelihood] || '—'} · Impact ${LEVELS[r.data.impact] || '—'}${r.data.owner_id ? ` · Owner ${escapeHtml(memberName(r.data.owner_id))}` : ''}</p>
            ${r.data.description ? `<p>${escapeHtml(r.data.description)}</p>` : ''}
            ${r.data.mitigation ? `<p class="ht-plan">${msIcon('shield')}<span>${escapeHtml(r.data.mitigation)}</span></p>` : ''}
          </div>
        </article>`).join('') || toolEmpty('warning', riskFilter ? 'No risks in that square' : 'No risks written down', 'Exams, a member dropping out, an API that changes, a demo that breaks… Write them down with a plan.')}</div>
    </div>

    ${toolHead('Decision log', 'What was decided, why, and by whom, so nobody has to remember.', `<button type="button" class="ht-btn" data-decision="new">${msIcon('add')}Record a decision</button>`)}
    <div class="ht-decisions">${decisions.map(d => `
      <article class="ht-card ht-decision is-${d.data.status || 'decided'}">
        <div class="ht-decision-date">${d.data.date ? `<strong>${dayDate(d.data.date).getDate()}</strong><span>${escapeHtml(dayDate(d.data.date).toLocaleDateString([], { month: 'short', year: 'numeric' }))}</span>` : '—'}</div>
        <div><h4><button type="button" class="ht-link" data-decision="edit" data-id="${d.id}">${escapeHtml(d.title)}</button> <span class="ht-chip is-${d.data.status === 'decided' ? 'done' : d.data.status === 'reversed' ? 'late' : 'todo'}">${escapeHtml(d.data.status || 'decided')}</span></h4>
          ${d.data.decision ? `<p><strong>Decision:</strong> ${escapeHtml(d.data.decision)}</p>` : ''}
          ${d.data.reasons ? `<p><strong>Why:</strong> ${escapeHtml(d.data.reasons)}</p>` : ''}
          ${d.data.alternatives ? `<p class="ht-muted"><strong>Also considered:</strong> ${escapeHtml(d.data.alternatives)}</p>` : ''}
          ${d.data.owner_id ? `<p class="ht-muted">${avatarOf(d.data.owner_id)} ${escapeHtml(memberName(d.data.owner_id))}</p>` : ''}</div>
      </article>`).join('') || toolEmpty('gavel', 'No decisions recorded', 'Which framework, which database, what to cut: write it down with the reason.')}</div>`;
}

function riskSheet(risk) {
  const d = risk ? risk.data : { likelihood: 2, impact: 2, status: 'open' };
  openSheet({
    title: risk ? 'Edit risk' : 'Add a risk',
    fields: [
      { name: 'title', label: 'What could go wrong', required: true, maxlength: 160, value: risk ? risk.title : '' },
      { name: 'likelihood', label: 'Likelihood', type: 'select', half: true, options: [['1', 'Low'], ['2', 'Medium'], ['3', 'High']], value: String(d.likelihood || 2) },
      { name: 'impact', label: 'Impact', type: 'select', half: true, options: [['1', 'Low'], ['2', 'Medium'], ['3', 'High']], value: String(d.impact || 2) },
      { name: 'owner_id', label: 'Owner', type: 'select', half: true, options: memberOptions(null), value: d.owner_id ? String(d.owner_id) : '' },
      { name: 'status', label: 'Status', type: 'select', half: true, options: [['open', 'Open'], ['watching', 'Watching'], ['mitigated', 'Mitigated'], ['closed', 'Closed']], value: d.status || 'open' },
      { name: 'description', label: 'Details', type: 'textarea', maxlength: 2000, value: d.description || '' },
      { name: 'mitigation', label: 'What we will do about it', type: 'textarea', maxlength: 2000, value: d.mitigation || '' },
    ],
    onDelete: risk ? () => { deleteHubItem(risk, 'risk'); } : null,
    onSubmit: async (v) => {
      await saveHubItem({ id: risk && risk.id, kind: 'risk', title: v.title, base: risk && risk.updated_at,
        data: { likelihood: parseInt(v.likelihood, 10), impact: parseInt(v.impact, 10), owner_id: v.owner_id ? parseInt(v.owner_id, 10) : null,
                status: v.status, description: v.description, mitigation: v.mitigation } });
      renderRisks();
    },
  });
}

function decisionSheet(decision) {
  const d = decision ? decision.data : { date: todayIso(), status: 'decided', owner_id: currentUserId };
  openSheet({
    title: decision ? 'Edit decision' : 'Record a decision',
    fields: [
      { name: 'title', label: 'Title', required: true, maxlength: 160, value: decision ? decision.title : '', placeholder: 'Use PostgreSQL for the database' },
      { name: 'date', label: 'Date', type: 'date', half: true, value: d.date || '' },
      { name: 'status', label: 'Status', type: 'select', half: true, options: [['proposed', 'Proposed'], ['decided', 'Decided'], ['reversed', 'Reversed']], value: d.status || 'decided' },
      { name: 'owner_id', label: 'Decided by', type: 'select', options: memberOptions(null, '—'), value: d.owner_id ? String(d.owner_id) : '' },
      { name: 'context', label: 'Context', type: 'textarea', maxlength: 3000, value: d.context || '' },
      { name: 'decision', label: 'Decision', type: 'textarea', maxlength: 3000, value: d.decision || '' },
      { name: 'reasons', label: 'Why', type: 'textarea', maxlength: 3000, value: d.reasons || '' },
      { name: 'alternatives', label: 'Also considered', type: 'textarea', maxlength: 2000, value: d.alternatives || '' },
    ],
    onDelete: decision ? () => { deleteHubItem(decision, 'decision'); } : null,
    onSubmit: async (v) => {
      await saveHubItem({ id: decision && decision.id, kind: 'decision', title: v.title, base: decision && decision.updated_at,
        data: { ...v, title: undefined, owner_id: v.owner_id ? parseInt(v.owner_id, 10) : null } });
      renderRisks();
    },
  });
}

// ==========================================
// 3. ROLES AND WORKLOAD
// ==========================================
function renderRoles() {
  const view = el('view-roles');
  const roles = itemsOf('role');
  const active = hub.sprints.find(s => s.status === 'active');
  const weekAgo = addDays(todayIso(), -6);
  const people = hub.members.map(m => {
    const mine = hub.tasks.filter(t => t.assignee_id === m.user_id && t.column !== 'done');
    const sprintTasks_ = active ? mine.filter(t => t.sprint_id === active.id) : mine;
    return {
      m, open: mine.length, overdue: mine.filter(t => t.due_date && t.due_date < todayIso()).length,
      hours: sprintTasks_.reduce((sum, t) => sum + (t.estimate_hours || 0), 0),
      logged: (hub.time || []).filter(e => e.user_id === m.user_id && (e.day || '') >= weekAgo).reduce((sum, e) => sum + (e.minutes || 0), 0),
      done: hub.tasks.filter(t => t.assignee_id === m.user_id && t.column === 'done').length,
    };
  });
  const unassigned = hub.tasks.filter(t => !t.assignee_id && t.column !== 'done').length;
  const maxOpen = Math.max(1, ...people.map(p => p.open));
  const average = people.length ? people.reduce((sum, p) => sum + p.open, 0) / people.length : 0;

  view.innerHTML = `
    ${toolHead('Workload', `${active ? `Estimates are for the running sprint, ${active.name}. ` : ''}Hours logged count the last 7 days.`)}
    <div class="ht-card ht-workload">
      ${people.map(p => `<div class="ht-wl-row${p.open > Math.max(3, average * 1.5) ? ' is-heavy' : ''}">
        <span class="ht-person">${memberAvatarHtml(p.m, 'h-8 w-8', 'text-[11px]')}<span><strong>${escapeHtml(p.m.user_name)}</strong><small>${escapeHtml(p.m.role)}</small></span></span>
        <div class="ht-wl-bar"><i style="width:${Math.round(100 * p.open / maxOpen)}%"></i></div>
        <span class="ht-wl-num"><strong>${p.open}</strong> open</span>
        <span class="ht-wl-num${p.overdue ? ' is-late' : ''}"><strong>${p.overdue}</strong> late</span>
        <span class="ht-wl-num"><strong>${p.hours}</strong> h est.</span>
        <span class="ht-wl-num"><strong>${minutesLabel(p.logged)}</strong> logged</span>
        <span class="ht-wl-num"><strong>${p.done}</strong> done</span>
        ${p.open > Math.max(3, average * 1.5) ? `<span class="ht-chip is-late">${msIcon('priority_high')}Heavy</span>` : ''}
      </div>`).join('')}
      ${unassigned ? `<p class="ht-muted">${msIcon('person_off')}${unassigned} open task${unassigned === 1 ? ' has' : 's have'} nobody assigned. <button type="button" class="ht-link" data-roles="list">Assign them in the List</button></p>` : ''}
    </div>

    ${toolHead('Roles (RACI)', 'For each area or deliverable: who does it, who signs it off, who helps, who is kept informed.', `<button type="button" class="ht-btn" data-roles="add">${msIcon('add')}Add an area</button>`)}
    <div class="ht-card">
      <div class="ht-raci-legend"><span><b>R</b> Responsible: does the work</span><span><b>A</b> Accountable: owns the result (one person)</span><span><b>C</b> Consulted: asked before</span><span><b>I</b> Informed: told after</span></div>
      ${roles.length ? `<div class="ht-table-wrap"><table class="ht-table ht-raci"><thead><tr><th>Area</th>${hub.members.map(m => `<th>${memberAvatarHtml(m, 'h-6 w-6', 'text-[9px]')}<span>${escapeHtml(m.user_name.split(' ')[0])}</span></th>`).join('')}<th></th></tr></thead>
        <tbody>${roles.map(r => {
          const accountable = Object.values(r.data.raci || {}).filter(x => x === 'A').length;
          return `<tr><td><strong>${escapeHtml(r.title)}</strong>${accountable !== 1 ? `<small class="ht-warn">${accountable ? 'More than one A' : 'Nobody is accountable'}</small>` : ''}</td>
          ${hub.members.map(m => { const v = (r.data.raci || {})[String(m.user_id)] || ''; return `<td><select class="ht-raci-cell is-${v || 'none'}" data-raci="${r.id}" data-user="${m.user_id}" aria-label="${escapeHtml(m.user_name)} for ${escapeHtml(r.title)}">
            ${['', 'R', 'A', 'C', 'I'].map(x => `<option value="${x}" ${x === v ? 'selected' : ''}>${x || '–'}</option>`).join('')}</select></td>`; }).join('')}
          <td><button type="button" class="ht-icon-btn is-small" data-roles="delete" data-id="${r.id}" title="Remove">${msIcon('delete')}</button></td></tr>`; }).join('')}</tbody></table></div>`
        : toolEmpty('groups', 'No areas yet', 'Add areas like Backend, Design, Report, Presentation, then pick a letter for each person.')}
    </div>`;
}

function initBriefEvents() {
  el('view-brief').addEventListener('click', (e) => {
    const act = e.target.closest('[data-brief]');
    if (!act) return;
    if (act.dataset.brief === 'edit') { briefEditing = true; renderBrief(); }
    if (act.dataset.brief === 'cancel') { briefEditing = false; renderBrief(); }
    if (act.dataset.brief === 'save') saveBrief();
    if (act.dataset.brief === 'print') window.print();
    if (act.dataset.brief === 'template') openTemplatePicker();
  });
  el('view-risks').addEventListener('click', (e) => {
    const cell = e.target.closest('[data-riskcell]');
    if (cell) { riskFilter = cell.dataset.riskcell === riskFilter || !cell.dataset.riskcell ? null : cell.dataset.riskcell; return renderRisks(); }
    const risk = e.target.closest('[data-risk]');
    if (risk) return riskSheet(risk.dataset.risk === 'edit' ? hub.items.find(i => i.id === parseInt(risk.dataset.id, 10)) : null);
    const decision = e.target.closest('[data-decision]');
    if (decision) return decisionSheet(decision.dataset.decision === 'edit' ? hub.items.find(i => i.id === parseInt(decision.dataset.id, 10)) : null);
  });
  el('view-roles').addEventListener('click', (e) => {
    const act = e.target.closest('[data-roles]');
    if (!act) return;
    if (act.dataset.roles === 'list') return switchHubTab('list');
    if (act.dataset.roles === 'delete') return deleteHubItem(hub.items.find(i => i.id === parseInt(act.dataset.id, 10)), 'area');
    if (act.dataset.roles === 'add') openSheet({ title: 'Add an area', fields: [{ name: 'title', label: 'Area or deliverable', required: true, maxlength: 160, placeholder: 'Backend API' }],
      onSubmit: async (v) => { await saveHubItem({ kind: 'role', title: v.title, data: { raci: {} } }); renderRoles(); } });
  });
  el('view-roles').addEventListener('change', async (e) => {
    const cell = e.target.closest('[data-raci]');
    if (!cell) return;
    const role = hub.items.find(i => i.id === parseInt(cell.dataset.raci, 10));
    const raci = { ...(role.data.raci || {}) };
    if (cell.value) raci[cell.dataset.user] = cell.value; else delete raci[cell.dataset.user];
    try { await saveHubItem({ id: role.id, kind: 'role', title: role.title, data: { raci } }); } catch (err) { showToast(err.message); }
    renderRoles();
  });
}

registerHubTool('brief', { render: () => { if (!briefEditing) renderBrief(); else if (!el('briefForm')) renderBrief(); } });
registerHubTool('risks', { render: renderRisks });
registerHubTool('roles', { render: renderRoles });
document.addEventListener('DOMContentLoaded', initBriefEvents);
