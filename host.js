// ==========================================
// HOST.JS — host.html?id=ID: a department, club, college cell or company that puts on events, with its upcoming and past
// events, members and a Follow button (followers hear about new events). host.html?new=1 creates a host.
// ==========================================

const ho = { id: Number(evParam('id')), data: null, tab: 'upcoming' };

async function initHost() {
  if (evParam('new')) return renderNewHost();
  if (!ho.id) { el('hoRoot').innerHTML = evEmptyHtml('groups', 'No host chosen', 'Open a host from an event page.', '<a class="ev-btn" href="events.html">Events</a>'); return; }
  try { ho.data = await api(`/api/hosts/${ho.id}`); }
  catch (err) { el('hoRoot').innerHTML = evEmptyHtml('groups', 'Host not found', err.message, '<a class="ev-btn is-quiet" href="events.html">Events</a>'); return; }
  document.title = `${ho.data.host.name} | Connect2Minds`;
  render();
}

const HOST_KINDS = { department: 'Department', club: 'Club or society', college: 'College cell', company: 'Company' };

function render() {
  const { host, followers, following, members, upcoming, past, my_role: role } = ho.data;
  const list = ho.tab === 'upcoming' ? upcoming : (ho.tab === 'past' ? past : null);
  el('hoRoot').innerHTML = `
    ${host.status === 'pending' ? `<div class="ev-note" style="margin-bottom:14px">${evIcon('pending')}<span>A teacher of your college still has to approve this host. You can prepare events meanwhile.</span></div>` : ''}
    <section class="ev-host-hero"><div class="ev-host-banner">${host.banner_url ? `<img src="${escapeHtml(safeUrl(host.banner_url))}" alt="">` : ''}</div>
      <div class="ev-host-body"><div class="ev-host-logo-big">${host.logo_url ? `<img src="${escapeHtml(safeUrl(host.logo_url))}" alt="">` : escapeHtml(host.name.slice(0, 1))}</div>
        <div style="flex:1;min-width:200px;padding-top:12px"><h1 class="hm-title" style="margin:0">${escapeHtml(host.name)}${host.verified ? ` ${evIcon('verified', 'ev-verified')}` : ''}</h1>
          <p class="ev-small">${escapeHtml(HOST_KINDS[host.kind] || host.kind)}${host.college_name ? ` · ${escapeHtml(host.college_name)}` : ''} · ${followers} follower${followers === 1 ? '' : 's'}</p></div>
        <div class="ev-actions">${role === 'admin' ? `<a class="ev-btn" href="event-create.html">${evIcon('add_circle')}New event</a><button type="button" class="ev-btn is-quiet" id="hoEdit">${evIcon('edit')}Edit</button>` : ''}
          <button type="button" class="ev-btn ${following ? 'is-quiet' : 'is-line'}" id="hoFollow">${evIcon(following ? 'check' : 'add')}${following ? 'Following' : 'Follow'}</button></div></div></section>
    <div class="ev-tabs" role="tablist" style="margin-top:14px">${[['upcoming', `Upcoming (${upcoming.length})`], ['past', `Past (${past.length})`], ['about', 'About'], ['team', `Team (${members.length})`]].map(([k, l]) =>
      `<button type="button" role="tab" data-htab="${k}" aria-selected="${ho.tab === k}">${l}</button>`).join('')}</div>
    <div style="margin-top:16px">${list ? (list.length ? `<div class="ev-grid">${list.map(ev => evCardHtml(ev)).join('')}</div>` : evEmptyHtml('event', ho.tab === 'upcoming' ? 'No upcoming events' : 'No past events', following ? 'You will be told when they publish one.' : 'Follow to hear about new events.', ''))
      : ho.tab === 'about' ? `<section class="ev-card-pad"><div class="ev-md">${mdToHtml(host.description || '', { links: true }) || '<p class="ev-small">No description yet.</p>'}</div>
        ${host.links.length ? `<div class="ev-actions" style="margin-top:12px">${host.links.map(l => `<a class="ev-btn is-quiet is-small" href="${escapeHtml(safeUrl(l))}" target="_blank" rel="noopener">${evIcon('link')}${escapeHtml(l.replace(/^https?:\/\//, '').slice(0, 40))}</a>`).join('')}</div>` : ''}</section>`
      : `<section class="ev-card-pad"><div class="ev-people">${members.map(m => `<div class="ev-person">${evFaceHtml(m)}<div><b><a href="profile.html?id=${m.id}" style="color:inherit">${escapeHtml(m.name)}</a></b><span>${m.role === 'admin' ? 'Admin' : 'Member'}</span>
          ${role === 'admin' && members.length > 1 ? `<br><button type="button" class="ev-btn is-quiet is-small" data-hremove="${m.id}" style="margin-top:4px">Remove</button>` : ''}</div></div>`).join('')}</div>
        ${role === 'admin' ? `<form id="hoAdd" class="ev-row2" style="margin-top:16px" novalidate><label class="ev-field"><span class="ev-label">Add someone by their account email</span><input type="email" id="hoAddEmail" required></label>
          <label class="ev-field"><span class="ev-label">Role</span><select id="hoAddRole"><option value="member">Member: shown on this page</option><option value="admin">Admin: can post events as this host</option></select></label>
          <div style="grid-column:1/-1"><p class="ev-form-error" id="hoAddError" role="alert"></p><button class="ev-btn is-small" type="submit">${evIcon('person_add')}Add</button></div></form>` : ''}</section>`}</div>`;
  el('hoRoot').querySelectorAll('[data-htab]').forEach(b => b.addEventListener('click', () => { ho.tab = b.dataset.htab; render(); }));
  el('hoFollow').addEventListener('click', async () => {
    try { const r = await api(`/api/hosts/${ho.id}/follow`, { method: 'POST' }); ho.data.following = r.following; ho.data.followers += r.following ? 1 : -1; render(); evToast(r.following ? 'Following. You will hear about new events.' : 'Unfollowed.'); }
    catch (err) { evToast(err.message); }
  });
  const edit = el('hoEdit');
  if (edit) edit.addEventListener('click', () => hostForm(host));
  const add = el('hoAdd');
  if (add) add.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api(`/api/hosts/${ho.id}/members`, { method: 'POST', body: { email: el('hoAddEmail').value.trim(), role: el('hoAddRole').value } }); evToast('Added and told.'); ho.tab = 'team'; initHost(); }
    catch (err) { el('hoAddError').textContent = err.message; el('hoAddError').classList.add('is-shown'); }
  });
  el('hoRoot').querySelectorAll('[data-hremove]').forEach(b => b.addEventListener('click', async () => {
    try { await api(`/api/hosts/${ho.id}/members/${b.dataset.hremove}`, { method: 'DELETE' }); initHost(); } catch (err) { evToast(err.message); }
  }));
}

function renderNewHost() {
  el('hoRoot').innerHTML = `<section class="hm-hero"><div class="hm-hero-text"><p class="hm-date"><a href="events.html" style="color:inherit">Events</a></p><h1 class="hm-title">Create a host</h1>
    <p class="hm-sub">A host is the department, club or company that puts on events. Teachers' hosts are live at once; a student's request goes to a teacher of the college.</p></div></section><div id="hoForm"></div>`;
  hostForm(null, el('hoForm'));
}

function hostForm(host, target) {
  const body = `<form id="hfForm" class="ev-card-pad" style="display:flex;flex-direction:column;gap:12px" novalidate>
    ${host ? '' : `<label class="ev-field"><span class="ev-label">Kind</span><select id="hfKind">${Object.entries(HOST_KINDS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>`}
    <label class="ev-field"><span class="ev-label">Name <span class="ev-req">*</span></span><input id="hfName" maxlength="100" value="${escapeHtml(host ? host.name : '')}" placeholder="e.g. Coding Club, Department of CSE"></label>
    <label class="ev-field"><span class="ev-label">About</span><textarea id="hfDesc" maxlength="1500">${escapeHtml(host ? host.description : '')}</textarea><span class="ev-help">Markdown works: **bold**, - lists, [links](https://...).</span></label>
    <label class="ev-field"><span class="ev-label">Links (one per line, up to 5)</span><textarea id="hfLinks" style="min-height:70px" placeholder="https://instagram.com/...">${escapeHtml(host ? host.links.join('\n') : '')}</textarea></label>
    <div class="ev-row2"><div class="ev-field"><span class="ev-label">Logo</span><input type="file" id="hfLogo" accept="image/jpeg,image/png,image/webp"></div><div class="ev-field"><span class="ev-label">Banner</span><input type="file" id="hfBanner" accept="image/jpeg,image/png,image/webp"></div></div>
    <p class="ev-form-error" id="hfError" role="alert"></p><button class="ev-btn" type="submit" style="align-self:flex-start">${host ? 'Save' : 'Create host'}</button></form>`;
  let close = null;
  if (target) target.innerHTML = body;
  else close = evDialog('Edit host', body, '').close;
  const urls = { logo: host ? host.logo_url : '', banner: host ? host.banner_url : '' };
  [['hfLogo', 'logo', 512], ['hfBanner', 'banner', 1600]].forEach(([id, key, size]) => document.getElementById(id).addEventListener('change', async (e) => {
    if (!e.target.files[0]) return;
    try { urls[key] = await evUploadPicture(e.target.files[0], size); evToast('Picture uploaded.'); } catch (err) { evToast(err.message); }
  }));
  document.getElementById('hfForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = { kind: host ? host.kind : document.getElementById('hfKind').value, name: document.getElementById('hfName').value, description: document.getElementById('hfDesc').value,
      links: document.getElementById('hfLinks').value.split('\n').map(s => s.trim()).filter(Boolean), logo_url: urls.logo, banner_url: urls.banner };
    try {
      if (host) { await api(`/api/hosts/${host.id}`, { method: 'PATCH', body: payload }); if (close) close(); initHost(); evToast('Saved.'); }
      else { const made = await api('/api/hosts', { method: 'POST', body: payload }); location.href = `host.html?id=${made.id}`; }
    } catch (err) { const n = document.getElementById('hfError'); n.textContent = err.message; n.classList.add('is-shown'); }
  });
}

initHost();
