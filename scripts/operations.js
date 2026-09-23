import { readFileSync, readdirSync, existsSync } from "node:fs";
import { load, dump } from "js-yaml";
import {
  ValidationError,
  parseTmdbInput,
  resolveTmdbTarget,
  validateLinkEntry,
  validateQuality,
  validatePoster,
  sanitizeNewLanguage,
} from "./lib.js";
import { linkKey } from "../site/rules.js";
import { requireTextFields, parseSeasonField, parseListField } from "./issue-fields.js";

const ENTRY_KEY_ORDER = ["season", "quality", "audio", "subs", "tags", "link"];

function orderEntry(entry) {
  const ordered = {};
  for (const key of ENTRY_KEY_ORDER) {
    if (entry[key] !== undefined) ordered[key] = entry[key];
  }
  return ordered;
}

function dedupe(list) {
  return [...new Set(list)];
}

function applyNewLanguage(raw, list, languages) {
  const known = [...languages[list], ...Object.values(languages).flat()];
  const resolved = sanitizeNewLanguage(raw, known);
  if (resolved === undefined) return { values: undefined, changed: false };
  const changed = !languages[list].includes(resolved);
  if (changed) languages[list].push(resolved);
  return { values: [resolved], changed };
}

function isKnownLink(existingLinks, link) {
  const key = linkKey(link);
  return [...existingLinks].some((known) => linkKey(known) === key);
}

export async function processAdd(fields, { qualities, groups, languages, tmdbClient, existingLinks, fileExists, readFile }) {
  requireTextFields(fields);
  const season = parseSeasonField(fields.season);
  const descriptor = parseTmdbInput(fields.tmdb, { hasSeason: season !== undefined });
  const target = await resolveTmdbTarget(descriptor, tmdbClient);
  const kind = target.type === "movie" ? "movie" : "series";
  const dir = target.type === "movie" ? "movies" : "series";

  if (isKnownLink(existingLinks, fields.link)) {
    throw new ValidationError(`link already exists in the catalog: ${fields.link}`);
  }

  let audio = parseListField(fields.audio);
  let subs = parseListField(fields.subs);
  const tags = parseListField(fields.tags);

  const newAudio = applyNewLanguage(fields.new_audio_language, "audio", languages);
  if (newAudio.values) audio = dedupe([...(audio ?? []), ...newAudio.values]);
  const newSubs = applyNewLanguage(fields.new_subs_language, "subs", languages);
  if (newSubs.values) subs = dedupe([...(subs ?? []), ...newSubs.values]);
  const languagesChanged = newAudio.changed || newSubs.changed;

  const entry = orderEntry({ season, quality: fields.quality, audio, subs, tags, link: fields.link });
  validateLinkEntry(entry, { type: kind, qualities, groups, languages });

  const info = target.type === "movie"
    ? await tmdbClient.getMovie(target.id)
    : await tmdbClient.getTv(target.id);
  const title = target.type === "movie" ? info.title : info.name;

  const poster = fields.poster?.trim() || undefined;
  validatePoster(poster);

  const filePath = `${dir}/${target.id}.yaml`;
  let data;
  if (fileExists(filePath)) {
    data = load(readFile(filePath));
    data.links.push(entry);
  } else {
    data = { title, links: [entry] };
  }
  if (poster) {
    data = withPoster(data, poster);
  }

  return { filePath, content: dump(data), title, quality: fields.quality, action: "write", languagesChanged };
}

export function findFileByLink(link, { readdir, readFile }) {
  for (const dir of ["movies", "series"]) {
    let filenames = [];
    try {
      filenames = readdir(dir);
    } catch {
      continue;
    }
    for (const filename of filenames) {
      const filePath = `${dir}/${filename}`;
      const data = load(readFile(filePath));
      const idx = data.links.findIndex((l) => l.link === link);
      if (idx !== -1) {
        const type = dir === "movies" ? "movie" : "series";
        return { filePath, data, idx, type };
      }
    }
  }
  return null;
}

export const DELETE_LINK = "-";
const FIX_TARGET_KEYS = new Set(["type", "tmdb", "old_link", "new_link"]);

/**
 * A fix deletes its link when new_link is "-", or when new_link is empty and
 * no other field carries a value. An empty new_link next to any other value
 * keeps the current link.
 */
export function wantsLinkDeletion(fields) {
  if (fields.new_link === DELETE_LINK) return true;
  if (fields.new_link) return false;
  return Object.entries(fields).every(
    ([key, value]) => FIX_TARGET_KEYS.has(key) || value === undefined || value === null || value === ""
  );
}

export function processFix(fields, { qualities, groups, languages, existingLinks, readdir, readFile }) {
  requireTextFields(fields);
  const located = findFileByLink(fields.old_link, { readdir, readFile });
  if (!located) {
    throw new ValidationError(`link not found in the catalog: ${fields.old_link}`);
  }
  const { filePath, data, idx, type } = located;
  const oldEntry = data.links[idx];
  const title = data.title;
  let languagesChanged = false;
  const deleted = wantsLinkDeletion(fields);
  const newLink = fields.new_link || fields.old_link;

  if (deleted) {
    data.links.splice(idx, 1);
  } else {
    if (linkKey(newLink) !== linkKey(fields.old_link) && isKnownLink(existingLinks, newLink)) {
      throw new ValidationError(`link already exists in the catalog: ${newLink}`);
    }
    const updated = { ...oldEntry, link: newLink };
    if (fields.quality) {
      validateQuality(fields.quality, qualities);
      updated.quality = fields.quality;
    }
    const season = parseSeasonField(fields.season);
    if (season !== undefined) {
      updated.season = season;
    }
    for (const key of ["audio", "subs", "tags"]) {
      if (fields[key] === "-") {
        delete updated[key];
      } else {
        const values = parseListField(fields[key]);
        if (values) updated[key] = values;
      }
    }

    const newAudio = applyNewLanguage(fields.new_audio_language, "audio", languages);
    if (newAudio.values) updated.audio = dedupe([...(updated.audio ?? []), ...newAudio.values]);
    const newSubs = applyNewLanguage(fields.new_subs_language, "subs", languages);
    if (newSubs.values) updated.subs = dedupe([...(updated.subs ?? []), ...newSubs.values]);
    languagesChanged = newAudio.changed || newSubs.changed;

    validateLinkEntry(updated, { type, qualities, groups, languages });
    data.links[idx] = orderEntry(updated);
  }

  const quality = deleted ? oldEntry.quality : data.links[idx].quality;

  if (data.links.length === 0) {
    return { filePath, content: null, title, quality, action: "delete", deleted, languagesChanged };
  }
  return { filePath, content: dump(data), title, quality, action: "write", deleted, languagesChanged };
}

export async function processPoster(fields, { tmdbClient, fileExists, readFile }) {
  requireTextFields(fields);
  const descriptor = parseTmdbInput(fields.tmdb);
  const target = await resolveTmdbTarget(descriptor, tmdbClient);
  const dir = target.type === "movie" ? "movies" : "series";
  const filePath = `${dir}/${target.id}.yaml`;
  if (!fileExists(filePath)) {
    throw new ValidationError(`title not found in the catalog: ${filePath}`);
  }
  const poster = fields.poster?.trim() || undefined;
  validatePoster(poster);
  const current = load(readFile(filePath));
  const data = withPoster(current, poster);
  return { filePath, content: dump(data), title: current.title, action: "write" };
}

function withPoster(data, poster) {
  const { title, seasonPosters, links } = data;
  return {
    title,
    ...(poster ? { poster } : {}),
    ...(seasonPosters ? { seasonPosters } : {}),
    links,
  };
}

function pruneSeasonPosters(seasonPosters, links) {
  if (!seasonPosters) return undefined;
  const used = new Set(links.map((l) => String(l.season)));
  const kept = Object.fromEntries(Object.entries(seasonPosters).filter(([season]) => used.has(season)));
  return Object.keys(kept).length ? kept : undefined;
}

export async function processReidentify(fields, { qualities, groups, languages, tmdbClient, fileExists, readFile }) {
  requireTextFields(fields);
  const source = await resolveTmdbTarget(parseTmdbInput(fields.tmdb), tmdbClient);
  const sourcePath = `${source.type === "movie" ? "movies" : "series"}/${source.id}.yaml`;
  if (!fileExists(sourcePath)) {
    throw new ValidationError(`title not found in the catalog: ${sourcePath}`);
  }

  const season = parseSeasonField(fields.season);
  const descriptor = parseTmdbInput(fields.new_tmdb, { hasSeason: season !== undefined || source.type === "tv" });
  const target = await resolveTmdbTarget(descriptor, tmdbClient);
  const kind = target.type === "movie" ? "movie" : "series";
  const targetPath = `${target.type === "movie" ? "movies" : "series"}/${target.id}.yaml`;
  if (targetPath === sourcePath) {
    throw new ValidationError("the new title is the same as the current one");
  }
  if (kind === "movie" && season !== undefined) {
    throw new ValidationError("season is not allowed when moving to a movie");
  }

  const sourceData = load(readFile(sourcePath));
  const oldEntry = fields.old_link
    ? sourceData.links.find((l) => l.link === fields.old_link)
    : undefined;
  if (fields.old_link && !oldEntry) {
    throw new ValidationError(`link not found in ${sourcePath}: ${fields.old_link}`);
  }
  const toMove = oldEntry ? [oldEntry] : sourceData.links;
  const remaining = sourceData.links.filter((l) => !toMove.includes(l));

  const moved = toMove.map((entry) => {
    const next = { ...entry };
    if (kind === "movie") {
      delete next.season;
    } else if (season !== undefined) {
      next.season = season;
    } else if (next.season === undefined) {
      throw new ValidationError("season is required when moving a movie to a series");
    }
    const ordered = orderEntry(next);
    validateLinkEntry(ordered, { type: kind, qualities, groups, languages });
    return ordered;
  });

  const info = target.type === "movie"
    ? await tmdbClient.getMovie(target.id)
    : await tmdbClient.getTv(target.id);
  const title = target.type === "movie" ? info.title : info.name;

  const poster = fields.poster?.trim() || undefined;
  validatePoster(poster);
  const existing = fileExists(targetPath) ? load(readFile(targetPath)) : { title, links: [] };
  const targetData = withPoster(
    { ...existing, links: [...existing.links, ...moved] },
    poster ?? existing.poster
  );

  const files = [{ filePath: targetPath, content: dump(targetData) }];
  if (remaining.length === 0) {
    files.push({ filePath: sourcePath, content: null });
  } else {
    const sourceOut = { ...sourceData, links: remaining };
    const seasonPosters = pruneSeasonPosters(sourceData.seasonPosters, remaining);
    delete sourceOut.seasonPosters;
    files.push({
      filePath: sourcePath,
      content: dump(withPoster({ ...sourceOut, seasonPosters }, sourceData.poster)),
    });
  }

  return {
    files,
    title: sourceData.title,
    targetTitle: title,
    count: moved.length,
    languagesChanged: false,
  };
}

export function resultFiles(result) {
  if (result.files) return result.files;
  return [{ filePath: result.filePath, content: result.action === "delete" ? null : result.content }];
}

export function describeResult(issueLabel, result) {
  const messages = {
    add: {
      subject: `feat: add ${result.title} ${result.quality}`,
      close: `Añadido: ${result.title} (${result.quality}).`,
    },
    fix: result.deleted
      ? {
        subject: `fix: remove link from ${result.title}`,
        close: `Borrado el link de ${result.title} (${result.quality}).`,
      }
      : {
        subject: `fix: update link for ${result.title}`,
        close: `Actualizado el link de ${result.title} (${result.quality}).`,
      },
    poster: {
      subject: `fix: update poster for ${result.title}`,
      close: `Portada actualizada para ${result.title}.`,
    },
    reidentify: {
      subject: `fix: move ${result.count} link(s) from ${result.title} to ${result.targetTitle}`,
      close: `Movido(s) ${result.count} link(s) de ${result.title} a ${result.targetTitle}.`,
    },
  };
  return messages[issueLabel];
}

export function collectExistingLinks() {
  const links = new Set();
  for (const dir of ["movies", "series"]) {
    if (!existsSync(dir)) continue;
    for (const filename of readdirSync(dir)) {
      const data = load(readFileSync(`${dir}/${filename}`, "utf8"));
      for (const entry of data.links) links.add(entry.link);
    }
  }
  return links;
}
