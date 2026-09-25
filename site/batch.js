import { issueUrl } from "./rules.js";
import { esc, byIdIn } from "./ui.js";
import { getQueue, removeAt, clear } from "./queue.js";

const view = document.getElementById("view-batch");
const URL_LENGTH_THRESHOLD = 6500;
const MAX_OPERATIONS = 50;

const $ = byIdIn(view);

function renderRow(item, index) {
  return `
    <div class="batch-row">
      <span class="batch-row__label">${esc(item.label)}</span>
      <button type="button" class="link-btn" data-remove="${index}">Quitar</button>
    </div>
  `;
}

function buildConfirm(queue) {
  const operations = queue.map((item) => ({ type: item.type, ...item.fields }));
  const json = JSON.stringify(operations);
  const prefilledUrl = issueUrl("batch.yml", { operations: json });
  if (prefilledUrl.length <= URL_LENGTH_THRESHOLD) {
    return { url: prefilledUrl, json: null };
  }
  return { url: issueUrl("batch.yml"), json };
}

export function renderBatch() {
  const queue = getQueue();
  if (queue.length === 0) {
    view.innerHTML = `
      <a class="back" href="#/">&larr; Volver</a>
      <h2>Cola de cambios</h2>
      <p class="add__hint">No hay ningún cambio en la cola. Activa "Modo lote" en la cabecera y añade o edita algo para empezar.</p>
    `;
    return;
  }
  const tooMany = queue.length > MAX_OPERATIONS;
  const { url, json } = tooMany ? { url: "", json: null } : buildConfirm(queue);
  const confirmControl = tooMany
    ? `<button type="button" class="btn btn--add" disabled>Confirmar (${queue.length})</button>`
    : `<a class="btn btn--add" id="batch-confirm" href="${esc(url)}" target="_blank" rel="noopener">Confirmar (${queue.length})</a>`;
  const note = tooMany
    ? `<p class="add__error">Un lote admite como máximo ${MAX_OPERATIONS} cambios: quita ${queue.length - MAX_OPERATIONS} o confírmalos en dos tandas.</p>`
    : json
      ? `<p class="add__hint">La cola es demasiado grande para prerellenar la URL: al pulsar Confirmar se copia el JSON al portapapeles y se abre el formulario vacío, pégalo en el campo "Operaciones (JSON)".</p>`
      : `<p class="add__hint">Confirmar abre el formulario de GitHub con todo relleno: revisa los campos y pulsa Submit. Si se abre la app de GitHub, mantén pulsado Confirmar para abrirlo en una pestaña nueva. La cola se conserva hasta que pulses "Vaciar cola".</p>`;
  view.innerHTML = `
    <a class="back" href="#/">&larr; Volver</a>
    <h2>Cola de cambios</h2>
    <p class="add__hint">Revisa lo que se va a aplicar. Al confirmar se abre un único issue de GitHub con todo.</p>
    <div id="batch-list">${queue.map(renderRow).join("")}</div>
    <div class="edit__actions">
      <button type="button" class="btn" id="batch-clear">Vaciar cola</button>
      ${confirmControl}
    </div>
    ${note}
    <div id="batch-outcome"></div>
  `;
  for (const btn of view.querySelectorAll("[data-remove]")) {
    btn.addEventListener("click", () => {
      removeAt(Number(btn.dataset.remove));
      renderBatch();
    });
  }
  $("batch-clear").addEventListener("click", () => {
    if (!confirm("¿Vaciar toda la cola de cambios?")) return;
    clear();
    renderBatch();
  });
  if (json) {
    $("batch-confirm").addEventListener("click", () => {
      navigator.clipboard.writeText(json).catch(() => {
        $("batch-outcome").innerHTML = `<p class="add__error">No se ha podido copiar el JSON al portapapeles: prueba con menos cambios en la cola.</p>`;
      });
    });
  }
}
