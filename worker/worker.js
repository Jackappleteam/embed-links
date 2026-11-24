// Cloudflare Worker backend for Embed Links. Lets anyone create links with no token.
//   POST /api/create          body = embed JSON -> stores it in KV, returns { id, url }
//   GET  /e/<id>               page Discord reads
//   GET  /e/<id>/oembed.json
//   GET  /?d=<compressed>      stateless fallback, works without KV
//
//   GET  /auth/login           redirects to Discord OAuth
//   GET  /auth/callback        Discord redirects here with ?code=...
//   GET  /api/me               who am I (bearer session token)
//   POST /api/logout           invalidate a session token
//   GET  /api/my-links         my saved links (requires login)
//   DELETE /api/links/<id>     delete a link (owner or admin)
//   GET  /api/admin/links      list every link (admin only)
import { decodeData, renderPage, renderOembed, normalize, prune, needsOembed } from "../js/render.js";

// The one Discord user allowed into /admin.
const ADMIN_ID = "1247230105529618535";

// Where the static site actually lives. Used to send people back there after
// Discord login. Update this if the site ever moves to a custom domain.
const SITE_ORIGIN = "https://jackappleteam.github.io/embed-links";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};
const html = (body, status = 200, extra = {}) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300", ...extra } });
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...CORS } });
const ID_CHARS = "abcdefghijkmnpqrstuvwxyz23456789";
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(7)), (b) => ID_CHARS[b % 32]).join("");
const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
const MAX_BYTES = 8000;
const RESERVED_PREFIXES = ["_stats:", "session:", "user:"];
const isLinkId = (k) => /^[a-z0-9]+$/.test(k) && !RESERVED_PREFIXES.some((p) => k.startsWith(p));

// ---------------------------------------------------------------- stats ---
// Running total of links created, for the README badge. Stored under a key
// that can't collide with a real short id (ids never contain "_" or ":").
const STATS_KEY = "_stats:total_links";
async function bumpLinkCount(env) {
  try {
    const cur = parseInt((await env.EMBEDS.get(STATS_KEY)) || "0", 10) || 0;
    await env.EMBEDS.put(STATS_KEY, String(cur + 1));
  } catch {
    // best-effort only — never block link creation over a counter write
  }
}

// ------------------------------------------------------------- sessions ---
const SESSION_TTL = 60 * 60 * 24 * 60; // 60 days
async function getSession(req, env) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || !env.EMBEDS) return null;
  try {
    const raw = await env.EMBEDS.get(`session:${token}`);
    return raw ? { token, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- links ---
// Stored value shape (v2): { v: 2, owner: discordId|null, created: ms, data }
// Older links (pre-accounts) are stored as the bare embed-data object — read
// code below falls back to treating the whole parsed value as `data` when it
// doesn't look like a v2 wrapper, so nothing already created breaks.
function unwrapLink(raw) {
  const parsed = JSON.parse(raw);
  if (parsed && parsed.v === 2 && "data" in parsed) return parsed;
  return { v: 1, owner: null, created: null, data: parsed };
}
async function addToUserList(env, discordId, id) {
  try {
    const key = `user:${discordId}:links`;
    const list = JSON.parse((await env.EMBEDS.get(key)) || "[]");
    list.unshift(id);
    await env.EMBEDS.put(key, JSON.stringify(list.slice(0, 200)));
  } catch {
    // best-effort — the link itself is already saved either way
  }
}
async function removeFromUserList(env, discordId, id) {
  if (!discordId) return;
  try {
    const key = `user:${discordId}:links`;
    const list = JSON.parse((await env.EMBEDS.get(key)) || "[]");
    await env.EMBEDS.put(key, JSON.stringify(list.filter((x) => x !== id)));
  } catch {}
}

// ---------------------------------------------------------- anti-adblock --
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

// -------------------------------------------------------------- discord ---
function randomStateCookie() {
  const state = newToken();
  return { state, cookie: `aa_oauth_state=${state}; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax` };
}
function readCookie(req, name) {
  const c = req.headers.get("cookie") || "";
  const m = c.split(/;\s*/).find((p) => p.startsWith(name + "="));
  return m ? m.slice(name.length + 1) : null;
}

// Allowed values for return_to — the bare filename to land back on within
// the site's own folder. Anything else falls back to the main page. Kept as
// an allowlist (not just "looks like a relative path") since this value
// ends up directly in a redirect URL.
const RETURN_PAGES = new Set(["", "admin.html"]);

async function handleLogin(url, env) {
  if (!env.DISCORD_CLIENT_ID) return html("<!DOCTYPE html><title>Login not configured</title><p>Discord login isn't set up on this Worker yet.</p>", 501);
  const { state, cookie } = randomStateCookie();
  const returnTo = url.searchParams.get("return_to") || "";
  const packedState = `${state}.${encodeURIComponent(returnTo)}`;
  const redirectUri = `${url.origin}/auth/callback`;
  const authorize = new URL("https://discord.com/api/oauth2/authorize");
  authorize.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "identify");
  authorize.searchParams.set("state", packedState);
  return new Response(null, { status: 302, headers: { location: authorize.toString(), "set-cookie": cookie } });
}

async function handleCallback(req, url, env) {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET)
    return html("<!DOCTYPE html><title>Login not configured</title><p>Discord login isn't set up on this Worker yet.</p>", 501);
  const code = url.searchParams.get("code");
  const packedState = url.searchParams.get("state") || "";
  const [state, returnToEnc] = packedState.split(".");
  const returnToRaw = returnToEnc ? decodeURIComponent(returnToEnc) : "";
  const returnTo = RETURN_PAGES.has(returnToRaw) ? returnToRaw : "";
  const cookieState = readCookie(req, "aa_oauth_state");
  if (!code || !state || state !== cookieState) return html("<!DOCTYPE html><title>Login failed</title><p>That login link expired or is invalid. Go back and try again.</p>", 400);

  const redirectUri = `${url.origin}/auth/callback`;
  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) return html("<!DOCTYPE html><title>Login failed</title><p>Discord didn't accept that login. Go back and try again.</p>", 400);
  const tokenData = await tokenRes.json();

  const meRes = await fetch("https://discord.com/api/users/@me", { headers: { authorization: `Bearer ${tokenData.access_token}` } });
  if (!meRes.ok) return html("<!DOCTYPE html><title>Login failed</title><p>Couldn't read your Discord profile. Go back and try again.</p>", 400);
  const me = await meRes.json();

  const token = newToken();
  const session = { discordId: me.id, username: me.username, globalName: me.global_name || null, avatar: me.avatar || null };
  await env.EMBEDS.put(`session:${token}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });

  // Plain string concatenation on purpose: SITE_ORIGIN already includes the
  // GitHub Pages project folder (".../embed-links"), and resolving returnTo
  // with `new URL(path, base)` would treat a leading "/" as domain-root-
  // relative, dropping that folder from the result.
  const dest = new URL(`${SITE_ORIGIN}/${returnTo}`);
  dest.hash = `session=${token}`;
  return new Response(null, {
    status: 302,
    headers: { location: dest.toString(), "set-cookie": "aa_oauth_state=; Path=/; Max-Age=0" },
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/lib/core.js") return proxyAntiAdblock();

    if (url.pathname === "/auth/login") return handleLogin(url, env);
    if (url.pathname === "/auth/callback") return handleCallback(req, url, env);

    if (url.pathname === "/api/me") {
      const session = await getSession(req, env);
      if (!session) return json({ error: "Not logged in" }, 401);
      return json({ discordId: session.discordId, username: session.username, globalName: session.globalName, avatar: session.avatar, isAdmin: session.discordId === ADMIN_ID });
    }

    if (url.pathname === "/api/logout" && req.method === "POST") {
      const auth = req.headers.get("authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (token && env.EMBEDS) await env.EMBEDS.delete(`session:${token}`);
      return json({ ok: true });
    }

    if (url.pathname === "/api/badge/links") {
      if (!env.EMBEDS) return json({ schemaVersion: 1, label: "links created", message: "n/a", color: "lightgrey" });
      const cur = parseInt((await env.EMBEDS.get(STATS_KEY)) || "0", 10) || 0;
      return json({ schemaVersion: 1, label: "links created", message: String(cur), color: "5865f2" });
    }

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
      const session = await getSession(req, env);
      let id = newId();
      for (let i = 0; i < 5 && (await env.EMBEDS.get(id)); i++) id = newId();
      const owner = session ? session.discordId : null;
      const created = Date.now();
      const stored = { v: 2, owner, created, data: prune(data) };
      await env.EMBEDS.put(id, JSON.stringify(stored), owner ? { metadata: { owner, created } } : { metadata: { created } });
      await bumpLinkCount(env);
      if (owner) await addToUserList(env, owner, id);
      return json({ id, url: `${url.origin}/e/${id}` });
    }

    if (url.pathname === "/api/my-links") {
      const session = await getSession(req, env);
      if (!session) return json({ error: "Not logged in" }, 401);
      const ids = JSON.parse((await env.EMBEDS.get(`user:${session.discordId}:links`)) || "[]");
      const items = [];
      for (const id of ids.slice(0, 100)) {
        const raw = await env.EMBEDS.get(id);
        if (!raw) continue;
        const { created, data } = unwrapLink(raw);
        items.push({ id, url: `${url.origin}/e/${id}`, created, data });
      }
      return json({ links: items });
    }

    const delMatch = /^\/api\/links\/([a-z0-9]+)$/.exec(url.pathname);
    if (delMatch && req.method === "DELETE") {
      const session = await getSession(req, env);
      if (!session) return json({ error: "Not logged in" }, 401);
      const id = delMatch[1];
      const raw = await env.EMBEDS.get(id);
      if (!raw) return json({ error: "Not found" }, 404);
      const { owner } = unwrapLink(raw);
      if (owner !== session.discordId && session.discordId !== ADMIN_ID) return json({ error: "Not your link" }, 403);
      await env.EMBEDS.delete(id);
      await removeFromUserList(env, owner, id);
      return json({ ok: true });
    }

    if (url.pathname === "/api/admin/links") {
      const session = await getSession(req, env);
      if (!session || session.discordId !== ADMIN_ID) return json({ error: "Forbidden" }, 403);
      const cursor = url.searchParams.get("cursor") || undefined;
      const page = await env.EMBEDS.list({ limit: 1000, cursor });
      const items = page.keys
        .filter((k) => isLinkId(k.name))
        .map((k) => ({ id: k.name, owner: k.metadata?.owner || null, created: k.metadata?.created || null }));
      return json({ items, cursor: page.list_complete ? null : page.cursor });
    }

    const m = /^\/e\/([a-z0-9]+)(\/oembed\.json)?\/?$/.exec(url.pathname);
    if (m && env.EMBEDS) {
      const raw = await env.EMBEDS.get(m[1]);
      if (!raw) return html("<!DOCTYPE html><title>Not found</title><p>This embed link doesn't exist.</p>", 404);
      const { data: wrapped } = unwrapLink(raw);
      const data = normalize(wrapped);
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
