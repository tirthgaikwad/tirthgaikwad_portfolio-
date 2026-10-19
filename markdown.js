// ==========================================
// MARKDOWN.JS — a small, safe Markdown renderer shared by the AI tutor and event descriptions.
// Everything is escaped first (escapeHtml from shared.js), so no HTML from the text can ever run.
//   mdToHtml(text)                 headings, lists, tables, **bold**, *italic*, `code`, ``` blocks
//   mdToHtml(text, {links: true})  also [label](https://...) links; only http(s) addresses, opened in a new tab
// ==========================================

function mdInline(text, options) {
  let out = text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  if (options && options.links) {
    // The text is already escaped, so the address cannot hold quotes or angle brackets
    out = out.replace(/\[([^\]]{1,200})\]\((https?:\/\/[^\s)]{1,500})\)/g, '<a href="$2" target="_blank" rel="noopener nofollow">$1</a>');
  }
  return out;
}

function mdToHtml(source, options) {
  const out = [];
  const inline = (text) => mdInline(text, options);
  const blocks = String(source || '').split(/```/);
  blocks.forEach((block, i) => {
    if (i % 2 === 1) {                       // a fenced code block; its first line may name the language
      const code = block.replace(/^[a-zA-Z0-9+#-]*\n/, '');
      out.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
      return;
    }
    const lines = escapeHtml(block).split('\n');
    let list = null, para = [], table = [];
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join('<br>'))}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(item => `<li>${inline(item)}</li>`).join('')}</${list.tag}>`); list = null; } };
    const flushTable = () => {
      if (!table.length) return;
      const rows = table.filter(row => !/^\|?\s*:?-{2,}/.test(row)).map(row => row.replace(/^\||\|$/g, '').split('|').map(cell => inline(cell.trim())));
      out.push(`<table>${rows.map((cells, r) => `<tr>${cells.map(cell => r === 0 ? `<th>${cell}</th>` : `<td>${cell}</td>`).join('')}</tr>`).join('')}</table>`);
      table = [];
    };
    for (const raw of lines) {
      const line = raw.trimEnd();
      const heading = line.match(/^(#{1,4})\s+(.+)$/);
      const bullet = line.match(/^\s*[-*•]\s+(.+)$/);
      const numbered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
      if (/^\s*\|.*\|\s*$/.test(line)) { flushPara(); flushList(); table.push(line.trim()); continue; }
      flushTable();
      if (!line.trim()) { flushPara(); flushList(); continue; }
      if (heading) { flushPara(); flushList(); out.push(`<h${heading[1].length <= 3 ? 3 : 4}>${inline(heading[2])}</h${heading[1].length <= 3 ? 3 : 4}>`); continue; }
      if (bullet || numbered) {
        flushPara();
        const tag = bullet ? 'ul' : 'ol';
        if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
        list.items.push(bullet ? bullet[1] : numbered[2]);
        continue;
      }
      if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += `<br>${line.trim()}`; continue; }
      flushList();
      para.push(line);
    }
    flushPara(); flushList(); flushTable();
  });
  return out.join('');
}
