// ==========================================
// CERTIFICATE-CHECK.JS — certificate-check.html?code=C2M-XXXX-XXXX. Public: anyone (an employer, a college office) can check
// that a Connect2Minds certificate is real and was not revoked. Shows only what is printed on the certificate.
// ==========================================

function initCertificateCheck() {
  if (!localStorage.getItem('currentUserId')) {
    const header = document.getElementById('appHeader');
    if (header) header.innerHTML = `<div class="lg-guest-bar"><a class="lg-brand" href="index.html">Connect2Minds</a>
      <nav><a class="hm-btn is-quiet" href="login.html">Log in</a><a class="hm-btn" href="register.html">Sign up</a></nav></div>`;
    document.body.classList.add('tabbar-off');
  }
  el2('ccForm').addEventListener('submit', (e) => { e.preventDefault(); check(el2('ccCode').value); });
  const code = new URLSearchParams(location.search).get('code');
  if (code) { el2('ccCode').value = code; check(code); }
}
const el2 = (id) => document.getElementById(id);

async function check(raw) {
  const code = String(raw || '').toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9-]/g, '');
  const error = el2('ccError');
  error.classList.remove('is-shown');
  if (!/^C2M-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
    error.textContent = 'A code looks like C2M-ABCD-EFGH.';
    error.classList.add('is-shown');
    el2('ccResult').innerHTML = '';
    return;
  }
  history.replaceState(null, '', `certificate-check.html?code=${code}`);
  el2('ccResult').innerHTML = '<div class="skeleton" style="height:160px;border-radius:16px;margin-top:18px"></div>';
  try {
    const c = await evApi(`/api/certificates/${encodeURIComponent(code)}`);
    const kinds = { participation: 'Certificate of participation', winner: 'Winner', volunteer: 'Volunteer', speaker: 'Speaker', organiser: 'Organiser' };
    el2('ccResult').innerHTML = `<section class="ev-cert-result ${c.valid ? 'is-valid' : 'is-revoked'}" aria-live="polite">
      <p style="display:flex;align-items:center;gap:8px;font:800 20px 'Plus Jakarta Sans',sans-serif;margin:0 0 10px;color:${c.valid ? '#047857' : '#ba1a1a'}">${evIcon(c.valid ? 'verified' : 'gpp_bad')}${c.valid ? 'Valid certificate' : 'This certificate was revoked'}</p>
      <dl class="ev-dl"><dt>Issued to</dt><dd><b>${escapeHtml(c.holder_name)}</b></dd><dt>For</dt><dd>${escapeHtml(kinds[c.kind] || c.kind)}</dd>
        <dt>Event</dt><dd>${escapeHtml(c.event_title)}</dd><dt>Date</dt><dd>${escapeHtml(evDay(c.event_date, { year: 'numeric' }))}</dd>
        <dt>Host</dt><dd>${escapeHtml(c.host)}${c.host_verified ? ` ${evIcon('verified', 'ev-verified')}` : ''}${c.college_name ? `, ${escapeHtml(c.college_name)}` : ''}</dd>
        <dt>Code</dt><dd><code>${escapeHtml(c.code)}</code></dd>${c.valid ? '' : `<dt>Revoked on</dt><dd>${escapeHtml(evDay(c.revoked_at, { year: 'numeric' }))}</dd>`}</dl></section>`;
  } catch (err) {
    el2('ccResult').innerHTML = `<div class="ev-cert-result is-revoked" style="margin-top:18px"><p style="margin:0;font:700 16px Inter,sans-serif;color:#93000a">${escapeHtml(err.message)}</p>
      <p class="ev-small" style="margin-top:6px">If you got this certificate from someone, ask them to check the code with the organiser.</p></div>`;
  }
}

initCertificateCheck();
