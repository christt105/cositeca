import { readFileSync, writeFileSync, unlinkSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { ValidationError, createTmdbClient, isEntrypoint } from "./lib.js";
import {
  processAdd,
  processFix,
  processPoster,
  processReidentify,
  resultFiles,
  describeResult,
  collectExistingLinks,
} from "./operations.js";
import { openBotPr, closeIssueIfOpen, checkAntiSpam, reportFailure } from "./gh-flow.js";
import { loadConfig, saveLanguages } from "./config.js";

export const MAX_OPERATIONS = 50;
const OPERATIONS_LABEL = "Operaciones (JSON)";
const REQUIRED_FIELDS = {
  add: ["tmdb", "quality", "link"],
  fix: ["old_link"],
  poster: ["tmdb"],
  reidentify: ["tmdb", "new_tmdb"],
};

export function extractOperationsJson(issueBody) {
  const body = (issueBody || "").replace(/\r\n?/g, "\n");
  const heading = new RegExp(`^###\\s*${OPERATIONS_LABEL.replace(/[()]/g, "\\$&")}\\s*\\n+`, "m");
  const match = heading.exec(body);
  if (!match) return "";
  let value = body.slice(match.index + match[0].length).trim();
  const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(value);
  if (fenced) value = fenced[1].trim();
  return value === "_No response_" ? "" : value;
}

export function parseOperations(text) {
  let ops;
  try {
    ops = JSON.parse(text);
  } catch (err) {
    throw new ValidationError(`el JSON de operaciones no es válido: ${err.message}`);
  }
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new ValidationError("las operaciones deben ser un array no vacío");
  }
  if (ops.length > MAX_OPERATIONS) {
    throw new ValidationError(`demasiadas operaciones en un solo lote (${ops.length}), el máximo es ${MAX_OPERATIONS}`);
  }
  return ops;
}

function validOperation(op) {
  if (typeof op !== "object" || op === null) return "operación inválida, se omite";
  if (!Object.prototype.hasOwnProperty.call(REQUIRED_FIELDS, op.type)) {
    return `tipo de operación desconocido, se omite: ${JSON.stringify(op.type)}`;
  }
  for (const field of REQUIRED_FIELDS[op.type]) {
    if (!op[field]) return `falta el campo "${field}" en una operación de tipo ${op.type}, se omite`;
  }
  return null;
}

export function makeOverlayFs() {
  const overlay = new Map();
  return {
    fileExists: (p) => (overlay.has(p) ? overlay.get(p) !== null : existsSync(p)),
    readFile: (p) => {
      if (overlay.has(p)) {
        const content = overlay.get(p);
        if (content === null) throw new Error(`${p} was deleted earlier in this batch`);
        return content;
      }
      return readFileSync(p, "utf8");
    },
    readdir: (dir) => {
      const real = new Set(existsSync(dir) ? readdirSync(dir) : []);
      for (const [path, content] of overlay) {
        if (!path.startsWith(`${dir}/`)) continue;
        const filename = path.slice(dir.length + 1);
        if (content === null) real.delete(filename);
        else real.add(filename);
      }
      return [...real];
    },
    write: (p, content) => overlay.set(p, content),
    remove: (p) => overlay.set(p, null),
    flush: () => {
      for (const [path, content] of overlay) {
        if (content === null) unlinkSync(path);
        else writeFileSync(path, content);
      }
    },
  };
}

function updateExistingLinks(op, result, existingLinks) {
  if (op.type === "add") {
    existingLinks.add(op.link);
  } else if (op.type === "fix") {
    existingLinks.delete(op.old_link);
    if (!result.deleted) existingLinks.add(op.new_link || op.old_link);
  }
}

export async function applyBatch(ops, { qualities, groups, languages, tmdbClient, fs }) {
  const existingLinks = collectExistingLinks();
  const applied = [];
  const skipped = [];
  let languagesChanged = false;

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const invalidReason = validOperation(op);
    if (invalidReason) {
      skipped.push(`operación ${i + 1}: ${invalidReason}`);
      continue;
    }
    const languagesBefore = structuredClone(languages);
    try {
      let result;
      if (op.type === "add") {
        result = await processAdd(op, {
          qualities, groups, languages, tmdbClient, existingLinks,
          fileExists: fs.fileExists, readFile: fs.readFile,
        });
      } else if (op.type === "fix") {
        result = processFix(op, {
          qualities, groups, languages, existingLinks,
          readdir: fs.readdir, readFile: fs.readFile,
        });
      } else if (op.type === "reidentify") {
        result = await processReidentify(op, {
          qualities, groups, languages, tmdbClient,
          fileExists: fs.fileExists, readFile: fs.readFile,
        });
      } else {
        result = await processPoster(op, {
          tmdbClient, fileExists: fs.fileExists, readFile: fs.readFile,
        });
      }

      for (const { filePath, content } of resultFiles(result)) {
        if (content === null) fs.remove(filePath);
        else fs.write(filePath, content);
      }
      if (result.languagesChanged) languagesChanged = true;

      updateExistingLinks(op, result, existingLinks);
      const { close } = describeResult(op.type, result);
      applied.push(`operación ${i + 1}: ${close}`);
    } catch (err) {
      if (err instanceof ValidationError) {
        for (const list of Object.keys(languagesBefore)) languages[list] = languagesBefore[list];
        skipped.push(`operación ${i + 1}: ${err.message}`);
      } else {
        throw err;
      }
    }
  }

  return { applied, skipped, languagesChanged };
}

async function main() {
  const issueNumber = process.env.ISSUE_NUMBER;
  const issueAuthor = process.env.ISSUE_AUTHOR;
  const body = process.env.ISSUE_BODY || "";
  const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });
  const git = (args) => execFileSync("git", args, { encoding: "utf8" });
  const progress = { branch: `bot/entry-batch-${issueNumber}`, pushed: false, prCreated: false };

  try {
    await run({ issueNumber, issueAuthor, body, gh, git, progress });
  } catch (err) {
    reportFailure(err, { issueNumber, ...progress, gh, git });
  }
}

async function run({ issueNumber, issueAuthor, body, gh, git, progress }) {
  const tmdbClient = createTmdbClient(process.env.TMDB_API_KEY);

  const user = JSON.parse(gh(["api", `users/${issueAuthor}`]));
  const openCount = JSON.parse(gh([
    "issue", "list", "--label", "entry-batch", "--state", "open",
    "--author", issueAuthor, "--json", "number",
  ])).length;
  const spamReason = checkAntiSpam(user.created_at, openCount);
  if (spamReason) {
    gh(["issue", "comment", issueNumber, "--body", spamReason]);
    return;
  }

  const json = extractOperationsJson(body);
  if (!json) {
    throw new ValidationError("no se ha encontrado ningún JSON de operaciones en el issue");
  }
  const ops = parseOperations(json);

  const { qualities, groups, languages } = loadConfig(process.cwd());
  const fs = makeOverlayFs();

  const result = await applyBatch(ops, { qualities, groups, languages, tmdbClient, fs });

  for (const reason of result.skipped) console.warn(`skip: ${reason}`);

  if (result.applied.length === 0) {
    gh([
      "issue", "comment", issueNumber, "--body",
      `Ninguna operación se pudo aplicar (${result.skipped.length} omitida(s)). No se ha creado ningún PR.`,
    ]);
    gh(["issue", "close", issueNumber]);
    return;
  }

  fs.flush();
  if (result.languagesChanged) {
    saveLanguages(process.cwd(), languages);
  }

  const subject = `feat: batch changes (#${issueNumber})`;
  const prBodyParts = [
    `Ref #${issueNumber}`,
    "",
    `${result.applied.length} operación(es) aplicada(s):`,
    ...result.applied.map((a) => `- ${a}`),
  ];
  if (result.skipped.length) {
    prBodyParts.push(
      "",
      `${result.skipped.length} operación(es) omitida(s):`,
      ...result.skipped.map((s) => `- ${s}`)
    );
  }
  prBodyParts.push(
    "",
    "Este PR requiere revisión y merge manual: la validación automática que pasa no lo mergea solo."
  );

  const { prUrl, prNumber, validated } = await openBotPr({
    subject,
    commitBody: `${result.applied.length} operation(s) applied, ref #${issueNumber}`,
    prBody: prBodyParts.join("\n"),
    autoMerge: false,
    gh,
    git,
    progress,
  });
  if (!validated) {
    gh([
      "issue", "comment", issueNumber, "--body",
      `La validación automática ha fallado en el PR generado (${prUrl}), alguien lo revisará a mano.`,
    ]);
    return;
  }

  gh([
    "issue", "comment", issueNumber, "--body",
    `${result.applied.length} operación(es) aplicada(s) y validada(s), esperando revisión manual antes de mergear: ${prUrl} (PR #${prNumber}).`,
  ]);
  closeIssueIfOpen(gh, issueNumber);
}

if (process.env.ISSUE_NUMBER && isEntrypoint(import.meta.url)) {
  await main();
}
