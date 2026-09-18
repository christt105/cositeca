import { tmdbUrl, imdbUrl, issueUrl } from "./rules.js";
import { esc, typeIcon, renderChips, TYPE_LABELS } from "./ui.js";
import { renderAdd } from "./add.js";
import { bindTitleEditing } from "./edit.js";

const headerTools = document.getElementById("header-tools");
const searchInput = document.getElementById("search");
const filtersEl = document.getElementById("filters");
const filterPanelToggle = document.getElementById("filter-panel-toggle");
const filterPanel = document.getElementById("filter-panel");
const genreFilter = document.getElementById("genre-filter");
const tagFilter = document.getElementById("tag-filter");
const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const emptyAddLink = document.getElementById("empty-add-btn");
const views = {
  grid: document.getElementById("view-grid"),
  title: document.getElementById("view-title"),
  add: document.getElementById("view-add"),
  missing: document.getElementById("view-missing"),
};

let catalog = [];
let byKey = new Map();
let visitedWithinApp = false;

function normalize(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function titleHref(item) {
  return `#/${item.type}/${item.tmdb}`;
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

function activeTypes() {
  return [...filtersEl.querySelectorAll(".filter-toggle")]
    .filter((b) => b.classList.contains("is-active"))
    .map((b) => b.dataset.type);
}

function gridState() {
  const types = activeTypes();
  return {
    q: searchInput.value.trim(),
    type: types.length === 1 ? types[0] : "",
    genre: genreFilter.value,
    tag: tagFilter.value,
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
  const type = params.get("type") || "";
  for (const b of filtersEl.querySelectorAll(".filter-toggle")) {
    const active = !type || b.dataset.type === type;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-pressed", String(active));
  }
  genreFilter.value = params.get("genre") ?? "";
  tagFilter.value = params.get("tag") ?? "";
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

function hasGenre(item, value) {
  if (!value) return true;
  return (item.genres || []).includes(value);
}

function hasTag(item, value) {
  if (!value) return true;
  return item.links.some((link) => (link.tags || []).includes(value));
}

function fillOptionsFilter(select, collectValues) {
  const values = new Set();
  for (const item of catalog) collectValues(item, values);
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
      hasGenre(item, state.genre) &&
      hasTag(item, state.tag) &&
      matchesSearch(item, state.q)
  );
  empty.classList.toggle("hidden", items.length > 0);
  grid.classList.toggle("hidden", items.length === 0);
  emptyAddLink.href = state.q ? `#/add?q=${encodeURIComponent(state.q)}` : "#/add";
  grid.innerHTML = items.map(renderCard).join("");
}

function seasonSortKey(season) {
  return season === "all" ? Infinity : season;
}

function renderVersionRow(link, index) {
  return `
    <div class="version-row" data-index="${index}">
      <span class="badge">${esc(link.quality)}</span>
      ${renderChips(link.audio, "chip--audio")}
      ${renderChips(link.subs, "chip--subs")}
      ${renderChips(link.tags, "")}
      <span class="chip">${esc(link.group)}</span>
      <span class="version-row__tools">
        <button type="button" class="link-btn" data-edit>Editar</button>
        <button type="button" class="link-btn" data-delete>Borrar</button>
      </span>
      <a class="btn" href="${esc(link.link)}" target="_blank" rel="noopener">Abrir en Telegram</a>
    </div>
  `;
}

function renderVersions(item) {
  const rows = item.links.map((link, index) => ({ link, index }));
  if (item.type === "movie") {
    return rows.map(({ link, index }) => renderVersionRow(link, index)).join("");
  }
  const seasons = new Map();
  for (const row of rows) {
    if (!seasons.has(row.link.season)) seasons.set(row.link.season, []);
    seasons.get(row.link.season).push(row);
  }
  return [...seasons.keys()]
    .sort((a, b) => seasonSortKey(a) - seasonSortKey(b))
    .map((season) => {
      const links = seasons.get(season);
      const { seasonName, seasonPoster } = links[0].link;
      return `
        <div class="season-group">
          <div class="season-group__title">
            <img class="season-group__poster" src="${esc(seasonPoster ?? "")}" alt="">
            <span>${esc(seasonName)}</span>
            <span class="season-group__meta" data-season="${esc(season)}"></span>
          </div>
          ${links.map(({ link, index }) => renderVersionRow(link, index)).join("")}
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
    <div id="title-poster-picker" class="hidden"></div>
    <div class="title__actions">
      <a class="btn" href="#/add?tmdb=${encodeURIComponent(tmdb)}">Añadir versión</a>
      <a class="btn" id="poster-btn" href="#">Cambiar portada</a>
    </div>
    <div id="title-notice"></div>
  `;
  bindTitleEditing(views.title, item);
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
    document.title = "Añadir · Cositeca";
    showView("add");
    renderAdd(r.params, { catalog, byKey });
    window.scrollTo(0, 0);
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
  const btn = e.target.closest(".filter-toggle");
  if (!btn) return;
  const deactivating = btn.classList.contains("is-active");
  if (deactivating && activeTypes().length <= 1) return;
  btn.classList.toggle("is-active");
  btn.setAttribute("aria-pressed", String(btn.classList.contains("is-active")));
  navigateGrid(true);
});

filterPanelToggle.addEventListener("click", () => {
  const open = filterPanel.classList.toggle("hidden") === false;
  filterPanelToggle.setAttribute("aria-expanded", String(open));
});

genreFilter.addEventListener("change", () => navigateGrid(true));
tagFilter.addEventListener("change", () => navigateGrid(true));

searchInput.addEventListener("input", () => navigateGrid(false));

window.addEventListener("hashchange", () => {
  visitedWithinApp = true;
  route();
});

fetch("catalog.json", { cache: "no-cache" })
  .then((res) => res.json())
  .then((data) => {
    catalog = data;
    byKey = new Map(catalog.map((item) => [`${item.type}/${item.tmdb}`, item]));
    fillOptionsFilter(genreFilter, (item, values) => {
      for (const genre of item.genres || []) values.add(genre);
    });
    fillOptionsFilter(tagFilter, (item, values) => {
      for (const link of item.links) {
        for (const tag of link.tags || []) values.add(tag);
      }
    });
    route();
  });

if ("serviceWorker" in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register("sw.js");
}
