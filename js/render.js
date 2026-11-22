// Shared by the browser app and the optional Cloudflare Worker.
// Pure functions only: no DOM access.

const HTTP = /^https?:\/\//i;
export const isHttp = (u) => HTTP.test(String(u ?? "").trim());
const str = (v) => (typeof v === "string" ? v : "");

export const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function hexToInt(h) {
  h = String(h ?? "").replace("#", "").trim();
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return parseInt(h, 16);
}
export const intToHex = (n) => "#" + Number(n).toString(16).padStart(6, "0");

export const LIMITS = { bytes: 3000, components: 40, gallery: 10, buttons: 5, sectionTexts: 3 };

export const defaults = () => ({
  url: "",
  embed: {
    title: "",
    description: "",
    color: "",
    provider: { name: "", url: "" },
    author: { name: "", url: "" },
    image: { url: "", large: true },
  },
  use_component: false,
  component: {
    type: 17,
    accent_color: null,
    spoiler: false,
    components: [
      { type: 10, content: "# Hello world\nBuilt with **Embed Links**." },
      { type: 14, divider: true, spacing: 1 },
      { type: 1, components: [{ type: 2, style: 5, url: "https://example.com", label: "Open", emoji: { name: "" } }] },
    ],
  },
});

/** Accepts the editor schema, a bare Discord payload ({component}) or a bare container. */
export function normalize(raw) {
  const d = defaults();
  if (!raw || typeof raw !== "object") return d;
  if (raw.type === 17) raw = { component: raw, use_component: true };
  else if (raw.component && !raw.embed && !("url" in raw) && raw.use_component === undefined)
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
      image: { url: str(e.image?.url), large: e.image?.large !== false },
    },
    use_component: !!raw.use_component,
    component: comp,
  };
}

/** Drops empty strings / nulls / empty containers (keeps false) to keep payloads short. */
export function prune(v) {
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

/* ---------- Components V2 cleaning (builder state -> Discord payload) ---------- */

function cleanMedia(m) {
  const url = str(m?.url).trim();
  return isHttp(url) && url.length <= 2048 ? { url } : null;
}
function cleanButton(b) {
  const label = str(b?.label).trim().slice(0, 80);
  const emoji = str(b?.emoji?.name ?? b?.emoji).trim();
  const url = str(b?.url).trim();
  if (!isHttp(url) || (!label && !emoji)) return null;
  const o = { type: 2, style: 5, url };
  if (label) o.label = label;
  if (emoji) o.emoji = { name: emoji };
  return o;
}
function cleanNode(n) {
  switch (n?.type) {
    case 10: {
      const c = str(n.content);
      return c.trim() ? [{ type: 10, content: c }] : [];
    }
    case 14:
      return [{ type: 14, divider: n.divider !== false, spacing: n.spacing === 2 ? 2 : 1 }];
    case 12: {
      const items = (n.items || [])
        .map((i) => {
          const media = cleanMedia(i?.media);
          if (!media) return null;
          const o = { media };
          if (str(i.description).trim()) o.description = str(i.description).trim().slice(0, 1024);
          if (i.spoiler) o.spoiler = true;
          return o;
        })
        .filter(Boolean)
        .slice(0, LIMITS.gallery);
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
      // A section needs an accessory; without one it degrades to plain text.
      return accessory ? [{ type: 9, components: texts, accessory }] : texts;
    }
  }
  return [];
}

export function cleanComponent(c) {
  const components = (c?.components || []).flatMap(cleanNode);
  const o = { type: 17 };
  if (Number.isInteger(c?.accent_color) && c.accent_color >= 0 && c.accent_color <= 0xffffff) o.accent_color = c.accent_color;
  if (c?.spoiler) o.spoiler = true;
  o.components = components;
  return { component: o };
}

export function countComponents(node) {
  let n = 1;
  if (node.accessory) n += 1;
  for (const k of node.components || []) n += countComponents(k);
  return n;
}

/** Serialized for a <script> tag: `<` escaped so the payload can't close the tag. */
export function jsonForScript(payload) {
  return JSON.stringify(payload)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function payloadStats(payload) {
  const json = jsonForScript(payload);
  let gallery = 0;
  const walk = (n) => {
    if (n.type === 12) gallery += n.items.length;
    (n.components || []).forEach(walk);
  };
  walk(payload.component);
  return {
    json,
    bytes: new TextEncoder().encode(json).length,
    count: countComponents(payload.component),
    gallery,
  };
}

const stripMd = (s) =>
  s.replace(/^\s*(#{1,3}|-#)\s+/, "").replace(/(\*\*|__|~~|\|\||\*|_|`)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();

function fallbackText(payload) {
  const t = [];
  const walk = (n) => {
    if (n.type === 10) t.push(n.content);
    (n.components || []).forEach(walk);
  };
  walk(payload.component);
  if (!t.length) return { title: "", desc: "" };
  const lines = t.join("\n").split("\n").filter((l) => l.trim());
  return { title: stripMd(lines[0] || "").slice(0, 256), desc: stripMd(lines.slice(1).join(" ")).slice(0, 300) };
}

export function needsOembed(data) {
  const e = data.embed;
  return !!(e.author.name.trim() || e.author.url.trim() || e.provider.url.trim());
}

export function renderOembed(data) {
  const e = data.embed;
  const o = { version: "1.0", type: "link" };
  if (e.author.name.trim()) o.author_name = e.author.name.trim();
  if (isHttp(e.author.url)) o.author_url = e.author.url.trim();
  if (e.provider.name.trim()) o.provider_name = e.provider.name.trim();
  if (isHttp(e.provider.url)) o.provider_url = e.provider.url.trim();
  return o;
}

/**
 * The page Discord's crawler reads. ctx: { oembedHref?: absolute URL }.
 * Open Graph tags are always emitted; the component payload is added on top.
 */
export function renderPage(data, ctx = {}) {
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
    m.push(`<script id="discord:component-embed" type="application/json">${payloadStats(comp).json}</script>`);

  const target = isHttp(data.url) ? data.url.trim() : "";
  const redirect = target
    ? `<script>location.replace(${JSON.stringify(target).replace(/</g, "\\u003c")})</script>`
    : "";
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

/* ---------- shared encode/decode for the Worker mode ---------- */

export const b64url = (bytes) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const fromB64url = (s) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
export async function encodeData(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(prune(data)));
  const cs = new CompressionStream("deflate-raw");
  const w = cs.writable.getWriter();
  w.write(bytes);
  w.close();
  return b64url(new Uint8Array(await new Response(cs.readable).arrayBuffer()));
}
export async function decodeData(d) {
  const ds = new DecompressionStream("deflate-raw");
  const w = ds.writable.getWriter();
  w.write(fromB64url(d));
  w.close();
  const text = await new Response(ds.readable).text();
  return normalize(JSON.parse(text));
}
