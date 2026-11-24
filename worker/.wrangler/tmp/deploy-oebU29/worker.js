var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../js/render.js
var HTTP = /^https?:\/\//i;
var isHttp = /* @__PURE__ */ __name((u) => HTTP.test(String(u ?? "").trim()), "isHttp");
var str = /* @__PURE__ */ __name((v) => typeof v === "string" ? v : "", "str");
var esc = /* @__PURE__ */ __name((s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"), "esc");
function hexToInt(h) {
  h = String(h ?? "").replace("#", "").trim();
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return parseInt(h, 16);
}
__name(hexToInt, "hexToInt");
var intToHex = /* @__PURE__ */ __name((n) => "#" + Number(n).toString(16).padStart(6, "0"), "intToHex");
var LIMITS = { bytes: 3e3, components: 40, gallery: 10, buttons: 5, sectionTexts: 3 };
var defaults = /* @__PURE__ */ __name(() => ({
  url: "",
  embed: {
    title: "",
    description: "",
    color: "",
    provider: { name: "", url: "" },
    author: { name: "", url: "" },
    image: { url: "", large: true }
  },
  use_component: false,
  component: {
    type: 17,
    accent_color: null,
    spoiler: false,
    components: [
      { type: 10, content: "# Hello world\nBuilt with **Embed Links**." },
      { type: 14, divider: true, spacing: 1 },
      { type: 1, components: [{ type: 2, style: 5, url: "https://example.com", label: "Open", emoji: { name: "" } }] }
    ]
  }
}), "defaults");
function normalize(raw) {
  const d = defaults();
  if (!raw || typeof raw !== "object") return d;
  if (raw.type === 17) raw = { component: raw, use_component: true };
  else if (raw.component && !raw.embed && !("url" in raw) && raw.use_component === void 0)
    raw = { ...raw, use_component: true };
  const e = raw.embed && typeof raw.embed === "object" ? raw.embed : {};
  let comp = raw.component && raw.component.type === 17 ? raw.component : d.component;
  if (typeof comp.accent_color === "string") comp = { ...comp, accent_color: hexToInt(comp.accent_color) };
  if (!Array.isArray(comp.components)) comp = { ...comp, components: [] };
  return {
    url: str(raw.url),
    embed: {
      title: str(e.title),
      description: str(e.description),
      color: str(e.color),
      provider: { name: str(e.provider?.name), url: str(e.provider?.url) },
      author: { name: str(e.author?.name), url: str(e.author?.url) },
      image: { url: str(e.image?.url), large: e.image?.large !== false }
    },
    use_component: !!raw.use_component,
    component: comp
  };
}
__name(normalize, "normalize");
function prune(v) {
  if (Array.isArray(v)) return v.map(prune);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      const p = prune(x);
      if (p === "" || p == null) continue;
      if (p && typeof p === "object" && !Array.isArray(p) && !Object.keys(p).length) continue;
      o[k] = p;
    }
    return o;
  }
  return v;
}
__name(prune, "prune");
function cleanMedia(m) {
  const url = str(m?.url).trim();
  return isHttp(url) && url.length <= 2048 ? { url } : null;
}
__name(cleanMedia, "cleanMedia");
function cleanButton(b) {
  const label = str(b?.label).trim().slice(0, 80);
  const emoji = str(b?.emoji?.name ?? b?.emoji).trim();
  const url = str(b?.url).trim();
  if (!isHttp(url) || !label && !emoji) return null;
  const o = { type: 2, style: 5, url };
  if (label) o.label = label;
  if (emoji) o.emoji = { name: emoji };
  return o;
}
__name(cleanButton, "cleanButton");
function cleanNode(n) {
  switch (n?.type) {
    case 10: {
      const c = str(n.content);
      return c.trim() ? [{ type: 10, content: c }] : [];
    }
    case 14:
      return [{ type: 14, divider: n.divider !== false, spacing: n.spacing === 2 ? 2 : 1 }];
    case 12: {
      const items = (n.items || []).map((i) => {
        const media = cleanMedia(i?.media);
        if (!media) return null;
        const o = { media };
        if (str(i.description).trim()) o.description = str(i.description).trim().slice(0, 1024);
        if (i.spoiler) o.spoiler = true;
        return o;
      }).filter(Boolean).slice(0, LIMITS.gallery);
      return items.length ? [{ type: 12, items }] : [];
    }
    case 1: {
      const components = (n.components || []).map(cleanButton).filter(Boolean).slice(0, LIMITS.buttons);
      return components.length ? [{ type: 1, components }] : [];
    }
    case 9: {
      const texts = (n.components || []).flatMap(cleanNode).filter((t) => t.type === 10).slice(0, LIMITS.sectionTexts);
      if (!texts.length) return [];
      let accessory = null;
      const a = n.accessory;
      if (a?.type === 11) {
        const media = cleanMedia(a.media);
        if (media) {
          accessory = { type: 11, media };
          if (str(a.description).trim()) accessory.description = str(a.description).trim().slice(0, 1024);
          if (a.spoiler) accessory.spoiler = true;
        }
      } else if (a?.type === 2) accessory = cleanButton(a);
      return accessory ? [{ type: 9, components: texts, accessory }] : texts;
    }
  }
  return [];
}
__name(cleanNode, "cleanNode");
function cleanComponent(c) {
  const components = (c?.components || []).flatMap(cleanNode);
  const o = { type: 17 };
  if (Number.isInteger(c?.accent_color) && c.accent_color >= 0 && c.accent_color <= 16777215) o.accent_color = c.accent_color;
  if (c?.spoiler) o.spoiler = true;
  o.components = components;
  return { component: o };
}
__name(cleanComponent, "cleanComponent");
function countComponents(node) {
  let n = 1;
  if (node.accessory) n += 1;
  for (const k of node.components || []) n += countComponents(k);
  return n;
}
__name(countComponents, "countComponents");
function jsonForScript(payload) {
  return JSON.stringify(payload).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
__name(jsonForScript, "jsonForScript");
function payloadStats(payload) {
  const json2 = jsonForScript(payload);
  let gallery = 0;
  const walk = /* @__PURE__ */ __name((n) => {
    if (n.type === 12) gallery += n.items.length;
    (n.components || []).forEach(walk);
  }, "walk");
  walk(payload.component);
  return {
    json: json2,
    bytes: new TextEncoder().encode(json2).length,
    count: countComponents(payload.component),
    gallery
  };
}
__name(payloadStats, "payloadStats");
var stripMd = /* @__PURE__ */ __name((s) => s.replace(/^\s*(#{1,3}|-#)\s+/, "").replace(/(\*\*|__|~~|\|\||\*|_|`)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim(), "stripMd");
function fallbackText(payload) {
  const t = [];
  const walk = /* @__PURE__ */ __name((n) => {
    if (n.type === 10) t.push(n.content);
    (n.components || []).forEach(walk);
  }, "walk");
  walk(payload.component);
  if (!t.length) return { title: "", desc: "" };
  const lines = t.join("\n").split("\n").filter((l) => l.trim());
  return { title: stripMd(lines[0] || "").slice(0, 256), desc: stripMd(lines.slice(1).join(" ")).slice(0, 300) };
}
__name(fallbackText, "fallbackText");
function needsOembed(data) {
  const e = data.embed;
  return !!(e.author.name.trim() || e.author.url.trim() || e.provider.url.trim());
}
__name(needsOembed, "needsOembed");
function renderOembed(data) {
  const e = data.embed;
  const o = { version: "1.0", type: "link" };
  if (e.author.name.trim()) o.author_name = e.author.name.trim();
  if (isHttp(e.author.url)) o.author_url = e.author.url.trim();
  if (e.provider.name.trim()) o.provider_name = e.provider.name.trim();
  if (isHttp(e.provider.url)) o.provider_url = e.provider.url.trim();
  return o;
}
__name(renderOembed, "renderOembed");
function renderPage(data, ctx = {}) {
  const e = data.embed;
  const comp = data.use_component ? cleanComponent(data.component) : null;
  let title = e.title.trim();
  let desc = e.description.trim();
  if (comp && !title && !desc) ({ title, desc } = fallbackText(comp));
  let color = hexToInt(e.color) != null ? intToHex(hexToInt(e.color)) : "";
  if (!color && comp && comp.component.accent_color != null) color = intToHex(comp.component.accent_color);
  const m = [];
  if (title) m.push(`<meta property="og:title" content="${esc(title)}">`);
  if (desc) m.push(`<meta property="og:description" content="${esc(desc)}">`);
  if (e.provider.name.trim()) m.push(`<meta property="og:site_name" content="${esc(e.provider.name.trim())}">`);
  if (color) m.push(`<meta name="theme-color" content="${color}">`);
  if (isHttp(e.image.url)) {
    m.push(`<meta property="og:image" content="${esc(e.image.url.trim())}">`);
    m.push(`<meta name="twitter:card" content="${e.image.large ? "summary_large_image" : "summary"}">`);
  }
  if (ctx.oembedHref && needsOembed(data))
    m.push(`<link type="application/json+oembed" href="${esc(ctx.oembedHref)}">`);
  if (comp && comp.component.components.length)
    m.push(`<script id="discord:component-embed" type="application/json">${payloadStats(comp).json}<\/script>`);
  const target = isHttp(data.url) ? data.url.trim() : "";
  const redirect = target ? `<script>location.replace(${JSON.stringify(target).replace(/</g, "\\u003c")})<\/script>` : "";
  const pageTitle = title || "Embed link";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
${m.join("\n")}
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1e1f22;color:#dbdee1;font:16px system-ui,sans-serif}main{max-width:480px;padding:24px}a{color:#00a8fc}h1{font-size:20px}</style>
</head>
<body>
<main>
<h1>${esc(pageTitle)}</h1>
${desc ? `<p>${esc(desc)}</p>` : ""}
${target ? `<p><a href="${esc(target)}">Continue &rarr;</a></p>` : ""}
</main>
${redirect}
</body>
</html>
`;
}
__name(renderPage, "renderPage");
var fromB64url = /* @__PURE__ */ __name((s) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}, "fromB64url");
async function decodeData(d) {
  const ds = new DecompressionStream("deflate-raw");
  const w = ds.writable.getWriter();
  w.write(fromB64url(d));
  w.close();
  const text = await new Response(ds.readable).text();
  return normalize(JSON.parse(text));
}
__name(decodeData, "decodeData");

// worker.js
var CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type"
};
var html = /* @__PURE__ */ __name((body, status = 200, extra = {}) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300", ...extra } }), "html");
var json = /* @__PURE__ */ __name((obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...CORS } }), "json");
var ID_CHARS = "abcdefghijkmnpqrstuvwxyz23456789";
var newId = /* @__PURE__ */ __name(() => Array.from(crypto.getRandomValues(new Uint8Array(7)), (b) => ID_CHARS[b % 32]).join(""), "newId");
var MAX_BYTES = 8e3;
var STATS_KEY = "_stats:total_links";
async function bumpLinkCount(env) {
  try {
    const cur = parseInt(await env.EMBEDS.get(STATS_KEY) || "0", 10) || 0;
    await env.EMBEDS.put(STATS_KEY, String(cur + 1));
  } catch {
  }
}
__name(bumpLinkCount, "bumpLinkCount");
var AA_SOURCE = "https://adbpage.com/adblock?v=3&format=js&lnxv=2";
async function proxyAntiAdblock() {
  try {
    const upstream = await fetch(AA_SOURCE, { cf: { cacheTtl: 0, cacheEverything: false } });
    if (!upstream.ok) return new Response("", { status: 204 });
    const body = await upstream.text();
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store", ...CORS }
    });
  } catch {
    return new Response("", { status: 200, headers: { "content-type": "application/javascript", ...CORS } });
  }
}
__name(proxyAntiAdblock, "proxyAntiAdblock");
var worker_default = {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/lib/core.js") return proxyAntiAdblock();
    if (url.pathname === "/api/badge/links") {
      if (!env.EMBEDS) return json({ schemaVersion: 1, label: "links created", message: "n/a", color: "lightgrey" });
      const cur = parseInt(await env.EMBEDS.get(STATS_KEY) || "0", 10) || 0;
      return json({ schemaVersion: 1, label: "links created", message: String(cur), color: "5865f2" });
    }
    if (url.pathname === "/api/create" && req.method === "POST") {
      if (!env.EMBEDS) return json({ error: "KV not configured" }, 501);
      const text = await req.text();
      if (text.length > MAX_BYTES) return json({ error: "Too large" }, 413);
      let data2;
      try {
        data2 = normalize(JSON.parse(text));
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      let id = newId();
      for (let i = 0; i < 5 && await env.EMBEDS.get(id); i++) id = newId();
      await env.EMBEDS.put(id, JSON.stringify(prune(data2)));
      await bumpLinkCount(env);
      return json({ id, url: `${url.origin}/e/${id}` });
    }
    const m = /^\/e\/([a-z0-9]+)(\/oembed\.json)?\/?$/.exec(url.pathname);
    if (m && env.EMBEDS) {
      const raw = await env.EMBEDS.get(m[1]);
      if (!raw) return html("<!DOCTYPE html><title>Not found</title><p>This embed link doesn't exist.</p>", 404);
      const data2 = normalize(JSON.parse(raw));
      if (m[2])
        return new Response(JSON.stringify(renderOembed(data2)), {
          headers: { "content-type": "application/json", "cache-control": "public, max-age=300", ...CORS }
        });
      return html(renderPage(data2, { oembedHref: needsOembed(data2) ? `${url.origin}/e/${m[1]}/oembed.json` : null }));
    }
    const d = url.searchParams.get("d");
    if (!d) return html("<!DOCTYPE html><title>Embed links</title><p>Create links with the Embed Links builder.</p>");
    let data;
    try {
      data = await decodeData(d);
    } catch {
      return html("<!DOCTYPE html><title>Invalid link</title><p>This embed link is invalid.</p>", 400);
    }
    if (url.pathname.endsWith("/oembed.json"))
      return new Response(JSON.stringify(renderOembed(data)), { headers: { "content-type": "application/json", ...CORS } });
    return html(renderPage(data, { oembedHref: needsOembed(data) ? `${url.origin}/oembed.json?d=${d}` : null }));
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
