// ==========================================
// LEGAL.JS — Privacy, Terms, Cookies, Refunds, Copyright, Contact and Support pages. They open for visitors who are not
// logged in too: those get a plain top bar with Log in and Sign up instead of the app's menus.
// The Support form sends an enquiry of kind "support" (or "grievance" for complaints and appeals), the DPDP rights
// form (dpdp.html) one of kind "data_rights", the takedown form (copyright.html) one of kind "takedown";
// all show in the founder console under Enquiries.
// ==========================================

// The business behind the site, shown on contact.html, dpdp.html and refund.html (Consumer Protection (E-Commerce)
// Rules 2020, IT Rules 2021, DPDP Act 2023 Section 8(9)). FILL THESE IN BEFORE THE SITE GOES LIVE: an empty value
// shows its [placeholder] marked in red on the page. Razorpay also checks that the contact page shows them.
const SITE_INFO = {
  legalName: '',          // e.g. 'Connect2Minds Technologies Private Limited', or your own name as a sole proprietor
  address: '',            // registered address with PIN code
  gstin: '',              // leave empty if not registered for GST (the page then says "Not registered")
  email: '',              // support email
  phone: '',              // with +91
  hours: 'Mon–Sat, 10:00–18:00 IST',
  grievanceName: '',      // Grievance Officer (IT Rules 2021 Rule 3(2), DPDP Act): a person resident in India
  grievanceEmail: '',
};
const SITE_PLACEHOLDERS = {
  legalName: '[Legal name]', address: '[Registered address]', gstin: 'Not registered for GST', email: '[Support email]',
  phone: '[Phone]', hours: '[Hours]', grievanceName: '[Grievance Officer name]', grievanceEmail: '[grievance email]',
};

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
  const takedown = document.getElementById('tdForm');
  if (takedown) initRequestForm(takedown, 'td', 'takedown');
  document.querySelectorAll('[data-dpdp]').forEach((node) => { node.dataset.site = node.dataset.dpdp === 'name' ? 'grievanceName' : 'grievanceEmail'; });
  document.querySelectorAll('[data-site]').forEach(fillSiteInfo);
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

function fillSiteInfo(node) {
  const key = node.dataset.site;
  const value = SITE_INFO[key];
  node.textContent = value || SITE_PLACEHOLDERS[key] || '';
  node.classList.toggle('lg-todo', !value && key !== 'gstin');
  if (node.tagName !== 'A') return;
  if (value && /email/i.test(key)) node.href = `mailto:${value}`;
  else if (value && key === 'phone') node.href = `tel:${value.replace(/[^\d+]/g, '')}`;
  else node.removeAttribute('href');
}

// Support topics that are complaints go to the Grievance Officer's list (15-day answer) instead of plain support
const GRIEVANCE_TOPICS = ['Complaint (Grievance Officer)', 'Appeal a decision'];

// One form shape for Support, DPDP and takedown requests: fields <prefix>Topic/Name/Email/Message/Error/Send/Sent/SentTo
// (and <prefix>Oath, a box that must be ticked, on the takedown form)
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
    if (!topic) return show(kind === 'data_rights' ? 'Pick what you need.' : kind === 'takedown' ? 'Tell us where the material is.' : 'Pick a topic.');
    if (!name) return show('Tell us your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return show('Enter an email address we can reply to.');
    if (message.length < 10) return show(kind === 'data_rights' ? 'Tell us a little more about your request.' : 'Tell us a little more about what happened.');
    if (field('Oath') && !field('Oath').checked) return show('Tick the box to confirm the statement.');
    show('');
    const button = field('Send');
    button.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/enquiries`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: kind === 'support' && GRIEVANCE_TOPICS.includes(topic) ? 'grievance' : kind, organisation: topic.slice(0, 160), contact_name: name, email, message })
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
