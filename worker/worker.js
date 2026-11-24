// Cloudflare Worker backend for Embed Links. Lets anyone create links with no token.
//   POST /api/create      body = embed JSON -> stores it in KV, returns { id, url }   (needs the EMBEDS KV binding)
//   GET  /e/<id>          page Discord reads
//   GET  /e/<id>/oembed.json
//   GET  /?d=<compressed> stateless fallback, works without KV
import { decodeData, renderPage, renderOembed, normalize, prune, needsOembed } from "../js/render.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};
const html = (body, status = 200, extra = {}) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300", ...extra } });
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...CORS } });
const ID_CHARS = "abcdefghijkmnpqrstuvwxyz23456789";
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(7)), (b) => ID_CHARS[b % 32]).join("");
const MAX_BYTES = 8000;

// Live-proxies Adcash's anti-adblock library through our own Worker domain
// instead of their flagged domain. Nothing is stored or "rotated" — every
// request fetches it fresh, so there's no file/filename for a blocklist to
// ever learn and target.
const AA_SOURCE = "https://adbpage.com/adblock?v=3&format=js&lnxv=2";
async function proxyAntiAdblock() {
  try {
    const upstream = await fetch(AA_SOURCE, { cf: { cacheTtl: 0, cacheEverything: false } });
    if (!upstream.ok) return new Response("", { status: 204 });
    const body = await upstream.text();
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store", ...CORS },
    });
  } catch {
    // If Adcash's endpoint is briefly unreachable, fail quiet (empty script)
    // rather than breaking the page with a 500.
    return new Response("", { status: 200, headers: { "content-type": "application/javascript", ...CORS } });
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/lib/core.js") return proxyAntiAdblock();

    if (url.pathname === "/api/create" && req.method === "POST") {
      if (!env.EMBEDS) return json({ error: "KV not configured" }, 501);
      const text = await req.text();
      if (text.length > MAX_BYTES) return json({ error: "Too large" }, 413);
      let data;
      try {
        data = normalize(JSON.parse(text));
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      let id = newId();
      for (let i = 0; i < 5 && (await env.EMBEDS.get(id)); i++) id = newId();
      await env.EMBEDS.put(id, JSON.stringify(prune(data)));
      return json({ id, url: `${url.origin}/e/${id}` });
    }

    const m = /^\/e\/([a-z0-9]+)(\/oembed\.json)?\/?$/.exec(url.pathname);
    if (m && env.EMBEDS) {
      const raw = await env.EMBEDS.get(m[1]);
      if (!raw) return html("<!DOCTYPE html><title>Not found</title><p>This embed link doesn't exist.</p>", 404);
      const data = normalize(JSON.parse(raw));
      if (m[2])
        return new Response(JSON.stringify(renderOembed(data)), {
          headers: { "content-type": "application/json", "cache-control": "public, max-age=300", ...CORS },
        });
      return html(renderPage(data, { oembedHref: needsOembed(data) ? `${url.origin}/e/${m[1]}/oembed.json` : null }));
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
  },
};
