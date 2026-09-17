const ICONS = {
  movie: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v2h2V6H5zm12 0v2h2V6h-2zM5 10v2h2v-2H5zm12 0v2h2v-2h-2zM5 14v2h2v-2H5zm12 0v2h2v-2h-2zM9 6v12h6V6H9z"/></svg>`,
  series: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-6l2 2H7l2-2H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm1 2v8h16V8H4z"/></svg>`,
};

export const TYPE_LABELS = { movie: "Película", series: "Serie" };

export function esc(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function typeIcon(type, extra = "") {
  return `<span class="type-icon" title="${TYPE_LABELS[type]}" aria-label="${TYPE_LABELS[type]}">${ICONS[type]}${extra ? `<span>${esc(extra)}</span>` : ""}</span>`;
}

export function renderChips(values, className) {
  return (values || [])
    .map((v) => `<span class="chip ${className}">${esc(v)}</span>`)
    .join("");
}
