import { issueUrl } from "./rules.js";
import { esc } from "./ui.js";
import { getQueue, removeAt, clear } from "./queue.js";

const view = document.getElementById("view-batch");
const URL_LENGTH_THRESHOLD = 6500;

function $(id) {
  return view.querySelector(`#${id}`);
}

function renderRow(item, index) {
  return `
    <div class="batch-row">
      <span class="batch-row__label">${esc(item.label)}</span>
      <button type="button" class="link-btn" data-remove="${index}">Quitar</button>
    </div>
  `;
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
  view.innerHTML = `
    <a class="back" href="#/">&larr; Volver</a>
    <h2>Cola de cambios</h2>
    <p class="add__hint">Revisa lo que se va a aplicar. Al confirmar se abre un único issue de GitHub con todo.</p>
    <div id="batch-list">${queue.map(renderRow).join("")}</div>
    <div class="edit__actions">
      <button type="button" class="btn" id="batch-clear">Vaciar cola</button>
      <button type="button" class="btn btn--add" id="batch-confirm">Confirmar (${queue.length})</button>
    </div>
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
  $("batch-confirm").addEventListener("click", confirmBatch);
}

function confirmBatch() {
  const queue = getQueue();
  const operations = queue.map((item) => ({ type: item.type, ...item.fields }));
  const json = JSON.stringify(operations);
  const prefilledUrl = issueUrl("batch.yml", { operations: json });
  const outcome = $("batch-outcome");

  if (prefilledUrl.length <= URL_LENGTH_THRESHOLD) {
    window.open(prefilledUrl, "_blank", "noopener");
    outcome.innerHTML = `
      <p class="add__hint">Se abre el formulario de GitHub con todo relleno: revisa los campos y pulsa Submit. Si no se ha abierto, <a href="${esc(prefilledUrl)}" target="_blank" rel="noopener">ábrelo desde aquí</a>.</p>
    `;
    clear();
    renderBatch();
    return;
  }

  const blankUrl = issueUrl("batch.yml");
  navigator.clipboard
    .writeText(json)
    .then(() => {
      window.open(blankUrl, "_blank", "noopener");
      outcome.innerHTML = `
        <p class="add__hint">La cola es demasiado grande para prerellenar la URL: se ha copiado el JSON al portapapeles, pégalo en el campo "Operaciones (JSON)" del formulario que se acaba de abrir. Si no se ha abierto, <a href="${esc(blankUrl)}" target="_blank" rel="noopener">ábrelo desde aquí</a>.</p>
      `;
      clear();
      renderBatch();
    })
    .catch(() => {
      outcome.innerHTML = `
        <p class="add__error">La cola es demasiado grande para prerellenar la URL y no se ha podido copiar al portapapeles. Prueba a confirmar con menos cambios en la cola.</p>
      `;
    });
}
