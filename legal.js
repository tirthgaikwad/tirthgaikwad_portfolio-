// ==========================================
// LEGAL.JS — Privacy, Terms, Cookies and Support pages. They open for visitors who are not logged in too:
// those get a plain top bar with Log in and Sign up instead of the app's menus.
// The Support form sends an enquiry of kind "support", the DPDP rights form (dpdp.html) one of kind "data_rights";
// both show in the founder console under Enquiries.
// ==========================================

// The Grievance Officer named on dpdp.html (DPDP Act 2023, Section 8(9)). Fill these in before the site goes live.
const DPDP_CONTACT = { name: '[Grievance Officer name]', email: '' };

function initLegal() {
  if (!localStorage.getItem('currentUserId')) {
    const header = document.getElementById('appHeader');
    if (header) header.innerHTML = `<div class="lg-guest-bar"><a class="lg-brand" href="index.html">Connect2Minds</a>
      <nav><a class="hm-btn is-quiet" href="login.html">Log in</a><a class="hm-btn" href="register.html">Sign up</a></nav></div>`;
    document.body.classList.add('tabbar-off');      // the phone tab bar is for members
  }
  const form = document.getElementById('supportForm');
  if (form) initRequestForm(form, 'sup', 'support');
  const rights = document.getElementById('dpForm');
  if (rights) initRequestForm(rights, 'dp', 'data_rights');
  document.querySelectorAll('[data-dpdp]').forEach(fillDpdpContact);
  const status = document.getElementById('ckStatus');
  if (status) initCookieStatus(status);
}

// cookies.html: say what this device allows now; cookies.js arrives a moment after the page
function initCookieStatus(status) {
  const show = () => {
    const consent = window.CookieConsent;
    if (!consent) return false;
    if (!consent.chosen()) {
      status.textContent = 'You have not chosen yet, so only essential cookies are used.';
      return true;
    }
    const on = [consent.allows('preferences') && 'preferences', consent.allows('analytics') && 'visit counts'].filter(Boolean);
    status.textContent = on.length ? `Essential cookies, plus ${on.join(' and ')}.` : 'Essential cookies only.';
    return true;
  };
  document.addEventListener('cookieconsent', show);
  let tries = 0;
  const wait = setInterval(() => { if (show() || ++tries > 40) clearInterval(wait); }, 150);
}

function fillDpdpContact(node) {
  if (node.dataset.dpdp === 'name') node.textContent = DPDP_CONTACT.name;
  if (node.dataset.dpdp === 'email') {
    node.textContent = DPDP_CONTACT.email || '[grievance email]';
    if (DPDP_CONTACT.email) node.href = `mailto:${DPDP_CONTACT.email}`;
    else node.removeAttribute('href');
  }
}

// One form shape for Support and DPDP requests: fields <prefix>Topic/Name/Email/Message/Error/Send/Sent/SentTo
function initRequestForm(form, prefix, kind) {
  const field = (id) => document.getElementById(prefix + id);
  // A logged-in person's name and email are filled in for them
  const fill = () => {
    const me = window.currentUserProfile;
    if (!me) return false;
    if (!field('Name').value) field('Name').value = me.name || '';
    if (!field('Email').value && /@/.test(me.email || '') && !/placeholder/.test(me.email)) field('Email').value = me.email;
    return true;
  };
  // The header profile arrives a moment after the page (shared.js); look for it for a few seconds
  let tries = 0;
  const wait = setInterval(() => { if (fill() || ++tries > 30) clearInterval(wait); }, 300);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = field('Error');
    const show = (message) => { error.textContent = message; error.hidden = !message; };
    const topic = field('Topic').value, name = field('Name').value.trim(), email = field('Email').value.trim(), message = field('Message').value.trim();
    if (!topic) return show(kind === 'data_rights' ? 'Pick what you need.' : 'Pick a topic.');
    if (!name) return show('Tell us your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return show('Enter an email address we can reply to.');
    if (message.length < 10) return show(kind === 'data_rights' ? 'Tell us a little more about your request.' : 'Tell us a little more about what happened.');
    show('');
    const button = field('Send');
    button.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/enquiries`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, organisation: topic, contact_name: name, email, message })
      });
      let data = null;
      try { data = await res.json(); } catch (e) { /* empty body */ }
      if (!res.ok) throw new Error(res.status === 429 ? 'Too many messages. Wait a minute and try again.' : (data && typeof data.detail === 'string' ? data.detail : 'Could not send. Please try again.'));
      field('SentTo').textContent = email;
      form.hidden = true;
      field('Sent').hidden = false;
    } catch (err) {
      show(err.message === 'Failed to fetch' ? 'Could not reach the server.' : err.message);
      button.disabled = false;
    }
  });
}
