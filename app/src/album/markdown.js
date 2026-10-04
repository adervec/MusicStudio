// Tiny Markdown → HTML for previewing album notes. Escapes everything first, then adds a safe
// subset: headings, bold/italic, inline + fenced code, lists, quotes, rules, http(s) links.
// ponytail: no tables/nesting/footnotes — swap for a real parser (marked + DOMPurify) if notes need them.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  .replace(/(^|[^_\w])_([^_\s][^_]*)_/g, '$1<em>$2</em>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

export function renderMarkdown(src) {
  const out = []; let list = null, para = [], code = null;
  const flush = () => {
    if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; }
    if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; }
  };
  for (const line of String(src || '').replace(/\r/g, '').split('\n')) {
    if (code) { if (/^\s*```/.test(line)) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; } else code.push(line); continue; }
    if (/^\s*```/.test(line)) { flush(); code = []; continue; }
    let m;
    if (!line.trim()) flush();
    else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { flush(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
    else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); }
    else if ((m = line.match(/^\s*>\s?(.*)$/))) { flush(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); }
    else if ((m = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/))) {
      const tag = m[1] ? 'ul' : 'ol';
      if (para.length || (list && list.tag !== tag)) flush();
      (list ||= { tag, items: [] }).items.push(m[3]);
    } else { if (list) flush(); para.push(line.trim()); }
  }
  if (code) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  flush();
  return out.join('\n');
}
