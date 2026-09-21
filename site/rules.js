export const TELEGRAM_LINK_RE = /^https:\/\/t\.me\/c\/(\d+)\/(?:(\d+)\/)?(\d+)$/;
export const TMDB_URL_RE = /^https?:\/\/(?:www\.)?themoviedb\.org\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?(movie|tv)\/(\d+)(?:-[^/?#]*)?(?:\/season\/\d+)?\/?(?:[?#].*)?$/;
export const TMDB_ID_RE = /^tmdb:(\d+)$/;
export const IMDB_ID_RE = /^tt\d{1,12}$/;
export const NEW_LANGUAGE_RE = /^[\p{L}\p{M}\s]{2,30}$/u;

export const REPO_URL = "https://github.com/christt105/cositeca";
export const TMDB_PROXY_URL = "https://cositeca-tmdb-proxy.christt105.workers.dev";

export function tmdbUrl(type, id) {
  const kind = type === "movie" ? "movie" : "tv";
  return `https://www.themoviedb.org/${kind}/${id}`;
}

export function imdbUrl(imdbId) {
  return `https://www.imdb.com/title/${imdbId}/`;
}

/**
 * Value for a list field of a fix issue: the new value, or "-" when it is
 * empty but the link had values, so the bot clears them instead of keeping them.
 */
export function listFieldValue(value, previous) {
  return value || ((previous || []).length ? "-" : "");
}

export function issueUrl(template, params = {}) {
  const url = new URL(`${REPO_URL}/issues/new`);
  url.searchParams.set("template", template);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export function normalizeText(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Trims a new language typed in a form, collapses its inner whitespace and composes its accents. */
export function cleanNewLanguage(value) {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

/**
 * Spanish error message for a new language typed in a form, or "" when it is
 * empty or valid: a single language of 2 to 30 letters and spaces.
 */
export function newLanguageError(value) {
  const cleaned = cleanNewLanguage(value);
  if (cleaned === "" || NEW_LANGUAGE_RE.test(cleaned)) return "";
  return "El idioma nuevo tiene que ser uno solo, de 2 a 30 letras, sin comas, números ni signos.";
}

/** The Telegram message id (last numeric segment) of a t.me link, or "" if the link is invalid. */
export function telegramMessageId(link) {
  const match = TELEGRAM_LINK_RE.exec(link ?? "");
  return match ? match[3] : "";
}

function normalizeVersionList(values) {
  return [...new Set(values ?? [])].sort();
}

function versionSignature(entry) {
  return JSON.stringify({
    season: entry.season ?? null,
    quality: entry.quality ?? null,
    audio: normalizeVersionList(entry.audio),
    subs: normalizeVersionList(entry.subs),
    tags: normalizeVersionList(entry.tags),
  });
}

/**
 * Groups of 2+ link entries that share season, quality, audio, subs and
 * tags (compared as sets, a missing list treated as empty) and differ only
 * in the link: versions a user has no way to tell apart.
 */
export function findIndistinguishableVersions(links) {
  const groups = new Map();
  for (const entry of links) {
    const key = versionSignature(entry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export function matchesSearch(item, query) {
  if (!query) return true;
  if (/^tt\d+$/.test(query)) {
    return item.imdb === query;
  }
  const q = normalizeText(query);
  if (/^\d+$/.test(query) && String(item.tmdb) === query) return true;
  return (
    normalizeText(item.title).includes(q) ||
    normalizeText(item.originalTitle || "").includes(q)
  );
}
