import { TMDB_URL_RE, IMDB_ID_RE, tmdbUrl, issueUrl } from "./rules.js";
import { esc, typeIcon, TYPE_LABELS } from "./ui.js";
import { hasProxy, proxyGet, renderPosterPicker, seasonOptions, nameOf, yearOf } from "./add.js";

const IMG = "https://image.tmdb.org/t/p";

function siteType(type) {
  return type === "tv" ? "series" : "movie";
}

async function resolveQuery(value) {
  const urlMatch = TMDB_URL_RE.exec(value);
  if (urlMatch) return { hit: { type: urlMatch[1], id: Number(urlMatch[2]) } };
  if (IMDB_ID_RE.test(value)) {
    const found = await proxyGet(`/find/${value}`);
    const movie = found.movie_results?.[0];
    const tv = found.tv_results?.[0];
    if (movie) return { hit: { type: "movie", id: movie.id } };
    if (tv) return { hit: { type: "tv", id: tv.id } };
    return { results: [] };
  }
  const data = await proxyGet(`/search?q=${encodeURIComponent(value)}&type=multi`);
  const results = (data.results || []).filter((r) => r.media_type === "movie" || r.media_type === "tv").slice(0, 8);
  return { results };
}

function renderResults(results) {
  if (results.length === 0) return `<p class="add__hint">Sin resultados en TMDB.</p>`;
  return results
    .map((r) => `
      <button type="button" class="result" data-type="${r.media_type}" data-id="${r.id}">
        <img class="result__poster" src="${r.poster_path ? esc(`${IMG}/w92${r.poster_path}`) : ""}" alt="" loading="lazy">
        <span class="result__info">
          <span class="result__title">${esc(nameOf(r))}</span>
          <span class="result__meta">${typeIcon(siteType(r.media_type))} ${TYPE_LABELS[siteType(r.media_type)]} ${esc(yearOf(r))}</span>
        </span>
      </button>`)
    .join("");
}

export function openReidentify(slot, item, link, submit) {
  const whole = link === null;
  const scope = whole ? "todos los links de esta entrada" : "este link";
  const panel = document.createElement("div");
  panel.className = "reid add__form";
  slot.replaceChildren(panel);

  if (!hasProxy()) {
    const fields = { tmdb: tmdbUrl(item.type, item.tmdb), old_link: whole ? "" : link.link };
    panel.innerHTML = `<p class="add__hint">El buscador no está disponible: <a href="${esc(issueUrl("reidentify.yml", fields))}" target="_blank" rel="noopener">abre el formulario de GitHub</a> y rellena el título nuevo a mano.</p>`;
    return;
  }

  panel.innerHTML = `
    <label class="add__label">Mover ${scope} a otra película o serie</label>
    <input class="search" type="search" data-search placeholder="Título, URL de TMDB o tt1234567" autocomplete="off">
    <div class="add__results" data-results></div>
    <div data-target></div>
    <div data-posters></div>
    <div class="edit__actions">
      <button type="button" class="btn btn--ghost" data-cancel>Cancelar</button>
    </div>
  `;
  const input = panel.querySelector("[data-search]");
  const results = panel.querySelector("[data-results]");
  const targetBox = panel.querySelector("[data-target]");
  const posterBox = panel.querySelector("[data-posters]");
  panel.querySelector("[data-cancel]").addEventListener("click", () => panel.remove());
  let timer = null;
  let seq = 0;

  async function pick(type, id) {
    const current = ++seq;
    results.innerHTML = "";
    posterBox.innerHTML = "";
    targetBox.innerHTML = `<p class="add__hint">Cargando…</p>`;
    let info;
    try {
      info = await proxyGet(`/${type}/${id}`);
    } catch (err) {
      targetBox.innerHTML = `<p class="add__hint">No se ha encontrado ese título en TMDB (${esc(err.message)}).</p>`;
      return;
    }
    if (current !== seq) return;
    if (siteType(type) === item.type && id === item.tmdb) {
      targetBox.innerHTML = `<p class="add__error">Es el mismo título en el que está ahora.</p>`;
      return;
    }
    renderTarget(type, id, info);
  }

  function renderTarget(type, id, info) {
    const toSeries = type === "tv";
    const needsSeason = toSeries && item.type === "movie";
    const options = toSeries ? seasonOptions(info.seasons || []) : [];
    const poster = info.poster_path ? `${IMG}/w342${info.poster_path}` : "";
    let posterChoice = null;
    let seasonHint = "";
    if (!toSeries) {
      seasonHint = item.type === "series" ? "Al pasar a una película se quita la temporada de los links." : "";
    } else if (!needsSeason) {
      seasonHint = "Por defecto cada link conserva su temporada.";
    }
    targetBox.innerHTML = `
      <div class="selected">
        <img class="selected__poster" src="${esc(poster)}" alt="">
        <div>
          <div class="selected__title">${esc(nameOf(info))}</div>
          <div class="title__meta">${typeIcon(siteType(type))} <span>${TYPE_LABELS[siteType(type)]}</span> <span>${esc(yearOf(info))}</span></div>
        </div>
      </div>
      ${toSeries ? `
      <label class="add__label">Temporada${needsSeason ? "" : " (opcional)"}</label>
      <select class="filter-select" data-season>
        ${needsSeason ? "" : `<option value="">Mantener la actual de cada link</option>`}
        ${options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("")}
      </select>
      <input class="search hidden" data-season-other type="text" inputmode="numeric" pattern="\\d+" placeholder="Número de temporada">` : ""}
      ${seasonHint ? `<p class="add__hint">${seasonHint}</p>` : ""}
      <p class="add__hint">La portada del título actual no se traslada: si quieres una para el nuevo, elígela aquí.</p>
      <p class="add__error" data-error></p>
    `;
    const actions = panel.querySelector(".edit__actions");
    actions.querySelector("[data-accept]")?.remove();
    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = "btn add__submit";
    accept.dataset.accept = "";
    accept.textContent = "Aceptar";
    actions.prepend(accept);

    const seasonSelect = targetBox.querySelector("[data-season]");
    const seasonOther = targetBox.querySelector("[data-season-other]");
    if (seasonSelect && needsSeason) {
      const first = (info.seasons || []).find((s) => s.season_number > 0);
      if (first) seasonSelect.value = String(first.season_number);
    }
    seasonSelect?.addEventListener("change", () => {
      seasonOther.classList.toggle("hidden", seasonSelect.value !== "other");
    });

    renderPosterPicker(posterBox, type, id, poster, (value) => {
      posterChoice = value;
    }).then((ok) => {
      if (!ok) posterBox.innerHTML = "";
    });

    accept.addEventListener("click", () => {
      let season = "";
      if (seasonSelect) {
        season = seasonSelect.value === "other" ? seasonOther.value.trim() : seasonSelect.value;
        if (seasonSelect.value === "other" && !/^\d+$/.test(season)) {
          targetBox.querySelector("[data-error]").textContent = "Escribe el número de temporada.";
          return;
        }
      }
      const fields = {
        tmdb: tmdbUrl(item.type, item.tmdb),
        new_tmdb: tmdbUrl(siteType(type), id),
        old_link: whole ? "" : link.link,
        season,
        poster: posterChoice ?? "",
      };
      const what = whole ? "entrada" : link.season !== undefined ? `${link.seasonName} ${link.quality}` : link.quality;
      submit(fields, `${item.title} · mover ${what} a ${nameOf(info)}`);
      panel.remove();
    });
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const value = input.value.trim();
      const current = ++seq;
      if (!value) {
        results.innerHTML = "";
        return;
      }
      results.innerHTML = `<p class="add__hint">Buscando…</p>`;
      try {
        const found = await resolveQuery(value);
        if (current !== seq) return;
        if (found.hit) {
          pick(found.hit.type, found.hit.id);
          return;
        }
        results.innerHTML = renderResults(found.results);
        for (const btn of results.querySelectorAll(".result")) {
          btn.addEventListener("click", () => pick(btn.dataset.type, Number(btn.dataset.id)));
        }
      } catch (err) {
        if (current !== seq) return;
        results.innerHTML = `<p class="add__hint">No se ha podido buscar en TMDB (${esc(err.message)}).</p>`;
      }
    }, 300);
  });
  input.focus();
}
