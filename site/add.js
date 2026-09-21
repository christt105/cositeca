import {
  TMDB_PROXY_URL,
  TMDB_URL_RE,
  TMDB_ID_RE,
  IMDB_ID_RE,
  TELEGRAM_LINK_RE,
  tmdbUrl,
  issueUrl,
  newLanguageError,
} from "./rules.js";
import { esc, typeIcon, renderChips, TYPE_LABELS, byIdIn, checked } from "./ui.js";
import { enqueue, isBatchMode, getQueue } from "./queue.js";

const view = document.getElementById("view-add");
const IMG = "https://image.tmdb.org/t/p";

let meta = null;
let ctx = { catalog: [], byKey: new Map() };
let searchTimer = null;
let requestSeq = 0;
let selected = null;
let posterChoice = null;

function proxyUrl() {
  return TMDB_PROXY_URL || localStorage.getItem("tmdbProxy") || "";
}

export async function proxyGet(path) {
  const res = await fetch(`${proxyUrl()}${path}`);
  if (!res.ok) throw new Error(`proxy ${path} failed: ${res.status}`);
  return res.json();
}

export async function loadMeta() {
  if (meta) return meta;
  const res = await fetch("meta.json", { cache: "no-cache" });
  meta = await res.json();
  return meta;
}

function catalogKey(type, id) {
  return `${type === "tv" ? "series" : "movie"}/${id}`;
}

function toSiteType(type) {
  return type === "tv" ? "series" : "movie";
}

export function yearOf(result) {
  const date = result.release_date || result.first_air_date || "";
  return date.slice(0, 4);
}

export function nameOf(result) {
  return result.title || result.name || "";
}

const $ = byIdIn(view);

export async function renderAdd(params, context) {
  ctx = context;
  selected = null;
  posterChoice = null;
  if (!proxyUrl()) {
    view.innerHTML = `
      <a class="back" href="#/">&larr; Volver</a>
      <h2>Añadir una cosita</h2>
      <p>El buscador todavía no está disponible. De momento se añade rellenando el formulario de GitHub a mano; en la <a href="https://github.com/christt105/cositeca/blob/main/GUIA.md" target="_blank" rel="noopener">guía</a> está explicado.</p>
      <a class="btn btn--add" href="${issueUrl("add.yml", { tmdb: params.get("tmdb") })}" target="_blank" rel="noopener">Abrir el formulario</a>
    `;
    return;
  }
  await loadMeta();
  view.innerHTML = `
    <a class="back" href="#/">&larr; Volver</a>
    <h2>Añadir una cosita</h2>
    <label class="add__label" for="add-search">Busca la película o serie, o pega una URL de TMDB o un id de IMDB</label>
    <input id="add-search" class="search add__search" type="search" placeholder="Título, URL de TMDB o tt1234567" autocomplete="off">
    <div id="add-results" class="add__results"></div>
    <div id="add-selected"></div>
    <div id="add-posters"></div>
    <form id="add-form" class="add__form hidden"></form>
    <div id="add-outcome"></div>
  `;
  const input = $("add-search");
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => handleQuery(input.value.trim()), 300);
  });
  const tmdb = params.get("tmdb");
  const q = params.get("q");
  if (tmdb) {
    input.value = tmdb;
    handleQuery(tmdb);
  } else if (q) {
    input.value = q;
    handleQuery(q);
  } else {
    input.focus();
  }
}

async function handleQuery(value) {
  const results = $("add-results");
  if (!value) {
    results.innerHTML = "";
    return;
  }
  const seq = ++requestSeq;
  try {
    const urlMatch = TMDB_URL_RE.exec(value);
    if (urlMatch) {
      results.innerHTML = "";
      await select(urlMatch[1], Number(urlMatch[2]));
      return;
    }
    const idMatch = TMDB_ID_RE.exec(value);
    if (idMatch) {
      results.innerHTML = "";
      await select("movie", Number(idMatch[1]));
      return;
    }
    if (IMDB_ID_RE.test(value)) {
      const found = await proxyGet(`/find/${value}`);
      if (seq !== requestSeq) return;
      const hit = found.movie_results?.[0]
        ? { type: "movie", id: found.movie_results[0].id }
        : found.tv_results?.[0]
          ? { type: "tv", id: found.tv_results[0].id }
          : null;
      if (!hit) {
        results.innerHTML = `<p class="add__hint">Ese id de IMDB no está en TMDB.</p>`;
        return;
      }
      results.innerHTML = "";
      await select(hit.type, hit.id);
      return;
    }
    results.innerHTML = `<p class="add__hint">Buscando…</p>`;
    const data = await proxyGet(`/search?q=${encodeURIComponent(value)}&type=multi`);
    if (seq !== requestSeq) return;
    renderResults(data.results || []);
  } catch (err) {
    if (seq !== requestSeq) return;
    results.innerHTML = `<p class="add__hint">No se ha podido buscar en TMDB (${esc(err.message)}).</p>`;
  }
}

function renderResults(items) {
  const results = $("add-results");
  const hits = items.filter((r) => r.media_type === "movie" || r.media_type === "tv").slice(0, 10);
  if (hits.length === 0) {
    results.innerHTML = `<p class="add__hint">Sin resultados en TMDB.</p>`;
    return;
  }
  results.innerHTML = hits
    .map((r) => {
      const type = toSiteType(r.media_type);
      const inCatalog = ctx.byKey.has(catalogKey(r.media_type, r.id));
      return `
        <button type="button" class="result" data-type="${r.media_type}" data-id="${r.id}">
          <img class="result__poster" src="${r.poster_path ? esc(`${IMG}/w92${r.poster_path}`) : ""}" alt="" loading="lazy">
          <span class="result__info">
            <span class="result__title">${esc(nameOf(r))}</span>
            <span class="result__meta">${typeIcon(type)} ${TYPE_LABELS[type]} ${esc(yearOf(r))}${inCatalog ? ' <span class="chip">Ya en la Cositeca</span>' : ""}</span>
          </span>
        </button>
      `;
    })
    .join("");
  for (const btn of results.querySelectorAll(".result")) {
    btn.addEventListener("click", () => {
      results.innerHTML = "";
      select(btn.dataset.type, Number(btn.dataset.id));
    });
  }
}

async function select(type, id) {
  const box = $("add-selected");
  box.innerHTML = `<p class="add__hint">Cargando…</p>`;
  $("add-posters").innerHTML = "";
  $("add-form").classList.add("hidden");
  $("add-outcome").innerHTML = "";
  posterChoice = null;
  let info;
  try {
    info = await proxyGet(`/${type}/${id}`);
  } catch (err) {
    box.innerHTML = `<p class="add__hint">No se ha encontrado ese título en TMDB (${esc(err.message)}).</p>`;
    return;
  }
  selected = {
    type,
    id,
    title: nameOf(info),
    year: yearOf(info),
    poster: info.poster_path ? `${IMG}/w342${info.poster_path}` : "",
    seasons: type === "tv" ? (info.seasons || []) : [],
  };
  const siteType = toSiteType(type);
  const existing = ctx.byKey.get(catalogKey(type, id));
  box.innerHTML = `
    <div class="selected">
      <img class="selected__poster" src="${esc(selected.poster)}" alt="">
      <div>
        <div class="selected__title">${esc(selected.title)}</div>
        <div class="title__meta">${typeIcon(siteType)} <span>${TYPE_LABELS[siteType]}</span> <span>${esc(selected.year)}</span></div>
        ${existing ? renderExisting(existing) : ""}
      </div>
    </div>
  `;
  renderForm();
  loadPosters(type, id);
}

function renderExisting(item) {
  const rows = item.links
    .map((l) => `<li>${l.season !== undefined ? `<strong>${esc(l.seasonName)}</strong> ` : ""}<span class="badge">${esc(l.quality)}</span> ${renderChips(l.audio, "chip--audio")}${renderChips(l.subs, "chip--subs")}${renderChips(l.tags, "")}</li>`)
    .join("");
  return `
    <div class="existing">
      <p>Ya está en la Cositeca (<a href="#/${item.type}/${item.tmdb}">ver página</a>). Versiones que ya tiene, para no repetir:</p>
      <ul class="existing__list">${rows}</ul>
    </div>
  `;
}

export function hasProxy() {
  return Boolean(proxyUrl());
}

export async function renderPosterPicker(box, type, id, defaultPoster, onChoose) {
  let data;
  try {
    data = await proxyGet(`/images?type=${type}&id=${id}`);
  } catch {
    return false;
  }
  const posters = (data.posters || [])
    .filter((p) => [null, "es", "en"].includes(p.iso_639_1))
    .sort((a, b) => b.vote_count - a.vote_count || b.vote_average - a.vote_average)
    .slice(0, 12);
  if (posters.length === 0) return false;
  box.innerHTML = `
    <div class="add__label">Portada (la primera es la que TMDB usa por defecto)</div>
    <div class="posters">
      <button type="button" class="poster is-active" data-poster="">
        <img src="${esc(defaultPoster)}" alt="" loading="lazy"><span>Por defecto</span>
      </button>
      ${posters
        .map((p) => `
          <button type="button" class="poster" data-poster="${esc(`${IMG}/w342${p.file_path}`)}">
            <img src="${esc(`${IMG}/w185${p.file_path}`)}" alt="" loading="lazy"><span>${esc(p.iso_639_1 ?? "sin texto")}</span>
          </button>`)
        .join("")}
    </div>
  `;
  for (const btn of box.querySelectorAll(".poster")) {
    btn.addEventListener("click", () => {
      for (const b of box.querySelectorAll(".poster")) b.classList.toggle("is-active", b === btn);
      onChoose(btn.dataset.poster || null);
    });
  }
  return true;
}

async function loadPosters(type, id) {
  const box = $("add-posters");
  const current = selected;
  await renderPosterPicker(box, type, id, current.poster, (choice) => {
    posterChoice = choice;
    updateOutcome();
  });
  if (selected !== current) box.innerHTML = "";
}

export function seasonOptions(seasons) {
  const numbers = new Set(seasons.map((s) => s.season_number));
  const options = [];
  if (!numbers.has(0)) options.push({ value: 0, label: "Especiales (0)" });
  for (const s of [...seasons].sort((a, b) => a.season_number - b.season_number)) {
    options.push({ value: s.season_number, label: `${s.name} (${s.season_number})` });
  }
  options.push({ value: "all", label: "Serie completa (all)" });
  options.push({ value: "other", label: "Otra (escribir número)" });
  return options;
}

export function checkboxGroup(name, values, checkedValues = []) {
  return values
    .map((v) => `<label class="check"><input type="checkbox" name="${name}" value="${esc(v)}"${checkedValues.includes(v) ? " checked" : ""}> ${esc(v)}</label>`)
    .join("");
}

function renderForm() {
  const form = $("add-form");
  const isTv = selected.type === "tv";
  form.innerHTML = `
    <label class="add__label" for="add-link">Link de Telegram</label>
    <input id="add-link" class="search" type="url" placeholder="https://t.me/c/2229558644/12345" required>
    <p id="add-link-error" class="add__error"></p>
    <div class="add__row">
      <div>
        <label class="add__label" for="add-quality">Calidad</label>
        <select id="add-quality" class="filter-select">
          ${meta.qualities.map((q) => `<option value="${esc(q)}">${esc(q)}</option>`).join("")}
        </select>
      </div>
      ${isTv ? `
      <div>
        <label class="add__label" for="add-season">Temporada</label>
        <select id="add-season" class="filter-select">
          ${seasonOptions(selected.seasons).map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("")}
        </select>
        <input id="add-season-other" class="search hidden" type="text" inputmode="numeric" pattern="\\d+" placeholder="Número de temporada">
      </div>` : ""}
    </div>
    <div class="add__label">Audio</div>
    <div class="checks">${checkboxGroup("audio", meta.languages.audio)}</div>
    <input id="add-audio-other" class="search" type="text" maxlength="30" placeholder="Otro idioma de audio (opcional)">
    <div class="add__label">Subtítulos</div>
    <div class="checks">${checkboxGroup("subs", meta.languages.subs)}</div>
    <input id="add-subs-other" class="search" type="text" maxlength="30" placeholder="Otro idioma de subtítulos (opcional)">
    <p id="add-language-error" class="add__error"></p>
    <label class="add__label" for="add-tags">Etiquetas (opcional, separadas por comas)</label>
    <input id="add-tags" class="search" type="text" placeholder="HDR, REMUX">
    <button type="submit" class="btn btn--add add__submit">Aceptar</button>
  `;
  form.classList.remove("hidden");
  form.addEventListener("input", updateOutcome);
  form.addEventListener("change", updateOutcome);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fields = buildAddFields();
    if (!fields) return;
    if (isBatchMode()) {
      const replaced = enqueue({ type: "add", fields, label: addLabel(fields) });
      $("add-outcome").innerHTML = `
        <p class="add__hint">${replaced ? "Cambio actualizado en la cola" : "Añadido a la cola"} (${getQueue().length}). <a href="#/batch">Ver resumen</a>.</p>
      `;
      return;
    }
    const url = issueUrl("add.yml", fields);
    window.open(url, "_blank", "noopener");
    $("add-outcome").innerHTML = `
      <p class="add__hint">Se abre el formulario de GitHub con todo relleno: revisa los campos y pulsa Submit. Si no se ha abierto, <a href="${esc(url)}" target="_blank" rel="noopener">ábrelo desde aquí</a>.</p>
    `;
  });
  if (isTv) {
    const seasonSelect = $("add-season");
    const seasonOther = $("add-season-other");
    const first = selected.seasons.find((s) => s.season_number > 0);
    if (first) seasonSelect.value = String(first.season_number);
    seasonSelect.addEventListener("change", () => {
      seasonOther.classList.toggle("hidden", seasonSelect.value !== "other");
    });
  }
  updateOutcome();
}

export function validateLink(link) {
  if (!link) return "";
  if (link.includes("t.me/+") || link.includes("joinchat")) {
    return "Los links de invitación no valen, tiene que ser el link de un mensaje.";
  }
  const match = TELEGRAM_LINK_RE.exec(link);
  if (!match) {
    return "Tiene que ser https://t.me/c/<grupo>/<mensaje>, copiado con Copiar enlace.";
  }
  if (!Object.prototype.hasOwnProperty.call(meta.groups, match[1])) {
    return "Ese link no es de ninguno de los grupos de la Cositeca.";
  }
  return "";
}

function buildAddFields() {
  const link = $("add-link").value.trim();
  const error = validateLink(link);
  $("add-link-error").textContent = error;
  const newAudio = $("add-audio-other").value.trim();
  const newSubs = $("add-subs-other").value.trim();
  const languageError = newLanguageError(newAudio) || newLanguageError(newSubs);
  $("add-language-error").textContent = languageError;
  if (!link || error || languageError) return null;
  const seasonValue = selected.type === "tv"
    ? ($("add-season").value === "other" ? $("add-season-other").value.trim() : $("add-season").value)
    : "";
  return {
    tmdb: tmdbUrl(toSiteType(selected.type), selected.id),
    quality: $("add-quality").value,
    season: seasonValue,
    audio: checked(view, "audio").join(", "),
    subs: checked(view, "subs").join(", "),
    new_audio_language: newAudio,
    new_subs_language: newSubs,
    tags: $("add-tags").value.trim(),
    poster: posterChoice ?? "",
    link,
  };
}

function addLabel(fields) {
  const season = fields.season ? ` T${fields.season}` : "";
  return `${selected.title} — añadir ${fields.quality}${season}`;
}

function updateOutcome() {
  const fields = buildAddFields();
  const submit = view.querySelector(".add__submit");
  if (submit) submit.disabled = !fields;
}
