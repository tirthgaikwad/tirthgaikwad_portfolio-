// ==========================================
// PRICING.JS — Plans and prices (pricing.html). Every price comes from /api/plans, so it is written in one place.
// Student and Networking plans are bought here with Razorpay; Recruiter, Institution and Sponsor plans start with
// "Talk to us" (an enquiry the founder answers).
// Loaded after shared.js, chat-common.js and pages-common.js.
// ==========================================

const P = { plans: null, me: null, period: 'month', years: 1, tab: 'personal' };
const LINES = { personal: 'Students & professionals', recruiter: 'Recruiters', institution: 'Institutions', sponsor: 'Sponsors' };

const PERSONAL_FEATURES = (l) => [
  ['forum', l.new_conversations === null ? 'Unlimited new conversations' : `${l.new_conversations} new conversations a month with people who don't follow you`],
  ['work', l.board_applications === null ? 'Unlimited applications on the Opportunities board' : `${l.board_applications} board applications a month`],
  ['handshake', l.pro_intros === null ? 'Unlimited introductions to professionals' : `${l.pro_intros} introductions to professionals a month`],
  ['groups', l.teams === null ? 'Unlimited teams' : `Create up to ${l.teams} teams`],
  ['menu_book', l.research_saves === null ? 'Unlimited saved research reports' : `${l.research_saves} saved research reports`],
  ['tune', l.advanced_filters ? 'Advanced Professionals filters: several must-have skills, open-to, experience sort' : 'Basic search filters'],
  ...(l.profile_boost ? [['rocket_launch', 'Profile boost: shown first in Discover and Professionals']] : [])
];
const EXTRA_FEATURES = {
  recruiter_starter: ['Search verified students and professionals', '50 contact unlocks a month', 'Shortlists with stages and notes', '1 seat'],
  recruiter_growth: ['Everything in Starter', '250 contact unlocks a month', 'GitHub-backed filters (repos, languages)', 'CSV export of shortlists', '3 seats'],
  recruiter_enterprise: ['Unlimited contact unlocks', '10+ seats', 'Dedicated onboarding', 'API access (planned)'],
  inst_starter: ['College Hub for every student and teacher', 'Attendance with low-attendance alerts', 'Hand-in work, marks and feedback', 'Institution analytics and CSV exports', 'College admins for verification'],
  inst_growth: ['Everything in Starter', 'Up to 2,000 students', 'Priority support', 'Onboarding call for teachers'],
  inst_campus: ['Everything in Growth', 'Up to 5,000 students', 'Several departments and campuses', 'Quarterly review with our team'],
  inst_enterprise: ['Above 5,000 students', '₹55 per student a year', 'Custom onboarding and data export', 'Named account manager'],
  sponsor_basic: ['One bounty for 30 days', 'Sponsored tag, shown first on the board', 'Registrations and submissions', 'You judge and announce winners'],
  sponsor_featured: ['One challenge pinned for 60 days', 'Pushed to students whose skills match', 'Everything in Bounty Basic'],
  sponsor_hackathon: ['A full hackathon for up to 90 days', 'Team registration and submissions', 'Judging with scores and places', 'Campus-wide push and winners announcement'],
  sponsor_season: ['Five Featured challenges', 'Use them within a year', 'Best value for regular hiring drives']
};

async function loadPricing() {
  try {
    // The page is public: visitors who are not logged in see the prices and can send an enquiry
    const signedIn = Boolean(localStorage.getItem('currentUserId'));
    const [plans, me] = await Promise.all([api('/api/plans'), signedIn ? api('/api/me/plan').catch(() => null) : Promise.resolve(null)]);
    P.plans = plans;
    P.me = me;
    renderPricing();
  } catch (err) {
    el('pricingBody').innerHTML = stateBlock('cloud_off', 'Could not load the plans', escapeHtml(err.message));
  }
}

function priceOf(plan, period) {
  return plan.prices[period] || null;
}

function renderPricing() {
  el('pricingTabs').querySelectorAll('[data-tab]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.tab === P.tab)));
  el('periodSwitch').classList.toggle('ch-hidden', !['personal', 'recruiter'].includes(P.tab));
  el('periodSwitch').querySelectorAll('[data-period]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.period === P.period)));
  el('yearsSwitch').classList.toggle('ch-hidden', P.tab !== 'institution');
  el('yearsSwitch').querySelectorAll('[data-years]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.years) === P.years)));
  const plans = Object.values(P.plans.plans).filter(plan => plan.line === P.tab);
  const founder = P.me && P.me.founder;
  el('founderNote').classList.toggle('ch-hidden', !founder);

  el('pricingBody').innerHTML = `<div class="pr-grid pr-${P.tab}">${plans.map(cardHtml).join('')}</div>
    ${P.tab === 'personal' ? compareHtml() : ''}
    ${P.tab === 'institution' ? `<p class="pr-small">${icon('redeem')}Every college gets a free ${P.plans.trial_days}-day trial of all institution features when its first teacher is approved. Prices are per college per year, before 18% GST.</p>` : ''}
    ${['recruiter', 'sponsor', 'institution'].includes(P.tab) ? `<div class="ch-panel pr-talk"><div><h3>Not sure which fits?</h3><p>Tell us about your ${P.tab === 'institution' ? 'college' : P.tab === 'recruiter' ? 'hiring' : 'challenge'} and we will suggest a plan. We usually reply within one working day.</p></div><button class="ch-btn solid" type="button" data-enquire="${P.tab}">${icon('mail')}Talk to us</button></div>` : ''}`;
}

function cardHtml(plan) {
  const founder = P.me && P.me.founder;
  const current = P.me && P.me.plan === plan.key;
  let priceBlock = '';
  let period = P.tab === 'institution' ? 'year' : P.tab === 'sponsor' ? 'one_time' : P.period;
  if (!plan.prices[period] && plan.prices.year) period = 'year';
  const price = priceOf(plan, period);
  if (plan.key === 'free') {
    priceBlock = `<div class="pr-price"><b>₹0</b><span>forever</span></div>`;
  } else if (plan.quote) {
    priceBlock = `<div class="pr-price"><b>Custom</b><span>${plan.per_student ? `₹${(plan.prices.year.base / 100).toLocaleString('en-IN')} per student / year` : `from ${inr(plan.prices.year.base)} / year`}</span></div>`;
  } else if (price) {
    let base = price.base, total = price.total;
    if (P.tab === 'institution' && P.years > 1) {
      const off = P.plans.multi_year_discount[P.years] || 0;
      base = Math.round(base * P.years * (100 - off) / 100);
      total = Math.round(base * (100 + P.plans.gst_rate) / 100);
    }
    const unit = { month: '/ month', year: P.tab === 'institution' && P.years > 1 ? `for ${P.years} years` : '/ year', one_time: 'per challenge' }[period];
    const monthly = period === 'year' && P.tab !== 'institution' ? `<small>${inr(Math.round(total / 12))} a month, billed yearly</small>` : '';
    const saving = period === 'year' && plan.prices.month ? Math.round((1 - plan.prices.year.total / (plan.prices.month.total * 12)) * 100) : 0;
    const gst = plan.gst === 'extra' ? `<small>+18% GST (${inr(total)} in all)</small>` : '<small>GST included</small>';
    priceBlock = `<div class="pr-price"><b>${inr(plan.gst === 'extra' ? base : total)}</b><span>${unit}</span>${monthly}${gst}${saving > 0 ? `<span class="ch-chip green">Save ${saving}%</span>` : ''}
      ${P.tab === 'institution' && P.years > 1 ? `<span class="ch-chip green">${P.plans.multi_year_discount[P.years]}% off</span>` : ''}</div>`;
  }
  const features = plan.line === 'personal' ? PERSONAL_FEATURES(plan.limits).map(([ico, text]) => `<li>${icon(ico)}<span>${escapeHtml(text)}</span></li>`)
    : (EXTRA_FEATURES[plan.key] || []).map(text => `<li>${icon('check')}<span>${escapeHtml(text)}</span></li>`);
  let action;
  if (founder) action = `<button class="ch-btn line" type="button" disabled>${icon('star')}Included for the founder</button>`;
  else if (current) action = `<a class="ch-btn line" href="billing.html">${icon('check_circle')}Your plan</a>`;
  else if (plan.key === 'free') action = P.me && P.me.plan !== 'free' ? '<span class="pr-small">Your plan returns to Free when a paid one ends.</span>' : `<button class="ch-btn line" type="button" disabled>Your plan</button>`;
  else if (plan.self_serve) action = `<button class="ch-btn solid" type="button" data-buy="${plan.key}">${icon('bolt')}Upgrade to ${escapeHtml(plan.name)}</button>`;
  else action = `<button class="ch-btn solid" type="button" data-enquire="${plan.line}" data-plan="${plan.key}">${icon('mail')}${plan.quote ? 'Ask for a quote' : 'Talk to us'}</button>`;
  const popular = ['premium', 'recruiter_growth', 'inst_growth', 'sponsor_featured'].includes(plan.key);
  return `<article class="ch-panel pr-card${popular ? ' is-popular' : ''}${current ? ' is-current' : ''}">
    ${popular ? '<span class="pr-flag">Most chosen</span>' : ''}
    <h3>${escapeHtml(plan.name)}</h3>
    <p class="pr-blurb">${escapeHtml(plan.blurb || '')}</p>
    ${priceBlock}
    <ul class="pr-features">${features.join('')}</ul>
    <div class="pr-action">${action}</div>
  </article>`;
}

function compareHtml() {
  const keys = ['free', 'student_pro', 'premium', 'premium_plus'];
  const plans = keys.map(key => P.plans.plans[key]);
  const cell = (value, unit) => value === null ? '<b>Unlimited</b>' : value === true ? icon('check') : value === false ? '<span class="pr-dash">—</span>' : `${value}${unit || ''}`;
  const rows = [
    ['Profile, Discover, follows, College Hub, teams and chat with people who follow you back', () => icon('check')],
    ['New conversations a month (people who do not follow you)', (p) => cell(p.limits.new_conversations)],
    ['Opportunities board applications a month', (p) => cell(p.limits.board_applications)],
    ['Introductions to professionals a month', (p) => cell(p.limits.pro_intros)],
    ['Teams you can create', (p) => cell(p.limits.teams)],
    ['Saved research reports', (p) => cell(p.limits.research_saves)],
    ['Advanced Professionals filters (several must-have skills, open-to, experience sort)', (p) => cell(p.limits.advanced_filters)],
    ['Profile boost in Discover and Professionals', (p) => cell(p.limits.profile_boost)],
    ['Badge on your profile', (p) => ({ free: '<span class="pr-dash">—</span>', student_pro: '<span class="c2m-badge plan">Pro</span>', premium: '<span class="c2m-badge plan">Premium</span>', premium_plus: '<span class="c2m-badge plan">Premium+</span>' })[p.key]]
  ];
  return `<div class="ch-panel pr-compare"><h3>Compare personal plans</h3><div class="pr-table-wrap"><table class="ch-table">
    <thead><tr><th>Feature</th>${plans.map(p => `<th>${escapeHtml(p.name)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(([label, fn]) => `<tr><td>${escapeHtml(label)}</td>${plans.map(p => `<td>${fn(p)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="pr-small">Admins and teachers are accounts like any other here: their role does not include a paid plan. Replies to people who messaged you, and messages to your followers, never count.</p></div>`;
}

// ---------- buying ----------
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('The payment window could not be loaded. Check your connection.'));
    document.head.appendChild(script);
  });
}

async function buy(planKey, button) {
  if (!localStorage.getItem('currentUserId')) { window.location.href = 'login.html'; return; }
  if (!P.plans.payments_enabled) {
    return window.showSystemModal('Payments are coming soon', 'Online payments are not switched on yet. You will be able to upgrade here very soon.', 'alert');
  }
  button.disabled = true;
  try {
    const order = await api('/api/billing/order', { method: 'POST', body: { plan_key: planKey, period: P.period } });
    await loadRazorpay();
    const checkout = new window.Razorpay({
      key: order.key_id, amount: order.amount, currency: order.currency, name: order.name, description: order.description, order_id: order.order_id,
      prefill: order.prefill, theme: { color: '#3525cd' },
      handler: async (response) => {
        try {
          P.me = await api('/api/billing/verify', { method: 'POST', body: response });
          renderPricing();
          window.showSystemModal('Welcome aboard', `${escapeHtml(P.me.plan_name)} is active. Thank you!`, 'alert', () => { window.location.href = 'billing.html'; }, 'See my plan');
        } catch (err) { showToast(err.message); }
      },
      modal: { ondismiss: () => { button.disabled = false; } }
    });
    checkout.on('payment.failed', (response) => showToast((response.error && response.error.description) || 'The payment did not go through.'));
    checkout.open();
  } catch (err) {
    showToast(err.message);
  } finally {
    button.disabled = false;
  }
}

function openEnquiry(kind, planKey) {
  const plans = Object.values(P.plans.plans).filter(plan => plan.line === kind);
  const me = window.currentUserProfile || {};
  const sizeLabel = { institution: 'Number of students', recruiter: 'Hires a year (roughly)', sponsor: 'Challenges you plan' }[kind];
  openModal({
    title: `Talk to us: ${LINES[kind]}`, confirmText: 'Send',
    body: `<label>Plan you are interested in<select class="ch-select" id="enqPlan"><option value="">Not sure yet</option>${plans.map(p => `<option value="${p.key}" ${p.key === planKey ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select></label>
      <label>${kind === 'institution' ? 'College or university' : 'Company or organisation'}<input class="ch-input" id="enqOrg" maxlength="160" value="${escapeHtml(kind === 'institution' ? (me.college_name || '') : '')}"></label>
      <div class="ch-row2"><label>Your name<input class="ch-input" id="enqName" maxlength="120" value="${escapeHtml(me.name || '')}"></label>
      <label>${sizeLabel}<input class="ch-input" id="enqSize" maxlength="60"></label></div>
      <div class="ch-row2"><label>Work email<input class="ch-input" id="enqEmail" type="email" maxlength="160"></label>
      <label>Phone <small>(optional)</small><input class="ch-input" id="enqPhone" type="tel" maxlength="20"></label></div>
      <label>Anything else <small>(optional)</small><textarea class="ch-textarea" id="enqMessage" maxlength="2000"></textarea></label>`,
    onConfirm: async () => {
      await api('/api/enquiries', { method: 'POST', body: {
        kind, plan_key: el('enqPlan').value, organisation: el('enqOrg').value, contact_name: el('enqName').value, email: el('enqEmail').value,
        phone: el('enqPhone').value, size: el('enqSize').value, message: el('enqMessage').value
      } });
      window.showSystemModal('Thank you', 'We have your enquiry and will reply by email, usually within one working day.', 'alert');
    }
  });
}

document.querySelector('main').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    P.tab = tab.dataset.tab;
    history.replaceState(null, '', `${location.pathname}?tab=${P.tab}`);
    return renderPricing();
  }
  const period = e.target.closest('[data-period]');
  if (period) { P.period = period.dataset.period; return renderPricing(); }
  const years = e.target.closest('[data-years]');
  if (years) { P.years = Number(years.dataset.years); return renderPricing(); }
  const buyButton = e.target.closest('[data-buy]');
  if (buyButton) return buy(buyButton.dataset.buy, buyButton);
  const enquire = e.target.closest('[data-enquire]');
  if (enquire) return openEnquiry(enquire.dataset.enquire, enquire.dataset.plan || '');
  const faq = e.target.closest('.pr-faq summary');
  if (faq) return;
});

const startTab = new URLSearchParams(location.search).get('tab');
if (LINES[startTab]) P.tab = startTab;
bindModal();
loadPricing();
