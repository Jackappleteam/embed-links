import {
  defaults, normalize, prune, hexToInt, intToHex, isHttp, cleanComponent, payloadStats,
  renderPage, renderOembed, needsOembed, encodeData, LIMITS,
} from "./render.js";
import { md } from "./markdown.js";
import { WORKER_URL } from "./config.js";

/* ================= tiny DOM helpers ================= */
const $ = (s, r = document) => r.querySelector(s);
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "value" || k === "checked") el[k] = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const I = {
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
  git: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5A11.5 11.5 0 0 0 8.4 22.9c.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.9 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .5Z"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M5 8h14M5 13h9M5 18h12"/></svg>',
};
const ico = (name, cls = "ib") => h("span", { class: cls, html: I[name] });

/* ================= state ================= */
const SKEY = "eml.state.v1";
const SETKEY = "eml.settings.v1";
const LINKKEY = "eml.links.v1";
let state = (() => {
  try {
    return normalize(JSON.parse(localStorage.getItem(SKEY)));
  } catch {
    return defaults();
  }
})();
let tab = "builder";
const save = () => {
  try {
    localStorage.setItem(SKEY, JSON.stringify(state));
  } catch {}
};
const readLS = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? d;
  } catch {
    return d;
  }
};
const exportData = () => prune(structuredClone(state));

const exampleLink = () => `${WORKER_URL}/e/a1b2c3d`;

/* ================= form helpers ================= */
function wrap(label, el, extra) {
  return h("div", { class: "field" }, h("div", { class: "lab" }, label, extra || null), el);
}
/** text input / textarea bound to obj[key] */
function bound(label, obj, key, { ph = "", max, area = false, rows = 4, hint } = {}) {
  const counter = max ? h("i", {}, `${(obj[key] || "").length} / ${max}`) : null;
  const el = h(area ? "textarea" : "input", {
    class: area ? "ta" : "in",
    placeholder: ph,
    maxlength: max,
    value: obj[key] ?? "",
    rows: area ? rows : null,
    spellcheck: "false",
    autocomplete: "off",
  });
  el.addEventListener("input", () => {
    obj[key] = el.value;
    if (counter) counter.textContent = `${el.value.length} / ${max}`;
    update();
  });
  return h("div", { class: "field" }, h("div", { class: "lab" }, label, counter), hint ? h("div", { class: "hint" }, hint) : null, el);
}
function colorField(label, get, set) {
  const v0 = get();
  const txt = h("input", { class: "in", placeholder: "rrggbb", maxlength: 7, value: v0, spellcheck: "false" });
  const sw = h("input", { type: "color", class: "swatch", value: hexToInt(v0) != null ? intToHex(hexToInt(v0)) : "#1e1f22" });
  txt.addEventListener("input", () => {
    const v = txt.value.replace("#", "");
    set(v);
    if (hexToInt(v) != null) sw.value = intToHex(hexToInt(v));
    update();
  });
  sw.addEventListener("input", () => {
    txt.value = sw.value.slice(1);
    set(txt.value);
    update();
  });
  return wrap(label, h("div", { class: "color-wrap" }, h("span", { class: "hash" }, "#"), txt, sw));
}
function check(label, obj, key, { rebuild: rb = false } = {}) {
  const el = h("input", { type: "checkbox", checked: !!obj[key] });
  el.addEventListener("change", () => {
    obj[key] = el.checked;
    rb ? rebuild() : update();
  });
  return h("label", { class: "chk" }, el, label);
}
function select(obj, key, options, onchange) {
  const el = h("select", { class: "sel" }, options.map(([v, l]) => h("option", { value: v, selected: String(obj[key]) === String(v) }, l)));
  el.addEventListener("change", () => {
    obj[key] = isNaN(+el.value) ? el.value : +el.value;
    onchange ? onchange() : update();
  });
  return el;
}

/* ================= builder ================= */
function panel(title, body, { open = true, badge } = {}) {
  const p = h("div", { class: "panel" + (open ? "" : " closed") });
  const head = h("div", { class: "panel-h" }, h("span", { html: I.chev, style: "display:inline-flex" }), title, badge ? h("span", { class: "badge" }, badge) : null);
  head.addEventListener("click", () => p.classList.toggle("closed"));
  p.append(head, h("div", { class: "panel-b" }, body));
  return p;
}

function buildBuilder() {
  const root = $("#pane-builder");
  const e = state.embed;
  const embedFields = [
    h("div", { class: "row" }, bound("Title", e, "title", { max: 256 }), colorField("Color", () => e.color, (v) => (e.color = v))),
    h("div", { class: "row" }, bound("Provider", e.provider, "name", { max: 256 }), bound("Provider URL", e.provider, "url", { ph: "https://" })),
    h("div", { class: "row" }, bound("Author", e.author, "name", { max: 256 }), bound("Author URL", e.author, "url", { ph: "https://" })),
    bound("Description", e, "description", { max: 4096, area: true, rows: 5 }),
    h("div", { class: "field" }, check("Large image", e.image, "large")),
    bound("Image URL", e.image, "url", { ph: "https://…/image.png" }),
  ];

  const toggle = h("div", { class: "toggle" },
    h("div", { class: "t" }, h("b", {}, "Custom Component ", h("span", { class: "badge" }, "Discord only")), h("span", {}, "Replace the Discord preview with components: markdown, images, galleries and link buttons.")),
    h("label", { class: "sw" }, (() => {
      const c = h("input", { type: "checkbox", checked: state.use_component });
      c.addEventListener("change", () => {
        state.use_component = c.checked;
        rebuild();
      });
      return c;
    })(), h("i")),
  );

  root.replaceChildren(...[
    bound("URL", state, "url", { ph: "https://example.com", hint: "The URL that users will be redirected to when clicking your embed link." }),
    panel("Preview", embedFields, { open: !state.use_component || true }),
    toggle,
    state.use_component ? buildComponents() : null,
  ].filter(Boolean));
}

const NEW = {
  text: () => ({ type: 10, content: "" }),
  sep: () => ({ type: 14, divider: true, spacing: 1 }),
  section: () => ({ type: 9, components: [{ type: 10, content: "" }], accessory: { type: 11, media: { url: "" }, description: "", spoiler: false } }),
  gallery: () => ({ type: 12, items: [{ media: { url: "" }, description: "", spoiler: false }] }),
  row: () => ({ type: 1, components: [{ type: 2, style: 5, url: "", label: "", emoji: { name: "" } }] }),
};
const TYPE_NAME = { 10: "Text Display", 14: "Separator", 9: "Section", 12: "Media Gallery", 1: "Link Buttons" };

function buildComponents() {
  const c = state.component;
  const list = c.components;
  const wrapEl = h("div", {});
  wrapEl.append(
    h("div", { class: "row" },
      colorField("Accent color", () => (c.accent_color != null ? intToHex(c.accent_color).slice(1) : ""), (v) => (c.accent_color = hexToInt(v))),
      h("div", { class: "field" }, h("div", { class: "lab" }, "Container"), h("div", { style: "padding-top:8px" }, check("Spoiler", c, "spoiler"))),
    ),
    h("div", { class: "comp-tools" },
      [["text", "+ Text"], ["sep", "+ Separator"], ["section", "+ Section"], ["gallery", "+ Gallery"], ["row", "+ Buttons"]].map(([k, l]) =>
        h("button", { class: "btn sm", onclick: () => { list.push(NEW[k]()); rebuild(); } }, l)),
    ),
  );
  if (!list.length) wrapEl.append(h("div", { class: "note" }, "No components yet. Add one above."));
  list.forEach((n, i) => wrapEl.append(compCard(list, i)));
  return panel("Components", wrapEl, { badge: "V2" });
}

function compCard(list, i) {
  const n = list[i];
  const move = (d) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    rebuild();
  };
  const head = h("div", { class: "card-h" },
    h("div", { class: "name" }, TYPE_NAME[n.type] || "Component"),
    h("button", { class: "ib", title: "Move up", disabled: i === 0, html: I.up, onclick: () => move(-1) }),
    h("button", { class: "ib", title: "Move down", disabled: i === list.length - 1, html: I.down, onclick: () => move(1) }),
    h("button", { class: "ib del", title: "Remove", html: I.trash, onclick: () => { list.splice(i, 1); rebuild(); } }),
  );
  const body = h("div", { class: "card-b" });
  if (n.type === 10) body.append(bound("Content", n, "content", { area: true, rows: 5, max: 4000, ph: "# Heading\nSupports **markdown**" }));
  else if (n.type === 14) body.append(h("div", { class: "row" },
    h("div", { class: "field" }, check("Show divider line", n, "divider")),
    wrap("Spacing", select(n, "spacing", [[1, "Small"], [2, "Large"]])),
  ));
  else if (n.type === 9) body.append(...sectionBody(n));
  else if (n.type === 12) body.append(...galleryBody(n));
  else if (n.type === 1) body.append(...rowBody(n));
  return h("div", { class: "card" }, head, body);
}

function sectionBody(n) {
  const out = [];
  n.components.forEach((t, k) => {
    out.push(h("div", { class: "sub" },
      h("div", { class: "sub-h" }, `Text ${k + 1}`, n.components.length > 1 ? h("button", { class: "ib del", html: I.x, onclick: () => { n.components.splice(k, 1); rebuild(); } }) : null),
      bound("Content", t, "content", { area: true, rows: 3, max: 4000 })));
  });
  if (n.components.length < LIMITS.sectionTexts)
    out.push(h("button", { class: "btn sm", style: "margin-bottom:10px", onclick: () => { n.components.push({ type: 10, content: "" }); rebuild(); } }, "+ Text"));
  const a = n.accessory;
  const accSel = h("select", { class: "sel" },
    h("option", { value: 11, selected: a.type === 11 }, "Thumbnail"),
    h("option", { value: 2, selected: a.type === 2 }, "Link button"));
  accSel.addEventListener("change", () => {
    n.accessory = +accSel.value === 11
      ? { type: 11, media: { url: "" }, description: "", spoiler: false }
      : { type: 2, style: 5, url: "", label: "", emoji: { name: "" } };
    rebuild();
  });
  out.push(wrap("Accessory", accSel));
  if (a.type === 11) {
    a.media ||= { url: "" };
    out.push(bound("Thumbnail URL", a.media, "url", { ph: "https://…/image.png" }), bound("Alt text", a, "description", { max: 1024 }), check("Spoiler", a, "spoiler"));
  } else out.push(...buttonFields(a));
  return out;
}
function galleryBody(n) {
  const out = [];
  n.items.forEach((it, k) => {
    it.media ||= { url: "" };
    out.push(h("div", { class: "sub" },
      h("div", { class: "sub-h" }, `Image ${k + 1}`, n.items.length > 1 ? h("button", { class: "ib del", html: I.x, onclick: () => { n.items.splice(k, 1); rebuild(); } }) : null),
      bound("URL", it.media, "url", { ph: "https://…/image.png" }),
      bound("Alt text", it, "description", { max: 1024 }),
      check("Spoiler", it, "spoiler")));
  });
  out.push(h("button", { class: "btn sm", onclick: () => { n.items.push({ media: { url: "" }, description: "", spoiler: false }); rebuild(); } }, "+ Image"));
  return out;
}
function buttonFields(b) {
  b.emoji ||= { name: "" };
  return [
    h("div", { class: "row" }, bound("Label", b, "label", { max: 80 }), bound("Emoji", b.emoji, "name", { ph: "🔗" })),
    bound("URL", b, "url", { ph: "https://" }),
  ];
}
function rowBody(n) {
  const out = [];
  n.components.forEach((b, k) => {
    out.push(h("div", { class: "sub" },
      h("div", { class: "sub-h" }, `Button ${k + 1}`, n.components.length > 1 ? h("button", { class: "ib del", html: I.x, onclick: () => { n.components.splice(k, 1); rebuild(); } }) : null),
      ...buttonFields(b)));
  });
  if (n.components.length < LIMITS.buttons)
    out.push(h("button", { class: "btn sm", onclick: () => { n.components.push({ type: 2, style: 5, url: "", label: "", emoji: { name: "" } }); rebuild(); } }, "+ Button"));
  return out;
}

/* ================= JSON + HTML panes ================= */
let jsonTa, jsonMsg;
function buildJson() {
  const root = $("#pane-json");
  jsonTa = h("textarea", { class: "code-ta", spellcheck: "false", "aria-label": "JSON editor" });
  jsonMsg = h("div", { class: "ok" }, "Valid JSON");
  jsonTa.addEventListener("input", () => {
    try {
      const parsed = JSON.parse(jsonTa.value);
      state = normalize(parsed);
      jsonMsg.className = "ok";
      jsonMsg.textContent = "Valid JSON — applied";
      save();
      renderPreview();
      renderStats();
    } catch (err) {
      jsonMsg.className = "err";
      jsonMsg.textContent = String(err.message);
    }
  });
  const copy = (txt, msg) => navigator.clipboard.writeText(txt).then(() => toast(msg, "good"));
  root.replaceChildren(
    h("div", { class: "hint" }, "Edit the whole state, or paste a raw Discord component embed payload ({ \"component\": { \"type\": 17, … } }) to import it."),
    jsonTa, jsonMsg,
    h("div", { class: "pane-tools" },
      h("button", { class: "btn sm", onclick: () => copy(JSON.stringify(state, null, 2), "JSON copied") }, "Copy JSON"),
      h("button", { class: "btn sm", onclick: () => copy(JSON.stringify(cleanComponent(state.component), null, 2), "Discord payload copied") }, "Copy Discord payload"),
      h("button", { class: "btn sm", onclick: () => { try { jsonTa.value = JSON.stringify(JSON.parse(jsonTa.value), null, 2); } catch {} } }, "Format"),
    ),
  );
}
function syncJson() {
  if (!jsonTa || document.activeElement === jsonTa) return;
  jsonTa.value = JSON.stringify(state, null, 2);
  jsonMsg.className = "ok";
  jsonMsg.textContent = "Valid JSON";
}
let htmlTa;
function pageFor(id) {
  return renderPage(exportForRender(), { oembedHref: needsOembed(state) ? `${WORKER_URL}/e/${id}/oembed.json` : null });
}
const exportForRender = () => normalize(exportData());
function buildHtml() {
  const root = $("#pane-html");
  htmlTa = h("textarea", { class: "code-ta", readonly: true, spellcheck: "false", "aria-label": "Generated HTML" });
  root.replaceChildren(
    h("div", { class: "hint" }, "This is the exact page Discord's crawler reads. It is what the link service serves when Discord opens your link."),
    htmlTa,
    h("div", { class: "pane-tools" },
      h("button", { class: "btn sm", onclick: () => navigator.clipboard.writeText(htmlTa.value).then(() => toast("HTML copied", "good")) }, "Copy HTML"),
      h("button", { class: "btn sm", onclick: () => download("index.html", htmlTa.value, "text/html") }, "Download index.html"),
    ),
  );
}
function syncHtml() {
  if (htmlTa) htmlTa.value = pageFor("a1b2c3d");
}
function download(name, text, type) {
  const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
}

/* ================= Discord preview ================= */
const img = (src, cls) => {
  const el = h("img", { src, class: cls, alt: "", referrerpolicy: "no-referrer" });
  el.addEventListener("error", () => (el.style.display = "none"));
  return el;
};
const timeLabel = () => "Today at " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function renderPreview() {
  const link = exampleLink();
  const body = state.use_component ? previewComponent() : previewClassic();
  $("#preview").replaceChildren(
    h("div", { class: "dc" },
      h("div", { class: "dc-msg" },
        h("div", { class: "dc-av", html: I.logo }),
        h("div", { class: "dc-main" },
          h("div", { class: "dc-meta" }, h("span", { class: "dc-name" }, "Some User"), h("span", { class: "dc-bot" }, "BOT"), h("span", { class: "dc-time" }, timeLabel())),
          h("a", { class: "dc-link", href: "#", onclick: (ev) => ev.preventDefault() }, link),
          body))));
}
function previewClassic() {
  const e = state.embed;
  const has = e.title || e.description || e.provider.name || e.author.name || isHttp(e.image.url);
  if (!has) return h("div", { class: "dc-empty" }, "Fill in the fields to see your embed.");
  const small = isHttp(e.image.url) && !e.image.large;
  const box = h("div", { class: "dc-embed" + (small ? " has-thumb" : "") });
  const c = hexToInt(e.color);
  if (c != null) box.style.borderLeftColor = intToHex(c);
  if (e.provider.name) box.append(h(e.provider.url ? "a" : "div", { class: "prov", href: isHttp(e.provider.url) ? e.provider.url : null }, e.provider.name));
  if (e.author.name) box.append(h(isHttp(e.author.url) ? "a" : "div", { class: "auth", href: isHttp(e.author.url) ? e.author.url : null }, e.author.name));
  if (e.title) box.append(h("a", { class: "ttl", href: "#", onclick: (ev) => ev.preventDefault() }, e.title));
  if (e.description) box.append(h("div", { class: "dsc" }, e.description.slice(0, 350)));
  if (isHttp(e.image.url)) box.append(img(e.image.url.trim(), small ? "thumb" : "big"));
  return box;
}
function previewComponent() {
  const payload = cleanComponent(state.component);
  const c = payload.component;
  if (!c.components.length) return h("div", { class: "dc-empty" }, "Add some components to see the layout.");
  const box = h("div", { class: "dc-cont" + (c.spoiler ? " spoil" : "") });
  if (c.accent_color != null) box.style.setProperty("--acc", intToHex(c.accent_color));
  for (const n of c.components) box.append(previewNode(n));
  return box;
}
function previewNode(n) {
  switch (n.type) {
    case 10: return h("div", { class: "dc-text", html: md(n.content) });
    case 14: return h("div", { class: "dc-sep" + (n.divider ? " div" : "") + (n.spacing === 2 ? " lg" : "") });
    case 9: {
      const a = n.accessory;
      return h("div", { class: "dc-sec" },
        h("div", { class: "txt" }, n.components.map((t) => h("div", { class: "dc-text", html: md(t.content) }))),
        a.type === 11 ? img(a.media.url, "acc-th") : linkBtn(a));
    }
    case 12: {
      const k = n.items.length;
      return h("div", { class: "dc-gal " + (k <= 4 ? "n" + k : "nm") }, n.items.map((i) => img(i.media.url)));
    }
    case 1: return h("div", { class: "dc-row" }, n.components.map(linkBtn));
  }
  return h("div");
}
const linkBtn = (b) => h("a", { class: "dc-btn", href: b.url, target: "_blank", rel: "noopener" }, b.emoji ? h("span", {}, b.emoji.name) : null, b.label ? h("span", {}, b.label) : null, h("span", { html: I.ext, style: "display:inline-flex" }));

/* ================= stats / validation ================= */
function report() {
  const warns = [];
  const stats = [];
  if (state.url && !isHttp(state.url)) warns.push({ bad: true, text: "URL must start with http:// or https://" });
  if (state.use_component) {
    const p = cleanComponent(state.component);
    const s = payloadStats(p);
    stats.push(["Payload", `${s.bytes} / ${LIMITS.bytes} bytes`, s.bytes > LIMITS.bytes ? "bad" : s.bytes > LIMITS.bytes * 0.85 ? "warn" : "", s.bytes / LIMITS.bytes]);
    stats.push(["Components", `${s.count} / ${LIMITS.components}`, s.count > LIMITS.components ? "bad" : "", s.count / LIMITS.components]);
    stats.push(["Gallery images", `${s.gallery} / ${LIMITS.gallery}`, s.gallery > LIMITS.gallery ? "bad" : "", s.gallery / LIMITS.gallery]);
    if (s.bytes > LIMITS.bytes) warns.push({ bad: true, text: "Payload is over 3,000 bytes. Discord will ignore the component embed." });
    if (s.count > LIMITS.components) warns.push({ bad: true, text: "More than 40 components. Discord will ignore the component embed." });
    if (!p.component.components.length) warns.push({ bad: true, text: "No valid components yet (buttons need an http(s) URL and a label or emoji)." });
  } else {
    const e = state.embed;
    stats.push(["Title", `${e.title.length} / 70`, e.title.length > 70 ? "warn" : "", e.title.length / 70]);
    stats.push(["Description", `${e.description.length} / 350`, e.description.length > 350 ? "warn" : "", e.description.length / 350]);
    if (e.title.length > 70) warns.push({ text: "Discord trims link-preview titles after about 70 bytes." });
    if (e.description.length > 350) warns.push({ text: "Discord trims link-preview descriptions after about 350 bytes." });
    if (e.image.url && !isHttp(e.image.url)) warns.push({ bad: true, text: "Image URL must be http(s)." });
    if (!e.title && !e.description && !isHttp(e.image.url) && !e.provider.name) warns.push({ text: "Nothing to show yet." });
  }
  return { warns, stats };
}
function renderStats() {
  const { warns, stats } = report();
  $("#stats").replaceChildren(...[
    ...stats.map(([l, v, cls, pct]) => h("div", {}, h("div", { class: "stat " + cls }, l, h("b", {}, v)), h("div", { class: "bar " + cls }, h("i", { style: `width:${Math.min(100, pct * 100)}%` })))),
    warns.length ? h("div", { class: "warns" }, warns.map((w) => h("div", { class: w.bad ? "bad" : "" }, w.text))) : null,
  ].filter(Boolean));
}

/* ================= update / rebuild ================= */
function update() {
  save();
  renderPreview();
  renderStats();
  if (tab === "json") syncJson();
  if (tab === "html") syncHtml();
}
function rebuild() {
  buildBuilder();
  update();
}
function setTab(t) {
  tab = t;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
  for (const p of ["builder", "json", "html"]) $("#pane-" + p).hidden = p !== t;
  if (t === "builder") buildBuilder();
  if (t === "json") syncJson();
  if (t === "html") syncHtml();
}

/* ================= toast + modal ================= */
function toast(msg, kind = "") {
  const t = h("div", { class: "toast " + kind }, msg);
  $("#toasts").append(t);
  setTimeout(() => t.remove(), 3800);
}
function modal(title, body, buttons = []) {
  const close = () => {
    ov.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => e.key === "Escape" && close();
  const ov = h("div", { class: "overlay", onmousedown: (e) => e.target === ov && close() },
    h("div", { class: "modal", role: "dialog", "aria-label": title },
      h("div", { class: "modal-h" }, h("h2", {}, title), h("button", { class: "ib", html: I.x, onclick: close, "aria-label": "Close" })),
      h("div", { class: "modal-b" }, body),
      buttons.length ? h("div", { class: "modal-f" }, buttons) : null));
  document.addEventListener("keydown", onKey);
  $("#modal-root").append(ov);
  return { close, el: ov };
}

/* ================= create link ================= */
function blockers() {
  const out = [];
  if (state.url && !isHttp(state.url)) out.push("The redirect URL must start with http:// or https://");
  if (state.use_component) {
    const p = cleanComponent(state.component);
    const s = payloadStats(p);
    if (!p.component.components.length) out.push("Add at least one valid component first.");
    if (s.bytes > LIMITS.bytes) out.push(`Component payload is ${s.bytes} bytes; the limit is ${LIMITS.bytes}.`);
    if (s.count > LIMITS.components) out.push("Too many components (max 40).");
  } else {
    const e = state.embed;
    if (!e.title && !e.description && !isHttp(e.image.url) && !e.provider.name && !e.author.name) out.push("Add a title, description or image first.");
  }
  return out;
}
const linkTitle = () => (state.use_component ? (JSON.stringify(state.component).match(/"content":"([^"]{1,60})/)?.[1] || "Component embed").replace(/^[#\-\s]+/, "") : state.embed.title || state.embed.description.slice(0, 50) || "Embed link");

async function createLink() {
  const bl = blockers();
  if (bl.length) return toast(bl[0], "bad");
  const data = exportForRender();

  const status = h("div", { class: "status" }, h("span", { class: "dot spin" }), h("span", {}, "Creating link…"));
  const linkInput = h("input", { class: "in", readonly: true, value: "", "aria-label": "Embed link" });
  const body = h("div", {}, h("div", { class: "copy-row" }, linkInput, h("button", { class: "btn", onclick: () => linkInput.value && navigator.clipboard.writeText(linkInput.value).then(() => toast("Link copied", "good")) }, "Copy")), status);
  const openBtn = h("a", { class: "btn", href: "#", target: "_blank", rel: "noopener", hidden: true }, "Open");
  const m = modal("Create Link", body, [
    h("a", { class: "btn ghost", href: "https://discord.com/developers/embeds", target: "_blank", rel: "noopener" }, "Embed Debugger"),
    openBtn,
    h("button", { class: "btn primary", onclick: () => m.close() }, "Done"),
  ]);
  const setStatus = (text, cls = "") => status.replaceChildren(h("span", { class: "dot " + cls }), h("span", {}, text));

  try {
    let link = "";
    try {
      const r = await fetch(`${WORKER_URL}/api/create`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      if (r.ok) link = (await r.json()).url;
    } catch {}
    if (!link) {
      // Link service unreachable or storage missing: fall back to a self-contained link.
      link = `${WORKER_URL}/?d=${await encodeData(data)}`;
      if (link.length > 2000) throw new Error("Couldn't reach the link service, and this embed is too long for a fallback link. Try again in a moment.");
    }
    linkInput.value = link;
    openBtn.href = link;
    openBtn.hidden = false;
    linkInput.select();
    const all = readLS(LINKKEY, []);
    all.unshift({ id: link.split("/").pop(), link, title: linkTitle(), created: Date.now(), data: exportData() });
    localStorage.setItem(LINKKEY, JSON.stringify(all.slice(0, 100)));
    setStatus("Ready. Paste it in Discord.", "on");
  } catch (err) {
    setStatus(err.message || String(err));
    status.style.color = "var(--red)";
  }
}

/* ================= my links ================= */
function openLinks() {
  const render = () => {
    const all = readLS(LINKKEY, []);
    list.replaceChildren(...(all.length ? all.map(item) : [h("div", { class: "note" }, "Links you create show up here.")]));
  };
  const item = (l) => h("div", { class: "link-item" },
    h("div", { class: "t" }, l.title),
    h("div", { class: "u" }, l.link),
    h("div", { class: "b" },
      h("button", { class: "btn sm", onclick: () => navigator.clipboard.writeText(l.link).then(() => toast("Link copied", "good")) }, "Copy"),
      h("button", { class: "btn sm", onclick: () => { state = normalize(l.data); save(); setTab("builder"); update(); m.close(); toast("Loaded into the editor"); } }, "Edit as new"),
      h("button", { class: "btn sm danger", onclick: () => {
        localStorage.setItem(LINKKEY, JSON.stringify(readLS(LINKKEY, []).filter((x) => x.id !== l.id)));
        render();
      } }, "Remove")));
  const list = h("div", { class: "links-list" });
  render();
  const m = modal("My links", list, [h("button", { class: "btn primary", onclick: () => m.close() }, "Close")]);
}

/* ================= init ================= */
function init() {
  $("#railMain").innerHTML = I.pen;
  $("#railLinks").innerHTML = I.list;
  $("#railGit").innerHTML = I.git;
  $("#railMain").onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });
  $("#railLinks").onclick = openLinks;
  $("#createBtn").onclick = createLink;
  $("#resetBtn").onclick = () => {
    const m = modal("Reset editor?", h("p", {}, "This clears everything you've typed. Links you already created are not affected."), [
      h("button", { class: "btn ghost", onclick: () => m.close() }, "Cancel"),
      h("button", { class: "btn danger", onclick: () => { state = defaults(); state.use_component = false; rebuild(); setTab(tab); m.close(); } }, "Reset"),
    ]);
  };
  document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  buildJson();
  buildHtml();
  buildBuilder();
  update();
  window.__eml = { get state() { return state; } }; // handy for debugging in the console
}
init();
