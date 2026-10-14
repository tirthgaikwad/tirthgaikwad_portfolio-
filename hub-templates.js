// ==========================================
// HUB-TEMPLATES.JS — Start a plan from a template: a college project, a hackathon, a startup MVP or a research paper.
// A template adds a brief, sprints, tasks with dates and dependencies, milestones, risks and a starter page.
// Only Admins of the workspace can apply one (the server checks too). Offered on an empty board and in the header.
// ==========================================

let templateList = null;

async function openTemplatePicker() {
  if (!hubIsAdmin()) {
    return window.showSystemModal('Templates', 'Only Admins of this workspace can apply a template. Ask an Admin, or add tasks yourself.', 'alert');
  }
  try {
    if (!templateList) templateList = (await api('/api/project-templates')).templates;
  } catch (err) {
    return showToast(err.message);
  }
  const preview = (key) => {
    const t = templateList.find(x => x.key === key);
    return `<div class="ht-tpl-preview"><p>${escapeHtml(t.description)}</p>
      <p class="ht-muted">${t.tasks} tasks · ${t.milestones} milestones · ${t.sprints} sprint${t.sprints === 1 ? '' : 's'} · a brief, risks and a starter page</p>
      <ol>${t.task_titles.map(title => `<li>${escapeHtml(title)}</li>`).join('')}</ol></div>`;
  };
  openSheet({
    title: 'Start from a template',
    note: hub.tasks.length ? 'The template adds to what is already here; nothing is removed. An existing brief is kept.' : 'Dates start from today. Change anything afterwards.',
    fields: [{ name: 'template', label: 'Template', type: 'select', options: templateList.map(t => [t.key, t.name]), value: templateList[0].key }],
    submitLabel: 'Use this template',
    onOpen: (form) => {
      const select = form.elements.template;
      select.insertAdjacentHTML('afterend', `<div id="tplPreview">${preview(select.value)}</div>`);
      select.addEventListener('change', () => { document.getElementById('tplPreview').innerHTML = preview(select.value); });
    },
    onSubmit: async (v) => {
      const result = await api(`/api/teams/${hubTeamId}/apply-template`, { method: 'POST', body: { template: v.template } });
      await refreshHubBoard(hubTeamId);
      showToast(`Added ${result.tasks} tasks and ${result.sprints} sprint${result.sprints === 1 ? '' : 's'}.`);
      switchHubTab('timeline');
    },
  });
}
