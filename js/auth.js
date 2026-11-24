// Shared Discord-login helpers used by both the main builder page and the
// admin page. Session state lives as a bearer token in localStorage — no
// cookies, so it works fine even though the site (GitHub Pages) and the API
// (the Cloudflare Worker) are on different domains.
import { WORKER_URL } from "./config.js";

const SESSKEY = "eml.session.v1";

export const getToken = () => {
  try { return localStorage.getItem(SESSKEY) || ""; } catch { return ""; }
};
export const setToken = (t) => {
  try { t ? localStorage.setItem(SESSKEY, t) : localStorage.removeItem(SESSKEY); } catch {}
};

export async function authFetch(path, opts = {}) {
  const token = getToken();
  const headers = { ...(opts.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${WORKER_URL}${path}`, { ...opts, headers });
}

export function avatarUrl(u) {
  if (!u) return "";
  return u.avatar
    ? `https://cdn.discordapp.com/avatars/${u.discordId}/${u.avatar}.png?size=64`
    : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(u.discordId) % 5n)}.png`;
}

// Kicks off the Discord OAuth flow. `returnTo` is the bare filename to land
// back on within the site's own folder — "" for the main page, "admin.html"
// for the admin page — never a full path. The Worker only knows the site's
// base folder (SITE_ORIGIN), not a full URL, so this stays a plain filename
// rather than something resolved with URL path semantics (a leading "/"
// there would resolve to the domain root and drop the GitHub Pages project
// folder, e.g. "/embed-links/").
export function login(returnTo) {
  const page = returnTo ?? (location.pathname.split("/").pop() || "");
  location.href = `${WORKER_URL}/auth/login?return_to=${encodeURIComponent(page)}`;
}

export async function logout() {
  try { await authFetch("/api/logout", { method: "POST" }); } catch {}
  setToken("");
}

// After the Worker redirects back with #session=<token> in the URL, store
// the token and strip it from the address bar.
export function consumeSessionFromHash() {
  const m = /(?:^|#)session=([0-9a-f]+)/.exec(location.hash);
  if (!m) return false;
  setToken(m[1]);
  history.replaceState(null, "", location.pathname + location.search);
  return true;
}

// Fetches the current user (or null if logged out / token invalid).
export async function fetchMe() {
  if (!getToken()) return null;
  try {
    const r = await authFetch("/api/me");
    if (r.ok) return await r.json();
    if (r.status === 401) setToken("");
  } catch {
    // network hiccup — treat as "unknown", not "logged out"
  }
  return null;
}
