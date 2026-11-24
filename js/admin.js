import { WORKER_URL } from "./config.js";
import { authFetch, avatarUrl, login, logout as authLogout, consumeSessionFromHash, fetchMe } from "./auth.js";

const $ = (s, r = document) => r.querySelector(s);
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}
function toast(msg, kind = "") {
  const t = h("div", { class: "toast " + kind }, msg);
  $("#toasts").append(t);
  setTimeout(() => t.remove(), 3800);
}

let me = null;
async function logout() {
  await authLogout();
  me = null;
  renderAuthUI();
  renderBody();
}
function renderAuthUI() {
  const el = $("#railAuth");
  el.replaceChildren(
    me
      ? h("div", { class: "auth-chip" },
          h("img", { class: "auth-av", src: avatarUrl(me), alt: "" }),
          h("span", { class: "auth-name" }, me.globalName || me.username),
          h("button", { class: "btn ghost sm", onclick: logout }, "Log out"))
      : h("button", { class: "btn sm", onclick: () => login("admin.html") }, "Log in with Discord"));
}

function fmtDate(ms) {
  if (!ms) return "—";
  try { return new Date(ms).toLocaleString(); } catch { return "—"; }
}

async function renderBody() {
  const body = $("#adminBody");
  if (!me) {
    body.replaceChildren(h("p", { class: "note" }, "Log in with Discord to continue."));
    return;
  }
  if (!me.isAdmin) {
    body.replaceChildren(h("p", { class: "note" }, "Your Discord account doesn't have access to this page."));
    return;
  }
  body.replaceChildren(h("p", { class: "note" }, "Loading…"));
  let items = [];
  try {
    let cursor;
    do {
      const r = await authFetch(`/api/admin/links${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!r.ok) throw new Error();
      const page = await r.json();
      items.push(...page.items);
      cursor = page.cursor;
    } while (cursor);
  } catch {
    body.replaceChildren(h("p", { class: "note" }, "Couldn't load links. Try reloading the page."));
    return;
  }
  items.sort((a, b) => (b.created || 0) - (a.created || 0));

  const table = h("table", { class: "admin-table" },
    h("thead", {}, h("tr", {}, h("th", {}, "Link"), h("th", {}, "Owner"), h("th", {}, "Created"), h("th", {}, ""))),
    h("tbody", {}, ...(items.length ? items.map(row) : [h("tr", {}, h("td", { colspan: "4" }, "No links yet."))])));

  function row(it) {
    const url = `${WORKER_URL}/e/${it.id}`;
    const tr = h("tr", {},
      h("td", {}, h("a", { href: url, target: "_blank", rel: "noopener" }, it.id)),
      h("td", {}, it.owner || "— (guest)"),
      h("td", {}, fmtDate(it.created)),
      h("td", {}, h("button", { class: "btn sm danger", onclick: async () => {
        if (!confirm(`Delete link "${it.id}"? This can't be undone.`)) return;
        const dr = await authFetch(`/api/links/${it.id}`, { method: "DELETE" });
        if (!dr.ok) return toast("Couldn't delete that link", "bad");
        tr.remove();
        toast("Link deleted", "good");
      } }, "Delete")));
    return tr;
  }

  body.replaceChildren(h("p", { class: "note" }, `${items.length} link${items.length === 1 ? "" : "s"} total.`), table);
}

async function init() {
  consumeSessionFromHash();
  renderAuthUI();
  renderBody();
  me = await fetchMe();
  renderAuthUI();
  renderBody();
}
init();
