import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  TELEGRAM_LINK_RE,
  TMDB_URL_RE,
  TMDB_ID_RE,
  IMDB_ID_RE,
  cleanNewLanguage,
  newLanguageError,
  normalizeText,
} from "../site/rules.js";

export { TELEGRAM_LINK_RE, TMDB_URL_RE, TMDB_ID_RE, IMDB_ID_RE };
export const FILENAME_RE = /^\d+\.yaml$/;

export class ValidationError extends Error {}

export function parseTelegramLink(link) {
  if (typeof link !== "string") {
    throw new ValidationError(`link must be a string, got ${typeof link}`);
  }
  if (link.includes("t.me/+") || link.includes("joinchat")) {
    throw new ValidationError(
      `invite links are not allowed: ${link}`
    );
  }
  const match = TELEGRAM_LINK_RE.exec(link);
  if (!match) {
    throw new ValidationError(
      `link must match https://t.me/c/<group>/[<topic>/]<message>: ${link}`
    );
  }
  const [, groupId, topicId, messageId] = match;
  return {
    groupId,
    topicId: topicId ?? null,
    messageId,
  };
}

export function parseTmdbInput(input, { hasSeason } = {}) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new ValidationError("tmdb input is required");
  }
  const value = input.trim();

  const urlMatch = TMDB_URL_RE.exec(value);
  if (urlMatch) {
    return { source: "url", type: urlMatch[1], id: Number(urlMatch[2]) };
  }

  const idMatch = TMDB_ID_RE.exec(value);
  if (idMatch) {
    return {
      source: "tmdbId",
      type: hasSeason ? "tv" : "movie",
      id: Number(idMatch[1]),
    };
  }

  if (IMDB_ID_RE.test(value)) {
    return { source: "imdb", imdbId: value };
  }

  throw new ValidationError(
    `tmdb input must be a themoviedb.org URL, tmdb:<id> or an IMDB id: ${value}`
  );
}

export function validateQuality(quality, qualities) {
  if (!qualities.includes(quality)) {
    throw new ValidationError(
      `quality "${quality}" is not one of: ${qualities.join(", ")}`
    );
  }
}

export function validateSeason(season, type) {
  if (type === "series") {
    if (season === undefined || season === null) {
      throw new ValidationError("season is required for series entries");
    }
    if (season !== "all" && !(Number.isInteger(season) && season >= 0)) {
      throw new ValidationError(
        `season must be "all" or an integer >= 0, got ${JSON.stringify(season)}`
      );
    }
  } else if (season !== undefined) {
    throw new ValidationError("season is not allowed for movie entries");
  }
}

export function validateTags(tags) {
  if (tags === undefined) return;
  if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string")) {
    throw new ValidationError("tags must be an array of strings");
  }
}

export function validateLanguages(values, field, allowed) {
  if (values === undefined) return;
  if (!Array.isArray(values) || !values.every((v) => typeof v === "string")) {
    throw new ValidationError(`${field} must be an array of strings`);
  }
  const seen = new Set();
  for (const value of values) {
    if (!allowed.includes(value)) {
      throw new ValidationError(
        `${field} "${value}" is not one of: ${allowed.join(", ")}`
      );
    }
    if (seen.has(value)) {
      throw new ValidationError(`${field} has duplicate value "${value}"`);
    }
    seen.add(value);
  }
}

export function sanitizeNewLanguage(raw, existing) {
  if (raw === undefined || raw === null) return undefined;
  const value = cleanNewLanguage(raw);
  if (value === "") return undefined;
  const error = newLanguageError(value);
  if (error) throw new ValidationError(`${error} Recibido: ${value}`);
  const key = normalizeText(value);
  const existingMatch = existing.find((v) => normalizeText(v) === key);
  return existingMatch ?? value;
}

const HTTPS_URL_RE = /^https:\/\/[^\s/?#@]+(?:[/?#]\S*)?$/;

export function validatePoster(poster) {
  if (poster === undefined) return;
  if (typeof poster !== "string" || poster.trim() === "") {
    throw new ValidationError("poster must be a non-empty string");
  }
  if (!HTTPS_URL_RE.test(poster)) {
    throw new ValidationError(`poster must be an https:// URL, got ${poster}`);
  }
}

export function validateSeasonPosters(seasonPosters, type) {
  if (seasonPosters === undefined) return;
  if (type !== "series") {
    throw new ValidationError("seasonPosters is not allowed for movie entries");
  }
  if (typeof seasonPosters !== "object" || seasonPosters === null || Array.isArray(seasonPosters)) {
    throw new ValidationError("seasonPosters must be a mapping of season to poster URL");
  }
  for (const [season, poster] of Object.entries(seasonPosters)) {
    if (season !== "all" && !/^\d+$/.test(season)) {
      throw new ValidationError(
        `seasonPosters key must be "all" or an integer >= 0, got ${JSON.stringify(season)}`
      );
    }
    if (typeof poster !== "string" || poster.trim() === "") {
      throw new ValidationError(`seasonPosters["${season}"] must be a non-empty string`);
    }
    if (!HTTPS_URL_RE.test(poster)) {
      throw new ValidationError(`seasonPosters["${season}"] must be an https:// URL, got ${poster}`);
    }
  }
}

export function validateLinkEntry(entry, { type, qualities, groups, languages }) {
  if (typeof entry !== "object" || entry === null) {
    throw new ValidationError("each link entry must be an object");
  }
  validateSeason(entry.season, type);
  if (entry.quality === undefined) {
    throw new ValidationError("quality is required");
  }
  validateQuality(entry.quality, qualities);
  validateLanguages(entry.audio, "audio", languages.audio);
  validateLanguages(entry.subs, "subs", languages.subs);
  validateTags(entry.tags);
  const { groupId } = parseTelegramLink(entry.link);
  if (!Object.prototype.hasOwnProperty.call(groups, groupId)) {
    throw new ValidationError(`unknown telegram group id: ${groupId}`);
  }
}

export function validateTitleFile(type, filename, data, { qualities, groups, languages }) {
  if (!FILENAME_RE.test(filename)) {
    throw new ValidationError(`invalid filename: ${filename}`);
  }
  if (type !== "movies" && type !== "series") {
    throw new ValidationError(`invalid type: ${type}`);
  }
  if (typeof data !== "object" || data === null) {
    throw new ValidationError("file content must be a YAML mapping");
  }
  if (!Array.isArray(data.links) || data.links.length === 0) {
    throw new ValidationError("links must be a non-empty array");
  }
  validatePoster(data.poster);
  const entryType = type === "movies" ? "movie" : "series";
  validateSeasonPosters(data.seasonPosters, entryType);
  for (const entry of data.links) {
    validateLinkEntry(entry, { type: entryType, qualities, groups, languages });
  }
}

/**
 * Maps each path to the timestamp of its latest addition, from the output of
 * `git log --no-renames --diff-filter=A --name-only --format=%x00%at`, which
 * lists commits newest first with each header line starting with a NUL.
 */
export function parseAddedTimestamps(output) {
  const timestamps = new Map();
  let currentTimestamp = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("\0")) {
      currentTimestamp = Number(line.slice(1));
    } else if (line.trim() && currentTimestamp !== null && !timestamps.has(line)) {
      timestamps.set(line, currentTimestamp);
    }
  }
  return timestamps;
}

export function loadTmdbCache(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export function saveTmdbCache(path, cache) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache));
}

export function purgeTmdbCache(cache, usedKeys) {
  for (const key of Object.keys(cache)) {
    if (!usedKeys.has(key)) {
      delete cache[key];
    }
  }
}

export const TMDB_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createTmdbClient(apiKey, { cache = {}, now = () => Date.now() } = {}) {
  const useBearer = apiKey.startsWith("eyJ");
  const usedKeys = new Set();
  async function request(path, params = {}) {
    const url = new URL(`https://api.themoviedb.org/3${path}`);
    url.searchParams.set("language", "es-ES");
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const headers = {};
    if (useBearer) {
      headers.Authorization = `Bearer ${apiKey}`;
    } else {
      url.searchParams.set("api_key", apiKey);
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`TMDB ${path} failed: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }
  async function cached(key, fetcher) {
    usedKeys.add(key);
    const entry = cache[key];
    const wrapped = entry && typeof entry.fetchedAt === "number";
    if (wrapped && now() - entry.fetchedAt < TMDB_CACHE_TTL_MS) {
      return entry.value;
    }
    let value;
    try {
      value = await fetcher();
    } catch (err) {
      if (entry === undefined) throw err;
      return wrapped ? entry.value : entry;
    }
    cache[key] = { fetchedAt: now(), value };
    return value;
  }
  return {
    usedKeys,
    getMovie: (id) => cached(`movie:${id}`, () => request(`/movie/${id}`)),
    getTv: (id) => cached(`tv:${id}`, () => request(`/tv/${id}`)),
    getTvExternalIds: (id) =>
      cached(`tvExternalIds:${id}`, () => request(`/tv/${id}/external_ids`)),
    getTvSeason: (id, season) =>
      cached(`tvSeason:${id}:${season}`, () =>
        request(`/tv/${id}/season/${season}`)
      ),
    findByImdb: (imdbId) =>
      request(`/find/${imdbId}`, { external_source: "imdb_id" }),
    posterUrl: (path) =>
      path ? `https://image.tmdb.org/t/p/w342${path}` : null,
  };
}

export async function resolveTmdbTarget(descriptor, tmdbClient) {
  if (descriptor.source === "imdb") {
    const found = await tmdbClient.findByImdb(descriptor.imdbId);
    if (found.movie_results?.length) {
      return { type: "movie", id: found.movie_results[0].id };
    }
    if (found.tv_results?.length) {
      return { type: "tv", id: found.tv_results[0].id };
    }
    throw new ValidationError(`IMDB id not found on TMDB: ${descriptor.imdbId}`);
  }
  return { type: descriptor.type, id: descriptor.id };
}
