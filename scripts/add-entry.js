import { readFileSync, writeFileSync, unlinkSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { load, dump } from "js-yaml";
import {
  ValidationError,
  parseTmdbInput,
  resolveTmdbTarget,
  validateLinkEntry,
  validateQuality,
  createTmdbClient,
} from "./lib.js";

export const FIELD_LABELS = {
  tmdb: "URL de TMDB o id de IMDB",
  quality: "Calidad",
  season: "Temporada",
  tags: "Etiquetas",
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

function parseTagsField(raw) {
  if (!raw) return undefined;
  const tags = raw.split(",").map((t) => t.trim()).filter(Boolean);
  return tags.length ? tags : undefined;
}

export async function processAdd(fields, { qualities, groups, tmdbClient, existingLinks, fileExists, readFile }) {
  const season = parseSeasonField(fields.season);
  const descriptor = parseTmdbInput(fields.tmdb, { hasSeason: season !== undefined });
  const target = await resolveTmdbTarget(descriptor, tmdbClient);
  const kind = target.type === "movie" ? "movie" : "series";
  const dir = target.type === "movie" ? "movies" : "series";

  if (existingLinks.has(fields.link)) {
    throw new ValidationError(`link already exists in the catalog: ${fields.link}`);
  }

  const entry = {
    ...(season !== undefined ? { season } : {}),
    quality: fields.quality,
    ...(parseTagsField(fields.tags) ? { tags: parseTagsField(fields.tags) } : {}),
    link: fields.link,
  };
  validateLinkEntry(entry, { type: kind, qualities, groups });

  const info = target.type === "movie"
    ? await tmdbClient.getMovie(target.id)
    : await tmdbClient.getTv(target.id);
  const title = target.type === "movie" ? info.title : info.name;

  const filePath = `${dir}/${target.id}.yaml`;
  let data;
  if (fileExists(filePath)) {
    data = load(readFile(filePath));
    data.links.push(entry);
  } else {
    data = { title, links: [entry] };
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

export function processFix(fields, { qualities, groups, existingLinks, readdir, readFile }) {
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
    validateLinkEntry(updated, { type, qualities, groups });
    data.links[idx] = updated;
  }

  const quality = fields.new_link ? data.links[idx].quality : oldEntry.quality;

  if (data.links.length === 0) {
    return { filePath, content: null, title, quality, action: "delete" };
  }
  return { filePath, content: dump(data), title, quality, action: "write" };
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
  const issueLabel = issueLabels.includes("fix") ? "fix" : "add";
  const body = process.env.ISSUE_BODY;

  const qualities = load(readFileSync("qualities.yaml", "utf8"));
  const groups = load(readFileSync("groups.yaml", "utf8"));
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
      const fields = parseIssueBody(body, ["tmdb", "quality", "season", "tags", "link"]);
      result = await processAdd(fields, {
        qualities,
        groups,
        tmdbClient,
        existingLinks,
        fileExists: existsSync,
        readFile: (p) => readFileSync(p, "utf8"),
      });
    } else {
      const fields = parseIssueBody(body, ["tmdb", "old_link", "new_link", "quality", "season"]);
      result = processFix(fields, {
        qualities,
        groups,
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

    const verb = issueLabel === "add" ? "feat" : "fix";
    const subject = issueLabel === "add"
      ? `add ${result.title} ${result.quality}`
      : `update link for ${result.title}`;

    const git = (args) => execFileSync("git", args, { encoding: "utf8" });
    git(["config", "user.name", "cositeca-bot"]);
    git(["config", "user.email", "cositeca-bot@users.noreply.github.com"]);
    git(["add", "-A"]);
    git(["commit", "-m", `${verb}: ${subject}`, "-m", `Closes #${issueNumber}`]);
    git(["push"]);
    gh(["workflow", "run", "deploy.yml"]);
    gh([
      "issue", "close", issueNumber, "--comment",
      `Añadido: ${result.title} (${result.quality}). La web se actualiza en un par de minutos.`,
    ]);
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
