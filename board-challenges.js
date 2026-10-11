// ==========================================
// BOARD-CHALLENGES.JS — Sponsored bounties and hackathons on the Opportunities board (board.html).
// A sponsored post is shown first with the sponsor, the prize and a deadline; people register (the usual Apply),
// hand in an entry, and the sponsor scores entries and announces winners.
// Loaded before board.js, which calls these functions while drawing posts.
// ==========================================

let viewerIsFounder = false;
let sponsorCredits = 0;

const isChallenge = (post) => Boolean(post.was_sponsored) && (post.kind === 'bounty' || post.kind === 'hackathon');
const challengeClosed = (post) => Boolean(post.deadline) && post.deadline < new Date().toLocaleDateString('en-CA');
const canJudge = (post) => post.author_id === currentUserId || viewerIsFounder;
const bcIcon = (name, size) => `<span class="material-symbols-outlined" style="font-size:${size || 15}px">${name}</span>`;

function daysLeft(post) {
  if (!post.deadline) return '';
  const days = Math.round((new Date(`${post.deadline}T23:59:59`) - Date.now()) / 86400000);
  if (days < 0) return 'Closed';
  if (days === 0) return 'Ends today';
  return `${days} day${days === 1 ? '' : 's'} left`;
}

function challengeBadgesHtml(post) {
  if (!isChallenge(post)) return '';
  return `${post.is_sponsored ? `<span class="bc-pill sponsored">${bcIcon('workspace_premium', 13)}Sponsored</span>` : ''}
    <span class="bc-pill">${bcIcon(post.kind === 'hackathon' ? 'emoji_events' : 'paid', 13)}${post.kind === 'hackathon' ? 'Hackathon' : 'Bounty'}</span>
    ${post.winners_announced ? `<span class="bc-pill done">${bcIcon('military_tech', 13)}Winners announced</span>` : ''}`;
}

function challengeStripHtml(post) {
  if (!isChallenge(post)) return '';
  return `<div class="bc-strip">
    <span class="bc-sponsor">${post.sponsor_logo ? `<img src="${escapeHtml(safeUrl(post.sponsor_logo))}" alt="">` : bcIcon('business', 16)}by ${post.sponsor_url ? `<a href="${escapeHtml(safeUrl(post.sponsor_url))}" target="_blank" rel="noopener">${escapeHtml(post.sponsor_name)}</a>` : escapeHtml(post.sponsor_name)}</span>
    ${post.prize ? `<span class="bc-prize">${bcIcon('emoji_events', 16)}${escapeHtml(post.prize)}</span>` : ''}
    ${post.deadline ? `<span class="bc-deadline${challengeClosed(post) ? ' closed' : ''}">${bcIcon('schedule', 16)}${escapeHtml(daysLeft(post))}</span>` : ''}
  </div>`;
}

// The buttons at the foot of a challenge card; null means "draw the usual ones"
function challengeActionsHtml(post) {
  if (!isChallenge(post)) return null;
  const button = (action, icon, label, primary) => `<button type="button" data-action="${action}" class="bc-btn${primary ? ' primary' : ''}">${bcIcon(icon, 16)}${label}</button>`;
  if (canJudge(post)) {
    return `${button('entries', 'gavel', `Entries (${post.applicant_count})`, true)}
      ${post.author_id === currentUserId ? '<button type="button" data-action="edit" title="Edit" class="bc-icon">' + bcIcon('edit', 18) + '</button>' : ''}
      <button type="button" data-action="delete" title="Delete" class="bc-icon">${bcIcon('delete', 18)}</button>`;
  }
  if (post.winners_announced) return button('entries', 'military_tech', 'See winners', true);
  if (challengeClosed(post)) return `<span class="bc-closed">Entries closed</span>${post.has_applied ? button('entries', 'description', 'My entry') : ''}`;
  return `${post.has_applied ? button('entries', 'description', 'My entry') : ''}${button('submit-entry', 'upload', post.has_applied ? 'Hand in / update' : 'Register & enter', true)}`;
}

function challengeDetailsHtml(post) {
  if (!isChallenge(post)) return '';
  return `<div class="bc-details">
    ${challengeStripHtml(post)}
    <ul>
      <li>${bcIcon('event', 16)}Deadline: <b>${escapeHtml(post.deadline ? new Date(`${post.deadline}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) : 'none')}</b></li>
      <li>${bcIcon('group', 16)}${post.max_team_size > 1 ? `Solo or teams of up to ${post.max_team_size} (enter for one of your teams)` : 'Solo entries'}</li>
      <li>${bcIcon('how_to_reg', 16)}Entering also registers you. The sponsor scores the entries and announces the winners here.</li>
    </ul>
  </div>`;
}

// ---------- the pop-up these forms share ----------
function bcModal(title, body, confirmText, onConfirm, wide) {
  let modal = document.getElementById('challengeModal');
  if (!modal) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="challengeModal"><div class="custom-modal bc-modal" role="dialog" aria-modal="true" aria-labelledby="bcTitle">
      <h3 id="bcTitle"></h3><div id="bcBody" class="bc-form"></div><p id="bcError" class="bc-error" role="alert" hidden></p>
      <div class="modal-buttons" style="margin-top:18px"><button class="btn-outline-modal" type="button" id="bcCancel">Close</button><button class="btn-primary-modal" type="button" id="bcConfirm">Save</button></div></div></div>`);
    modal = document.getElementById('challengeModal');
    el('bcCancel').addEventListener('click', () => modal.classList.remove('active'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
    el('bcConfirm').addEventListener('click', async () => {
      if (!modal.onConfirm) return modal.classList.remove('active');
      el('bcConfirm').disabled = true;
      el('bcError').hidden = true;
      try { await modal.onConfirm(); modal.classList.remove('active'); } catch (err) { el('bcError').textContent = err.message; el('bcError').hidden = false; }
      el('bcConfirm').disabled = false;
    });
  }
  modal.querySelector('.bc-modal').classList.toggle('wide', Boolean(wide));
  el('bcTitle').textContent = title;
  el('bcBody').innerHTML = body;
  el('bcBody').onclick = null;
  el('bcError').hidden = true;
  el('bcConfirm').textContent = confirmText || 'Save';
  el('bcConfirm').hidden = !onConfirm;
  modal.onConfirm = onConfirm;
  modal.classList.add('active');
  return modal;
}

function openChallengeForm() {
  const today = new Date();
  const inMonth = new Date(today.getTime() + 30 * 86400000).toLocaleDateString('en-CA');
  bcModal('Post a sponsored challenge', `
    ${viewerIsFounder ? '<p class="bc-note">As the founder you can post any package without using credits.</p>' : `<p class="bc-note">This uses one challenge from your sponsorship package (${sponsorCredits} left).</p>`}
    <div class="bc-row"><label>Type<select id="bcKind"><option value="bounty">Bounty</option><option value="hackathon">Hackathon</option></select></label>
      <label>Package<select id="bcTier"><option value="basic">Bounty Basic (30 days)</option><option value="featured">Featured (60 days, pushed to matching students)</option><option value="hackathon">Hackathon package</option></select></label></div>
    <label>Title<input id="bcTitleInput" maxlength="120" placeholder="For example: Build an offline-first attendance app"></label>
    <label>What to build, rules and how it is judged<textarea id="bcDesc" maxlength="2000" rows="5"></textarea></label>
    <label>Skills (comma separated)<input id="bcSkills" maxlength="300" placeholder="Flutter, Firebase"></label>
    <div class="bc-row"><label>Sponsor name<input id="bcSponsor" maxlength="120"></label><label>Prize<input id="bcPrize" maxlength="120" placeholder="₹50,000 + internship interviews"></label></div>
    <div class="bc-row"><label>Sponsor website <small>(optional)</small><input id="bcUrl" maxlength="300" placeholder="https://"></label><label>Logo address <small>(optional)</small><input id="bcLogo" maxlength="300" placeholder="https://…/logo.png"></label></div>
    <div class="bc-row"><label>Deadline<input id="bcDeadline" type="date" value="${inMonth}"></label><label>Largest team<input id="bcTeam" type="number" min="1" max="10" value="1"></label></div>`,
  'Publish', async () => {
    const result = await api('/api/board/challenges', { method: 'POST', body: {
      kind: el('bcKind').value, tier: el('bcTier').value, title: el('bcTitleInput').value, description: el('bcDesc').value, skills_required: el('bcSkills').value,
      sponsor_name: el('bcSponsor').value, prize: el('bcPrize').value, sponsor_url: el('bcUrl').value, sponsor_logo: el('bcLogo').value,
      deadline: el('bcDeadline').value, max_team_size: Number(el('bcTeam').value) || 1
    } });
    upsertPost(result.post);
    if (!viewerIsFounder) sponsorCredits = Math.max(0, sponsorCredits - 1);
    renderSponsorButton();
    queueBoardRender();
    showToast('Challenge published. It is shown first on the board.');
  });
}

async function openSubmitEntry(post) {
  let teams = [];
  if (post.max_team_size > 1) {
    try { teams = await api('/api/teams'); } catch (err) { teams = []; }
  }
  bcModal(`Enter: ${post.title}`, `
    <p class="bc-note">Entering registers you for the challenge. You can update your entry until ${escapeHtml(post.deadline || 'the deadline')}.</p>
    <label>Link to your work<input id="bcLink" maxlength="1000" placeholder="https://github.com/you/project"></label>
    <label>Short note for the judges <small>(optional)</small><textarea id="bcEntryNote" maxlength="1000" rows="3"></textarea></label>
    ${teams.length ? `<label>Entering as<select id="bcTeamPick"><option value="">Just me</option>${teams.map(t => `<option value="${t.id}">Team: ${escapeHtml(t.name)}</option>`).join('')}</select></label>` : ''}`,
  'Hand in', async () => {
    await api(`/api/board/posts/${post.id}/submission`, { method: 'POST', body: {
      link: el('bcLink').value.trim(), note: el('bcEntryNote').value, team_id: el('bcTeamPick') && el('bcTeamPick').value ? Number(el('bcTeamPick').value) : null
    } });
    post.has_applied = true;
    queueBoardRender();
    showToast('Entry handed in. Good luck!');
  });
}

async function openEntries(post) {
  let data;
  try { data = await api(`/api/board/posts/${post.id}/submissions`); } catch (err) { return showToast(err.message); }
  const judge = data.judge;
  const rows = data.submissions.map(s => `<div class="bc-entry" data-entry="${s.id}">
    <div class="bc-entry-top">${s.rank ? `<span class="bc-rank">#${s.rank}</span>` : ''}<b>${escapeHtml(s.name || 'Entrant')}</b>${s.team ? `<span class="bc-pill">${escapeHtml(s.team)}</span>` : ''}<small>${escapeHtml(s.college || '')}</small></div>
    ${s.link ? `<a href="${escapeHtml(safeUrl(s.link))}" target="_blank" rel="noopener" class="bc-link">${escapeHtml(s.link)}</a>` : ''}
    ${s.note ? `<p>${escapeHtml(s.note)}</p>` : ''}
    ${judge ? `<div class="bc-row three"><label>Score /100<input type="number" min="0" max="100" data-score value="${s.score ?? ''}"></label><label>Place<input type="number" min="1" max="10" data-rank value="${s.rank ?? ''}"></label>
      <button type="button" class="bc-btn" data-judge="${s.id}">${bcIcon('save', 16)}Save</button></div><label>Remarks<input data-remarks maxlength="1000" value="${escapeHtml(s.remarks || '')}"></label>`
      : (s.remarks ? `<p class="bc-note">Judge: ${escapeHtml(s.remarks)}${s.score !== null && s.score !== undefined ? ` · ${s.score}/100` : ''}</p>` : '')}
  </div>`).join('');
  const modal = bcModal(judge ? `Entries: ${post.title}` : (data.winners_announced ? `Winners: ${post.title}` : 'Your entry'),
    `${judge && !data.winners_announced ? '<p class="bc-note">Give a place (1, 2, 3…) to the winners, then announce them. Everyone who entered is told.</p>' : ''}
     ${rows || '<p class="bc-note">No entries yet.</p>'}`,
    judge && !data.winners_announced && data.submissions.length ? 'Announce winners' : null,
    judge && !data.winners_announced ? async () => {
      const result = await api(`/api/board/posts/${post.id}/winners`, { method: 'POST' });
      post.winners_announced = true;
      queueBoardRender();
      showToast(`${result.winners} winner(s) announced.`);
    } : null, true);
  el('bcBody').onclick = async (e) => {
    const save = e.target.closest('[data-judge]');
    if (!save) return;
    const box = save.closest('[data-entry]');
    const num = (sel) => (box.querySelector(sel).value === '' ? null : Number(box.querySelector(sel).value));
    save.disabled = true;
    try {
      await api(`/api/board/submissions/${save.dataset.judge}/judge`, { method: 'PUT', body: { score: num('[data-score]'), rank: num('[data-rank]'), remarks: box.querySelector('[data-remarks]').value } });
      showToast('Saved.');
    } catch (err) { showToast(err.message); }
    save.disabled = false;
  };
  return modal;
}

function renderSponsorButton() {
  let holder = document.getElementById('sponsorButton');
  const show = viewerIsFounder || sponsorCredits > 0;
  if (!holder) {
    const anchor = document.getElementById('activeCallsCount');
    if (!anchor) return;
    anchor.insertAdjacentHTML('afterend', `<button type="button" id="sponsorButton" class="bc-btn primary" style="margin-left:8px">${bcIcon('workspace_premium', 16)}Post a sponsored challenge</button>
      <a href="pricing.html?tab=sponsor" id="sponsorLink" class="bc-link-small">Sponsor a challenge</a>`);
    holder = document.getElementById('sponsorButton');
    holder.addEventListener('click', openChallengeForm);
  }
  holder.hidden = !show;
  document.getElementById('sponsorLink').hidden = show;
}

// After board.js loads /api/board: who may post sponsored challenges, and links like board.html?post=12 and ?sponsor=1
function applyChallengeViewer(data) {
  viewerIsFounder = Boolean(data && data.viewer_is_founder);
  sponsorCredits = (data && data.sponsor_credits) || 0;
  renderSponsorButton();
  const params = new URLSearchParams(location.search);
  if (params.get('sponsor') === '1' && (viewerIsFounder || sponsorCredits > 0) && !applyChallengeViewer.opened) {
    applyChallengeViewer.opened = true;
    openChallengeForm();
  }
  const postId = Number(params.get('post'));
  if (postId && postsById.has(postId) && !applyChallengeViewer.shown) {
    applyChallengeViewer.shown = true;
    openPostDetails(postId);
  }
}
