import { tmdbUrl, imdbUrl, issueUrl } from "./rules.js";

const headerTools = document.getElementById("header-tools");
const searchInput = document.getElementById("search");
const filtersEl = document.getElementById("filters");
const audioFilter = document.getElementById("audio-filter");
const subsFilter = document.getElementById("subs-filter");
const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const views = {
  grid: document.getElementById("view-grid"),
  title: document.getElementById("view-title"),
  add: document.getElementById("view-add"),
  missing: document.getElementById("view-missing"),
};

const ICONS = {
  movie: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v2h2V6H5zm12 0v2h2V6h-2zM5 10v2h2v-2H5zm12 0v2h2v-2h-2zM5 14v2h2v-2H5zm12 0v2h2v-2h-2zM9 6v12h6V6H9z"/></svg>`,
  series: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-6l2 2H7l2-2H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm1 2v8h16V8H4z"/></svg>`,
};
const TYPE_LABELS = { movie: "Película", series: "Serie" };

let catalog = [];
let byKey = new Map();
let visitedWithinApp = false;

function esc(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalize(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function titleHref(item) {
  return `#/${item.type}/${item.tmdb}`;
}

function typeIcon(type, extra = "") {
  return `<span class="type-icon" title="${TYPE_LABELS[type]}" aria-label="${TYPE_LABELS[type]}">${ICONS[type]}${extra ? `<span>${esc(extra)}</span>` : ""}</span>`;
}

function seasonSummary(item) {
  if (item.type !== "series") return "";
  const seasons = [...new Set(item.links.map((l) => l.season))];
  if (seasons.some((s) => typeof s !== "number")) return "";
  seasons.sort((a, b) => a - b);
  if (seasons.length === 1) return `T${seasons[0]}`;
  const contiguous = seasons.every((s, i) => i === 0 || s === seasons[i - 1] + 1);
  return contiguous
    ? `T${seasons[0]}-${seasons[seasons.length - 1]}`
    : `T${seasons.join(",")}`;
}

function parseRoute() {
  const hash = location.hash.startsWith("#/") ? location.hash.slice(2) : "";
  const [path, query = ""] = hash.split("?");
  const params = new URLSearchParams(query);
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return { view: "grid", params };
  if (parts[0] === "add") return { view: "add", params };
  if ((parts[0] === "movie" || parts[0] === "series") && /^\d+$/.test(parts[1] ?? "")) {
    return { view: "title", type: parts[0], id: Number(parts[1]) };
  }
  return { view: "missing" };
}

function gridState() {
  const type = filtersEl.querySelector(".filter-btn.is-active")?.dataset.filter ?? "all";
  return {
    q: searchInput.value.trim(),
    type: type === "all" ? "" : type,
    audio: audioFilter.value,
    subs: subsFilter.value,
  };
}

function gridHash(state) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `#/?${query}` : "#/";
}

function applyGridState(params) {
  searchInput.value = params.get("q") ?? "";
  const type = params.get("type") || "all";
  for (const b of filtersEl.querySelectorAll(".filter-btn")) {
    b.classList.toggle("is-active", b.dataset.filter === type);
  }
  audioFilter.value = params.get("audio") ?? "";
  subsFilter.value = params.get("subs") ?? "";
}

function showView(name) {
  for (const [key, el] of Object.entries(views)) {
    el.classList.toggle("hidden", key !== name);
  }
  headerTools.classList.toggle("hidden", name !== "grid");
}

function matchesSearch(item, query) {
  if (!query) return true;
  if (/^\d+$/.test(query)) {
    return String(item.tmdb) === query;
  }
  if (/^tt\d+$/.test(query)) {
    return item.imdb === query;
  }
  const q = normalize(query);
  return (
    normalize(item.title).includes(q) ||
    normalize(item.originalTitle || "").includes(q)
  );
}

function hasLanguage(item, field, value) {
  if (!value) return true;
  return item.links.some((link) => (link[field] || []).includes(value));
}

function fillLanguageFilter(select, field) {
  const values = new Set();
  for (const item of catalog) {
    for (const link of item.links) {
      for (const value of link[field] || []) values.add(value);
    }
  }
  for (const value of [...values].sort((a, b) => a.localeCompare(b, "es"))) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
}

function renderCard(item) {
  return `
    <a class="card" href="${titleHref(item)}">
      <div class="card__poster-wrap">
        <img class="card__poster" src="${esc(item.poster ?? "")}" alt="" loading="lazy">
        ${typeIcon(item.type, seasonSummary(item))}
        <div class="card__badges">
          ${item.qualities.map((q) => `<span class="badge">${esc(q)}</span>`).join("")}
        </div>
      </div>
      <div class="card__title">${esc(item.title)}</div>
      <div class="card__year">${esc(item.year ?? "")}</div>
    </a>
  `;
}

function renderGrid() {
  const state = gridState();
  const items = catalog.filter(
    (item) =>
      (!state.type || item.type === state.type) &&
      hasLanguage(item, "audio", state.audio) &&
      hasLanguage(item, "subs", state.subs) &&
      matchesSearch(item, state.q)
  );
  empty.classList.toggle("hidden", items.length > 0);
  grid.classList.toggle("hidden", items.length === 0);
  grid.innerHTML = items.map(renderCard).join("");
}

function seasonSortKey(season) {
  return season === "all" ? Infinity : season;
}

function renderChips(values, className) {
  return (values || [])
    .map((v) => `<span class="chip ${className}">${esc(v)}</span>`)
    .join("");
}

function renderVersionRow(link) {
  return `
    <div class="version-row">
      <span class="badge">${esc(link.quality)}</span>
      ${renderChips(link.audio, "chip--audio")}
      ${renderChips(link.subs, "chip--subs")}
      ${renderChips(link.tags, "")}
      <span class="chip">${esc(link.group)}</span>
      <a class="btn" href="${esc(link.link)}" target="_blank" rel="noopener">Abrir en Telegram</a>
    </div>
  `;
}

function renderVersions(item) {
  if (item.type === "movie") {
    return item.links.map(renderVersionRow).join("");
  }
  const seasons = new Map();
  for (const link of item.links) {
    if (!seasons.has(link.season)) seasons.set(link.season, []);
    seasons.get(link.season).push(link);
  }
  return [...seasons.keys()]
    .sort((a, b) => seasonSortKey(a) - seasonSortKey(b))
    .map((season) => {
      const links = seasons.get(season);
      const { seasonName, seasonPoster } = links[0];
      return `
        <div class="season-group">
          <div class="season-group__title">
            <img class="season-group__poster" src="${esc(seasonPoster ?? "")}" alt="">
            <span>${esc(seasonName)}</span>
            <span class="season-group__meta" data-season="${esc(season)}"></span>
          </div>
          ${links.map(renderVersionRow).join("")}
        </div>
      `;
    })
    .join("");
}

function renderTitle(item) {
  const tmdb = tmdbUrl(item.type, item.tmdb);
  const imdb = item.imdb ? `<a href="${imdbUrl(item.imdb)}" target="_blank" rel="noopener">IMDB</a>` : "";
  const original = item.originalTitle && item.originalTitle !== item.title
    ? `<div class="title__original">${esc(item.originalTitle)}</div>`
    : "";
  views.title.innerHTML = `
    <a class="back" href="#/" id="back-btn">&larr; Volver</a>
    <div class="title__header">
      <img class="title__poster" src="${esc(item.poster ?? "")}" alt="">
      <div class="title__info">
        <h2 class="title__name">${esc(item.title)}</h2>
        ${original}
        <div class="title__meta">
          ${typeIcon(item.type)}
          <span>${TYPE_LABELS[item.type]}</span>
          <span>${esc(item.year ?? "")}</span>
        </div>
        <div class="title__external">
          <a href="${tmdb}" target="_blank" rel="noopener">TMDB</a>
          ${imdb}
        </div>
      </div>
    </div>
    <div class="title__detail" id="title-detail"></div>
    <div class="title__versions">${renderVersions(item)}</div>
    <div class="title__actions">
      <a class="btn" href="${issueUrl("add.yml", { tmdb })}" target="_blank" rel="noopener">Añadir versión</a>
      <a class="btn" href="${issueUrl("fix.yml", { tmdb })}" target="_blank" rel="noopener">Corregir un link</a>
    </div>
  `;
  document.getElementById("back-btn").addEventListener("click", (e) => {
    if (!visitedWithinApp) return;
    e.preventDefault();
    history.back();
  });
  loadDetail(item);
}

async function loadDetail(item) {
  const box = document.getElementById("title-detail");
  try {
    const res = await fetch(`titles/${item.type}-${item.tmdb}.json`, { cache: "no-cache" });
    if (!res.ok) return;
    const detail = await res.json();
    if (parseRoute().id !== item.tmdb) return;
    renderDetail(box, item, detail);
  } catch {
    box.innerHTML = "";
  }
}

function renderDetail(box, item, detail) {
  const chips = (detail.genres || []).map((g) => `<span class="chip">${esc(g)}</span>`);
  if (item.type === "movie" && detail.runtime) {
    chips.push(`<span class="chip">${esc(detail.runtime)} min</span>`);
  }
  if (item.type === "series" && detail.numberOfSeasons) {
    const n = detail.numberOfSeasons;
    chips.push(`<span class="chip">${n} ${n === 1 ? "temporada" : "temporadas"}</span>`);
  }
  if (detail.voteAverage) {
    chips.push(`<span class="chip">★ ${detail.voteAverage.toFixed(1)}</span>`);
  }
  const tagline = detail.tagline ? `<p class="title__tagline">${esc(detail.tagline)}</p>` : "";
  const overview = detail.overview ? `<p class="title__overview">${esc(detail.overview)}</p>` : "";
  box.innerHTML = `<div class="title__genres">${chips.join("")}</div>${tagline}${overview}`;
  for (const el of views.title.querySelectorAll(".season-group__meta")) {
    const season = detail.seasons?.[el.dataset.season];
    if (!season) continue;
    const parts = [];
    if (season.episodeCount) parts.push(`${season.episodeCount} ep.`);
    if (season.airDate) parts.push(season.airDate.slice(0, 4));
    el.textContent = parts.join(" · ");
  }
  if (detail.backdrop) {
    views.title.style.setProperty("--backdrop", `url("${detail.backdrop}")`);
    views.title.classList.add("has-backdrop");
  }
}

function route() {
  const r = parseRoute();
  views.title.classList.remove("has-backdrop");
  views.title.style.removeProperty("--backdrop");
  if (r.view === "grid") {
    applyGridState(r.params);
    document.title = "Cositeca";
    showView("grid");
    renderGrid();
    return;
  }
  if (r.view === "add") {
    document.getElementById("add-issue-btn").href = issueUrl("add.yml", { tmdb: r.params.get("tmdb") });
    document.title = "Añadir · Cositeca";
    showView("add");
    return;
  }
  if (r.view === "title") {
    const item = byKey.get(`${r.type}/${r.id}`);
    if (!item) {
      document.title = "Cositeca";
      showView("missing");
      return;
    }
    document.title = `${item.title} · Cositeca`;
    renderTitle(item);
    showView("title");
    window.scrollTo(0, 0);
    return;
  }
  document.title = "Cositeca";
  showView("missing");
}

function navigateGrid(push) {
  const hash = gridHash(gridState());
  if (hash === location.hash || (hash === "#/" && location.hash === "")) {
    renderGrid();
    return;
  }
  if (push) {
    location.hash = hash;
  } else {
    history.replaceState(null, "", hash);
    renderGrid();
  }
}

filtersEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;
  for (const b of filtersEl.querySelectorAll(".filter-btn")) {
    b.classList.toggle("is-active", b === btn);
  }
  navigateGrid(true);
});

searchInput.addEventListener("input", () => navigateGrid(false));
audioFilter.addEventListener("change", () => navigateGrid(true));
subsFilter.addEventListener("change", () => navigateGrid(true));

window.addEventListener("hashchange", () => {
  visitedWithinApp = true;
  route();
});

fetch("catalog.json", { cache: "no-cache" })
  .then((res) => res.json())
  .then((data) => {
    catalog = data;
    byKey = new Map(catalog.map((item) => [`${item.type}/${item.tmdb}`, item]));
    fillLanguageFilter(audioFilter, "audio");
    fillLanguageFilter(subsFilter, "subs");
    route();
  });
