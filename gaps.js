// ==========================================
// GAPS.JS — Gap Finder (research.html): research gaps in a field, from open research data (OpenAlex, through gaps.py),
// joined with the people and teams on Connect2Minds. A gap opens in a side panel with its few papers, who could build it
// and teams already on it, and can become a Project Hub workspace in one click.
// Loaded after shared.js and chat-common.js (api, el, escapeHtml, showToast, copyText, timeAgo, cacheGet/cacheSet).
// ==========================================

const GF_EXAMPLES = ['agriculture', 'healthcare', 'education', 'climate change', 'mental health', 'waste management'];
const GF_CARDS_SHOWN = 12;

let gfScan = null;            // the scan on screen
let gfOpen = null;            // { key, detail } of the gap in the side panel
let gfSaved = [];             // saved reports and gaps: { id, topic, created_at }
let gfReadyFields = [];
let gfSeq = 0;                // a newer search makes older answers irrelevant
let gfShowAll = false;

function gfMySkills() {
  const me = window.currentUserProfile || cacheGet('me') || {};
  return String(me.skills || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
}

function gfHasSkill(skill, mine) {
  return mine.some(have => have.includes(skill) || skill.includes(have));
}

function gfSafeUrl(url) {
  return /^https?:\/\//i.test(String(url || '')) ? String(url) : '';
}

function gfSetUrl(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value) query.set(key, value); });
  const text = query.toString();
  try { history.replaceState(null, '', location.pathname + (text ? `?${text}` : '')); } catch (e) { /* not allowed here */ }
}

function gfIcon(name) { return `<span class="material-symbols-outlined">${name}</span>`; }

// ==========================================
// 1. START
// ==========================================
function initGaps() {
  el('gfForm').addEventListener('submit', (e) => {
    e.preventDefault();
    gfFind(el('gfField').value, el('gfLocal').checked);
  });
  el('gfReady').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-field]');
    if (!chip) return;
    el('gfField').value = chip.dataset.field;
    el('gfLocal').checked = chip.dataset.local === '1';
    gfFind(chip.dataset.field, chip.dataset.local === '1');
  });
  el('gfResults').addEventListener('click', gfOnResultsClick);
  el('gfPanel').addEventListener('click', gfOnPanelClick);
  el('gfBackdrop').addEventListener('click', gfClosePanel);
  el('gfSide').addEventListener('click', gfOnSideClick);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el('gfPanel').hidden) gfClosePanel(); });

  gfRenderWelcome();
  gfLoadReady();
  gfLoadWall();
  gfLoadSaved();

  const params = new URLSearchParams(location.search);
  const field = (params.get('field') || params.get('q') || '').trim();
  const reportId = parseInt(params.get('report'), 10);
  if (reportId) gfOpenSaved(reportId);
  else if (field) {
    el('gfField').value = field;
    el('gfLocal').checked = params.get('local') === '1';
    gfFind(field, params.get('local') === '1', params.get('gap'));
  }
}

async function gfLoadReady() {
  try {
    const data = await fetchPageData('/api/gaps/fields');
    gfReadyFields = data.fields || [];
    gfRenderReady(data.budget_low);
  } catch (err) {
    gfRenderReady(false);
  }
}

function gfRenderReady(budgetLow) {
  const ready = gfReadyFields.filter(f => f.gaps > 0).slice(0, 14);
  const readyKeys = new Set(ready.map(f => `${f.field}|${f.local ? 1 : 0}`));
  const examples = GF_EXAMPLES.filter(f => !readyKeys.has(`${f}|0`));
  const chip = (field, local, ready, gaps) => `<button type="button" class="gf-chip${ready ? ' is-ready' : ''}" data-field="${escapeHtml(field)}" data-local="${local ? 1 : 0}" title="${ready ? `${gaps} gaps, opens instantly` : 'Not scanned yet'}">${ready ? gfIcon('bolt') : ''}${escapeHtml(field)}${local ? ' · India' : ''}</button>`;
  el('gfReady').innerHTML = (ready.length ? `<span class="gf-ready-label">Ready now:</span>${ready.map(f => chip(f.field, f.local, true, f.gaps)).join('')}` : '')
    + (examples.length ? `<span class="gf-ready-label">${ready.length ? 'Or try' : 'Try'}:</span>${examples.slice(0, ready.length ? 3 : 6).map(f => chip(f, false, false)).join('')}` : '')
    + (budgetLow ? '<p class="gf-note">Busy day: fields nobody has scanned yet are queued and ready in a few hours. Ready fields open instantly.</p>' : '');
}

// ==========================================
// 2. A FIELD
// ==========================================
function gfRenderWelcome() {
  el('gfResults').innerHTML = `
    <div class="gf-card gf-welcome">
      <h2>How it works</h2>
      <ol class="gf-steps">
        <li>${gfIcon('manage_search')}<div><strong>Type a field</strong><span>Gap Finder looks at millions of papers on it from OpenAlex, an open research database.</span></div></li>
        <li>${gfIcon('grid_on')}<div><strong>See the gaps</strong><span>Each sub-topic is crossed with 16 methods, like drones, IoT or language models. Pairs that are busy on their own but almost never studied together are gaps.</span></div></li>
        <li>${gfIcon('group_add')}<div><strong>Build it with people here</strong><span>See who on Connect2Minds has the skills, check no team already took it, and start a project in one click.</span></div></li>
      </ol>
    </div>`;
}

function gfSkeleton(text) {
  el('gfResults').innerHTML = `<div class="gf-card"><p class="gf-loading">${gfIcon('travel_explore')}${escapeHtml(text)}</p>
    <div class="skeleton" style="height:22px;width:40%;margin:14px 0"></div><div class="skeleton" style="height:240px"></div></div>`;
}

async function gfFind(rawField, local, openKey) {
  const field = String(rawField || '').replace(/\s+/g, ' ').trim();
  if (field.length < 3) { el('gfField').focus(); return showToast('Type a field of at least 3 letters.'); }
  const seq = ++gfSeq;
  gfShowAll = false;
  gfSetUrl({ field, local: local ? '1' : '', gap: openKey || '' });
  const ready = gfReadyFields.some(f => f.field === field.toLowerCase() && !!f.local === !!local);
  gfSkeleton(ready ? 'Opening the gaps…' : `Reading the research on “${field}”. A new field takes up to half a minute…`);
  el('gfGo').disabled = true;
  try {
    const data = await api(`/api/gaps?field=${encodeURIComponent(field)}&local=${local ? 'true' : 'false'}`, { timeout: 120000 });
    if (seq !== gfSeq) return;
    gfScan = data;
    if (data.status === 'queued') return gfRenderQueued(data);
    if (data.too_small) return gfRenderTooSmall(data);
    gfRenderScan();
    if (!gfReadyFields.some(f => f.field === data.field && !!f.local === !!data.local)) { gfReadyFields.unshift({ field: data.field, local: !!data.local, gaps: data.gaps.length }); gfRenderReady(false); }
    if (openKey) gfOpenGap(openKey);
  } catch (err) {
    if (seq !== gfSeq) return;
    el('gfResults').innerHTML = `<div class="gf-card">${peopleStateBlock('cloud_off', 'Could not find gaps right now', err.message, '<button type="button" class="gf-btn" data-act="retry">Try again</button>')}</div>`;
  } finally {
    if (seq === gfSeq) el('gfGo').disabled = false;
  }
}

function gfRenderQueued(data) {
  el('gfResults').innerHTML = `<div class="gf-card gf-queued">
    ${gfIcon('hourglass_top')}
    <h2>“${escapeHtml(data.field)}” is in the queue</h2>
    <p>Gap Finder uses a free research database with a daily allowance, and today's is nearly used. Your field will be scanned in about ${data.ready_in_hours} hour${data.ready_in_hours === 1 ? '' : 's'}, and you will get a notification when its gaps are ready.</p>
    <p class="gf-muted">Meanwhile, fields marked ⚡ above open instantly.</p></div>`;
}

function gfRenderTooSmall(data) {
  el('gfResults').innerHTML = `<div class="gf-card">${peopleStateBlock('search_off', `Not enough research on “${data.field}”`,
    `Only ${Number(data.total || 0).toLocaleString()} papers mention it. Try a broader field (for example "healthcare" instead of a disease name), or switch off "Make it local".`, '')}</div>`;
}

function gfUntouchedColor(cell, isGap) {
  if (!isGap) return `rgba(79, 70, 229, ${(0.04 + cell.untouched * 0.12).toFixed(3)})`;
  const strength = Math.min(1, (cell.untouched - 0.75) / 0.25);
  return `rgba(53, 37, 205, ${(0.45 + strength * 0.55).toFixed(3)})`;
}

function gfRenderScan() {
  const scan = gfScan;
  const mine = gfMySkills();
  const gapKeys = new Map(scan.gaps.map((gap, index) => [`${gap.topic_id}|${gap.lens}`, index]));
  const scanned = scan.scanned_at ? timeAgo(scan.scanned_at) : '';
  const heat = `<div class="gf-heat-wrap" tabindex="0" aria-label="Map of sub-topics against methods"><table class="gf-heat">
    <thead><tr><th class="gf-corner">Sub-topic \\ method</th>${scan.lenses.map(l => `<th scope="col"><span>${escapeHtml(l.label)}</span></th>`).join('')}</tr></thead>
    <tbody>${scan.topics.map((topic, row) => `<tr><th scope="row" title="${Number(topic.count).toLocaleString()} papers">${escapeHtml(topic.name)}</th>${scan.lenses.map((lens, col) => {
      const cell = (scan.cells[row] || [])[col] || { untouched: 0, observed: 0, expected: 0 };
      const index = gapKeys.get(`${topic.id}|${lens.id}`);
      const isGap = index !== undefined;
      const label = `${topic.name} × ${lens.label}: ${cell.observed} papers, about ${Math.round(cell.expected)} expected`;
      return isGap
        ? `<td><button type="button" class="gf-cell is-gap" data-gap="${escapeHtml(scan.gaps[index].key)}" style="background:${gfUntouchedColor(cell, true)}" title="${escapeHtml(label)}" aria-label="Gap: ${escapeHtml(label)}">${index < 9 ? index + 1 : ''}</button></td>`
        : `<td><span class="gf-cell" style="background:${gfUntouchedColor(cell, false)}" title="${escapeHtml(label)}"></span></td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>`;

  const shown = gfShowAll ? scan.gaps : scan.gaps.slice(0, GF_CARDS_SHOWN);
  const cards = shown.map((gap, index) => {
    const have = gap.skills.filter(skill => gfHasSkill(skill, mine));
    return `<article class="gf-gap">
      <span class="gf-rank">${index + 1}</span>
      <div class="gf-gap-main">
        <h3><button type="button" data-gap="${escapeHtml(gap.key)}">${escapeHtml(gap.title)}</button></h3>
        <div class="gf-bar" title="${Math.round(gap.untouched * 100)}% untouched"><i style="width:${Math.round(gap.untouched * 100)}%"></i></div>
        <p>${escapeHtml(gap.why)}</p>
        <div class="gf-skills">${gap.skills.map(skill => `<span class="gf-skill${gfHasSkill(skill, mine) ? ' is-mine' : ''}">${gfHasSkill(skill, mine) ? gfIcon('check') : ''}${escapeHtml(skill)}</span>`).join('')}
          ${have.length ? `<span class="gf-fit">You have ${have.length} of ${gap.skills.length}</span>` : ''}</div>
      </div>
      <div class="gf-gap-actions">
        <button type="button" class="gf-btn is-small" data-gap="${escapeHtml(gap.key)}">Open</button>
        <button type="button" class="gf-btn is-small is-quiet" data-save="${escapeHtml(gap.key)}" title="Save this gap">${gfIcon('bookmark_add')}</button>
      </div></article>`;
  }).join('');

  el('gfResults').innerHTML = `
    <div class="gf-card">
      <div class="gf-head">
        <div><h2>${escapeHtml(scan.field)}${scan.local ? ' <span class="gf-tag">India</span>' : ''}</h2>
        <p class="gf-muted">${Number(scan.total).toLocaleString()} papers · ${scan.gaps.length} gaps found${scanned ? ` · data from ${escapeHtml(scanned)}` : ''}${scan.refreshing ? ' · an update is on its way' : ''}</p></div>
        <button type="button" class="gf-btn is-quiet is-small" data-act="share-field">${gfIcon('link')}Copy link</button>
      </div>
      ${scan.gaps.length ? '' : '<p class="gf-note">No strong gaps here: every method is already well studied in this field. Try a narrower field or "Make it local".</p>'}
      <h3 class="gf-sub">The map</h3>
      <p class="gf-muted">Every square is a sub-topic crossed with a method. Darker means fewer papers than you would expect. Numbered squares are the best gaps: click one.</p>
      ${heat}
    </div>
    ${scan.gaps.length ? `<div class="gf-card"><h3 class="gf-sub">Best gaps</h3><div class="gf-gaps">${cards}</div>
      ${scan.gaps.length > GF_CARDS_SHOWN && !gfShowAll ? `<button type="button" class="gf-btn is-quiet gf-more" data-act="all">Show all ${scan.gaps.length} gaps</button>` : ''}</div>` : ''}`;
}

function gfFindGap(key) {
  return gfScan && gfScan.gaps ? gfScan.gaps.find(g => g.key === key) : null;
}

function gfOnResultsClick(e) {
  const open = e.target.closest('[data-gap]');
  if (open) return gfOpenGap(open.dataset.gap);
  const save = e.target.closest('[data-save]');
  if (save) return gfSaveGap(save.dataset.save);
  const act = e.target.closest('[data-act]');
  if (!act) return;
  if (act.dataset.act === 'retry') gfFind(el('gfField').value, el('gfLocal').checked);
  if (act.dataset.act === 'all') { gfShowAll = true; gfRenderScan(); }
  if (act.dataset.act === 'share-field') copyText(location.href, 'Link copied. It opens these gaps for anyone on Connect2Minds.');
  if (act.dataset.act === 'delete-saved') gfDeleteSaved(parseInt(act.dataset.id, 10));
}

// ==========================================
// 3. ONE GAP
// ==========================================
async function gfOpenGap(key) {
  const gap = gfFindGap(key);
  if (!gap) return showToast('That gap is not in the latest scan of this field.');
  gfOpen = { key, detail: null };
  gfSetUrl({ field: gfScan.field, local: gfScan.local ? '1' : '', gap: key });
  const panel = el('gfPanel');
  panel.hidden = false;
  el('gfBackdrop').hidden = false;
  document.body.classList.add('gf-panel-open');
  gfRenderPanel(gap, null);
  panel.querySelector('[data-act="close"]').focus();
  try {
    const detail = await api(`/api/gaps/detail?key=${encodeURIComponent(key)}`, { timeout: 60000 });
    if (!gfOpen || gfOpen.key !== key) return;
    gfOpen.detail = detail;
    gfRenderPanel(gap, detail);
  } catch (err) {
    if (!gfOpen || gfOpen.key !== key) return;
    gfRenderPanel(gap, { error: err.message });
  }
}

function gfClosePanel() {
  el('gfPanel').hidden = true;
  el('gfBackdrop').hidden = true;
  document.body.classList.remove('gf-panel-open');
  gfOpen = null;
  if (gfScan) gfSetUrl({ field: gfScan.field, local: gfScan.local ? '1' : '' });
}

function gfSparkline(years) {
  if (!years || years.length < 2) return '';
  const width = 300;
  const height = 64;
  const max = Math.max(...years.map(y => y.count), 1);
  const step = width / (years.length - 1);
  const points = years.map((y, i) => `${(i * step).toFixed(1)},${(height - 6 - (y.count / max) * (height - 14)).toFixed(1)}`).join(' ');
  const first = years[0];
  const last = years[years.length - 1];
  return `<figure class="gf-spark"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Papers per year from ${first.year} to ${last.year}">
    <polyline points="0,${height} ${points} ${width},${height}" fill="rgba(79,70,229,0.12)" stroke="none"/><polyline points="${points}" fill="none" stroke="#4f46e5" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
    <figcaption><span>${first.year}</span><span>${last.year}</span></figcaption></figure>`;
}

function gfPersonHtml(person) {
  return `<div class="gf-person">
    <a class="gf-face" href="profile.html?id=${person.id}">${avatarHtml(person.profile_pic, person.name, '')}</a>
    <div class="gf-person-main"><a href="profile.html?id=${person.id}"><strong>${escapeHtml(person.name)}</strong></a>
      <span>${escapeHtml(person.college_name || '')}${person.same_college ? ' · your college' : ''}</span>
      <span class="gf-person-skills">${person.matching_skills.map(skill => `<em>${escapeHtml(skill)}</em>`).join('')}</span></div>
    <a class="gf-btn is-small is-quiet" href="inbox.html?user=${person.id}" title="Message ${escapeHtml(person.name)}">${gfIcon('chat')}</a></div>`;
}

function gfRenderPanel(gap, detail) {
  const mine = gfMySkills();
  const loading = '<div class="skeleton" style="height:16px;margin:8px 0"></div><div class="skeleton" style="height:16px;width:70%"></div>';
  let papers = loading;
  let people = loading;
  let teams = loading;
  let trend = '';
  if (detail && detail.error) {
    papers = people = teams = `<p class="gf-muted">${escapeHtml(detail.error)}</p>`;
  } else if (detail) {
    papers = detail.papers.length
      ? `<ol class="gf-papers">${detail.papers.map(p => {
        const url = gfSafeUrl(p.url);
        const title = escapeHtml(p.title);
        return `<li>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${title}</a>` : title}<span>${[p.venue, p.year, p.cited ? `${p.cited} citations` : ''].filter(Boolean).map(escapeHtml).join(' · ')}</span></li>`;
      }).join('')}</ol>`
      : (detail.papers_later ? '<p class="gf-muted">The paper list will be ready later today (the free research database allowance is used up for now).</p>' : '<p class="gf-muted">No paper combines the two yet. You would be the first.</p>');
    trend = gfSparkline(detail.years);
    people = detail.people.length ? detail.people.map(gfPersonHtml).join('')
      : '<p class="gf-muted">Nobody on Connect2Minds lists these skills yet. Invite classmates who have them, or learn one together.</p>';
    teams = detail.claims.length
      ? detail.claims.map(c => `<div class="gf-claim"><div><strong>${escapeHtml(c.team_name)}</strong><span>${escapeHtml(c.college || '')} · ${c.members} member${c.members === 1 ? '' : 's'} · started ${escapeHtml(timeAgo(c.created_at))}</span></div>${c.lead_id === currentUserId ? '' : `<a class="gf-btn is-small is-quiet" href="inbox.html?user=${c.lead_id}">Message lead</a>`}</div>`).join('')
      : '<p class="gf-muted">No team has started this gap yet.</p>';
  }
  const have = gap.skills.filter(skill => gfHasSkill(skill, mine));
  el('gfPanel').innerHTML = `
    <div class="gf-panel-head">
      <span class="gf-tag">${escapeHtml(gfScan.field)}${gfScan.local ? ' · India' : ''}</span>
      <button type="button" class="gf-icon-btn" data-act="close" aria-label="Close">${gfIcon('close')}</button>
    </div>
    <div class="gf-panel-body">
      <h2 id="gfPanelTitle">${escapeHtml(gap.title)}</h2>
      <p>${escapeHtml(gap.why)}</p>
      <div class="gf-stats">
        <div><strong>${gap.estimated ? 'Very few' : Number(gap.observed).toLocaleString()}</strong><span>papers so far</span></div>
        <div><strong>${Number(gap.expected).toLocaleString()}</strong><span>expected if it were normal</span></div>
        <div><strong>${Math.round(gap.untouched * 100)}%</strong><span>untouched</span></div>
      </div>
      ${trend ? `<h3>Interest in ${escapeHtml(gap.lens_label.toLowerCase())} in this field</h3>${trend}` : ''}
      <h3>Your fit</h3>
      <div class="gf-skills">${gap.skills.map(skill => `<span class="gf-skill${gfHasSkill(skill, mine) ? ' is-mine' : ''}">${gfHasSkill(skill, mine) ? gfIcon('check') : ''}${escapeHtml(skill)}</span>`).join('')}</div>
      <p class="gf-muted">${have.length ? `You have ${have.length} of the ${gap.skills.length} skills this needs.` : 'Add your skills on your profile to see your fit.'}</p>
      <h3>People here who could build it</h3>${people}
      <h3>Teams already on it</h3>${teams}
      <h3>The papers that exist</h3>${papers}
    </div>
    <div class="gf-panel-foot">
      <button type="button" class="gf-btn" data-act="start">${gfIcon('rocket_launch')}Start this project</button>
      <button type="button" class="gf-btn is-quiet" data-act="save">${gfIcon('bookmark_add')}Save</button>
      <button type="button" class="gf-btn is-quiet" data-act="share" title="Share to a team">${gfIcon('send')}Share</button>
      <button type="button" class="gf-btn is-quiet" data-act="copy" aria-label="Copy link">${gfIcon('link')}</button>
    </div>`;
}

function gfOnPanelClick(e) {
  const act = e.target.closest('[data-act]');
  if (!act || !gfOpen) return;
  const gap = gfFindGap(gfOpen.key);
  if (act.dataset.act === 'close') return gfClosePanel();
  if (act.dataset.act === 'start') return gfStartProject(gap);
  if (act.dataset.act === 'save') return gfSaveGap(gap.key);
  if (act.dataset.act === 'share') return gfShareGap(gap);
  if (act.dataset.act === 'copy') return copyText(location.href, 'Link to this gap copied.');
}

function gfStartProject(gap) {
  const form = `<span class="block text-left">
      <label class="block text-sm font-medium text-on-surface-variant mb-1" for="gfTeamName">Name of the new workspace</label>
      <input id="gfTeamName" maxlength="80" value="${escapeHtml(gap.title.slice(0, 80))}" class="w-full bg-surface-container-low border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary">
      <span class="block text-xs text-on-surface-variant mt-2">It comes with a research plan (sprints, tasks, milestones), a brief that states the gap and a reading list of its papers. It appears on the gap wall so others can find your team.</span>
    </span>`;
  window.showSystemModal('Start this project', form, 'confirm', async () => {
    const name = (el('gfTeamName') ? el('gfTeamName').value : '').trim();
    try {
      showToast('Setting up your workspace…');
      const result = await api('/api/gaps/start', { method: 'POST', body: { key: gap.key, name }, timeout: 60000 });
      location.href = `project_management.html?team=${result.team_id}&tab=brief`;
    } catch (err) {
      showToast(err.message);
    }
  }, 'Start');
}

function gfShareText(gap) {
  return `Research gap from Gap Finder: ${gap.title}\n${gap.why}\nOpen it: ${location.origin}${location.pathname}?field=${encodeURIComponent(gfScan.field)}${gfScan.local ? '&local=1' : ''}&gap=${encodeURIComponent(gap.key)}`;
}

async function gfShareGap(gap) {
  let teams;
  try { teams = await api('/api/teams'); } catch (err) { return showToast(err.message); }
  if (!teams.length) return window.showSystemModal('Share to team', 'You are not in a team yet. Create or join one on the My Teams page first.', 'alert');
  const form = `<span class="block text-left"><label class="block text-sm font-medium text-on-surface-variant mb-1" for="gfShareTeam">Post this gap to</label>
    <select id="gfShareTeam" class="w-full bg-surface-container-low border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface">${teams.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}</select>
    <span class="block text-xs text-on-surface-variant mt-2">It goes to the team's first text channel, as a message from you.</span></span>`;
  window.showSystemModal('Share to team', form, 'confirm', async () => {
    try {
      const channels = await api(`/api/teams/${el('gfShareTeam').value}/channels`);
      const channel = channels.find(c => c.channel_type === 'text') || channels[0];
      if (!channel) throw new Error('That team has no channel to post in.');
      await api(`/api/channels/${channel.id}/messages`, { method: 'POST', body: { content: gfShareText(gap).slice(0, 4500) } });
      showToast(`Shared in #${channel.name}.`);
    } catch (err) {
      showToast(err.message);
    }
  }, 'Share');
}

// ==========================================
// 4. SAVED GAPS (and briefings saved on the old Research page)
// ==========================================
async function gfLoadSaved() {
  try {
    const data = await api('/api/research');
    gfSaved = data.reports || [];
  } catch (err) {
    gfSaved = [];
  }
  gfRenderSaved();
}

function gfRenderSaved() {
  el('gfSavedCount').textContent = gfSaved.length ? `(${gfSaved.length})` : '';
  el('gfSaved').innerHTML = gfSaved.length
    ? gfSaved.map(item => `<div class="gf-saved"><button type="button" data-open-saved="${item.id}"><strong>${escapeHtml(item.topic)}</strong><span>${escapeHtml(timeAgo(item.created_at))}</span></button>
        <button type="button" class="gf-icon-btn" data-delete-saved="${item.id}" aria-label="Delete ${escapeHtml(item.topic)}">${gfIcon('delete')}</button></div>`).join('')
    : '<p class="gf-muted">Gaps you save are kept here, visible only to you.</p>';
}

async function gfSaveGap(key) {
  const gap = gfFindGap(key);
  if (!gap) return;
  try {
    const saved = await api('/api/research', { method: 'POST', body: { topic: gap.title, content: { kind: 'gap', field: gfScan.field, local: !!gfScan.local, gap } } });
    gfSaved.unshift({ id: saved.id, topic: saved.topic, created_at: saved.created_at });
    gfRenderSaved();
    showToast('Gap saved. Find it under Saved.');
  } catch (err) {
    showToast(err.message);
  }
}

async function gfOpenSaved(id) {
  try {
    const item = await api(`/api/research/${id}`);
    const content = item.content || {};
    if (content.kind === 'gap') {
      el('gfField').value = content.field;
      el('gfLocal').checked = !!content.local;
      return gfFind(content.field, content.local, content.gap && content.gap.key);
    }
    gfRenderBriefing(item);
  } catch (err) {
    showToast(err.message);
  }
}

// A briefing saved on the old Research page: shown as it was, read only
function gfRenderBriefing(item) {
  ++gfSeq;
  gfSetUrl({ report: item.id });
  const report = item.content || {};
  const wiki = report.wikipedia;
  const papers = report.papers || [];
  const link = (url, text) => (gfSafeUrl(url) ? `<a href="${escapeHtml(gfSafeUrl(url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>` : escapeHtml(text));
  el('gfResults').innerHTML = `<div class="gf-card gf-briefing">
    <p class="gf-muted">Saved briefing · ${escapeHtml(timeAgo(item.created_at))}</p>
    <h2>${escapeHtml(wiki ? wiki.title : item.topic)}</h2>
    ${wiki ? `<p>${escapeHtml(wiki.summary || '')}</p>${(wiki.sections || []).map(s => `<h3>${escapeHtml(s.heading)}</h3><p>${escapeHtml(s.text)}</p>`).join('')}<p>${link(wiki.url, 'Read on Wikipedia')}</p>` : ''}
    ${papers.length ? `<h3>Reading list</h3><ol class="gf-papers">${papers.map(p => `<li>${link(p.url, p.title)}<span>${[p.authors, p.venue, p.year].filter(Boolean).map(escapeHtml).join(' · ')}</span></li>`).join('')}</ol>` : ''}
    <div class="gf-row"><button type="button" class="gf-btn is-quiet is-small" data-act="delete-saved" data-id="${item.id}">${gfIcon('delete')}Delete</button>
    <button type="button" class="gf-btn is-small" data-field="${escapeHtml(item.topic)}" data-act="find-topic">Find gaps on this</button></div></div>`;
  el('gfResults').querySelector('[data-act="find-topic"]').addEventListener('click', () => { el('gfField').value = item.topic; gfFind(item.topic, false); });
}

function gfDeleteSaved(id) {
  const item = gfSaved.find(s => s.id === id);
  if (!item) return;
  window.showSystemModal('Delete', `Delete your saved "${escapeHtml(item.topic)}"? This cannot be undone.`, 'confirm', async () => {
    try {
      await api(`/api/research/${id}`, { method: 'DELETE' });
      gfSaved = gfSaved.filter(s => s.id !== id);
      gfRenderSaved();
      if (new URLSearchParams(location.search).get('report') === String(id)) { gfSetUrl({}); gfRenderWelcome(); }
      showToast('Deleted.');
    } catch (err) {
      showToast(err.message);
    }
  }, 'Delete');
}

// ==========================================
// 5. THE GAP WALL
// ==========================================
async function gfLoadWall() {
  el('gfWall').innerHTML = '<div class="skeleton" style="height:56px;margin-bottom:8px"></div>'.repeat(3);
  try {
    const data = await api('/api/gaps/wall');
    el('gfWall').innerHTML = (data.claims || []).length
      ? `<p class="gf-muted">Teams working on gaps right now. Ask to join instead of starting the same thing twice.</p>` + data.claims.map(c => `
        <div class="gf-wall-item">
          <button type="button" class="gf-wall-open" data-wall-field="${escapeHtml(c.field)}" data-wall-key="${escapeHtml(c.gap_key)}"><strong>${escapeHtml(c.title)}</strong></button>
          <span>${escapeHtml(c.team_name)} · ${escapeHtml(c.college || 'Connect2Minds')} · ${c.members} member${c.members === 1 ? '' : 's'}</span>
          <span class="gf-wall-foot"><em>${escapeHtml(c.field)}</em>${c.lead_id === currentUserId ? '<em>your team</em>' : `<a href="inbox.html?user=${c.lead_id}">Message ${escapeHtml(c.lead_name.split(' ')[0])}</a>`}</span>
        </div>`).join('')
      : '<p class="gf-muted">No team has claimed a gap yet. Start a project on one and your team shows up here for others to find.</p>';
  } catch (err) {
    el('gfWall').innerHTML = `<p class="gf-muted">${escapeHtml(err.message)}</p>`;
  }
}

function gfOnSideClick(e) {
  const tab = e.target.closest('[data-side]');
  if (tab) {
    document.querySelectorAll('.gf-tab').forEach(t => { const on = t === tab; t.classList.toggle('is-on', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); });
    el('gfWall').hidden = tab.dataset.side !== 'wall';
    el('gfSaved').hidden = tab.dataset.side !== 'saved';
    return;
  }
  const wall = e.target.closest('[data-wall-key]');
  if (wall) {
    const local = wall.dataset.wallKey.split('|')[1] === '1';
    el('gfField').value = wall.dataset.wallField;
    el('gfLocal').checked = local;
    return gfFind(wall.dataset.wallField, local, wall.dataset.wallKey);
  }
  const open = e.target.closest('[data-open-saved]');
  if (open) return gfOpenSaved(parseInt(open.dataset.openSaved, 10));
  const remove = e.target.closest('[data-delete-saved]');
  if (remove) return gfDeleteSaved(parseInt(remove.dataset.deleteSaved, 10));
}

initGaps();
