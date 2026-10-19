// ==========================================
// EVENT-PRINT.JS — printable sheets (event-print.html). The browser's print dialog makes the PDF, like the resume builder.
//   ?id=ID&type=poster          A4 poster with a QR code to the event page (for notice boards)
//   ?id=ID&type=attendance      the sign-in sheet: the backup when the scanner cannot be used
//   ?id=ID&type=certificates    every certificate of the event (organisers)
//   ?cert=ID                    one of my own certificates
// ==========================================

const pr = { id: Number(evParam('id')), type: evParam('type') || 'poster', cert: Number(evParam('cert')) };

async function initPrint() {
  try {
    if (pr.cert) await printCertificate();
    else if (pr.type === 'attendance') await printAttendance();
    else if (pr.type === 'certificates') await printAllCertificates();
    else await printPoster();
  } catch (err) {
    el('prRoot').innerHTML = evEmptyHtml('print_disabled', 'Nothing to print', err.message, '<a class="ev-btn is-quiet" href="my-events.html">My events</a>');
    return;
  }
  el('prTools').innerHTML = `<button type="button" class="ev-btn" onclick="window.print()">${evIcon('print')}Print or save as PDF</button>
    ${pr.id ? `<a class="ev-btn is-quiet" href="event-manage.html?id=${pr.id}">${evIcon('arrow_back')}Back to the dashboard</a>` : `<a class="ev-btn is-quiet" href="my-events.html?tab=certificates">${evIcon('arrow_back')}My certificates</a>`}`;
}

async function printPoster() {
  const ev = await api(`/api/events/${pr.id}`);
  const link = ev.visibility === 'link' && ev.invite_code ? `${ev.page_url}&code=${ev.invite_code}` : ev.share_url;
  document.title = `Poster · ${ev.title}`;
  el('prRoot').innerHTML = `<article class="pr-sheet pr-a4 pr-poster">
    ${ev.poster_url ? `<img class="pr-img" src="${escapeHtml(safeUrl(ev.poster_url))}" alt="">` : ''}
    <div class="pr-kind">${escapeHtml(ev.kind_label)}</div><h1>${escapeHtml(ev.title)}</h1>${ev.tagline ? `<p class="pr-tag">${escapeHtml(ev.tagline)}</p>` : ''}
    <div class="pr-facts">${escapeHtml(evRange(ev.start_at, ev.end_at))}<br>${escapeHtml(ev.mode === 'online' ? 'Online' : [ev.venue, ev.room].filter(Boolean).join(', '))}</div>
    <div class="pr-qr" id="prQr"></div><div class="pr-scan">Scan to register · Free</div>
    <p class="pr-tag">By ${escapeHtml(ev.host.name)}${ev.college_name ? ` · ${escapeHtml(ev.college_name)}` : ''}</p>
    <div class="pr-foot">${escapeHtml(link)} · Connect2Minds</div></article>`;
  await evDrawQr(el('prQr'), link, 600);
}

async function printAttendance() {
  const [ev, data] = await Promise.all([api(`/api/events/${pr.id}`), api(`/api/events/${pr.id}/registrations?status=confirmed`)]);
  const rows = data.registrations.slice().sort((a, b) => a.name.localeCompare(b.name));
  const roll = (ev.collect_fields || []).includes('roll_no');
  document.title = `Attendance · ${ev.title}`;
  const pages = [];
  for (let i = 0; i < Math.max(rows.length, 1); i += 28) pages.push(rows.slice(i, i + 28));
  el('prRoot').innerHTML = pages.map((page, p) => `<article class="pr-sheet pr-a4 pr-att"><h1>${escapeHtml(ev.title)}</h1>
    <p>${escapeHtml(evRange(ev.start_at, ev.end_at))} · ${escapeHtml(ev.venue || 'Online')} · Attendance sheet, page ${p + 1} of ${pages.length} · ${rows.length} registered</p>
    <table><thead><tr><th>#</th><th>Name</th>${roll ? '<th>Roll no.</th>' : ''}<th>Department</th><th>Signature</th></tr></thead><tbody>
    ${page.map((r, i) => `<tr><td class="pr-n">${p * 28 + i + 1}</td><td>${escapeHtml(r.name)}</td>${roll ? `<td>${escapeHtml((r.profile || {}).roll_no || '')}</td>` : ''}<td>${escapeHtml((r.profile || {}).department || r.department || '')}</td><td class="pr-sign">${r.checked_in_at ? '✓ scanned' : ''}</td></tr>`).join('')}
    ${!page.length ? '<tr><td colspan="5">Nobody is registered yet.</td></tr>' : ''}</tbody></table>
    <div class="pr-foot">Mark people who signed here as checked in on the event dashboard afterwards.</div></article>`).join('');
}

function certificateHtml(c, extra) {
  const kinds = { participation: 'Certificate of Participation', winner: 'Certificate of Achievement', volunteer: 'Certificate of Appreciation', speaker: 'Certificate of Appreciation', organiser: 'Certificate of Appreciation' };
  const verb = { participation: 'took part in', winner: 'won at', volunteer: 'volunteered at', speaker: 'spoke at', organiser: 'organised' }[c.kind] || 'took part in';
  return `<article class="pr-sheet pr-a4-land pr-cert"><div class="pr-cert-frame">
    <div class="pr-brand">CONNECT2MINDS</div><h1>${escapeHtml(kinds[c.kind] || 'Certificate')}</h1>
    <p class="pr-lead">This is to certify that</p><div class="pr-name">${escapeHtml(c.holder_name)}</div>
    <p class="pr-for">${verb} <b>${escapeHtml(c.event_title)}</b>, held on ${escapeHtml(evDay(c.event_date, { year: 'numeric', weekday: undefined }))}${extra.host ? `, organised by <b>${escapeHtml(extra.host)}</b>` : ''}${extra.college ? ` at ${escapeHtml(extra.college)}` : ''}.</p>
    ${c.revoked ? '<p class="pr-for" style="color:#ba1a1a;font-weight:700">This certificate has been revoked.</p>' : ''}
    <div class="pr-bottom"><div class="pr-sigline">${escapeHtml(extra.organiser || extra.host || 'Organiser')}<br><span style="font-weight:400">Organiser</span></div>
      <div class="pr-verify"><div data-qr="${escapeHtml(c.verify_url)}"></div><div>Check this certificate at<br>${escapeHtml(c.verify_url.split('?')[0])}<br><span class="pr-code">${escapeHtml(c.code)}</span></div></div></div>
    <div class="pr-foot" style="bottom:4mm">Powered by Connect2Minds</div></div></article>`;
}

async function drawCertificateQrs() {
  for (const box of document.querySelectorAll('[data-qr]')) await evDrawQr(box, box.dataset.qr, 300);
}

async function printCertificate() {
  const c = await api(`/api/me/certificates/${pr.cert}`);
  document.title = `Certificate · ${c.event_title}`;
  el('prRoot').innerHTML = certificateHtml(c, { host: c.host, college: c.college_name, organiser: c.organiser });
  await drawCertificateQrs();
}

async function printAllCertificates() {
  const [ev, data] = await Promise.all([api(`/api/events/${pr.id}`), api(`/api/events/${pr.id}/certificates`)]);
  const valid = data.certificates.filter(c => !c.revoked);
  if (!valid.length) throw new Error('No certificates have been issued for this event yet.');
  document.title = `Certificates · ${ev.title}`;
  el('prRoot').innerHTML = valid.map(c => certificateHtml(c, { host: ev.host.name, college: ev.college_name })).join('');
  await drawCertificateQrs();
}

initPrint();
