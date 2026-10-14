// ==========================================
// RESUME.JS — The resume builder: an editor on one side, the finished page on the other.
// The first draft is filled from the profile, projects and (if wanted) the CGPA from My Study. Changes save by themselves.
// "Download PDF" prints the page; resume.css hides everything but the resume when printing.
// Loaded after shared.js, chat-common.js and formsheet.js.
// ==========================================

const PAPER_WIDTH = 794;          // an A4 page at 96 dots per inch
const PAPER_HEIGHT = 1123;
const SAVE_DELAY_MS = 1200;
const RESUME_LISTS = {
  education: { one: 'education', title: (e) => e.degree || e.school, sub: (e) => [e.school, e.years, e.score].filter(Boolean).join(' · '),
    fields: (e) => [
      { name: 'degree', label: 'Degree or course', value: e.degree, required: true, maxlength: 140, placeholder: 'B.E. Computer Engineering' },
      { name: 'school', label: 'College or school', value: e.school, maxlength: 140 },
      { name: 'years', label: 'Years', value: e.years, maxlength: 40, placeholder: '2023 – 2027', half: true },
      { name: 'score', label: 'Score', value: e.score, maxlength: 40, placeholder: 'CGPA 8.4 / 10', half: true }] },
  projects: { one: 'project', title: (e) => e.title, sub: (e) => e.tech,
    fields: (e) => [
      { name: 'title', label: 'Project name', value: e.title, required: true, maxlength: 120 },
      { name: 'tech', label: 'Built with', value: e.tech, maxlength: 160, placeholder: 'Python, FastAPI, PostgreSQL' },
      { name: 'description', label: 'What it does and what you did', type: 'textarea', value: e.description, maxlength: 500 },
      { name: 'link', label: 'Link', value: e.link, maxlength: 300, placeholder: 'https://github.com/you/project' }] },
  experience: { one: 'experience', title: (e) => e.role, sub: (e) => [e.org, e.years].filter(Boolean).join(' · '),
    fields: (e) => [
      { name: 'role', label: 'Role', value: e.role, required: true, maxlength: 120, placeholder: 'Web development intern' },
      { name: 'org', label: 'Company, club or team', value: e.org, maxlength: 140 },
      { name: 'years', label: 'When', value: e.years, maxlength: 40, placeholder: 'Jun – Aug 2026' },
      { name: 'description', label: 'What you did', type: 'textarea', value: e.description, maxlength: 500 }] },
  links: { one: 'link', title: (e) => e.label || e.url, sub: (e) => e.label ? e.url : '',
    fields: (e) => [
      { name: 'label', label: 'Name', value: e.label, maxlength: 40, placeholder: 'GitHub', half: true },
      { name: 'url', label: 'Address', value: e.url, required: true, maxlength: 300, placeholder: 'https://github.com/you', half: true }] }
};
const LIST_LIMITS = { education: 6, projects: 8, experience: 8, links: 6 };

let resume = null;                // the resume being edited
let resumeSource = null;          // { profile, projects, cgpa } from the server
let saveTimer = null;
let saving = false;
let saveAgain = false;
let mobilePane = 'edit';

const icon = (name) => `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;

// ==========================================
// 1. LOADING AND SAVING
// ==========================================
async function initResume() {
  bindResume();
  try {
    const data = await fetchPageData('/api/resume');
    resumeSource = { profile: data.profile, projects: data.projects, cgpa: data.cgpa };
    resume = data.saved ? { ...draftFromProfile(), ...data.saved } : draftFromProfile();
    setStatus(data.saved ? 'Saved' : 'Filled from your profile');
    renderEditor();
    renderPaper();
  } catch (err) {
    el('resumeEditor').innerHTML = `<div class="hm-card hm-problem">${icon('cloud_off')}<p>${escapeHtml(err.message)}</p><button class="hm-btn" type="button" data-act="reload">Try again</button></div>`;
  }
}

// A first draft from what the profile already says
function draftFromProfile() {
  const profile = resumeSource.profile;
  const student = !profile.profession || profile.profession === 'Student';
  const links = [];
  if (profile.github_username) links.push({ label: 'GitHub', url: `https://github.com/${profile.github_username}` });
  if (/^https?:\/\//i.test(profile.portfolio_link || '')) links.push({ label: 'Portfolio', url: profile.portfolio_link });
  return {
    template: 'classic', show_cgpa: false,
    name: profile.name, email: profile.email, phone: '', city: profile.city,
    headline: student ? [profile.department, profile.department ? 'student' : ''].filter(Boolean).join(' ') : profile.profession,
    summary: profile.bio,
    education: profile.college_name ? [{ school: profile.college_name, degree: profile.department, years: '', score: '' }] : [],
    skills: String(profile.skills || '').split(',').map(skill => skill.trim()).filter(Boolean).slice(0, 40),
    projects: resumeSource.projects.slice(0, 4).map(project => ({
      title: project.title, tech: project.tech_stack, description: String(project.description || '').slice(0, 500),
      link: /^https?:\/\//i.test(project.live_link || '') ? project.live_link : (/^https?:\/\//i.test(project.github_link || '') ? project.github_link : '') })),
    experience: [], achievements: [], links
  };
}

function setStatus(text, problem) {
  const status = el('resumeStatus');
  status.textContent = text;
  status.classList.toggle('is-problem', Boolean(problem));
}

// Every change redraws the page at once and is saved a moment later
function changed() {
  renderPaper();
  setStatus('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveResume, SAVE_DELAY_MS);
}

async function saveResume() {
  if (saving) { saveAgain = true; return; }
  saving = true;
  clearTimeout(saveTimer);
  try {
    await api('/api/resume', { method: 'PUT', body: { data: resume } });
    setStatus('Saved');
  } catch (err) {
    setStatus(`Not saved: ${err.message}`, true);
  }
  saving = false;
  if (saveAgain) { saveAgain = false; saveResume(); }
}

// ==========================================
// 2. THE EDITOR
// ==========================================
function listCardHtml(key, heading, hint) {
  const config = RESUME_LISTS[key];
  const rows = resume[key].map((entry, index) => `
    <button type="button" class="rs-item" data-act="edit-item" data-list="${key}" data-index="${index}">
      <span><strong>${escapeHtml(config.title(entry) || 'Untitled')}</strong>${config.sub(entry) ? `<small>${escapeHtml(config.sub(entry))}</small>` : ''}</span>${icon('edit')}</button>`).join('');
  return `
    <section class="hm-card"><div class="hm-head"><h2>${heading}</h2>
      <button class="hm-btn is-quiet" type="button" data-act="add-item" data-list="${key}">${icon('add')}Add</button></div>
      ${rows || `<p class="hm-note">${hint}</p>`}</section>`;
}

function renderEditor() {
  const field = (name, label, placeholder, half) => `
    <label class="rs-field${half ? ' is-half' : ''}">${label}<input type="text" data-field="${name}" value="${escapeHtml(resume[name] || '')}" placeholder="${escapeHtml(placeholder || '')}" autocomplete="off"/></label>`;
  const cgpa = resumeSource.cgpa;
  el('resumeEditor').innerHTML = `
    <section class="hm-card"><div class="hm-head"><h2>About you</h2></div>
      <div class="rs-fields">
        ${field('name', 'Full name', '', false)}
        ${field('headline', 'One line about you', 'Computer Engineering student')}
        ${field('email', 'Email', 'you@example.com', true)}${field('phone', 'Phone', '+91 98765 43210', true)}
        ${field('city', 'City', 'Pune')}
        <label class="rs-field">Summary<textarea data-field="summary" rows="3" maxlength="700" placeholder="Two or three lines: what you are good at and what you are looking for.">${escapeHtml(resume.summary || '')}</textarea></label>
      </div></section>
    ${listCardHtml('education', 'Education', 'Add your degree and your college.')}
    ${cgpa ? `<label class="rs-check"><input type="checkbox" data-check="show_cgpa" ${resume.show_cgpa ? 'checked' : ''}/>Show my CGPA from My Study (${cgpa.toFixed(2)})</label>` : ''}
    <section class="hm-card"><div class="hm-head"><h2>Skills</h2></div>
      <label class="rs-field">Separate them with commas<input type="text" data-words="skills" value="${escapeHtml(resume.skills.join(', '))}" placeholder="Python, SQL, React" autocomplete="off"/></label></section>
    ${listCardHtml('projects', 'Projects', 'Projects say more than marks. Add two or three you can talk about.')}
    ${listCardHtml('experience', 'Experience', 'Internships, part-time work, club roles, freelance jobs.')}
    <section class="hm-card"><div class="hm-head"><h2>Achievements</h2></div>
      <label class="rs-field">One on each line<textarea data-lines="achievements" rows="3" placeholder="Winner, Smart India Hackathon 2026&#10;Published a paper on ...">${escapeHtml(resume.achievements.join('\n'))}</textarea></label></section>
    ${listCardHtml('links', 'Links', 'GitHub, LinkedIn, your portfolio.')}
    <section class="hm-card"><p class="hm-note">Want a clean start? This replaces what is here with a fresh draft from your profile.</p>
      <div class="st-row-actions"><button class="hm-btn is-quiet st-danger" type="button" data-act="restart">Start again from my profile</button></div></section>`;
}

function openItem(key, index) {
  const config = RESUME_LISTS[key];
  const isNew = index === null;
  if (isNew && resume[key].length >= LIST_LIMITS[key]) return showToast(`A resume holds up to ${LIST_LIMITS[key]} of these.`);
  const entry = isNew ? {} : resume[key][index];
  openSheet({
    title: `${isNew ? 'Add' : 'Edit'} ${config.one}`, fields: config.fields(entry), submitLabel: isNew ? 'Add' : 'Save',
    onSubmit: (values) => {
      const link = values.url !== undefined ? values.url : values.link;
      if (link && !/^https?:\/\//i.test(link)) throw new Error('A link starts with http:// or https://');
      if (isNew) resume[key].push(values); else resume[key][index] = values;
      renderEditor();
      changed();
    },
    onDelete: isNew ? null : () => { resume[key].splice(index, 1); renderEditor(); changed(); }
  });
}

// ==========================================
// 3. THE PAGE
// ==========================================
function paperHtml() {
  const r = resume;
  const text = (value) => escapeHtml(value || '');
  const block = (title, body) => body ? `<section><h2>${title}</h2>${body}</section>` : '';
  const linkText = (url) => text(String(url).replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''));
  const contact = [r.email, r.phone, r.city].filter(Boolean).map(text);
  const links = r.links.map(link => `<a href="${escapeHtml(safeUrl(link.url))}">${link.label ? `${text(link.label)}: ` : ''}${linkText(link.url)}</a>`);
  const cgpa = r.show_cgpa && resumeSource.cgpa ? `<p class="rs-cgpa">CGPA: ${resumeSource.cgpa.toFixed(2)} / 10</p>` : '';

  const education = r.education.map(entry => `
    <div class="rs-entry"><div class="rs-entry-top"><strong>${text(entry.degree || entry.school)}</strong><span>${text(entry.years)}</span></div>
      <p>${[entry.degree ? entry.school : '', entry.score].filter(Boolean).map(text).join(' · ')}</p></div>`).join('') + cgpa;
  const projects = r.projects.map(entry => `
    <div class="rs-entry"><div class="rs-entry-top"><strong>${text(entry.title)}</strong>${entry.link ? `<a href="${escapeHtml(safeUrl(entry.link))}">${linkText(entry.link)}</a>` : ''}</div>
      ${entry.tech ? `<p class="rs-tech">${text(entry.tech)}</p>` : ''}${entry.description ? `<p>${text(entry.description)}</p>` : ''}</div>`).join('');
  const experience = r.experience.map(entry => `
    <div class="rs-entry"><div class="rs-entry-top"><strong>${text(entry.role)}${entry.org ? `, ${text(entry.org)}` : ''}</strong><span>${text(entry.years)}</span></div>
      ${entry.description ? `<p>${text(entry.description)}</p>` : ''}</div>`).join('');
  const skills = r.skills.length ? `<ul class="rs-skills">${r.skills.map(skill => `<li>${text(skill)}</li>`).join('')}</ul>` : '';
  const achievements = r.achievements.length ? `<ul class="rs-bullets">${r.achievements.map(line => `<li>${text(line)}</li>`).join('')}</ul>` : '';
  const head = `<header><h1>${text(r.name) || 'Your name'}</h1>${r.headline ? `<p class="rs-headline">${text(r.headline)}</p>` : ''}</header>`;

  if (r.template === 'modern') {
    return `${head}
      <div class="rs-columns">
        <aside>${block('Contact', [...contact, ...links].map(line => `<p>${line}</p>`).join(''))}${block('Skills', skills)}${block('Achievements', achievements)}</aside>
        <div>${block('Summary', r.summary ? `<p>${text(r.summary)}</p>` : '')}${block('Education', education)}${block('Projects', projects)}${block('Experience', experience)}</div>
      </div>`;
  }
  return `${head.replace('</header>', `<p class="rs-contact">${[...contact, ...links].join('<i>·</i>')}</p></header>`)}
    ${block('Summary', r.summary ? `<p>${text(r.summary)}</p>` : '')}${block('Education', education)}${block('Skills', skills)}
    ${block('Projects', projects)}${block('Experience', experience)}${block('Achievements', achievements)}`;
}

function renderPaper() {
  const paper = el('resumePaper');
  paper.className = `rs-paper is-${resume.template}`;
  paper.innerHTML = paperHtml();
  document.querySelectorAll('[data-act=template]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.value === resume.template)));
  // More than one page is not an error, but most recruiters read one
  const tooLong = paper.scrollHeight > PAPER_HEIGHT + 4;
  el('resumeFit').hidden = !tooLong;
  if (tooLong) el('resumeFit').textContent = `This runs to about ${Math.ceil(paper.scrollHeight / PAPER_HEIGHT)} pages. One page reads best: shorten the descriptions or drop the oldest entries.`;
  fitPaper();
}

// The page is always laid out at its real size and then scaled to the width there is
function fitPaper() {
  const stage = el('resumeStage');
  const paper = el('resumePaper');
  const scale = Math.min(1, stage.clientWidth / PAPER_WIDTH);
  paper.style.transform = scale < 1 ? `scale(${scale})` : '';
  stage.style.height = `${Math.max(PAPER_HEIGHT, paper.scrollHeight) * scale}px`;
}

function showPane(pane) {
  mobilePane = pane;
  document.querySelector('.rs-layout').dataset.pane = pane;
  document.querySelectorAll('[data-act=pane]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.value === pane)));
  fitPaper();
}

// ==========================================
// 4. CONTROLS
// ==========================================
function bindResume() {
  const page = document.querySelector('.st-page');
  page.addEventListener('input', (e) => {
    if (!resume) return;
    const input = e.target;
    if (input.dataset.field) resume[input.dataset.field] = input.value;
    else if (input.dataset.words) resume[input.dataset.words] = input.value.split(',').map(word => word.trim()).filter(Boolean).slice(0, 40);
    else if (input.dataset.lines) resume[input.dataset.lines] = input.value.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 10);
    else return;
    changed();
  });
  page.addEventListener('change', (e) => {
    if (resume && e.target.dataset.check) { resume[e.target.dataset.check] = e.target.checked; changed(); }
  });
  page.addEventListener('click', (e) => {
    const button = e.target.closest('[data-act]');
    if (!button || button.disabled) return;
    const act = button.dataset.act;
    if (act === 'reload') return window.location.reload();
    if (!resume) return;
    if (act === 'add-item') return openItem(button.dataset.list, null);
    if (act === 'edit-item') return openItem(button.dataset.list, Number(button.dataset.index));
    if (act === 'template') { resume.template = button.dataset.value; return changed(); }
    if (act === 'pane') return showPane(button.dataset.value);
    if (act === 'print') {
      if (!resume.name.trim()) return showToast('Add your name first.');
      return window.print();
    }
    if (act === 'restart') {
      if (!window.confirm('Replace this resume with a fresh draft from your profile?')) return;
      resume = draftFromProfile();
      renderEditor();
      return changed();
    }
  });
  window.addEventListener('resize', () => { if (resume) fitPaper(); });
  // Leaving while a save is still waiting: send it now
  window.addEventListener('pagehide', () => { if (saveTimer && resume && el('resumeStatus').textContent === 'Saving…') saveResume(); });
}

initResume();
