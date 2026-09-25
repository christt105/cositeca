import { TELEGRAM_LINK_RE, tmdbUrl } from "../../site/rules.js";

export class BotValidationError extends Error {}

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
};

const FIELD_ORDER = [
  "tmdb",
  "quality",
  "season",
  "audio",
  "subs",
  "new_audio_language",
  "new_subs_language",
  "tags",
  "poster",
  "link",
];

export function buildIssueBody(fields) {
  return FIELD_ORDER.map((id) => {
    const value = fields[id];
    const text = value === undefined || value === null || value === "" ? "_No response_" : String(value);
    return `### ${FIELD_LABELS[id]}\n\n${text}`;
  }).join("\n\n");
}

export function parseTelegramLink(link, groups) {
  if (typeof link !== "string" || link.trim() === "") {
    throw new BotValidationError("Pégame el link del mensaje de Telegram.");
  }
  const trimmed = link.trim();
  if (trimmed.includes("t.me/+") || trimmed.includes("joinchat")) {
    throw new BotValidationError(
      "Los links de invitación (t.me/+...) no valen, necesito el link directo al mensaje (usa 'Copiar enlace' en el mensaje)."
    );
  }
  const match = TELEGRAM_LINK_RE.exec(trimmed);
  if (!match) {
    throw new BotValidationError(
      "Eso no parece un link de mensaje de Telegram. Tiene que ser del tipo https://t.me/c/<grupo>/<mensaje> (usa 'Copiar enlace' en el mensaje)."
    );
  }
  const [, groupId] = match;
  if (!Object.prototype.hasOwnProperty.call(groups, groupId)) {
    throw new BotValidationError(`Ese grupo de Telegram (${groupId}) no está dado de alta en Cositeca.`);
  }
  return trimmed;
}

export function formatCandidates(results, limit = 5, preferredYear) {
  const withYear = results
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .map((r) => {
      const type = r.media_type;
      const dateStr = type === "movie" ? r.release_date : r.first_air_date;
      return { r, type, year: dateStr ? dateStr.slice(0, 4) : "????" };
    });
  if (preferredYear) {
    withYear.sort((a, b) => Number(b.year === preferredYear) - Number(a.year === preferredYear));
  }
  return withYear.slice(0, limit).map(({ r, type, year }, idx) => {
    const title = type === "movie" ? r.title : r.name;
    const icon = type === "movie" ? "🎬" : "📺";
    return { idx, type, id: r.id, title, year, label: `${icon} ${title} (${year})`, url: tmdbUrl(type, r.id) };
  });
}

export function toggleLanguage(selected, lang) {
  return selected.includes(lang) ? selected.filter((l) => l !== lang) : [...selected, lang];
}

export function buildLanguageKeyboard(options, selected, kind) {
  const prefix = kind === "audio" ? "a" : "s";
  const keyboard = options.map((lang) => [
    { text: `${selected.includes(lang) ? "✅ " : ""}${lang}`, callback_data: `${prefix}:${lang}` },
  ]);
  keyboard.push([
    { text: "➕ Otro idioma", callback_data: `${prefix}:new` },
    { text: "Listo ➡️", callback_data: `${prefix}:done` },
  ]);
  return keyboard;
}

export function buildSummary(session) {
  const f = session.fields;
  const lines = [
    `Título: ${session.title}`,
    `TMDB: ${f.tmdb}`,
    f.season !== undefined ? `Temporada: ${f.season}` : null,
    `Calidad: ${f.quality}`,
    f.audio ? `Audio: ${f.audio}` : null,
    f.subs ? `Subtítulos: ${f.subs}` : null,
    f.new_audio_language ? `Nuevo idioma de audio: ${f.new_audio_language}` : null,
    f.new_subs_language ? `Nuevo idioma de subtítulos: ${f.new_subs_language}` : null,
    f.tags ? `Etiquetas: ${f.tags}` : null,
    f.poster ? `Portada: ${f.poster}` : null,
    `Link: ${f.link}`,
  ].filter(Boolean);
  return `Voy a crear esta entrada:\n\n${lines.join("\n")}\n\n¿Confirmas?`;
}

export function buildParsedSummary(parsed) {
  const lines = [
    `Tipo: ${parsed.kind === "series" ? "Serie" : "Película"}`,
    `Título: ${parsed.title}${parsed.year ? ` (${parsed.year})` : ""}`,
    parsed.kind === "series" ? `Temporada: ${parsed.season}` : null,
    `Calidad: ${parsed.quality ?? "no detectada"}`,
    parsed.tags?.length ? `Etiquetas: ${parsed.tags.join(", ")}` : null,
    `Audio: ${parsed.audio?.length ? parsed.audio.join(", ") : "no detectado"}`,
    `Subtítulos: ${parsed.subs?.length ? parsed.subs.join(", ") : "no detectado"}`,
  ].filter(Boolean);
  return `He entendido esto del mensaje:\n\n${lines.join("\n")}\n\n¿Lo uso, o prefieres rellenarlo tú paso a paso? La coincidencia con TMDB la tendrás que confirmar tú igualmente.`;
}

export function newSession() {
  return { step: "AWAIT_LINK", fields: {}, candidates: [], audioSelected: [], subsSelected: [] };
}
