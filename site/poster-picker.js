import { esc } from "./ui.js";
import { IMG, proxyGet } from "./tmdb.js";

export const POSTER_PAGE = 12;

const FIXED_GROUPS = [
  { key: "es", lang: "es", label: "Castellano" },
  { key: "en", lang: "en", label: "Inglés" },
  { key: "null", lang: null, label: "Sin texto" },
];

export function languageName(code) {
  try {
    const name = new Intl.DisplayNames(["es"], { type: "language" }).of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}

export function byVotes(a, b) {
  return (b.vote_count ?? 0) - (a.vote_count ?? 0) || (b.vote_average ?? 0) - (a.vote_average ?? 0);
}

/** Splits TMDB posters into the picker's language groups (es, en, no text, original language), each sorted by votes then rating; empty groups are dropped. */
export function groupPosters(posters, originalLanguage) {
  const defs = [...FIXED_GROUPS];
  if (originalLanguage && !["es", "en"].includes(originalLanguage)) {
    defs.push({ key: "vo", lang: originalLanguage, label: `VO (${languageName(originalLanguage)})` });
  }
  return defs
    .map((def) => ({
      key: def.key,
      label: def.label,
      posters: (posters || []).filter((p) => (p.iso_639_1 ?? null) === def.lang).sort(byVotes),
    }))
    .filter((g) => g.posters.length > 0);
}

async function fetchOriginalLanguage(type, id) {
  try {
    return (await proxyGet(`/${type}/${id}`)).original_language ?? null;
  } catch {
    return null;
  }
}

function posterButton(value, thumb, caption, active) {
  return `
    <button type="button" class="poster${active ? " is-active" : ""}" data-poster="${esc(value)}">
      <img src="${esc(thumb)}" alt="" loading="lazy">${caption ? `<span>${esc(caption)}</span>` : ""}
    </button>`;
}

export async function renderPosterPicker(box, type, id, defaultPoster, onChoose, options = {}) {
  let data;
  let originalLanguage;
  try {
    [data, originalLanguage] = await Promise.all([
      proxyGet(`/images?type=${type}&id=${id}`),
      options.originalLanguage !== undefined ? options.originalLanguage : fetchOriginalLanguage(type, id),
    ]);
  } catch {
    return false;
  }
  const groups = groupPosters(data.posters, originalLanguage);
  if (groups.length === 0) return false;

  let chosen = "";
  let active = groups[0];
  let shown = POSTER_PAGE;

  const root = document.createElement("div");
  root.className = "poster-picker";
  root.innerHTML = `
    <div class="add__label">Portada</div>
    <div class="poster-default">${posterButton("", defaultPoster, "Por defecto", true)}</div>
    <div class="poster-tabs" role="tablist">
      ${groups
        .map((g) => `
          <button type="button" class="poster-tab" role="tab" data-group="${esc(g.key)}">
            ${esc(g.label)} <span class="poster-tab__count">${g.posters.length}</span>
          </button>`)
        .join("")}
    </div>
    <div class="poster-grid" role="tabpanel"></div>
    <button type="button" class="btn btn--ghost poster-more hidden"></button>
  `;
  box.replaceChildren(root);
  const grid = root.querySelector(".poster-grid");
  const more = root.querySelector(".poster-more");

  function renderGroup() {
    for (const tab of root.querySelectorAll(".poster-tab")) {
      const on = tab.dataset.group === active.key;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", String(on));
    }
    grid.innerHTML = active.posters
      .slice(0, shown)
      .map((p) => {
        const value = `${IMG}/w342${p.file_path}`;
        return posterButton(value, `${IMG}/w185${p.file_path}`, "", value === chosen);
      })
      .join("");
    const rest = active.posters.length - shown;
    more.classList.toggle("hidden", rest <= 0);
    more.textContent = `Ver más (${rest})`;
  }

  function select(btn) {
    chosen = btn.dataset.poster;
    for (const b of root.querySelectorAll(".poster")) b.classList.toggle("is-active", b === btn);
    onChoose(chosen || null);
  }

  root.addEventListener("click", (e) => {
    const poster = e.target.closest(".poster");
    if (poster) {
      select(poster);
      return;
    }
    const tab = e.target.closest(".poster-tab");
    if (tab && tab.dataset.group !== active.key) {
      active = groups.find((g) => g.key === tab.dataset.group);
      shown = POSTER_PAGE;
      renderGroup();
    }
  });
  more.addEventListener("click", () => {
    shown += POSTER_PAGE;
    renderGroup();
  });

  renderGroup();
  return true;
}
