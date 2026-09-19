import csv
import json
import sys
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent

KIND_TO_TMDB_TYPE = {"movies": "movie", "series": "tv"}
TMDB_PROXY_URL = "https://cositeca-tmdb-proxy.christt105.workers.dev"
REPO_URL = "https://github.com/christt105/cositeca"
CATALOG_URL = "https://christt105.github.io/cositeca/catalog.json"

REASON_LABELS = {
    "anio_imposible": "Año imposible",
    "ambiguo_muchos_candidatos": "Ambiguo, muchos candidatos",
    "posible_serie_en_peliculas": "Posible serie en películas",
}

TEMPLATE = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cositeca - revisión de matches dudosos</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; background: #14161a; color: #e8e8e8; margin: 0; padding: 1rem 1rem 5.5rem; }
  h1 { font-size: 1.2rem; }
  #summary { color: #9aa0a8; margin-bottom: 1rem; font-size: 0.9rem; }
  .filters { display: flex; flex-wrap: wrap; }
  .filters button { margin: 0 0.4rem 0.6rem 0; padding: 0.45rem 0.8rem; border-radius: 999px; border: 1px solid #444; background: #1f2226; color: #ccc; cursor: pointer; font-size: 0.85rem; }
  .filters button.active { background: #3a5a8c; border-color: #3a5a8c; color: #fff; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 0.9rem; }
  .card { background: #1c1f24; border: 1px solid #2b2f36; border-radius: 10px; padding: 0.8rem; display: flex; gap: 0.8rem; }
  .card.done { opacity: 0.35; }
  .card img { width: 72px; height: 108px; object-fit: cover; border-radius: 6px; background: #333; flex: none; }
  .card .body { flex: 1; min-width: 0; }
  .card .raw { font-size: 0.85rem; color: #cfd3d8; word-break: break-word; }
  .card .match { font-weight: 600; margin: 0.2rem 0; word-break: break-word; }
  .badges { margin: 0.3rem 0; }
  .badge { display: inline-block; font-size: 0.7rem; padding: 0.15rem 0.55rem; border-radius: 999px; background: #4a3720; color: #f0c987; margin: 0 0.3rem 0.3rem 0; }
  .badge--audio { background: #234a3a; color: #8fe0bd; }
  .badge--subs { background: #24344a; color: #8fc0f0; }
  .links a { color: #7cb2ff; margin-right: 0.9rem; font-size: 0.85rem; display: inline-block; padding: 0.2rem 0; }
  .fix { margin-top: 0.5rem; }
  .fix .current { font-size: 0.82rem; color: #9aa0a8; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .fix .corrected { color: #8fe0bd; }
  .fix button.toggle-search { margin-top: 0.35rem; padding: 0.4rem 0.7rem; border-radius: 6px; border: 1px solid #444; background: #1f2226; color: #ccc; font-size: 0.82rem; cursor: pointer; }
  .fix button.undo { background: none; border: none; color: #e08787; text-decoration: underline; cursor: pointer; font-size: 0.8rem; padding: 0; }
  .search-box { margin-top: 0.5rem; }
  .search-box input[type=search] { width: 100%; padding: 0.5rem 0.6rem; border-radius: 6px; border: 1px solid #444; background: #101214; color: #eee; font-size: 0.9rem; }
  .search-results { margin-top: 0.4rem; display: flex; flex-direction: column; gap: 0.3rem; max-height: 60vh; overflow-y: auto; }
  .search-results button { display: flex; gap: 0.5rem; align-items: center; text-align: left; background: #14161a; border: 1px solid #2b2f36; border-radius: 6px; padding: 0.4rem; color: #eee; cursor: pointer; width: 100%; }
  .search-results button:active, .search-results button:hover { background: #23272e; }
  .search-results button:disabled { opacity: 0.45; cursor: default; }
  .search-results img { width: 34px; height: 51px; object-fit: cover; border-radius: 4px; background: #333; flex: none; }
  .search-hint { font-size: 0.82rem; color: #9aa0a8; margin-top: 0.3rem; }
  label.done-label { font-size: 0.78rem; color: #9aa0a8; display: flex; gap: 0.4rem; align-items: center; margin-top: 0.5rem; }
  label.done-label input { width: 1.1rem; height: 1.1rem; }
  #save-bar { position: fixed; bottom: 0; left: 0; right: 0; padding: 0.7rem 1rem; background: #1c1f24; border-top: 1px solid #2b2f36; display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; flex-wrap: wrap; }
  #save-status { font-size: 0.82rem; color: #9aa0a8; }
  #export, #send, #mark-sent, #resend { padding: 0.7rem 1.1rem; border-radius: 8px; border: none; color: #fff; font-size: 0.95rem; cursor: pointer; }
  #export { background: #3a8c5a; }
  #send { background: #3a5a8c; text-decoration: none; display: inline-block; -webkit-touch-callout: default; }
  #send.disabled { background: #2b2f36; color: #777; pointer-events: none; }
  #mark-sent, #resend { background: #2b2f36; }
  #missing { margin-top: 2.5rem; font-size: 1.05rem; }
  #missing table { border-collapse: collapse; width: 100%; font-size: 0.8rem; }
  #missing td, #missing th { border-bottom: 1px solid #2b2f36; padding: 0.35rem 0.4rem; text-align: left; }
  .card.applied { opacity: 0.55; }
  .card.sent { border-color: #3a5a8c; }
  .badge--ok { background: #234a3a; color: #8fe0bd; }
  .badge--pending { background: #24344a; color: #8fc0f0; }
  .fix .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin-top: 0.4rem; }
  .fix .actions button { padding: 0.4rem 0.7rem; border-radius: 6px; border: 1px solid #444; background: #1f2226; color: #ccc; font-size: 0.82rem; cursor: pointer; }
  .fix .actions button.ok { background: #234a3a; border-color: #2f6b52; color: #cfeee0; }
  .fix .season { margin-top: 0.4rem; font-size: 0.82rem; color: #f0c987; display: flex; gap: 0.4rem; align-items: center; }
  .fix .season input { width: 6rem; padding: 0.3rem 0.4rem; border-radius: 6px; border: 1px solid #444; background: #101214; color: #eee; }
  #more { margin: 1rem auto; display: block; padding: 0.6rem 1.2rem; border-radius: 8px; border: 1px solid #444; background: #1f2226; color: #ccc; cursor: pointer; }
  #catalog-status { color: #9aa0a8; font-size: 0.82rem; margin-bottom: 0.8rem; }
  #catalog-status button { background: none; border: none; color: #7cb2ff; text-decoration: underline; cursor: pointer; font-size: 0.82rem; padding: 0; }
  @media (min-width: 600px) {
    body { padding: 1.5rem 1.5rem 4rem; }
  }
</style>
</head>
<body>
<h1>Cositeca &mdash; revisión de matches dudosos (ctgrev)</h1>
<div id="summary"></div>
<div id="catalog-status"></div>
<div class="filters" id="status-filters"></div>
<div class="filters" id="reason-filters"></div>
<div class="grid" id="grid"></div>
<button id="more" type="button" style="display:none"></button>

<h2 id="missing">Sin match ni parseo (__MISSING_COUNT__)</h2>
<p style="color:#9aa0a8">No son correcciones, son mensajes que no se casaron con nada; toca añadirlos a mano cuando exista la página de Añadir.</p>
<table>
<thead><tr><th>Tipo</th><th>Fecha</th><th>Texto</th><th>Estado</th><th>Link</th></tr></thead>
<tbody id="missing-body"></tbody>
</table>

<div id="save-bar">
  <span id="save-status">&nbsp;</span>
  <button id="resend" type="button" style="display:none">Reenviar</button>
  <button id="mark-sent" type="button" style="display:none">Marcar como enviadas</button>
  <a id="send" role="button">Enviar como lote</a>
  <button id="export">Descargar corrections.csv</button>
</div>

<script>
const SUSPECTS = __SUSPECTS_JSON__;
const MISSING = __MISSING_JSON__;
const REASON_LABELS = __REASON_LABELS_JSON__;
const STORAGE_KEY = "cositeca-review-state";
const TMDB_PROXY_URL = "__TMDB_PROXY_URL__";
const REPO_URL = "__REPO_URL__";
const CATALOG_URL = "__CATALOG_URL__";
const IMG = "https://image.tmdb.org/t/p";
const MAX_OPS = 50;
const URL_LIMIT = 6500;
const PAGE = 60;
const NL = String.fromCharCode(10);

const STATUS_LABELS = {
  pending: "Pendientes",
  queued: "Por enviar",
  applied: "Ya aplicados",
  done: "Revisados",
  all: "Todos",
};

let current = null;
let catalogNote = "";
let searchTimer = null;
let searchSeq = 0;
let openSearchKey = null;
let activeStatus = "pending";
let activeReason = "all";
let limit = PAGE;
const searchQueries = {};

function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
const state = loadState();

let autoSaveTimer = null;
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(saveToServer, 600);
}

function rowKey(row) { return row.kind + ":" + row.id; }
function tmdbType(kind) { return kind === "series" ? "tv" : "movie"; }
function tmdbHref(kind, id) { return "https://www.themoviedb.org/" + tmdbType(kind) + "/" + id; }

async function loadCatalog() {
  const status = document.getElementById("catalog-status");
  status.textContent = "Cargando el catálogo publicado…";
  try {
    const res = await fetch(CATALOG_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(String(res.status));
    const items = await res.json();
    const map = new Map();
    for (const item of items) {
      const kind = item.type === "series" ? "series" : "movies";
      for (const l of item.links) {
        map.set(l.link, { kind, tmdb: String(item.tmdb), title: item.title, year: item.year || "", poster: item.poster || "" });
      }
    }
    current = map;
    const modified = res.headers.get("last-modified");
    catalogNote = items.length + " títulos" + (modified ? ", publicado " + new Date(modified).toLocaleString("es-ES") : "");
  } catch (err) {
    current = null;
    catalogNote = "";
    status.textContent = "No se pudo cargar el catálogo publicado (" + err.message + "), se muestran los datos de la importación. ";
    addReloadButton(status);
    return;
  }
  status.textContent = "Catálogo publicado: " + catalogNote + ". ";
  addReloadButton(status);
}

function addReloadButton(box) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = "Recargar";
  b.onclick = async () => { await loadCatalog(); render(); };
  box.appendChild(b);
}

function locate(row) {
  if (!current) return { state: "unknown", source: { kind: row.kind, tmdb: row.tmdb_id } };
  const c = current.get(row.link);
  if (!c) return { state: "gone", source: null };
  if (row.tmdb_id && (c.tmdb !== row.tmdb_id || c.kind !== row.kind)) return { state: "moved", source: c, c };
  return { state: "same", source: c, c };
}

function correctionOf(row, loc) {
  const saved = state[rowKey(row)] || {};
  if (!saved.new_tmdb_id) return null;
  const src = loc.source;
  if (src && saved.new_tmdb_id === src.tmdb && (saved.new_kind || row.kind) === src.kind) return null;
  return saved;
}

function needsSeason(loc, saved) {
  return loc.source && loc.source.kind === "movies" && saved.new_kind === "series";
}

function isApplied(loc) { return loc.state === "moved" || loc.state === "gone"; }

function category(row) {
  const loc = locate(row);
  const saved = state[rowKey(row)] || {};
  const correction = loc.state === "same" || loc.state === "unknown" ? correctionOf(row, loc) : null;
  return { loc, saved, correction };
}

function matchesStatus(cat) {
  switch (activeStatus) {
    case "pending": return !isApplied(cat.loc) && !cat.saved.done;
    case "queued": return !isApplied(cat.loc) && Boolean(cat.correction);
    case "applied": return isApplied(cat.loc);
    case "done": return Boolean(cat.saved.done);
    default: return true;
  }
}

function buildOps() {
  const ready = [];
  const blocked = [];
  for (const row of SUSPECTS) {
    const cat = category(row);
    if (!cat.correction || isApplied(cat.loc) || cat.saved.sent) continue;
    const src = cat.loc.source;
    const op = {
      type: "reidentify",
      tmdb: tmdbHref(src.kind, src.tmdb),
      new_tmdb: tmdbHref(cat.saved.new_kind || row.kind, cat.saved.new_tmdb_id),
      old_link: row.link,
    };
    if (needsSeason(cat.loc, cat.saved)) {
      const season = String(cat.saved.season || "").trim();
      if (!season) { blocked.push(row); continue; }
      op.season = season;
    }
    ready.push({ key: rowKey(row), op });
  }
  return { ready, blocked };
}

function buildCorrectionsCsv() {
  const rows = [["kind", "old_tmdb_id", "link", "new_kind", "new_tmdb_id"]];
  for (const row of SUSPECTS) {
    const cat = category(row);
    if (!cat.correction || isApplied(cat.loc)) continue;
    const src = cat.loc.source;
    rows.push([src.kind, src.tmdb, row.link, cat.saved.new_kind || row.kind, cat.saved.new_tmdb_id]);
  }
  return rows.map(r => r.map(v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"').join(",")).join(NL);
}

function setSaveStatus(text) {
  const el = document.getElementById("save-status");
  if (el) el.textContent = text;
}

async function saveToServer() {
  try {
    const res = await fetch("save-corrections", { method: "POST", body: buildCorrectionsCsv() });
    if (!res.ok) throw new Error(String(res.status));
    await fetch("save-state", { method: "POST", body: JSON.stringify(state) });
  } catch (err) {
    setSaveStatus("No se pudo guardar en el servidor, usa Descargar como respaldo");
  }
}

function batchUrl(ops) {
  const url = new URL(REPO_URL + "/issues/new");
  url.searchParams.set("template", "batch.yml");
  url.searchParams.set("operations", JSON.stringify(ops));
  return url.toString();
}

function nextChunk() {
  const { ready, blocked } = buildOps();
  const chunk = [];
  for (const item of ready) {
    if (chunk.length >= MAX_OPS) break;
    if (chunk.length > 0 && batchUrl([...chunk, item].map(x => x.op)).length > URL_LIMIT) break;
    chunk.push(item);
  }
  return { chunk, total: ready.length, blocked };
}

function updateSendBar() {
  const { chunk, total, blocked } = nextChunk();
  const send = document.getElementById("send");
  const markSent = document.getElementById("mark-sent");
  if (chunk.length === 0) {
    send.classList.add("disabled");
    send.removeAttribute("href");
    send.removeAttribute("target");
    send.textContent = "Nada que enviar";
    markSent.style.display = "none";
  } else {
    send.classList.remove("disabled");
    send.href = batchUrl(chunk.map(x => x.op));
    send.target = "_blank";
    send.rel = "noopener";
    send.textContent = total > chunk.length ? "Enviar " + chunk.length + " de " + total + " como lote" : "Enviar " + chunk.length + " como lote";
    markSent.style.display = "inline-block";
    markSent.textContent = "Marcar " + chunk.length + " como enviadas";
  }
  const parts = [];
  if (blocked.length) parts.push(blocked.length + " sin temporada (película a serie)");
  const sent = SUSPECTS.filter(r => { const c = category(r); return c.saved.sent && !isApplied(c.loc) && c.correction; }).length;
  if (sent) parts.push(sent + " enviadas, esperando a que se apliquen");
  const resend = document.getElementById("resend");
  resend.style.display = sent ? "inline-block" : "none";
  resend.textContent = "Reenviar las " + sent + " enviadas";
  setSaveStatus(parts.join(" · ") || " ");
}

function resendSent() {
  for (const row of SUSPECTS) {
    const key = rowKey(row);
    if (state[key] && state[key].sent) state[key] = { ...state[key], sent: undefined };
  }
  saveState();
  render();
}

function markChunkSent() {
  const { chunk } = nextChunk();
  const now = Date.now();
  for (const x of chunk) state[x.key] = { ...state[x.key], sent: now };
  saveState();
  render();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function badge(text, cls) { return el("span", "badge" + (cls ? " " + cls : ""), text); }

function render() {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  const cats = SUSPECTS.map(row => ({ row, cat: category(row) }));

  const statusCounts = { pending: 0, queued: 0, applied: 0, done: 0, all: cats.length };
  for (const { cat } of cats) {
    if (!isApplied(cat.loc) && !cat.saved.done) statusCounts.pending++;
    if (!isApplied(cat.loc) && cat.correction) statusCounts.queued++;
    if (isApplied(cat.loc)) statusCounts.applied++;
    if (cat.saved.done) statusCounts.done++;
  }
  renderStatusFilters(statusCounts);

  const inStatus = cats.filter(({ cat }) => matchesStatus(cat));
  renderReasonFilters(inStatus);
  const visible = inStatus.filter(({ row }) => activeReason === "all" || row.reasons.split(",").includes(activeReason));
  document.getElementById("summary").textContent = visible.length + " mostrados de " + SUSPECTS.length + " sospechosos";

  for (const { row, cat } of visible.slice(0, limit)) grid.appendChild(renderCard(row, cat));

  const more = document.getElementById("more");
  more.style.display = visible.length > limit ? "block" : "none";
  more.textContent = "Mostrar más (" + (visible.length - limit) + " restantes)";
  updateSendBar();
}

function renderCard(row, cat) {
  const { loc, saved, correction } = cat;
  const key = rowKey(row);
  const shown = loc.c || { title: row.catalog_title || row.tmdb_title, year: row.tmdb_year, tmdb: row.tmdb_id, poster: row.catalog_poster };
  const card = el("div", "card" + (isApplied(loc) ? " applied" : "") + (saved.done ? " done" : "") + (saved.sent && correction ? " sent" : ""));

  const img = el("img");
  img.src = shown.poster || row.catalog_poster || "";
  img.alt = "";
  card.appendChild(img);

  const body = el("div", "body");
  body.appendChild(el("div", "raw", row.raw));
  const kind = loc.c ? loc.c.kind : row.kind;
  body.appendChild(el("div", "match", "→ " + (shown.title || "?") + " (" + (shown.year || "?") + ") · tmdb " + (shown.tmdb || "?")));

  const badges = el("div", "badges");
  if (loc.state === "moved") badges.appendChild(badge("✓ Ya corregido en el catálogo", "badge--ok"));
  if (loc.state === "gone") badges.appendChild(badge("Ya no está en el catálogo", "badge--ok"));
  if (correction && saved.sent) {
    const sentBadge = badge("Enviada (toca para reenviar)", "badge--pending");
    sentBadge.style.cursor = "pointer";
    sentBadge.onclick = () => { state[rowKey(row)] = { ...state[rowKey(row)], sent: undefined }; saveState(); render(); };
    badges.appendChild(sentBadge);
  }
  else if (correction) badges.appendChild(badge("Por enviar", "badge--pending"));
  for (const reason of row.reasons.split(",")) badges.appendChild(badge(REASON_LABELS[reason] || reason));
  for (const audio of (row.audio || "").split(",").filter(Boolean)) badges.appendChild(badge("🔊 " + audio, "badge--audio"));
  for (const sub of (row.subs || "").split(",").filter(Boolean)) badges.appendChild(badge("CC " + sub, "badge--subs"));
  body.appendChild(badges);

  const links = el("div", "links");
  if (shown.tmdb) {
    const a = el("a", "", "Ver en TMDB");
    a.href = tmdbHref(kind, shown.tmdb); a.target = "_blank";
    links.appendChild(a);
  }
  const t = el("a", "", "Ver mensaje");
  t.href = row.link; t.target = "_blank";
  links.appendChild(t);
  body.appendChild(links);

  if (isApplied(loc)) {
    card.appendChild(body);
    return card;
  }

  const fix = el("div", "fix");
  fix.dataset.key = key;
  if (correction) {
    const current = el("div", "current");
    current.appendChild(el("span", "corrected", "→ Corregir a: " + (correction.new_title || (correction.new_kind + " " + correction.new_tmdb_id))));
    const undo = el("button", "undo", "deshacer");
    undo.onclick = () => {
      state[key] = { ...state[key], new_tmdb_id: undefined, new_kind: undefined, new_title: undefined, season: undefined, sent: undefined };
      saveState();
      render();
    };
    current.appendChild(undo);
    fix.appendChild(current);
    if (needsSeason(loc, correction)) {
      const wrap = el("label", "season", "Temporada (número, 0 o all):");
      const input = el("input");
      input.type = "text";
      input.value = correction.season || "";
      input.oninput = () => { state[key] = { ...state[key], season: input.value.trim() }; saveState(); updateSendBar(); };
      wrap.appendChild(input);
      fix.appendChild(wrap);
    }
  }

  const actions = el("div", "actions");
  const searchBtn = el("button", "", correction ? "Buscar otro" : "Corregir");
  searchBtn.type = "button";
  searchBtn.onclick = () => {
    openSearchKey = openSearchKey === key ? null : key;
    render();
  };
  actions.appendChild(searchBtn);
  const okBtn = el("button", saved.done ? "" : "ok", saved.done ? "Quitar revisado" : "✓ Está bien");
  okBtn.type = "button";
  okBtn.onclick = () => {
    state[key] = { ...state[key], done: !saved.done };
    saveState();
    render();
  };
  actions.appendChild(okBtn);
  fix.appendChild(actions);

  if (openSearchKey === key) {
    const box = el("div", "search-box");
    const input = el("input");
    input.type = "search";
    input.autocomplete = "off";
    input.placeholder = "Título, URL de TMDB o tt1234567";
    input.value = searchQueries[key] !== undefined ? searchQueries[key] : (row.title || "");
    const results = el("div", "search-results");
    box.appendChild(input);
    box.appendChild(results);
    fix.appendChild(box);
    input.oninput = () => {
      searchQueries[key] = input.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runSearch(input.value.trim(), results, key, loc.source), 300);
    };
    setTimeout(() => {
      input.focus();
      input.select();
      runSearch(input.value.trim(), results, key, loc.source);
    }, 0);
  }

  body.appendChild(fix);
  card.appendChild(body);
  return card;
}

async function proxyGet(path) {
  const res = await fetch(TMDB_PROXY_URL + path);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

async function findHits(query) {
  const url = query.match(/themoviedb[.]org[/](movie|tv)[/]([0-9]+)/);
  if (url) {
    const info = await proxyGet("/" + url[1] + "/" + url[2]);
    return [{ ...info, media_type: url[1] }];
  }
  if (/^tt[0-9]+$/.test(query)) {
    const found = await proxyGet("/find/" + query);
    return [
      ...(found.movie_results || []).map(r => ({ ...r, media_type: "movie" })),
      ...(found.tv_results || []).map(r => ({ ...r, media_type: "tv" })),
    ];
  }
  const data = await proxyGet("/search?q=" + encodeURIComponent(query) + "&type=multi");
  return (data.results || []).filter(r => r.media_type === "movie" || r.media_type === "tv").slice(0, 8);
}

async function runSearch(query, resultsBox, key, source) {
  if (!query) { resultsBox.innerHTML = ""; return; }
  if (!TMDB_PROXY_URL) {
    resultsBox.innerHTML = '<p class="search-hint">Sin proxy de TMDB configurado.</p>';
    return;
  }
  const seq = ++searchSeq;
  resultsBox.innerHTML = '<p class="search-hint">Buscando…</p>';
  try {
    const hits = await findHits(query);
    if (seq !== searchSeq) return;
    if (hits.length === 0) {
      resultsBox.innerHTML = '<p class="search-hint">Sin resultados.</p>';
      return;
    }
    resultsBox.innerHTML = "";
    for (const hit of hits) {
      const title = hit.title || hit.name || "?";
      const year = (hit.release_date || hit.first_air_date || "").slice(0, 4);
      const isCurrent = source && String(hit.id) === source.tmdb && (hit.media_type === "tv" ? "series" : "movies") === source.kind;
      const btn = el("button");
      btn.type = "button";
      btn.disabled = Boolean(isCurrent);
      const img = el("img");
      img.src = hit.poster_path ? IMG + "/w92" + hit.poster_path : "";
      img.alt = "";
      btn.appendChild(img);
      btn.appendChild(el("span", "", title + " (" + (year || "?") + ") · " + (hit.media_type === "tv" ? "serie" : "película") + " · tmdb " + hit.id + (isCurrent ? " · actual" : "")));
      btn.onclick = () => {
        state[key] = {
          ...state[key],
          new_kind: hit.media_type === "tv" ? "series" : "movies",
          new_tmdb_id: String(hit.id),
          new_title: title + " (" + (year || "?") + ")",
          sent: undefined,
        };
        saveState();
        openSearchKey = null;
        render();
      };
      resultsBox.appendChild(btn);
    }
  } catch (err) {
    if (seq !== searchSeq) return;
    resultsBox.innerHTML = '<p class="search-hint">Error buscando: ' + err.message + "</p>";
  }
}

function renderStatusFilters(counts) {
  const box = document.getElementById("status-filters");
  box.innerHTML = "";
  for (const key of Object.keys(STATUS_LABELS)) {
    const btn = el("button", key === activeStatus ? "active" : "", STATUS_LABELS[key] + " (" + counts[key] + ")");
    btn.onclick = () => { activeStatus = key; limit = PAGE; render(); };
    box.appendChild(btn);
  }
}

function renderReasonFilters(rows) {
  const counts = { all: rows.length };
  for (const { row } of rows) {
    for (const reason of row.reasons.split(",")) counts[reason] = (counts[reason] || 0) + 1;
  }
  if (!(activeReason in counts)) activeReason = "all";
  const box = document.getElementById("reason-filters");
  box.innerHTML = "";
  for (const [key, count] of Object.entries(counts)) {
    const btn = el("button", key === activeReason ? "active" : "", (key === "all" ? "Todos los motivos" : (REASON_LABELS[key] || key)) + " (" + count + ")");
    btn.onclick = () => { activeReason = key; limit = PAGE; render(); };
    box.appendChild(btn);
  }
}

function renderMissing() {
  const body = document.getElementById("missing-body");
  for (const row of MISSING) {
    const tr = document.createElement("tr");
    for (const value of [row.kind, row.date || "", row.raw, row.status]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }
    const linkTd = document.createElement("td");
    const a = el("a", "", "abrir");
    a.href = row.link; a.target = "_blank";
    linkTd.appendChild(a);
    tr.appendChild(linkTd);
    body.appendChild(tr);
  }
}

document.getElementById("more").onclick = () => { limit += PAGE; render(); };
document.getElementById("send").addEventListener("click", () => setTimeout(markChunkSent, 0));
document.getElementById("mark-sent").onclick = markChunkSent;
document.getElementById("resend").onclick = resendSent;
document.getElementById("export").onclick = () => {
  const blob = new Blob([buildCorrectionsCsv()], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "corrections.csv";
  a.click();
};

async function mergeServerState() {
  try {
    const res = await fetch("state.json", { cache: "no-cache" });
    if (!res.ok) return;
    const remote = await res.json();
    for (const [key, value] of Object.entries(remote)) {
      const local = state[key] || {};
      state[key] = { ...value, ...Object.fromEntries(Object.entries(local).filter(([, v]) => v !== undefined && v !== null)) };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

renderMissing();
mergeServerState().then(() => {
  render();
  loadCatalog().then(() => { render(); saveToServer(); });
});
</script>
</body>
</html>
"""


def main(suspects_path, missing_path, out_path):
    with open(suspects_path, newline="") as f:
        suspects = list(csv.DictReader(f))
    with open(missing_path, newline="") as f:
        missing = list(csv.DictReader(f))

    def embed(value):
        return json.dumps(value, ensure_ascii=False).replace("</script", "<\\/script")

    html = (
        TEMPLATE
        .replace("__MISSING_COUNT__", str(len(missing)))
        .replace("__SUSPECTS_JSON__", embed(suspects))
        .replace("__MISSING_JSON__", embed(missing))
        .replace("__REASON_LABELS_JSON__", embed(REASON_LABELS))
        .replace("__TMDB_PROXY_URL__", TMDB_PROXY_URL)
        .replace("__REPO_URL__", REPO_URL)
        .replace("__CATALOG_URL__", CATALOG_URL)
    )
    with open(out_path, "w") as f:
        f.write(html)
    print(f"wrote {out_path} with {len(suspects)} suspects, {len(missing)} missing")


if __name__ == "__main__":
    main(
        sys.argv[1] if len(sys.argv) > 1 else "cache/suspects.csv",
        sys.argv[2] if len(sys.argv) > 2 else "cache/missing.csv",
        sys.argv[3] if len(sys.argv) > 3 else "cache/review.html",
    )
