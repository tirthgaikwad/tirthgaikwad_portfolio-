// ==========================================
// GUARDIAN.JS — guardian.html (DPDP Act 2023 Section 9, section 31 of main.py).
// With ?t= (the emailed link) a parent or guardian sees what the child shares and agrees or says no.
// Without it, the logged-in under-18 member sees that the account waits, and can send the link again.
// Loaded after auth.js, which provides postJson, setFieldError, showNotice and setBusy.
// ==========================================
(function () {
  const byId = (id) => document.getElementById(id);
  const notice = byId('gNotice');
  const token = new URLSearchParams(window.location.search).get('t') || '';

  function done(title, text) {
    ['gDecide', 'gWait'].forEach(id => { byId(id).hidden = true; });
    byId('gTitle').textContent = title;
    byId('gLead').textContent = '';
    byId('gDoneText').textContent = text;
    byId('gDone').hidden = false;
  }

  async function getJson(path) {
    try {
      const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
      return { status: res.status, data: await res.json().catch(() => null) };
    } catch (err) {
      return { status: 0, data: null };
    }
  }

  // ---------- the guardian ----------
  async function openForGuardian() {
    const { data } = await getJson(`/api/guardian?t=${encodeURIComponent(token)}`);
    if (!data || !data.valid) return done('This link does not work any more', 'It may have been used already, or it is older than 7 days. Ask your child to send a new one from Connect2Minds.');
    byId('gTitle').textContent = `${data.name.split(' ')[0] || 'Your child'} asks for your consent`;
    byId('gLead').textContent = 'Please read what they share on Connect2Minds, then decide.';
    byId('gName').textContent = data.name;
    byId('gCollege').textContent = [data.college, data.department].filter(Boolean).join(', ') || '—';
    byId('gBirth').textContent = data.birth_date ? new Date(`${data.birth_date}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
    byId('gDecide').hidden = false;
  }

  async function decide(decision, button) {
    if (decision === 'decline' && !window.confirm('Say no? The account and everything in it will be erased now. This cannot be undone.')) return;
    showNotice(notice, '');
    setBusy(button, true);
    const result = await postJson('/api/guardian', { token, decision });
    setBusy(button, false);
    if (!result.ok) return showNotice(notice, result.message || 'Could not save. Try again.');
    history.replaceState(null, '', 'guardian.html');
    if (decision === 'approve') done('Thank you', 'Your consent is recorded and the account is open now. You can withdraw it at any time by writing to the Grievance Officer (see Contact us).');
    else done('The account is erased', 'You said no, so the account and its data were erased. Nothing more will be sent to you.');
  }
  byId('gApprove').addEventListener('click', (e) => decide('approve', e.currentTarget));
  byId('gDecline').addEventListener('click', (e) => decide('decline', e.currentTarget));

  // ---------- the young member ----------
  async function openForMember() {
    const { status, data } = await getJson('/api/me');
    if (status === 401 || !data) { window.location.replace('login.html'); return; }
    if (!data.guardian_needed) { window.location.replace('home.html'); return; }
    byId('gTitle').textContent = 'Waiting for your guardian';
    byId('gLead').textContent = 'You are under 18, so a parent or guardian has to agree before you can use Connect2Minds.';
    byId('gWaitText').textContent = data.email_ready
      ? `We emailed a link to ${data.guardian_email}. When they agree, this page opens the site for you. Not arrived? Check spam, or send it again.`
      : `Email is not set up on Connect2Minds yet, so the founder will contact your guardian (${data.guardian_email}) to check. You can still change the address below.`;
    byId('gWait').hidden = false;
  }

  byId('gResendForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = byId('gEmail');
    const button = e.currentTarget.querySelector('.btn');
    showNotice(notice, '');
    setBusy(button, true);
    const result = await postJson('/api/me/guardian/resend', { guardian_email: email.value.trim() });
    setBusy(button, false);
    if (!result.ok) return showNotice(notice, result.message || 'Could not send. Try again.');
    email.value = '';
    byId('gWaitText').textContent = result.data.email_sent
      ? `Sent again to ${result.data.guardian_email}.`
      : `Saved ${result.data.guardian_email}. Email is not set up yet, so the founder will contact them.`;
  });

  byId('gLogout').addEventListener('click', async () => {
    await postJson('/api/logout', {});
    try { localStorage.removeItem('currentUserId'); } catch (err) { /* storage unavailable */ }
    window.location.replace('index.html');
  });

  if (token) openForGuardian();
  else openForMember();
})();
