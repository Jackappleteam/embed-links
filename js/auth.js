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

// Kicks off the Discord OAuth flow. `returnTo` is a path on the *site*
// (GitHub Pages), e.g. "/" or "/admin.html", not the Worker.
export function login(returnTo) {
  const path = returnTo || (location.pathname.slice(location.origin.length) + location.search) || "/";
  location.href = `${WORKER_URL}/auth/login?return_to=${encodeURIComponent(path)}`;
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
