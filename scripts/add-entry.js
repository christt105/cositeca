import { readFileSync, writeFileSync, unlinkSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { load, dump } from "js-yaml";
import {
  ValidationError,
  parseTmdbInput,
  resolveTmdbTarget,
  validateLinkEntry,
  validateQuality,
  validatePoster,
  createTmdbClient,
} from "./lib.js";

export const FIELD_LABELS = {
  tmdb: "URL de TMDB o id de IMDB",
  quality: "Calidad",
  season: "Temporada",
  audio: "Audio",
  subs: "Subtítulos",
  tags: "Etiquetas",
  poster: "Portada",
  link: "Link de Telegram",
  old_link: "Link actual",
  new_link: "Link nuevo",
};

export function parseIssueBody(body, fieldIds) {
  const sections = body.split(/\n(?=### )/);
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

export async function processAdd(fields, { qualities, groups, languages, tmdbClient, existingLinks, fileExists, readFile }) {
  const season = parseSeasonField(fields.season);
  const descriptor = parseTmdbInput(fields.tmdb, { hasSeason: season !== undefined });
  const target = await resolveTmdbTarget(descriptor, tmdbClient);
  const kind = target.type === "movie" ? "movie" : "series";
  const dir = target.type === "movie" ? "movies" : "series";

  if (existingLinks.has(fields.link)) {
    throw new ValidationError(`link already exists in the catalog: ${fields.link}`);
  }

  const audio = parseListField(fields.audio);
  const subs = parseListField(fields.subs);
  const tags = parseListField(fields.tags);
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
    data = { title: data.title, poster, links: data.links };
  }

  return { filePath, content: dump(data), title, quality: fields.quality, action: "write" };
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
  const located = findFileByLink(fields.old_link, { readdir, readFile });
  if (!located) {
    throw new ValidationError(`link not found in the catalog: ${fields.old_link}`);
  }
  const { filePath, data, idx, type } = located;
  const oldEntry = data.links[idx];
  const title = data.title;

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
    const audio = parseListField(fields.audio);
    if (audio) updated.audio = audio;
    const subs = parseListField(fields.subs);
    if (subs) updated.subs = subs;
    if (fields.tags === "-") {
      delete updated.tags;
    } else {
      const tags = parseListField(fields.tags);
      if (tags) updated.tags = tags;
    }
    validateLinkEntry(updated, { type, qualities, groups, languages });
    data.links[idx] = orderEntry(updated);
  }

  const quality = fields.new_link ? data.links[idx].quality : oldEntry.quality;
  const deleted = !fields.new_link;

  if (data.links.length === 0) {
    return { filePath, content: null, title, quality, action: "delete", deleted };
  }
  return { filePath, content: dump(data), title, quality, action: "write", deleted };
}

export async function processPoster(fields, { tmdbClient, fileExists, readFile }) {
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
  const data = poster
    ? { title: current.title, poster, links: current.links }
    : { title: current.title, links: current.links };
  return { filePath, content: dump(data), title: current.title, action: "write" };
}

export function checkAntiSpam(createdAt, openEntryIssueCount) {
  const accountAgeDays = (Date.now() - new Date(createdAt).getTime()) / 86400000;
  if (accountAgeDays < 7) {
    return "Cuenta demasiado nueva o demasiadas peticiones abiertas";
  }
  if (openEntryIssueCount > 3) {
    return "Cuenta demasiado nueva o demasiadas peticiones abiertas";
  }
  return null;
}

function collectExistingLinks() {
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

async function main() {
  const issueNumber = process.env.ISSUE_NUMBER;
  const issueAuthor = process.env.ISSUE_AUTHOR;
  const issueLabels = (process.env.ISSUE_LABELS || "").split(",");
  const issueLabel = ["fix", "poster"].find((l) => issueLabels.includes(l)) ?? "add";
  const body = process.env.ISSUE_BODY;

  const qualities = load(readFileSync("qualities.yaml", "utf8"));
  const groups = load(readFileSync("groups.yaml", "utf8"));
  const languages = load(readFileSync("languages.yaml", "utf8"));
  const tmdbClient = createTmdbClient(process.env.TMDB_API_KEY);

  const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });

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

  try {
    let result;
    if (issueLabel === "add") {
      const fields = parseIssueBody(body, ["tmdb", "quality", "season", "audio", "subs", "tags", "poster", "link"]);
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
    } else {
      const fields = parseIssueBody(body, ["tmdb", "old_link", "new_link", "quality", "audio", "subs", "season", "tags"]);
      result = processFix(fields, {
        qualities,
        groups,
        languages,
        existingLinks,
        readdir: readdirSync,
        readFile: (p) => readFileSync(p, "utf8"),
      });
    }

    if (result.action === "delete") {
      unlinkSync(result.filePath);
    } else {
      writeFileSync(result.filePath, result.content);
    }

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
    };
    const { subject, close } = messages[issueLabel];

    const git = (args) => execFileSync("git", args, { encoding: "utf8" });
    const branch = `bot/entry-${issueNumber}`;
    git(["config", "user.name", "cositeca-bot"]);
    git(["config", "user.email", "cositeca-bot@users.noreply.github.com"]);
    git(["checkout", "-b", branch]);
    git(["add", "-A"]);
    git(["commit", "-m", subject, "-m", `Closes #${issueNumber}`]);
    git(["push", "-u", "origin", branch]);

    const prUrl = gh([
      "pr", "create", "--base", "main", "--head", branch,
      "--title", subject, "--body", `Closes #${issueNumber}`,
    ]).trim();
    const prNumber = prUrl.split("/").pop();

    try {
      gh(["pr", "checks", prNumber, "--watch"]);
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
  } catch (err) {
    if (err instanceof ValidationError) {
      gh(["issue", "comment", issueNumber, "--body", err.message]);
      gh(["issue", "edit", issueNumber, "--add-label", "invalid"]);
    } else {
      throw err;
    }
  }
}

if (process.env.ISSUE_NUMBER) {
  await main();
}
