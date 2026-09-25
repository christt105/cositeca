import { normalizeText } from "../../site/rules.js";

const MOVIE_LINE_RE = /^(?<title>.*?)(?:\s*\((?<year>\d{4})\))?\s*[([](?<quality>[^()[\]]*)[)\]]\s*$/;
const SERIES_LINE_RE =
  /^(?<title>.*?)\s*-\s*(?:Temporada\s+(?<season>\d+|Especiales?)|(?<whole>Miniserie|Serie Completa))(?:\s*[([](?<quality>[^()[\]]*)[)\]])?\s*$/i;
const YEAR_IN_TITLE_RE = /\s*\((\d{4})\)/;

const BRACKET_RE = /\s*[([][^()[\]]*[)\]]/g;
const EDITION_SUFFIX_RE =
  /\s*[-+]\s*(Versi[oó]n .*|Montaje del [Dd]irector|Director'?s Cut|Extendida.*|Remasterizada.*|Documental.*)$/i;
const KNOWN_PREFIXES = ["Fitgirl Repacks ", "Marvel Television presenta "];

function detectQuality(raw) {
  if (!raw) return null;
  if (raw.includes("4K")) return "4K";
  if (raw.includes("1080p")) return "1080p";
  return null;
}

function detectTags(raw) {
  const tags = [];
  if (!raw) return tags;
  if (raw.includes("REMUX")) tags.push("REMUX");
  if (raw.includes("HDR")) tags.push("HDR");
  return tags;
}

export function parseEntryLine(text) {
  const firstLine = (text ?? "").split("\n")[0].trim();
  if (!firstLine) return null;

  const seriesMatch = SERIES_LINE_RE.exec(firstLine);
  if (seriesMatch) {
    const { title, season, whole, quality } = seriesMatch.groups;
    const yearMatch = YEAR_IN_TITLE_RE.exec(title);
    return {
      kind: "series",
      title: title.replace(YEAR_IN_TITLE_RE, "").trim(),
      year: yearMatch ? yearMatch[1] : null,
      season: whole ? "all" : /^especial/i.test(season) ? 0 : Number(season),
      quality: detectQuality(quality) ?? "1080p",
      tags: detectTags(quality),
    };
  }

  const movieMatch = MOVIE_LINE_RE.exec(firstLine);
  if (movieMatch) {
    const { title, year, quality } = movieMatch.groups;
    return {
      kind: "movie",
      title: title.trim(),
      year: year ?? null,
      season: undefined,
      quality: detectQuality(quality),
      tags: detectTags(quality),
    };
  }

  return null;
}

export function cleanTitleForSearch(title) {
  let cleaned = title;
  for (const prefix of KNOWN_PREFIXES) {
    if (cleaned.startsWith(prefix)) cleaned = cleaned.slice(prefix.length);
  }
  cleaned = cleaned.replace(BRACKET_RE, "");
  cleaned = cleaned.replace(EDITION_SUFFIX_RE, "");
  return cleaned.replace(/^[\s\-+]+|[\s\-+]+$/g, "");
}

const SYNONYMS = {
  espanol: "castellano",
  spanish: "castellano",
  english: "ingles",
  japanese: "japones",
  french: "frances",
  catalan: "catalan",
};

const SPLIT_RE = /,|\by\b|\be\b|\/|\+/i;
const MAX_LEADING_LINES = 4;

function norm(text) {
  return normalizeText(text ?? "").replace(/^[\s.]+|[\s.]+$/g, "");
}

function buildTable(names) {
  const table = {};
  for (const name of names) table[norm(name)] = name;
  return table;
}

function tokenize(segment) {
  return segment
    .replaceAll("(", ",")
    .replaceAll(")", ",")
    .split(SPLIT_RE)
    .map((raw) => {
      const token = norm(raw);
      return SYNONYMS[token] ?? token;
    })
    .filter(Boolean);
}

function extractLanguages(segment, table) {
  const found = [];
  for (const token of tokenize(segment)) {
    const mapped = token === "vose" ? "VOSE" : table[token];
    if (mapped && !found.includes(mapped)) found.push(mapped);
  }
  return found;
}

function resolveVose(tokens, isSubsContext) {
  const resolved = tokens.map((t) => (t === "VOSE" ? (isSubsContext ? "Castellano" : "VO") : t));
  return resolved.filter((t, i) => resolved.indexOf(t) === i);
}

function isPureLanguageLine(line, audioTable) {
  const stripped = line.replace(/^\s*solo\s+/i, "");
  const tokens = tokenize(stripped);
  if (!tokens.length) return false;
  return tokens.every((t) => t === "vose" || t === "vo" || t in audioTable);
}

export function parseLanguages(text, languages) {
  const audioTable = buildTable(languages.audio);
  const subsTable = buildTable(languages.subs);
  let audio = [];
  let subs = [];
  const lines = (text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const lower = norm(line);
    if (lower.startsWith("audio")) {
      const segment = line.includes(":") ? line.split(":").slice(1).join(":") : line.slice("audio".length);
      audio.push(...resolveVose(extractLanguages(segment, audioTable), false));
    } else if (lower.startsWith("subtitulos") || lower.startsWith("subt")) {
      const segment = line.includes(":") ? line.split(":").slice(1).join(":") : line;
      subs.push(...resolveVose(extractLanguages(segment, subsTable), true));
    }
  }

  if (!audio.length && !subs.length) {
    for (const line of lines.slice(0, MAX_LEADING_LINES)) {
      if (!isPureLanguageLine(line, audioTable)) continue;
      const segment = line.replace(/^\s*solo\s+/i, "");
      const tokens = extractLanguages(segment, audioTable);
      audio = resolveVose(tokens, false);
      if (tokens.includes("VOSE")) subs = ["Castellano"];
      break;
    }
  }

  const dedupe = (items) => items.filter((t, i) => items.indexOf(t) === i);
  return { audio: dedupe(audio), subs: dedupe(subs) };
}
