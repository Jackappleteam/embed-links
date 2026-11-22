// Tiny Discord-flavoured markdown renderer for the preview. Escapes everything first.
import { esc } from "./render.js";

function inline(t) {
  const codes = [];
  t = t.replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  t = t
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<u>$1</u>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>")
    .replace(/\|\|(.+?)\|\|/g, '<span class="spoiler">$1</span>')
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, "$1<em>$2</em>");
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

export function md(src) {
  const blocks = String(src ?? "").split(/```/);
  let out = "";
  blocks.forEach((chunk, i) => {
    if (i % 2 === 1) {
      out += `<pre class="md-pre">${esc(chunk.replace(/^[a-z0-9]*\n/i, "").replace(/\n$/, ""))}</pre>`;
      return;
    }
    const lines = esc(chunk).split("\n");
    let list = false;
    for (const raw of lines) {
      const li = /^\s*[-*] (.*)$/.exec(raw);
      if (li && !raw.startsWith("-#")) {
        if (!list) out += '<ul class="md-ul">';
        list = true;
        out += `<li>${inline(li[1])}</li>`;
        continue;
      }
      if (list) {
        out += "</ul>";
        list = false;
      }
      let m;
      if ((m = /^(#{1,3}) (.*)$/.exec(raw))) out += `<div class="md-h${m[1].length}">${inline(m[2])}</div>`;
      else if ((m = /^-# (.*)$/.exec(raw))) out += `<div class="md-sub">${inline(m[1])}</div>`;
      else if ((m = /^&gt; (.*)$/.exec(raw))) out += `<div class="md-quote">${inline(m[1])}</div>`;
      else if (raw.trim() === "") out += '<div class="md-gap"></div>';
      else out += `<div>${inline(raw)}</div>`;
    }
    if (list) out += "</ul>";
  });
  return out;
}
