import { tmdbUrl, issueUrl } from "./rules.js";
import { esc } from "./ui.js";
import { loadMeta, hasProxy, renderPosterPicker, checkboxGroup, validateLink } from "./add.js";

const SENT_NOTICE = "Se abre el formulario de GitHub con todo relleno: revísalo y pulsa Submit. Los cambios tardan unos minutos en verse.";

function openIssue(view, url) {
  window.open(url, "_blank", "noopener");
  const box = view.querySelector("#title-notice");
  box.innerHTML = `<p class="add__hint">${SENT_NOTICE} Si no se ha abierto, <a href="${esc(url)}" target="_blank" rel="noopener">ábrelo desde aquí</a>.</p>`;
}

function checked(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
}

function renderEditForm(row, item, link, meta) {
  const isSeries = item.type === "series";
  const form = document.createElement("form");
  form.className = "edit add__form";
  form.innerHTML = `
    <label class="add__label">Link de Telegram</label>
    <input name="link" class="search" type="url" value="${esc(link.link)}" required>
    <p class="add__error" data-error></p>
    <div class="add__row">
      <div>
        <label class="add__label">Calidad</label>
        <select name="quality" class="filter-select">
          ${meta.qualities.map((q) => `<option value="${esc(q)}"${q === link.quality ? " selected" : ""}>${esc(q)}</option>`).join("")}
        </select>
      </div>
      ${isSeries ? `
      <div>
        <label class="add__label">Temporada (número, 0 o all)</label>
        <input name="season" class="search" type="text" value="${esc(link.season)}" pattern="\\d+|all">
      </div>` : ""}
    </div>
    <div class="add__label">Audio</div>
    <div class="checks">${checkboxGroup("audio", meta.languages.audio, link.audio || [])}</div>
    <div class="add__label">Subtítulos</div>
    <div class="checks">${checkboxGroup("subs", meta.languages.subs, link.subs || [])}</div>
    <label class="add__label">Etiquetas (separadas por comas)</label>
    <input name="tags" class="search" type="text" value="${esc((link.tags || []).join(", "))}">
    <div class="edit__actions">
      <button type="submit" class="btn add__submit">Aceptar</button>
      <button type="button" class="btn btn--ghost" data-cancel>Cancelar</button>
    </div>
  `;
  form.querySelector("[data-cancel]").addEventListener("click", () => form.remove());
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const newLink = form.elements.link.value.trim();
    const error = validateLink(newLink);
    form.querySelector("[data-error]").textContent = error;
    if (error) return;
    const audio = checked(form, "audio");
    const subs = checked(form, "subs");
    const tags = form.elements.tags.value.trim();
    const params = {
      tmdb: tmdbUrl(item.type, item.tmdb),
      old_link: link.link,
      new_link: newLink,
      quality: form.elements.quality.value,
      season: isSeries ? form.elements.season.value.trim() : "",
      audio: audio.join(", "),
      subs: subs.join(", "),
      tags: tags || ((link.tags || []).length ? "-" : ""),
    };
    openIssue(row.closest(".title"), issueUrl("fix.yml", params));
    form.remove();
  });
  row.after(form);
}

export async function bindTitleEditing(view, item) {
  const meta = await loadMeta();
  for (const row of view.querySelectorAll(".version-row[data-index]")) {
    const link = item.links[Number(row.dataset.index)];
    row.querySelector("[data-edit]").addEventListener("click", () => {
      view.querySelectorAll(".edit").forEach((f) => f.remove());
      renderEditForm(row, item, link, meta);
    });
    row.querySelector("[data-delete]").addEventListener("click", () => {
      const what = item.type === "series" ? `${link.seasonName} ${link.quality}` : link.quality;
      if (!confirm(`¿Borrar el link ${what} de ${item.title}?`)) return;
      openIssue(view, issueUrl("fix.yml", { tmdb: tmdbUrl(item.type, item.tmdb), old_link: link.link }));
    });
  }

  const posterBtn = view.querySelector("#poster-btn");
  const picker = view.querySelector("#title-poster-picker");
  if (!hasProxy()) {
    posterBtn.href = issueUrl("poster.yml", { tmdb: tmdbUrl(item.type, item.tmdb) });
    posterBtn.target = "_blank";
    posterBtn.rel = "noopener";
    return;
  }
  posterBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!picker.classList.contains("hidden")) {
      picker.classList.add("hidden");
      return;
    }
    picker.classList.remove("hidden");
    picker.innerHTML = `<p class="add__hint">Cargando portadas…</p>`;
    let choice = null;
    const ok = await renderPosterPicker(picker, item.type === "series" ? "tv" : "movie", item.tmdb, item.poster, (value) => {
      choice = value;
    });
    if (!ok) {
      picker.innerHTML = `<p class="add__hint">No se han podido cargar las portadas.</p>`;
      return;
    }
    const actions = document.createElement("div");
    actions.className = "edit__actions";
    actions.innerHTML = `<button type="button" class="btn add__submit">Aceptar</button>`;
    actions.querySelector("button").addEventListener("click", () => {
      openIssue(view, issueUrl("poster.yml", { tmdb: tmdbUrl(item.type, item.tmdb), poster: choice ?? "" }));
      picker.classList.add("hidden");
    });
    picker.append(actions);
  });
}
