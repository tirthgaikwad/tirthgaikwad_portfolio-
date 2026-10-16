// ==========================================
// BILLING.JS — Plans & billing (billing.html): your plan, what you have used this month, your other plans
// (recruiter seat, sponsor package) and your payments with printable GST receipts.
// Loaded after shared.js, chat-common.js and pages-common.js.
// ==========================================

const METERS = [
  ['new_conversations', 'New conversations', 'this month', 'forum'],
  ['board_applications', 'Board applications', 'this month', 'work'],
  ['pro_intros', 'Introductions to professionals', 'this month', 'handshake'],
  ['teams', 'Teams created', 'in total', 'groups'],
  ['research_saves', 'Saved research reports', 'in total', 'menu_book']
];

async function loadBilling() {
  try {
    const [plan, history] = await Promise.all([api('/api/me/plan'), api('/api/billing/history')]);
    renderBilling(plan, history.payments);
  } catch (err) {
    el('billingBody').innerHTML = stateBlock('cloud_off', 'Could not load your plan', escapeHtml(err.message), '<button class="ch-btn solid" type="button" onclick="loadBilling()">Try again</button>');
  }
}

function renderBilling(plan, payments) {
  const personal = plan.subscriptions.find(s => s.line === 'personal' && s.status === 'active' && s.ends_at >= new Date().toLocaleDateString('en-CA'));
  const others = plan.subscriptions.filter(s => s.line !== 'personal');
  const head = plan.founder
    ? `<div class="ch-panel bl-plan founder"><div><span class="c2m-badge founder">★ Founder</span><h2>Every feature, free</h2><p>As the founder you are never limited or charged. Admins you approve pay for premium features like everyone else.</p></div>
       <a class="ch-btn line" href="founder.html?tab=plans">${icon('payments')}Plans & payments in the Founder console</a></div>`
    : `<div class="ch-panel bl-plan"><div><span class="ch-muted">Your plan</span><h2>${escapeHtml(plan.plan_name)} ${plan.plan !== 'free' ? '<span class="c2m-badge plan">Paid</span>' : ''}</h2>
        <p>${personal ? `Active until <b>${escapeHtml(formatDate(personal.ends_at))}</b>. Renew any time: the new period starts when this one ends.` : 'The free plan. Upgrade for unlimited applications, messaging and more.'}</p></div>
        <div class="bl-plan-actions"><a class="ch-btn solid" href="pricing.html">${icon('bolt')}${plan.plan === 'free' ? 'See paid plans' : 'Renew or change plan'}</a></div></div>`;

  const meters = METERS.map(([key, label, when, ico]) => {
    const limit = plan.limits[key];
    const used = plan.usage[key] || 0;
    const share = limit === null || limit === undefined ? 0 : Math.min(100, Math.round(used / Math.max(1, limit) * 100));
    const full = limit !== null && limit !== undefined && used >= limit;
    return `<div class="ch-panel bl-meter${full ? ' is-full' : ''}">
      <div class="bl-meter-top">${icon(ico)}<span>${escapeHtml(label)} <small>${when}</small></span></div>
      <b>${used}<small> / ${limit === null || limit === undefined ? '∞' : limit}</small></b>
      <div class="ch-meter"><i style="width:${limit === null ? 4 : share}%"></i></div>
      ${full ? `<a class="msg-link" href="pricing.html">Limit reached: upgrade</a>` : ''}
    </div>`;
  }).join('');

  const extras = [];
  if (plan.recruiter) extras.push(`<div class="ch-panel bl-extra">${icon('person_search')}<div><b>${escapeHtml(plan.recruiter.name)}</b><p>${plan.recruiter.owner ? 'Your recruiter plan' : 'A seat on a colleague\'s recruiter plan'}${plan.recruiter.ends_at ? `, until ${escapeHtml(formatDate(plan.recruiter.ends_at))}` : ''}.</p></div><a class="ch-btn line small" href="recruiter.html">Open Recruiter search</a></div>`);
  if (plan.sponsor_credits) extras.push(`<div class="ch-panel bl-extra">${icon('emoji_events')}<div><b>${plan.sponsor_credits === null ? 'Unlimited' : plan.sponsor_credits} sponsored challenge${plan.sponsor_credits === 1 ? '' : 's'} left</b><p>Post them from the Opportunities board.</p></div><a class="ch-btn line small" href="board.html">Open the board</a></div>`);

  el('billingBody').innerHTML = `${head}
    ${plan.founder ? '' : `<h3 class="bl-title">This month</h3><div class="bl-meters">${meters}</div>`}
    ${extras.length ? `<h3 class="bl-title">Business plans</h3><div class="bl-extras">${extras.join('')}</div>` : ''}
    ${plan.subscriptions.length ? `<h3 class="bl-title">All your plans</h3><div class="ch-panel bl-table"><table class="ch-table"><thead><tr><th>Plan</th><th>Period</th><th>From</th><th>Until</th><th>Status</th></tr></thead><tbody>
      ${plan.subscriptions.map(s => `<tr><td>${escapeHtml(s.plan_name)}</td><td>${escapeHtml({ month: 'Monthly', year: s.years > 1 ? `${s.years} years` : 'Yearly', one_time: 'One-off', trial: 'Trial' }[s.period] || s.period)}</td><td>${escapeHtml(formatDate(s.starts_at))}</td><td>${escapeHtml(formatDate(s.ends_at))}</td><td>${statusChip(s.status)}</td></tr>`).join('')}
    </tbody></table></div>` : ''}
    <h3 class="bl-title">Payments</h3>
    ${payments.length ? `<div class="ch-panel bl-table"><table class="ch-table"><thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
      ${payments.map(p => `<tr><td>${escapeHtml(formatDate(p.paid_at || p.created_at))}</td><td>${escapeHtml(p.plan_name)}</td><td>${inr(p.amount_paise, true)}</td><td>${statusChip(p.status)}</td>
        <td>${['paid', 'refunded'].includes(p.status) ? `<button class="ch-btn line small" type="button" data-receipt="${p.id}">${icon('receipt_long')}Receipt</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : `<p class="ch-muted">No payments yet.</p>`}
    ${others.length ? '' : ''}
    <p class="bl-small">Questions about a payment? See the <a class="msg-link" href="refund.html">refund &amp; cancellation policy</a>, then write to <a class="msg-link" href="support.html">Support</a> with the receipt number.</p>`;
}

async function showReceipt(id) {
  try {
    const r = await api(`/api/billing/receipt/${id}`);
    openModal({
      title: `Receipt ${r.receipt_no || '#' + r.id}`, confirmText: 'Print', wide: true,
      body: `<div class="bl-receipt" id="receiptBox">
        <div class="bl-receipt-head"><div><b>${escapeHtml(r.business)}</b><small>${r.gstin ? `GSTIN ${escapeHtml(r.gstin)}` : 'GST invoice details pending'}</small></div><div><small>Receipt</small><b>${escapeHtml(r.receipt_no || String(r.id))}</b></div></div>
        <dl class="ap-summary"><dt>Billed to</dt><dd>${escapeHtml(r.customer)}<br><small>${escapeHtml(r.email)}</small></dd><dt>Date</dt><dd>${escapeHtml(formatDate(r.paid_at || r.created_at))}</dd>
        <dt>Plan</dt><dd>${escapeHtml(r.plan_name)} (${escapeHtml(r.period)})</dd><dt>Payment reference</dt><dd>${escapeHtml(r.reference || '—')}</dd></dl>
        <table class="ch-table"><tbody><tr><td>Taxable value</td><td>${inr(r.taxable_paise, true)}</td></tr><tr><td>GST @ ${r.gst_rate}%</td><td>${inr(r.gst_paise, true)}</td></tr><tr><td><b>Total paid</b></td><td><b>${inr(r.amount_paise, true)}</b></td></tr></tbody></table>
        ${r.status === 'refunded' ? '<p class="ch-warn-text">This payment was refunded.</p>' : ''}
      </div>`,
      onConfirm: async () => { document.body.classList.add('printing-receipt'); window.print(); document.body.classList.remove('printing-receipt'); throw new Error(''); }
    });
  } catch (err) { if (err.message) showToast(err.message); }
}

el('billingBody').addEventListener('click', (e) => {
  const receipt = e.target.closest('[data-receipt]');
  if (receipt) showReceipt(Number(receipt.dataset.receipt));
});

bindModal();
loadBilling();
