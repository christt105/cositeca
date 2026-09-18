const REPO_URL = "https://github.com/christt105/cositeca";

const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const searchInput = document.getElementById("search");
const filtersEl = document.getElementById("filters");
const audioFilter = document.getElementById("audio-filter");
const subsFilter = document.getElementById("subs-filter");
const modal = document.getElementById("modal");
const modalBody = document.getElementById("modal-body");

let catalog = [];
let activeFilter = "all";

function normalize(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function tmdbUrl(item) {
  const kind = item.type === "movie" ? "movie" : "tv";
  return `https://www.themoviedb.org/${kind}/${item.tmdb}`;
}

function addUrl(prefillTmdb) {
  const url = new URL(`${REPO_URL}/issues/new`);
  url.searchParams.set("template", "add.yml");
  if (prefillTmdb) url.searchParams.set("tmdb", prefillTmdb);
  return url.toString();
}

function fixUrl(prefillTmdb) {
  const url = new URL(`${REPO_URL}/issues/new`);
  url.searchParams.set("template", "fix.yml");
  if (prefillTmdb) url.searchParams.set("tmdb", prefillTmdb);
  return url.toString();
}

document.getElementById("add-btn").href = addUrl();
document.getElementById("empty-add-btn").href = addUrl();

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

function render() {
  const query = searchInput.value.trim();
  const items = catalog.filter(
    (item) =>
      (activeFilter === "all" || item.type === activeFilter) &&
      hasLanguage(item, "audio", audioFilter.value) &&
      hasLanguage(item, "subs", subsFilter.value) &&
      matchesSearch(item, query)
  );

  grid.innerHTML = "";
  if (items.length === 0) {
    empty.classList.remove("hidden");
    grid.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");
  grid.classList.remove("hidden");

  for (const item of items) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card__poster-wrap">
        <img class="card__poster" src="${item.poster ?? ""}" alt="" loading="lazy">
        <div class="card__badges">
          ${item.qualities.map((q) => `<span class="badge">${q}</span>`).join("")}
        </div>
      </div>
      <div class="card__title">${item.title}</div>
      <div class="card__year">${item.year ?? ""}</div>
    `;
    card.addEventListener("click", () => onCardClick(item));
    grid.appendChild(card);
  }
}

function onCardClick(item) {
  if (item.type === "movie" && item.links.length === 1) {
    window.open(item.links[0].link, "_blank", "noopener");
    return;
  }
  openModal(item);
}

function seasonSortKey(season) {
  if (season === "all") return Infinity;
  return season;
}

function renderChips(values, className) {
  return (values || [])
    .map((v) => `<span class="chip ${className}">${v}</span>`)
    .join("");
}

function renderVersionRow(link) {
  return `
    <div class="version-row">
      <span class="badge">${link.quality}</span>
      ${renderChips(link.audio, "chip--audio")}
      ${renderChips(link.subs, "chip--subs")}
      ${renderChips(link.tags, "")}
      <span class="chip">${link.group}</span>
      <a class="btn" href="${link.link}" target="_blank" rel="noopener">Abrir en Telegram</a>
    </div>
  `;
}

function openModal(item) {
  const tmdb = tmdbUrl(item);
  let versionsHtml;

  if (item.type === "movie") {
    versionsHtml = item.links.map(renderVersionRow).join("");
  } else {
    const seasons = new Map();
    for (const link of item.links) {
      if (!seasons.has(link.season)) seasons.set(link.season, []);
      seasons.get(link.season).push(link);
    }
    const orderedSeasons = [...seasons.keys()].sort(
      (a, b) => seasonSortKey(a) - seasonSortKey(b)
    );
    versionsHtml = orderedSeasons
      .map((season) => {
        const links = seasons.get(season);
        const { seasonName, seasonPoster } = links[0];
        return `
          <div class="season-group">
            <div class="season-group__title">
              <img class="season-group__poster" src="${seasonPoster ?? ""}" alt="">
              <span>${seasonName}</span>
            </div>
            ${links.map(renderVersionRow).join("")}
          </div>
        `;
      })
      .join("");
  }

  modalBody.innerHTML = `
    <div class="modal__header">
      <img class="modal__poster" src="${item.poster ?? ""}" alt="">
      <div>
        <h2>${item.title}</h2>
        <div class="card__year">${item.year ?? ""}</div>
      </div>
    </div>
    ${versionsHtml}
    <div class="modal__actions">
      <a class="btn" href="${addUrl(tmdb)}" target="_blank" rel="noopener">Añadir versión</a>
      <a class="btn" href="${fixUrl(tmdb)}" target="_blank" rel="noopener">Corregir un link</a>
    </div>
  `;
  modal.classList.remove("hidden");
}

function closeModal() {
  modal.classList.add("hidden");
  modalBody.innerHTML = "";
}

document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal-backdrop").addEventListener("click", closeModal);

filtersEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;
  activeFilter = btn.dataset.filter;
  for (const b of filtersEl.querySelectorAll(".filter-btn")) {
    b.classList.toggle("is-active", b === btn);
  }
  render();
});

searchInput.addEventListener("input", render);
audioFilter.addEventListener("change", render);
subsFilter.addEventListener("change", render);

fetch("catalog.json", { cache: "no-cache" })
  .then((res) => res.json())
  .then((data) => {
    catalog = data;
    fillLanguageFilter(audioFilter, "audio");
    fillLanguageFilter(subsFilter, "subs");
    render();
  });
