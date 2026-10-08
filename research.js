// ==========================================
// RESEARCH.JS — The Research Collab page: a background briefing and a reading list for any topic,
// collected from Wikipedia, OpenAlex and Crossref, which can be saved and shared with a team.
// Loaded after shared.js and chat-common.js (api, caches, toast, el, peopleStateBlock).
// ==========================================

const SOURCE_TIMEOUT_MS = 15000;
const SOURCES = { wikipedia: 'Wikipedia', openalex: 'OpenAlex', crossref: 'Crossref' };
const SOURCE_STATES = { loading: 'searching...', ok: 'found', empty: 'nothing found', failed: 'unavailable' };
const SECTIONS_SHOWN = 5;
const SECTION_LENGTH = 1100;
const INTRO_LENGTH = 1800;
const PAPERS_SHOWN = 12;
const SKIPPED_SECTIONS = new Set(['see also', 'references', 'external links', 'notes', 'further reading', 'bibliography', 'citations', 'sources', 'footnotes', 'works cited', 'explanatory notes']);
const DEFAULT_EXAMPLES = ['Federated learning', 'Graph neural networks', 'CRISPR gene editing', 'Swarm robotics', 'Quantum error correction'];

let currentReport = null;         // the report on screen
let currentReportId = null;       // its id when it is one of our saved reports
let savedReports = [];            // { id, topic, created_at }, newest first
let researchSeq = 0;              // a newer search makes older answers irrelevant

// ==========================================
// 1. LOADING
// ==========================================
function initResearch() {
  bindResearchControls();
  renderExamples();
  renderWelcome();

  const cached = cacheGet('research');
  if (cached && Array.isArray(cached.reports)) { savedReports = cached.reports; renderSavedReports(); }
  else el('savedReports').innerHTML = '<div class="skeleton h-9 w-full"></div>'.repeat(3);
  loadSavedReports();

  const params = new URLSearchParams(window.location.search);
  const reportId = parseInt(params.get('report'));
  const topic = (params.get('q') || '').trim();
  if (reportId) openSavedReport(reportId);
  else if (topic) { el('researchQuery').value = topic; runResearch(topic); }
}

async function loadSavedReports() {
  try {
    const data = await fetchPageData('/api/research');
    savedReports = data.reports || [];
    cacheSet('research', { reports: savedReports });
    renderSavedReports();
  } catch (err) {
    if (!savedReports.length) el('savedReports').innerHTML = `<p class="font-body-sm text-body-sm text-error">${escapeHtml(err.message)}</p>`;
  }
}

function setResearchUrl(params) {
  const query = new URLSearchParams(params).toString();
  history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
}

// ==========================================
// 2. SOURCES
// ==========================================
async function fetchSource(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function plainText(html) {
  return new DOMParser().parseFromString(String(html || ''), 'text/html').body.textContent.replace(/\s+/g, ' ').trim();
}

// Cuts at the end of a sentence where it can, so a section never stops mid-word
function shorten(text, limit) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const sentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  return (sentenceEnd > limit * 0.5 ? cut.slice(0, sentenceEnd + 1) : cut.slice(0, cut.lastIndexOf(' ')) + ' ...');
}

function wikiUrl(title) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(String(title).replace(/ /g, '_'))}`;
}

// The article that best matches the topic: its introduction, its main sections and nearby articles
async function fromWikipedia(topic) {
  const endpoint = 'https://en.wikipedia.org/w/api.php?format=json&origin=*&action=query';
  const search = await fetchSource(`${endpoint}&list=search&srlimit=7&srsearch=${encodeURIComponent(topic)}`);
  const hits = (search.query && search.query.search) || [];
  if (!hits.length) return null;

  const page = await fetchSource(`${endpoint}&prop=extracts%7Cdescription&explaintext=1&exsectionformat=wiki&redirects=1&pageids=${hits[0].pageid}`);
  const article = Object.values((page.query && page.query.pages) || {})[0] || {};
  const lines = String(article.extract || '').split('\n');

  let intro = [];
  const sections = [];
  let section = null;
  for (const line of lines) {
    const heading = /^(={2,})\s*(.+?)\s*\1\s*$/.exec(line);
    if (heading) {
      // Only top-level headings start a section; the text under sub-headings stays with its parent
      if (heading[1].length === 2) { section = { heading: heading[2], paragraphs: [] }; sections.push(section); }
      continue;
    }
    const text = line.trim();
    if (!text) continue;
    if (section) section.paragraphs.push(text); else intro.push(text);
  }

  const title = article.title || hits[0].title;
  return {
    title,
    url: wikiUrl(title),
    description: article.description || '',
    summary: shorten(intro.join('\n'), INTRO_LENGTH) || plainText(hits[0].snippet),
    sections: sections
      .filter(part => part.paragraphs.length && !SKIPPED_SECTIONS.has(part.heading.toLowerCase()))
      .slice(0, SECTIONS_SHOWN)
      .map(part => ({ heading: part.heading, text: shorten(part.paragraphs.join('\n'), SECTION_LENGTH) })),
    related: hits.slice(1).map(hit => ({ title: hit.title, url: wikiUrl(hit.title), snippet: plainText(hit.snippet) }))
  };
}

function authorList(names) {
  const clean = names.filter(Boolean);
  if (clean.length <= 3) return clean.join(', ');
  return `${clean.slice(0, 3).join(', ')} et al.`;
}

async function fromOpenAlex(topic) {
  const fields = 'id,display_name,publication_year,cited_by_count,authorships,primary_location,doi,open_access';
  const data = await fetchSource(`https://api.openalex.org/works?per-page=8&select=${fields}&search=${encodeURIComponent(topic)}`);
  return (data.results || []).filter(work => work.display_name).map(work => {
    const location = work.primary_location || {};
    return {
      title: plainText(work.display_name),
      authors: authorList((work.authorships || []).map(entry => entry.author && entry.author.display_name)),
      year: work.publication_year || '',
      venue: (location.source && location.source.display_name) || '',
      cited: work.cited_by_count || 0,
      url: work.doi || location.landing_page_url || work.id || '',
      open: Boolean(work.open_access && work.open_access.is_oa),
      source: 'OpenAlex'
    };
  });
}

async function fromCrossref(topic) {
  const fields = 'DOI,title,author,issued,container-title,is-referenced-by-count,URL';
  const data = await fetchSource(`https://api.crossref.org/works?rows=6&select=${fields}&query=${encodeURIComponent(topic)}`);
  return ((data.message && data.message.items) || []).filter(item => item.title && item.title[0]).map(item => ({
    title: plainText(item.title[0]),
    authors: authorList((item.author || []).map(person => [person.given, person.family].filter(Boolean).join(' '))),
    year: (item.issued && item.issued['date-parts'] && item.issued['date-parts'][0] && item.issued['date-parts'][0][0]) || '',
    venue: (item['container-title'] && item['container-title'][0]) || '',
    cited: item['is-referenced-by-count'] || 0,
    url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : ''),
    open: false,
    source: 'Crossref'
  }));
}

// The same paper often comes back from both indexes
function mergePapers(lists) {
  const seen = new Set();
  const papers = [];
  for (const paper of lists.flat()) {
    const doi = /10\.\d{4,9}\/\S+/i.exec(paper.url || '');
    const titleKey = paper.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const keys = [doi ? doi[0].toLowerCase() : null, titleKey].filter(Boolean);
    if (keys.some(key => seen.has(key))) continue;
    keys.forEach(key => seen.add(key));
    papers.push(paper);
  }
  return papers.slice(0, PAPERS_SHOWN);
}

// ==========================================
// 3. RUNNING A SEARCH
// ==========================================
function setSourceState(key, state) {
  const chip = el('sourceStatus').querySelector(`[data-source="${key}"]`);
  if (!chip) return;
  chip.dataset.state = state;
  chip.querySelector('[data-label]').textContent = `${SOURCES[key]}: ${SOURCE_STATES[state]}`;
}

async function runResearch(rawTopic) {
  const topic = String(rawTopic || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!topic) { el('researchQuery').focus(); return; }
  const seq = ++researchSeq;
  currentReport = null;
  currentReportId = null;
  el('researchGo').disabled = true;
  setResearchUrl({ q: topic });
  renderSavedReports();

  el('sourceStatus').classList.remove('hidden');
  el('sourceStatus').classList.add('flex');
  el('sourceStatus').innerHTML = Object.keys(SOURCES).map(key =>
    `<span class="source-chip" data-source="${key}" data-state="loading"><span class="dot"></span><span data-label>${SOURCES[key]}: ${SOURCE_STATES.loading}</span></span>`).join('');
  renderReportSkeleton();

  // The three sources are asked side by side; one failing never stops the others
  const states = {};
  const ask = async (key, work, isEmpty) => {
    try {
      const result = await work(topic);
      states[key] = isEmpty(result) ? 'empty' : 'ok';
      if (seq === researchSeq) setSourceState(key, states[key]);
      return result;
    } catch (err) {
      states[key] = 'failed';
      if (seq === researchSeq) setSourceState(key, 'failed');
      return null;
    }
  };
  const [wikipedia, openalex, crossref] = await Promise.all([
    ask('wikipedia', fromWikipedia, result => !result),
    ask('openalex', fromOpenAlex, result => !result.length),
    ask('crossref', fromCrossref, result => !result.length)
  ]);
  if (seq !== researchSeq) return;   // a newer search has started

  el('researchGo').disabled = false;
  const papers = mergePapers([openalex || [], crossref || []]);
  if (!wikipedia && !papers.length) {
    const allFailed = Object.values(states).every(state => state === 'failed');
    el('researchReport').innerHTML = peopleStateBlock(allFailed ? 'cloud_off' : 'search_off',
      allFailed ? 'The sources could not be reached' : 'Nothing found for that topic',
      allFailed ? 'Wikipedia, OpenAlex and Crossref did not answer. Check your connection and try again.' : 'Try the name of a method, technology or field rather than a full question.',
      allFailed ? '<button type="button" data-action="retry" class="btn-primary-modal">Try again</button>' : '');
    return;
  }

  currentReport = { topic, generated_at: new Date().toISOString(), wikipedia, papers, sources: states };
  renderReport();
}

// ==========================================
// 4. RENDERING
// ==========================================
function renderExamples() {
  const me = window.currentUserProfile || cacheGet('me') || {};
  const mine = String(me.skills || '').split(',').map(skill => skill.trim()).filter(Boolean).slice(0, 5);
  const topics = mine.length >= 3 ? mine : DEFAULT_EXAMPLES;
  el('researchExamples').innerHTML =
    `<span class="font-label-sm text-label-sm uppercase tracking-wider text-outline mr-space-2xs">${mine.length >= 3 ? 'From your skills:' : 'Try:'}</span>` +
    topics.map(topic => `<button type="button" data-topic="${escapeHtml(topic)}" class="px-space-sm py-1 rounded-full font-skill-pill text-skill-pill bg-surface-container-lowest hover:bg-surface-container text-on-surface-variant border border-outline-variant/30 transition-colors">${escapeHtml(topic)}</button>`).join('');
}

function renderWelcome() {
  el('sourceStatus').classList.add('hidden');
  el('sourceStatus').classList.remove('flex');
  el('researchReport').innerHTML = peopleStateBlock('menu_book', 'Your briefing will appear here',
    'Search a topic above. You get a plain-language background, the main sub-topics and a reading list of papers, each linked to where it came from.', '');
}

function renderReportSkeleton() {
  el('researchReport').innerHTML = `
    <div class="skeleton h-7 w-2/3 mb-space-md"></div>
    <div class="skeleton h-4 w-full mb-2"></div><div class="skeleton h-4 w-full mb-2"></div><div class="skeleton h-4 w-4/5 mb-space-lg"></div>
    <div class="skeleton h-5 w-1/3 mb-space-sm"></div>
    <div class="skeleton h-4 w-full mb-2"></div><div class="skeleton h-4 w-3/4"></div>`;
}

function paragraphsHtml(text) {
  return String(text || '').split('\n').filter(Boolean).map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('');
}

function externalLink(url, label, classes) {
  const safe = safeUrl(url);
  if (safe === '#') return escapeHtml(label);
  return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener" class="${classes || 'text-primary hover:underline'}">${escapeHtml(label)}</a>`;
}

function renderReport() {
  const report = currentReport;
  if (!report) return;
  const wiki = report.wikipedia;
  const papers = report.papers || [];
  const made = new Date(report.generated_at);
  const saved = currentReportId !== null;
  const actionClass = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md transition-colors';

  let html = `
    <div class="flex flex-col md:flex-row md:items-start justify-between gap-space-sm mb-space-md">
      <div class="min-w-0">
        <h2 class="font-headline-lg text-headline-lg font-bold text-on-surface break-words">${escapeHtml(wiki ? wiki.title : report.topic)}</h2>
        <p class="font-body-sm text-body-sm text-on-surface-variant mt-1">
          ${wiki && wiki.description ? `${escapeHtml(wiki.description)} · ` : ''}Searched for "${escapeHtml(report.topic)}"${isNaN(made) ? '' : ` on ${escapeHtml(made.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }))}`}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2 shrink-0 no-print">
        <button type="button" data-action="save" ${saved ? 'disabled' : ''} class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg font-label-md text-label-md transition-colors ${saved ? 'bg-primary-fixed text-on-primary-fixed-variant' : 'bg-primary hover:bg-primary-container text-on-primary'}">
          <span class="material-symbols-outlined text-[16px]">${saved ? 'bookmark_added' : 'bookmark_add'}</span>${saved ? 'Saved' : 'Save'}
        </button>
        <button type="button" data-action="share" class="${actionClass}"><span class="material-symbols-outlined text-[16px]">groups</span>Share to team</button>
        <button type="button" data-action="copy" class="${actionClass}"><span class="material-symbols-outlined text-[16px]">content_copy</span>Copy</button>
        <button type="button" data-action="print" class="${actionClass}"><span class="material-symbols-outlined text-[16px]">print</span>Print / PDF</button>
      </div>
    </div>`;

  if (wiki) {
    html += `
      <section class="mb-space-lg">
        <h3 class="font-headline-sm text-headline-sm text-primary mb-space-xs flex items-center gap-1.5"><span class="material-symbols-outlined text-[18px]">info</span>Background</h3>
        <div class="report-text">${paragraphsHtml(wiki.summary)}</div>
      </section>`;
    for (const section of wiki.sections || []) {
      html += `
        <section class="mb-space-lg">
          <h3 class="font-headline-sm text-headline-sm text-on-surface mb-space-xs">${escapeHtml(section.heading)}</h3>
          <div class="report-text">${paragraphsHtml(section.text)}</div>
        </section>`;
    }
    html += `<p class="font-body-sm text-body-sm text-on-surface-variant mb-space-lg">Background text from ${externalLink(wiki.url, `Wikipedia: ${wiki.title}`)}, shortened. Licensed CC BY-SA 4.0.</p>`;
  } else {
    html += `<p class="font-body-md text-body-md text-on-surface-variant mb-space-lg">Wikipedia has no article that matches this topic, so there is no background section. The papers below are still a good place to start.</p>`;
  }

  html += `<section class="mb-space-lg"><h3 class="font-headline-sm text-headline-sm text-primary mb-space-sm flex items-center gap-1.5"><span class="material-symbols-outlined text-[18px]">article</span>Reading list${papers.length ? ` (${papers.length})` : ''}</h3>`;
  if (papers.length) {
    html += '<ol class="flex flex-col gap-space-sm">' + papers.map((paper, index) => {
      const facts = [paper.authors, paper.venue, paper.year].filter(Boolean).map(value => escapeHtml(String(value))).join(' · ');
      return `
        <li class="flex gap-3">
          <span class="font-label-md text-label-md text-outline w-6 shrink-0 text-right mt-0.5">${index + 1}.</span>
          <div class="min-w-0">
            <p class="font-body-md text-body-md font-semibold text-on-surface break-words">${externalLink(paper.url, paper.title, 'hover:text-primary hover:underline')}</p>
            ${facts ? `<p class="font-body-sm text-body-sm text-on-surface-variant break-words">${facts}</p>` : ''}
            <p class="font-body-sm text-body-sm text-outline flex flex-wrap items-center gap-x-2">
              <span>${paper.cited} ${paper.cited === 1 ? 'citation' : 'citations'}</span>
              ${paper.open ? '<span class="text-emerald-700 font-semibold">Open access</span>' : ''}
              <span>via ${escapeHtml(paper.source)}</span>
            </p>
          </div>
        </li>`;
    }).join('') + '</ol>';
  } else {
    html += '<p class="font-body-md text-body-md text-on-surface-variant">No papers were found for this topic.</p>';
  }
  html += '</section>';

  if (wiki && wiki.related && wiki.related.length) {
    html += `
      <section class="mb-space-lg no-print">
        <h3 class="font-headline-sm text-headline-sm text-on-surface mb-space-xs">Related topics</h3>
        <div class="flex flex-wrap gap-space-xs">${wiki.related.map(item =>
          `<button type="button" data-topic="${escapeHtml(item.title)}" title="${escapeHtml(item.snippet)}" class="px-space-sm py-1 rounded-full font-skill-pill text-skill-pill bg-surface-container hover:bg-surface-container-high text-on-surface transition-colors">${escapeHtml(item.title)}</button>`).join('')}</div>
      </section>`;
  }

  const missing = Object.keys(SOURCES).filter(key => report.sources && report.sources[key] === 'failed').map(key => SOURCES[key]);
  html += `
    <p class="font-body-sm text-body-sm text-on-surface-variant border-t border-outline-variant/30 pt-space-sm flex items-start gap-2">
      <span class="material-symbols-outlined text-[16px] mt-0.5 shrink-0">warning</span>
      <span>This page collects what the sources say; nobody has checked it. Open the links and read the originals before you cite anything.${missing.length ? ` ${missing.join(' and ')} could not be reached, so some results may be missing.` : ''}</span>
    </p>`;

  el('researchReport').innerHTML = html;
}

function renderSavedReports() {
  el('savedReportCount').textContent = savedReports.length ? String(savedReports.length) : '';
  if (!savedReports.length) {
    el('savedReports').innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant py-2">Nothing saved yet. Reports you save are kept here, visible only to you.</p>';
    return;
  }
  el('savedReports').innerHTML = savedReports.map(report => `
    <div class="saved-report group flex items-center gap-1 rounded-lg hover:bg-surface-container-low transition-colors" aria-current="${report.id === currentReportId}">
      <button type="button" data-open="${report.id}" class="flex-1 min-w-0 text-left px-2 py-2">
        <span class="block font-label-md text-label-md text-on-surface truncate">${escapeHtml(report.topic)}</span>
        <span class="block font-body-sm text-body-sm text-outline">${escapeHtml(timeAgo(report.created_at))}</span>
      </button>
      <button type="button" data-delete="${report.id}" title="Delete this report" aria-label="Delete ${escapeHtml(report.topic)}" class="p-1.5 mr-1 rounded text-outline hover:text-error opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity">
        <span class="material-symbols-outlined text-[18px] block">delete</span>
      </button>
    </div>`).join('');
}

// ==========================================
// 5. SAVED REPORTS
// ==========================================
async function openSavedReport(reportId) {
  const seq = ++researchSeq;
  el('researchGo').disabled = false;
  el('sourceStatus').classList.add('hidden');
  el('sourceStatus').classList.remove('flex');
  renderReportSkeleton();
  try {
    const data = await api(`/api/research/${reportId}`);
    if (seq !== researchSeq) return;
    currentReport = Object.assign({ topic: data.topic, generated_at: data.created_at, papers: [], sources: {} }, data.content);
    currentReportId = data.id;
    el('researchQuery').value = currentReport.topic;
    setResearchUrl({ report: data.id });
    renderReport();
    renderSavedReports();
  } catch (err) {
    if (seq !== researchSeq) return;
    currentReport = null;
    currentReportId = null;
    setResearchUrl({});
    el('researchReport').innerHTML = peopleStateBlock('error', 'Could not open that report', err.message, '');
    if (err.status === 404) { savedReports = savedReports.filter(report => report.id !== reportId); renderSavedReports(); }
  }
}

async function saveCurrentReport() {
  if (!currentReport || currentReportId !== null) return;
  const report = currentReport;
  try {
    const saved = await api('/api/research', { method: 'POST', body: { topic: report.wikipedia ? report.wikipedia.title : report.topic, content: report } });
    savedReports.unshift({ id: saved.id, topic: saved.topic, created_at: saved.created_at });
    cacheSet('research', { reports: savedReports });
    if (currentReport === report) {
      currentReportId = saved.id;
      setResearchUrl({ report: saved.id });
      renderReport();
    }
    renderSavedReports();
    showToast('Report saved.');
  } catch (err) {
    showToast(err.message);
  }
}

function deleteSavedReport(reportId) {
  const report = savedReports.find(item => item.id === reportId);
  if (!report) return;
  window.showSystemModal('Delete report', `Delete your saved report on "${escapeHtml(report.topic)}"? This cannot be undone.`, 'confirm', async () => {
    try {
      await api(`/api/research/${reportId}`, { method: 'DELETE' });
      savedReports = savedReports.filter(item => item.id !== reportId);
      cacheSet('research', { reports: savedReports });
      if (currentReportId === reportId) {
        // The report stays on screen, as an unsaved one that can be saved again
        currentReportId = null;
        setResearchUrl({ q: currentReport.topic });
        renderReport();
      }
      renderSavedReports();
      showToast('Report deleted.');
    } catch (err) {
      showToast(err.message);
    }
  }, 'Delete');
}

// ==========================================
// 6. COPY AND SHARE
// ==========================================
function reportAsText(report, short) {
  const wiki = report.wikipedia;
  const lines = [`Research briefing: ${wiki ? wiki.title : report.topic}`, ''];
  if (wiki) {
    lines.push(short ? shorten(wiki.summary.split('\n')[0], 500) : wiki.summary, '');
    if (!short) (wiki.sections || []).forEach(section => lines.push(section.heading.toUpperCase(), section.text, ''));
    lines.push(`Background: ${wiki.url}`, '');
  }
  const papers = (report.papers || []).slice(0, short ? 5 : PAPERS_SHOWN);
  if (papers.length) {
    lines.push(short ? 'Top papers:' : 'READING LIST');
    papers.forEach((paper, index) => {
      const facts = [paper.authors, paper.venue, paper.year].filter(Boolean).join(', ');
      lines.push(`${index + 1}. ${paper.title}${facts ? ` (${facts})` : ''}`, `   ${paper.url}`);
    });
  }
  return lines.join('\n').trim();
}

async function shareReportToTeam() {
  if (!currentReport) return;
  const report = currentReport;
  let teams;
  try {
    teams = await api('/api/teams');
  } catch (err) {
    return showToast(err.message);
  }
  if (!teams.length) {
    return window.showSystemModal('Share to team', 'You are not in a team yet. Create or join one on the My Teams page first.', 'alert');
  }
  const form = `
    <span class="block text-left">
      <label class="block text-sm font-medium text-on-surface-variant mb-1" for="shareTeamSelect">Post a summary with the top papers to</label>
      <select id="shareTeamSelect" class="w-full bg-surface-container-low border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary">
        ${teams.map(team => `<option value="${team.id}">${escapeHtml(team.name)}</option>`).join('')}
      </select>
      <span class="block text-xs text-on-surface-variant mt-2">It goes to the team's first text channel, as a message from you.</span>
    </span>`;
  window.showSystemModal('Share to team', form, 'confirm', async () => {
    const teamId = el('shareTeamSelect').value;
    try {
      const channels = await api(`/api/teams/${teamId}/channels`);
      const channel = channels.find(item => item.channel_type === 'text') || channels[0];
      if (!channel) throw new ApiError(0, 'That team has no channel to post in.');
      await api(`/api/channels/${channel.id}/messages`, { method: 'POST', body: { content: reportAsText(report, true).slice(0, 4500) } });
      showToast(`Shared in #${channel.name}.`);
    } catch (err) {
      showToast(err.message);
    }
  }, 'Share');
}

// ==========================================
// 7. CONTROLS
// ==========================================
function bindResearchControls() {
  el('researchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    runResearch(el('researchQuery').value);
  });

  const startTopic = (e) => {
    const chip = e.target.closest('[data-topic]');
    if (!chip) return false;
    el('researchQuery').value = chip.dataset.topic;
    runResearch(chip.dataset.topic);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return true;
  };
  el('researchExamples').addEventListener('click', startTopic);

  el('researchReport').addEventListener('click', (e) => {
    if (startTopic(e)) return;
    const button = e.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'retry') runResearch(el('researchQuery').value);
    if (action === 'save') saveCurrentReport();
    if (action === 'share') shareReportToTeam();
    if (action === 'copy' && currentReport) copyText(reportAsText(currentReport, false), 'Report copied as text.');
    if (action === 'print') window.print();
  });

  el('savedReports').addEventListener('click', (e) => {
    const remove = e.target.closest('[data-delete]');
    if (remove) return deleteSavedReport(parseInt(remove.dataset.delete));
    const open = e.target.closest('[data-open]');
    if (open) openSavedReport(parseInt(open.dataset.open));
  });

  window.addEventListener('beforeprint', () => {
    if (currentReport) document.title = `Research briefing - ${currentReport.wikipedia ? currentReport.wikipedia.title : currentReport.topic}`;
  });
  window.addEventListener('afterprint', () => { document.title = 'ProPartner | Research Collab'; });
}

initResearch();
