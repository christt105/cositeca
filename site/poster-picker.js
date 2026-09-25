import { esc } from "./ui.js";
import { IMG, proxyGet } from "./tmdb.js";

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
