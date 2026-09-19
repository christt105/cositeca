import { readFileSync, writeFileSync, unlinkSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { load, dump } from "js-yaml";
import { ValidationError, createTmdbClient } from "./lib.js";
import {
  processAdd,
  processFix,
  processPoster,
  describeResult,
  collectExistingLinks,
} from "./add-entry.js";

const OPERATIONS_LABEL = "Operaciones (JSON)";
const REQUIRED_FIELDS = {
  add: ["tmdb", "quality", "link"],
  fix: ["old_link"],
  poster: ["tmdb"],
};

export function extractOperationsJson(issueBody) {
  const body = (issueBody || "").replace(/\r\n/g, "\n");
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
  return ops;
}

function validOperation(op) {
  if (typeof op !== "object" || op === null) return "operación inválida, se omite";
  const required = REQUIRED_FIELDS[op.type];
  if (!required) return `tipo de operación desconocido, se omite: ${JSON.stringify(op.type)}`;
  for (const field of required) {
    if (!op[field]) return `falta el campo "${field}" en una operación de tipo ${op.type}, se omite`;
  }
  return null;
}

function makeOverlayFs() {
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
    if (!result.deleted) existingLinks.add(op.new_link);
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
      } else {
        result = await processPoster(op, {
          tmdbClient, fileExists: fs.fileExists, readFile: fs.readFile,
        });
      }

      if (result.action === "delete") fs.remove(result.filePath);
      else fs.write(result.filePath, result.content);
      if (result.languagesChanged) languagesChanged = true;

      updateExistingLinks(op, result, existingLinks);
      const { close } = describeResult(op.type, result);
      applied.push(`operación ${i + 1}: ${close}`);
    } catch (err) {
      if (err instanceof ValidationError) {
        skipped.push(`operación ${i + 1}: ${err.message}`);
      } else {
        throw err;
      }
    }
  }

  return { applied, skipped, languagesChanged };
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
  const body = process.env.ISSUE_BODY || "";
  const tmdbClient = createTmdbClient(process.env.TMDB_API_KEY);
  const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });

  try {
    const json = extractOperationsJson(body);
    if (!json) {
      throw new ValidationError("no se ha encontrado ningún JSON de operaciones en el issue");
    }
    const ops = parseOperations(json);

    const qualities = load(readFileSync("qualities.yaml", "utf8"));
    const groups = load(readFileSync("groups.yaml", "utf8"));
    const languages = load(readFileSync("languages.yaml", "utf8"));
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
      writeFileSync("languages.yaml", dump(languages));
    }

    const git = (args) => execFileSync("git", args, { encoding: "utf8" });
    const branch = `bot/entry-batch-${issueNumber}`;
    git(["config", "user.name", "cositeca-bot"]);
    git(["config", "user.email", "cositeca-bot@users.noreply.github.com"]);
    git(["checkout", "-b", branch]);
    git(["add", "-A"]);
    const subject = `feat: batch changes (#${issueNumber})`;
    git(["commit", "-m", subject, "-m", `${result.applied.length} operation(s) applied, ref #${issueNumber}`]);
    git(["push", "-u", "origin", branch]);

    gh(["workflow", "run", "validate.yml", "--ref", branch]);
    const runId = await findRunId(gh, "validate.yml", branch);

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

    const prUrl = gh([
      "pr", "create", "--base", "main", "--head", branch,
      "--title", subject, "--body", prBodyParts.join("\n"),
    ]).trim();
    const prNumber = prUrl.split("/").pop();

    try {
      gh(["run", "watch", String(runId), "--exit-status"]);
    } catch {
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
