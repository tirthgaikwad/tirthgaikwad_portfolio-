// ==========================================
// ADMIN.JS — The admin dashboard: platform numbers, account reviews, admin applications, announcements
// Loaded after shared.js and chat-common.js (ApiError, caches, toast, el, peopleStateBlock, peoplePaginationHtml).
// ==========================================

const STATUS_ORDER = ['verified', 'active', 'pending', 'appealed', 'rejected'];
const ANNOUNCEMENT_LIMIT = 300;

let adminRole = '';               // "admin" or "founder", as the server says
let adminLoaded = false;
let adminLoading = false;
let growthChart = null;

const userView = { q: '', status: '', page: 1 };
let userSearchDelay = null;
let userRequestSeq = 0;
let usersShown = [];

// Admin requests carry the admin token as well as the login cookie: some browsers drop the cookie
async function adminApi(path, { method = 'GET', body } = {}) {
  const headers = {};
  const token = localStorage.getItem('adminToken');
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, credentials: 'include', headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (err) {
    throw new ApiError(0, 'Could not reach the server.');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty body */ }
  if (!res.ok) {
    if (res.status === 429) throw new ApiError(429, 'Too many announcements in a short time. Wait a minute and try again.');
    throw new ApiError(res.status, data && typeof data.detail === 'string' ? data.detail : 'Something went wrong. Please try again.');
  }
  return data;
}

// ==========================================
// 1. LOADING
// ==========================================
function initAdmin() {
  bindAdminControls();
  renderAdminSkeleton();
  loadAdmin();
}

async function loadAdmin() {
  if (adminLoading) return;
  adminLoading = true;
  try {
    const overview = await adminApi('/api/admin/overview');
    adminRole = overview.role || 'admin';
    adminLoaded = true;
    showAdminBody(true);
    renderOverview(overview);
    loadUsers();
    loadTeacherRequests();
  } catch (err) {
    if (err.status === 401 || err.status === 403) renderAdminGate();
    else if (!adminLoaded) renderAdminProblem(err.message);
    else showToast(err.message);
  } finally {
    adminLoading = false;
  }
}

function showAdminBody(visible) {
  el('adminBody').classList.toggle('hidden', !visible);
  el('adminGate').classList.toggle('hidden', visible);
  el('adminRefresh').classList.toggle('hidden', !visible);
}

// Not signed in as an admin: say so, and say how to get in
function renderAdminGate() {
  localStorage.removeItem('adminToken');
  showAdminBody(false);
  el('adminGate').innerHTML = peopleStateBlock('lock', 'Founder only',
    'This dashboard is for the founder. Admins verify accounts from the Verification desk. If you are the founder, sign in again through the admin form on the login page with your founder code.',
    '<a href="verify.html" class="btn-primary-modal" style="display:inline-block;text-decoration:none;margin-right:8px;">Verification desk</a><a href="login.html#admin" class="btn-outline-modal" style="display:inline-block;text-decoration:none;">Founder login</a>');
}

function renderAdminProblem(message) {
  showAdminBody(false);
  el('adminGate').innerHTML = peopleStateBlock('cloud_off', 'Could not load the dashboard', message,
    '<button type="button" data-action="retry" class="btn-primary-modal">Try again</button>');
}

function renderAdminSkeleton() {
  el('adminTotals').innerHTML = '<div class="skeleton h-20"></div>'.repeat(6);
  el('usersBody').innerHTML = '<tr><td colspan="5"><div class="skeleton h-8 w-full"></div></td></tr>'.repeat(3);
  el('requestsBody').innerHTML = '<tr><td colspan="4"><div class="skeleton h-8 w-full"></div></td></tr>';
}

// ==========================================
// 2. OVERVIEW
// ==========================================
function renderOverview(overview) {
  el('adminRole').textContent = adminRole === 'founder' ? 'Founder' : 'Admin';

  const totals = overview.totals || {};
  const tiles = [
    ['Members', totals.users, 'groups'], ['Online now', overview.online, 'sensors'], ['Projects', totals.projects, 'code'],
    ['Teams', totals.teams, 'corporate_fare'], ['Board posts', totals.posts, 'campaign'], ['Admins', totals.admins, 'shield_person']
  ];
  el('adminTotals').innerHTML = tiles.map(([label, value, icon]) => `
    <div class="bg-surface-container-lowest rounded-xl p-space-md shadow-sm border border-outline-variant/20">
      <div class="flex items-center justify-between">
        <span class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">${label}</span>
        <span class="material-symbols-outlined text-[18px] text-primary">${icon}</span>
      </div>
      <span class="font-headline-lg text-headline-lg text-on-surface block mt-1">${Number(value) || 0}</span>
    </div>`).join('');

  renderStatusBars(overview.statuses || {}, totals.users || 0);
  renderGrowth(overview.growth || [], overview.undated_accounts || 0);
  renderRequests(overview.requests || []);
}

function renderStatusBars(statuses, total) {
  const names = [...STATUS_ORDER.filter(name => statuses[name]), ...Object.keys(statuses).filter(name => !STATUS_ORDER.includes(name))];
  if (!names.length) { el('statusBars').innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant">No accounts yet.</p>'; return; }
  el('statusBars').innerHTML = names.map(name => {
    const count = statuses[name];
    const share = total ? Math.round((count / total) * 100) : 0;
    return `
      <button type="button" data-status="${escapeHtml(name)}" class="text-left group" title="Show these accounts">
        <span class="flex items-center justify-between font-body-sm text-body-sm">
          <span class="status-pill ${escapeHtml(name)}">${escapeHtml(name)}</span>
          <span class="text-on-surface-variant group-hover:text-primary">${count} · ${share}%</span>
        </span>
        <span class="block h-1.5 rounded-full bg-surface-container mt-1 overflow-hidden"><span class="block h-full bg-primary rounded-full" style="width:${share}%"></span></span>
      </button>`;
  }).join('');
}

function renderGrowth(growth, undated) {
  const joined = growth.reduce((sum, week) => sum + week.signups, 0);
  el('growthNote').textContent = `${joined} joined in this period` + (undated ? ` · ${undated} older ${undated === 1 ? 'account has' : 'accounts have'} no join date` : '');
  if (typeof Chart === 'undefined') {
    // The chart library is still downloading (or blocked); the numbers above tell the story until it arrives
    if (document.readyState !== 'complete') window.addEventListener('load', () => renderGrowth(growth, undated), { once: true });
    return;
  }
  const labels = growth.map(week => new Date(week.week + 'T00:00:00').toLocaleDateString([], { day: 'numeric', month: 'short' }));
  if (growthChart) growthChart.destroy();
  growthChart = new Chart(el('growthChart').getContext('2d'), {
    data: {
      labels,
      datasets: [
        { type: 'line', label: 'Total members', data: growth.map(week => week.total), borderColor: '#3525cd', backgroundColor: 'rgba(53,37,205,0.08)', borderWidth: 2, tension: 0.3, fill: true, pointRadius: 2, yAxisID: 'y' },
        { type: 'bar', label: 'New this week', data: growth.map(week => week.signups), backgroundColor: '#68dba9', borderRadius: 4, yAxisID: 'y' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { color: '#464555', boxWidth: 12 } } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0, color: '#777587' }, grid: { color: '#e5eeff' } },
        x: { ticks: { color: '#777587' }, grid: { display: false } }
      }
    }
  });
}

// ==========================================
// 3. ADMIN APPLICATIONS
// ==========================================
function renderRequests(requests) {
  if (!requests.length) {
    el('requestsBody').innerHTML = '<tr><td colspan="4" class="text-center" style="color:#777587;padding:24px;">Nobody has applied for admin access.</td></tr>';
    return;
  }
  el('requestsBody').innerHTML = requests.map(request => {
    const status = String(request.status || 'Pending');
    let actions = '<span style="color:#777587;font-size:12px;">Settled</span>';
    if (status === 'Pending') {
      actions = adminRole === 'founder'
        ? `<span class="flex gap-2"><button type="button" class="admin-btn good" data-request="${request.id}" data-decision="accept">Approve</button><button type="button" class="admin-btn bad" data-request="${request.id}" data-decision="reject">Deny</button></span>`
        : '<span style="color:#777587;font-size:12px;">Only the founder can decide</span>';
    }
    return `
      <tr>
        <td><a class="font-semibold hover:text-primary" href="profile.html?id=${request.user_id}">${escapeHtml(request.name || `User #${request.user_id}`)}</a></td>
        <td style="color:#464555;">${escapeHtml(timeAgo(request.requested_at))}</td>
        <td><span class="status-pill ${escapeHtml(status.toLowerCase())}">${escapeHtml(status)}</span></td>
        <td>${actions}</td>
      </tr>`;
  }).join('');
}

function decideRequest(requestId, decision, name) {
  const approving = decision === 'accept';
  window.showSystemModal(approving ? 'Approve admin access' : 'Deny admin access',
    approving ? `Give ${escapeHtml(name)} admin access? They will be able to review accounts and send announcements.` : `Deny ${escapeHtml(name)}'s request for admin access?`,
    'confirm', async () => {
      try {
        await adminApi(`/api/admin/requests/${requestId}/${decision}`, { method: 'POST' });
        showToast(approving ? 'Admin access granted.' : 'Request denied.');
        loadAdmin();
      } catch (err) {
        showToast(err.message);
      }
    }, approving ? 'Approve' : 'Deny');
}

// ==========================================
// 3b. TEACHER ACCESS FOR COLLEGE HUB
// ==========================================
async function loadTeacherRequests() {
  let requests;
  try {
    requests = await adminApi('/api/admin/teacher-requests');
  } catch (err) {
    el('teacherRequestsBody').innerHTML = `<tr><td colspan="6" class="text-center" style="color:#ba1a1a;padding:24px;">${escapeHtml(err.message)}</td></tr>`;
    return;
  }
  if (!requests.length) {
    el('teacherRequestsBody').innerHTML = '<tr><td colspan="6" class="text-center" style="color:#777587;padding:24px;">Nobody has asked for teacher access.</td></tr>';
    return;
  }
  el('teacherRequestsBody').innerHTML = requests.map(request => {
    const status = String(request.status || 'pending');
    const actions = status === 'pending'
      ? `<span class="flex gap-2"><button type="button" class="admin-btn good" data-teacher-request="${request.id}" data-action="approve">Approve</button><button type="button" class="admin-btn bad" data-teacher-request="${request.id}" data-action="decline">Decline</button></span>`
      : '<span style="color:#777587;font-size:12px;">Settled</span>';
    return `
      <tr>
        <td>
          <a class="font-semibold hover:text-primary" href="profile.html?id=${request.user_id}">${escapeHtml(request.name)}</a>
          <span class="block" style="color:#777587;font-size:12px;">${escapeHtml([request.profession, request.email].filter(Boolean).join(' · '))}</span>
        </td>
        <td style="color:#464555;">${escapeHtml(request.college)}</td>
        <td style="color:#464555;max-width:260px;">${escapeHtml(request.note || '-')}</td>
        <td style="color:#464555;">${escapeHtml(timeAgo(request.requested_at))}</td>
        <td><span class="status-pill ${escapeHtml(status === 'approved' ? 'verified' : (status === 'declined' ? 'rejected' : 'pending'))}">${escapeHtml(status)}</span></td>
        <td>${actions}</td>
      </tr>`;
  }).join('');
}

function decideTeacherRequest(requestId, action, name, college) {
  const approving = action === 'approve';
  window.showSystemModal(approving ? 'Approve teacher access' : 'Decline teacher access',
    approving
      ? `Give ${escapeHtml(name)} teacher access for ${escapeHtml(college)}? They will be able to form and change student groups, post to the notice board and read every class chat room of that college.`
      : `Decline ${escapeHtml(name)}'s request for teacher access?`,
    'confirm', async () => {
      try {
        await adminApi(`/api/admin/teacher-requests/${requestId}`, { method: 'POST', body: { action } });
        showToast(approving ? 'Teacher access given.' : 'Request declined.');
        loadTeacherRequests();
        loadUsers();
      } catch (err) {
        showToast(err.message);
      }
    }, approving ? 'Approve' : 'Decline');
}

function setTeacherAccess(userId, teacher) {
  const user = usersShown.find(row => row.id === userId);
  const name = user ? user.name : 'this account';
  window.showSystemModal(teacher ? 'Give teacher access' : 'Remove teacher access',
    teacher
      ? `Make ${escapeHtml(name)} a teacher for ${escapeHtml(user && user.college_name ? user.college_name : 'their college')} on College Hub?`
      : `Remove ${escapeHtml(name)}'s teacher access? Groups they created stay as they are.`,
    'confirm', async () => {
      try {
        await adminApi(`/api/admin/users/${userId}/teacher`, { method: 'POST', body: { teacher } });
        showToast(teacher ? 'Teacher access given.' : 'Teacher access removed.');
        loadUsers();
      } catch (err) {
        showToast(err.message);
      }
    }, teacher ? 'Give access' : 'Remove');
}

// ==========================================
// 4. ACCOUNTS
// ==========================================
async function loadUsers() {
  const seq = ++userRequestSeq;
  const params = new URLSearchParams({ page: userView.page });
  if (userView.q) params.set('q', userView.q);
  if (userView.status) params.set('status', userView.status);
  let data;
  try {
    data = await adminApi(`/api/admin/users?${params}`);
  } catch (err) {
    if (seq === userRequestSeq) el('usersBody').innerHTML = `<tr><td colspan="5" class="text-center" style="color:#ba1a1a;padding:24px;">${escapeHtml(err.message)}</td></tr>`;
    return;
  }
  if (seq !== userRequestSeq) return;   // a newer search has started
  usersShown = data.users || [];
  renderUsers(data);
}

function userRowHtml(user) {
  const badges = [
    user.is_founder ? 'Founder' : (user.is_admin ? 'Admin' : ''),
    user.is_ambassador ? 'Ambassador' : '',
    user.is_teacher ? 'Teacher' : ''
  ].filter(Boolean).map(text => `<span class="px-1.5 py-0.5 rounded bg-secondary-container text-on-secondary-container text-[10px] font-semibold uppercase tracking-wide">${text}</span>`).join(' ');
  const status = user.account_status;
  const buttons = [];
  if (!user.is_founder) {
    if (status !== 'verified') buttons.push(`<button type="button" class="admin-btn good" data-user="${user.id}" data-set="verified">Verify</button>`);
    if (status !== 'rejected') buttons.push(`<button type="button" class="admin-btn bad" data-user="${user.id}" data-set="rejected">Reject</button>`);
  }
  if (user.has_id_card) buttons.push(`<button type="button" class="admin-btn" data-user="${user.id}" data-idcard>View ID</button>`);
  if (user.is_teacher) buttons.push(`<button type="button" class="admin-btn" data-user="${user.id}" data-teacher="0">Remove teacher</button>`);
  else if (user.college_name) buttons.push(`<button type="button" class="admin-btn" data-user="${user.id}" data-teacher="1">Make teacher</button>`);
  return `
    <tr data-user-row="${user.id}">
      <td>
        <a class="font-semibold hover:text-primary" href="profile.html?id=${user.id}">${escapeHtml(user.name || 'Unnamed')}</a> ${badges}
        <span class="block" style="color:#777587;font-size:12px;">${escapeHtml(user.email || 'No email')}</span>
      </td>
      <td style="color:#464555;">${escapeHtml(user.college_name || '-')}<span class="block" style="color:#777587;font-size:12px;">${escapeHtml(user.department || '')}</span></td>
      <td style="color:#464555;">${escapeHtml(user.roll_no || '-')}</td>
      <td><span class="status-pill ${escapeHtml(status)}">${escapeHtml(status)}</span></td>
      <td><span class="flex flex-wrap gap-2">${buttons.join('') || '<span style="color:#777587;font-size:12px;">-</span>'}</span></td>
    </tr>`;
}

function renderUsers(data) {
  const users = data.users || [];
  el('usersBody').innerHTML = users.length
    ? users.map(userRowHtml).join('')
    : `<tr><td colspan="5" class="text-center" style="color:#777587;padding:24px;">${userView.q || userView.status ? 'No account matches that.' : 'No accounts yet.'}</td></tr>`;
  const totalPages = Math.max(1, Math.ceil(data.total / data.page_size));
  el('usersPagination').innerHTML = peoplePaginationHtml(data.page, data.total, (data.page - 1) * data.page_size, users.length, totalPages, ['account', 'accounts']);
}

function changeAccountStatus(userId, status) {
  const user = usersShown.find(row => row.id === userId);
  if (!user) return;
  const verifying = status === 'verified';
  window.showSystemModal(verifying ? 'Verify account' : 'Reject account',
    verifying
      ? `Mark ${escapeHtml(user.name)} as verified? They get the verified badge and a notification.`
      : `Reject ${escapeHtml(user.name)}'s account? They are hidden from every people list and told they can appeal.`,
    'confirm', async () => {
      try {
        const result = await adminApi(`/api/admin/users/${userId}/status`, { method: 'POST', body: { status } });
        user.account_status = result.account_status;
        const row = el('usersBody').querySelector(`[data-user-row="${userId}"]`);
        if (row) row.outerHTML = userRowHtml(user);
        showToast(verifying ? `${user.name} is now verified.` : `${user.name} was rejected.`);
        refreshOverviewQuietly();
      } catch (err) {
        showToast(err.message);
      }
    }, verifying ? 'Verify' : 'Reject');
}

async function refreshOverviewQuietly() {
  try { renderOverview(await adminApi('/api/admin/overview')); } catch (err) { /* the numbers catch up on the next refresh */ }
}

async function showIdCard(userId) {
  const user = usersShown.find(row => row.id === userId);
  try {
    const data = await adminApi(`/api/admin/users/${userId}/id-card`);
    const source = safeUrl(mediaUrl(data.image));
    const body = source === '#'
      ? 'The stored ID document is not an image this page can show.'
      : `<img src="${escapeHtml(source)}" alt="ID document" style="max-width:100%;max-height:60vh;border-radius:8px;display:block;margin:0 auto;"/>`;
    window.showSystemModal(`ID document: ${user ? user.name : 'account'}`, body, 'alert', null, 'Close');
  } catch (err) {
    showToast(err.message);
  }
}

// ==========================================
// 5. ANNOUNCEMENT
// ==========================================
function sendAnnouncement() {
  const message = el('announceText').value.trim();
  if (!message) return;
  window.showSystemModal('Send to everyone?', `Every account will get this notification:<br><br><strong>${escapeHtml(message)}</strong>`, 'confirm', async () => {
    const button = el('announceSend');
    button.disabled = true;
    try {
      const result = await adminApi('/api/admin/announce', { method: 'POST', body: { message } });
      el('announceText').value = '';
      updateAnnounceCount();
      showToast(`Sent to ${result.sent_to} ${result.sent_to === 1 ? 'account' : 'accounts'}.`);
    } catch (err) {
      showToast(err.message);
      updateAnnounceCount();
    }
  }, 'Send');
}

function updateAnnounceCount() {
  const length = el('announceText').value.trim().length;
  el('announceCount').textContent = `${length} / ${ANNOUNCEMENT_LIMIT}`;
  el('announceSend').disabled = length === 0;
}

// ==========================================
// 6. CONTROLS
// ==========================================
function bindAdminControls() {
  el('adminRefresh').addEventListener('click', () => { loadAdmin(); showToast('Refreshing...'); });
  el('adminGate').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="retry"]')) loadAdmin();
  });

  el('userSearch').addEventListener('input', (e) => {
    clearTimeout(userSearchDelay);
    userSearchDelay = setTimeout(() => { userView.q = e.target.value.trim(); userView.page = 1; loadUsers(); }, 300);
  });
  el('userStatus').addEventListener('change', (e) => { userView.status = e.target.value; userView.page = 1; loadUsers(); });
  el('statusBars').addEventListener('click', (e) => {
    const bar = e.target.closest('[data-status]');
    if (!bar) return;
    userView.status = bar.dataset.status;
    userView.page = 1;
    el('userStatus').value = userView.status;
    loadUsers();
    el('usersTop').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  el('usersPagination').addEventListener('click', (e) => {
    const button = e.target.closest('[data-page]');
    if (!button || button.disabled) return;
    userView.page = parseInt(button.dataset.page);
    loadUsers();
  });
  el('usersBody').addEventListener('click', (e) => {
    const button = e.target.closest('[data-user]');
    if (!button) return;
    const userId = parseInt(button.dataset.user);
    if (button.dataset.set) changeAccountStatus(userId, button.dataset.set);
    else if ('idcard' in button.dataset) showIdCard(userId);
    else if (button.dataset.teacher) setTeacherAccess(userId, button.dataset.teacher === '1');
  });
  el('teacherRequestsBody').addEventListener('click', (e) => {
    const button = e.target.closest('[data-teacher-request]');
    if (!button) return;
    const row = button.closest('tr');
    decideTeacherRequest(parseInt(button.dataset.teacherRequest), button.dataset.action, row.querySelector('a').textContent, row.children[1].textContent);
  });
  el('requestsBody').addEventListener('click', (e) => {
    const button = e.target.closest('[data-request]');
    if (!button) return;
    const name = button.closest('tr').querySelector('a').textContent;
    decideRequest(parseInt(button.dataset.request), button.dataset.decision, name);
  });

  el('announceText').addEventListener('input', updateAnnounceCount);
  el('announceSend').addEventListener('click', sendAnnouncement);
}

initAdmin();
