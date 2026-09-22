import { ValidationError } from "./lib.js";

export const FIELD_LABELS = {
  tmdb: "URL de TMDB o id de IMDB",
  quality: "Calidad",
  season: "Temporada",
  audio: "Audio",
  subs: "Subtítulos",
  new_audio_language: "Nuevo idioma (audio)",
  new_subs_language: "Nuevo idioma (subtítulos)",
  tags: "Etiquetas",
  poster: "Portada",
  link: "Link de Telegram",
  old_link: "Link actual",
  new_link: "Link nuevo",
  new_tmdb: "Nueva URL de TMDB o id de IMDB",
};

export function parseIssueBody(body, fieldIds) {
  const sections = body.replace(/\r\n?/g, "\n").split(/\n(?=### )/);
  const byLabel = new Map();
  for (const section of sections) {
    const match = /^### (.+?)\n+([\s\S]*)$/.exec(section.trim());
    if (!match) continue;
    const [, label, rawValue] = match;
    const value = rawValue.trim();
    byLabel.set(label.trim(), value === "_No response_" ? "" : value);
  }
  const fields = {};
  for (const id of fieldIds) {
    fields[id] = byLabel.get(FIELD_LABELS[id]) ?? "";
  }
  return fields;
}

const TEXT_FIELDS = [
  "tmdb", "quality", "audio", "subs", "new_audio_language", "new_subs_language",
  "tags", "poster", "link", "old_link", "new_link", "new_tmdb",
];

export function requireTextFields(fields) {
  for (const id of TEXT_FIELDS) {
    const value = fields[id];
    if (value !== undefined && value !== null && typeof value !== "string") {
      const kind = Array.isArray(value) ? "array" : typeof value;
      throw new ValidationError(`${id} must be a string, got ${kind}`);
    }
  }
}

export function parseSeasonField(raw) {
  if (raw === "" || raw === undefined) return undefined;
  if (raw === "all") return "all";
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new ValidationError(`season must be "all" or an integer >= 0, got ${raw}`);
  }
  return n;
}

export function parseListField(raw) {
  if (!raw) return undefined;
  const values = raw.split(",").map((t) => t.trim()).filter(Boolean);
  return values.length ? values : undefined;
}
