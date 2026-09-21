import { readFileSync, writeFileSync, unlinkSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { load, dump } from "js-yaml";
import {
  ValidationError,
  parseTmdbInput,
  resolveTmdbTarget,
  validateLinkEntry,
  validateQuality,
  validatePoster,
  sanitizeNewLanguage,
  createTmdbClient,
} from "./lib.js";

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

function requireTextFields(fields) {
  for (const id of TEXT_FIELDS) {
    const value = fields[id];
    if (value !== undefined && value !== null && typeof value !== "string") {
      const kind = Array.isArray(value) ? "array" : typeof value;
      throw new ValidationError(`${id} must be a string, got ${kind}`);
    }
  }
}

function parseSeasonField(raw) {
  if (raw === "" || raw === undefined) return undefined;
  if (raw === "all") return "all";
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new ValidationError(`season must be "all" or an integer >= 0, got ${raw}`);
  }
  return n;
}

const ENTRY_KEY_ORDER = ["season", "quality", "audio", "subs", "tags", "link"];

function orderEntry(entry) {
  const ordered = {};
  for (const key of ENTRY_KEY_ORDER) {
    if (entry[key] !== undefined) ordered[key] = entry[key];
  }
  return ordered;
}

function parseListField(raw) {
  if (!raw) return undefined;
  const values = raw.split(",").map((t) => t.trim()).filter(Boolean);
  return values.length ? values : undefined;
}

function dedupe(list) {
  return [...new Set(list)];
}

function applyNewLanguage(raw, list, languages) {
  const resolved = sanitizeNewLanguage(raw, languages[list]);
  if (resolved === undefined) return { values: undefined, changed: false };
  const changed = !languages[list].includes(resolved);
  if (changed) languages[list].push(resolved);
  return { values: [resolved], changed };
}

export async function processAdd(fields, { qualities, groups, languages, tmdbClient, existingLinks, fileExists, readFile }) {
  requireTextFields(fields);
  const season = parseSeasonField(fields.season);
  const descriptor = parseTmdbInput(fields.tmdb, { hasSeason: season !== undefined });
  const target = await resolveTmdbTarget(descriptor, tmdbClient);
  const kind = target.type === "movie" ? "movie" : "series";
  const dir = target.type === "movie" ? "movies" : "series";

  if (existingLinks.has(fields.link)) {
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

  if (!fields.new_link) {
    data.links.splice(idx, 1);
  } else {
    if (fields.new_link !== fields.old_link && existingLinks.has(fields.new_link)) {
      throw new ValidationError(`link already exists in the catalog: ${fields.new_link}`);
    }
    const updated = { ...oldEntry, link: fields.new_link };
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

  const quality = fields.new_link ? data.links[idx].quality : oldEntry.quality;
  const deleted = !fields.new_link;

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

export function checkAntiSpam(createdAt, openEntryIssueCount) {
  const createdMs = createdAt ? new Date(createdAt).getTime() : NaN;
  if (Number.isNaN(createdMs)) {
    return "No se ha podido comprobar la antigüedad de tu cuenta. Vuelve a intentarlo más tarde.";
  }
  const accountAgeDays = (Date.now() - createdMs) / 86400000;
  if (accountAgeDays < 7) {
    return "Tu cuenta de GitHub es demasiado nueva (menos de 7 días) para enviar peticiones.";
  }
  if (openEntryIssueCount > 3) {
    return "Tienes demasiadas peticiones abiertas (más de 3), espera a que se procesen antes de enviar otra.";
  }
  return null;
}

export const INTERNAL_ERROR_LABEL = "bug";
export const INTERNAL_ERROR_MESSAGE =
  "Error interno al procesar la petición. No es culpa tuya: alguien lo revisará a mano.";

/**
 * Reports a failed run on its issue. A ValidationError is explained to the
 * author and labelled invalid. Any other error gets a generic internal-error
 * comment and label, deletes the bot branch if it was pushed and GitHub has
 * no PR for it,
 * and is rethrown so the job still fails. Each cleanup step is best effort.
 */
export function reportFailure(err, { issueNumber, branch, pushed, prCreated, gh, git }) {
  if (err instanceof ValidationError) {
    gh(["issue", "comment", issueNumber, "--body", err.message]);
    gh(["issue", "edit", issueNumber, "--add-label", "invalid"]);
    return;
  }
  const steps = [
    () => gh(["issue", "comment", issueNumber, "--body", INTERNAL_ERROR_MESSAGE]),
    () => gh(["issue", "edit", issueNumber, "--add-label", INTERNAL_ERROR_LABEL]),
  ];
  if (pushed && !prCreated) {
    steps.push(() => {
      const prs = gh(["pr", "list", "--head", branch, "--state", "all", "--json", "number", "--jq", "length"]);
      if (String(prs).trim() === "0") git(["push", "origin", "--delete", branch]);
    });
  }
  for (const step of steps) {
    try {
      step();
    } catch (cleanupErr) {
      console.error(`failure reporting step failed: ${cleanupErr.message}`);
    }
  }
  throw err;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findRunId(gh, workflow, branch) {
  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(1500);
    const runs = JSON.parse(gh([
      "run", "list", "--workflow", workflow, "--branch", branch,
      "--limit", "1", "--json", "databaseId",
    ]));
    if (runs.length) return runs[0].databaseId;
  }
  throw new Error(`${workflow} did not start on ${branch}`);
}

async function main() {
  const issueNumber = process.env.ISSUE_NUMBER;
  const issueAuthor = process.env.ISSUE_AUTHOR;
  const issueLabels = (process.env.ISSUE_LABELS || "").split(",");
  const issueLabel = ["fix", "poster", "reidentify"].find((l) => issueLabels.includes(l)) ?? "add";
  const body = process.env.ISSUE_BODY;

  const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });
  const git = (args) => execFileSync("git", args, { encoding: "utf8" });
  const progress = { branch: `bot/entry-${issueNumber}`, pushed: false, prCreated: false };

  try {
    await run({ issueNumber, issueAuthor, issueLabel, body, gh, git, progress });
  } catch (err) {
    reportFailure(err, { issueNumber, ...progress, gh, git });
  }
}

async function run({ issueNumber, issueAuthor, issueLabel, body, gh, git, progress }) {
  const qualities = load(readFileSync("qualities.yaml", "utf8"));
  const groups = load(readFileSync("groups.yaml", "utf8"));
  const languages = load(readFileSync("languages.yaml", "utf8"));
  const tmdbClient = createTmdbClient(process.env.TMDB_API_KEY);

  const user = JSON.parse(gh(["api", `users/${issueAuthor}`]));
  const openCountOut = gh([
    "issue", "list", "--label", "entry", "--state", "open",
    "--author", issueAuthor, "--json", "number",
  ]);
  const openCount = JSON.parse(openCountOut).length;
  const spamReason = checkAntiSpam(user.created_at, openCount);
  if (spamReason) {
    gh(["issue", "comment", issueNumber, "--body", spamReason]);
    return;
  }

  const existingLinks = collectExistingLinks();

  let result;
  if (issueLabel === "add") {
    const fields = parseIssueBody(body, ["tmdb", "quality", "season", "audio", "subs", "new_audio_language", "new_subs_language", "tags", "poster", "link"]);
    result = await processAdd(fields, {
      qualities,
      groups,
      languages,
      tmdbClient,
      existingLinks,
      fileExists: existsSync,
      readFile: (p) => readFileSync(p, "utf8"),
    });
  } else if (issueLabel === "poster") {
    const fields = parseIssueBody(body, ["tmdb", "poster"]);
    result = await processPoster(fields, {
      tmdbClient,
      fileExists: existsSync,
      readFile: (p) => readFileSync(p, "utf8"),
    });
  } else if (issueLabel === "reidentify") {
    const fields = parseIssueBody(body, ["tmdb", "new_tmdb", "old_link", "season", "poster"]);
    result = await processReidentify(fields, {
      qualities,
      groups,
      languages,
      tmdbClient,
      fileExists: existsSync,
      readFile: (p) => readFileSync(p, "utf8"),
    });
  } else {
    const fields = parseIssueBody(body, ["tmdb", "old_link", "new_link", "quality", "audio", "subs", "new_audio_language", "new_subs_language", "season", "tags"]);
    result = processFix(fields, {
      qualities,
      groups,
      languages,
      existingLinks,
      readdir: readdirSync,
      readFile: (p) => readFileSync(p, "utf8"),
    });
  }

  for (const { filePath, content } of resultFiles(result)) {
    if (content === null) unlinkSync(filePath);
    else writeFileSync(filePath, content);
  }
  if (result.languagesChanged) {
    writeFileSync("languages.yaml", dump(languages));
  }

  const { subject, close } = describeResult(issueLabel, result);

  const { branch } = progress;
  git(["config", "user.name", "cositeca-bot"]);
  git(["config", "user.email", "cositeca-bot@users.noreply.github.com"]);
  git(["checkout", "-b", branch]);
  git(["add", "-A"]);
  git(["commit", "-m", subject, "-m", `Closes #${issueNumber}`]);
  git(["push", "-u", "origin", branch]);
  progress.pushed = true;

  gh(["workflow", "run", "validate.yml", "--ref", branch]);
  const runId = await findRunId(gh, "validate.yml", branch);

  const prUrl = gh([
    "pr", "create", "--base", "main", "--head", branch,
    "--title", subject, "--body", `Closes #${issueNumber}`,
  ]).trim();
  progress.prCreated = true;
  const prNumber = prUrl.split("/").pop();

  try {
    gh(["run", "watch", String(runId), "--exit-status"]);
  } catch {
    gh([
      "issue", "comment", issueNumber, "--body",
      "La validación automática ha fallado en el PR generado, alguien lo revisará a mano.",
    ]);
    return;
  }

  gh(["pr", "merge", prNumber, "--squash", "--delete-branch"]);
  gh(["workflow", "run", "deploy.yml"]);
  gh([
    "issue", "comment", issueNumber, "--body",
    `${close} La web se actualiza en un par de minutos.`,
  ]);
  if (gh(["issue", "view", issueNumber, "--json", "state", "--jq", ".state"]).trim() !== "CLOSED") {
    gh(["issue", "close", issueNumber]);
  }
}

if (process.env.ISSUE_NUMBER && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
