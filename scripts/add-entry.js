import { readFileSync, writeFileSync, unlinkSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ValidationError, createTmdbClient } from "./lib.js";
import { openBotPr, closeIssueIfOpen } from "./gh-flow.js";
import { loadConfig, saveLanguages } from "./config.js";
import { parseIssueBody } from "./issue-fields.js";
import {
  processAdd,
  processFix,
  processPoster,
  processReidentify,
  resultFiles,
  describeResult,
  collectExistingLinks,
} from "./operations.js";

export { FIELD_LABELS, parseIssueBody } from "./issue-fields.js";
export {
  processAdd,
  findFileByLink,
  DELETE_LINK,
  wantsLinkDeletion,
  processFix,
  processPoster,
  processReidentify,
  resultFiles,
  describeResult,
  collectExistingLinks,
} from "./operations.js";

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
  const { qualities, groups, languages } = loadConfig(process.cwd());
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
    saveLanguages(process.cwd(), languages);
  }

  const { subject, close } = describeResult(issueLabel, result);

  const { validated } = await openBotPr({
    subject,
    commitBody: `Closes #${issueNumber}`,
    prBody: `Closes #${issueNumber}`,
    autoMerge: true,
    gh,
    git,
    progress,
  });
  if (!validated) {
    gh([
      "issue", "comment", issueNumber, "--body",
      "La validación automática ha fallado en el PR generado, alguien lo revisará a mano.",
    ]);
    return;
  }

  gh([
    "issue", "comment", issueNumber, "--body",
    `${close} La web se actualiza en un par de minutos.`,
  ]);
  closeIssueIfOpen(gh, issueNumber);
}

if (process.env.ISSUE_NUMBER && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
