import { readFileSync, writeFileSync, unlinkSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createTmdbClient, isEntrypoint } from "./lib.js";
import { openBotPr, closeIssueIfOpen, checkAntiSpam, reportFailure, runUrl, hasPendingChanges, skipReason, reportValidationFailure, mergedMessage, NO_CHANGES_MESSAGE } from "./gh-flow.js";
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
export {
  checkAntiSpam,
  INTERNAL_ERROR_LABEL,
  INTERNAL_ERROR_MESSAGE,
  reportFailure,
} from "./gh-flow.js";

async function main() {
  const issueNumber = process.env.ISSUE_NUMBER;
  const issueAuthor = process.env.ISSUE_AUTHOR;
  const issueLabels = (process.env.ISSUE_LABELS || "").split(",");
  const issueLabel = ["fix", "poster", "reidentify"].find((l) => issueLabels.includes(l)) ?? "add";
  const body = process.env.ISSUE_BODY;

  const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });
  const git = (args) => execFileSync("git", args, { encoding: "utf8" });
  const progress = { branch: `bot/entry-${issueNumber}`, pushed: false, prCreated: false, merged: false };

  try {
    const outcome = await run({ issueNumber, issueAuthor, issueLabel, body, gh, git, progress });
    if (outcome?.deployPending) process.exitCode = 1;
  } catch (err) {
    reportFailure(err, { issueNumber, ...progress, runUrl: runUrl(), gh, git });
  }
}

export async function run({ issueNumber, issueAuthor, issueLabel, body, gh, git, progress }) {
  const skip = skipReason(gh, issueNumber);
  if (skip) {
    console.log(`Issue #${issueNumber} is ${skip}, nothing to do.`);
    return;
  }

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

  if (!hasPendingChanges(git)) {
    gh(["issue", "comment", issueNumber, "--body", NO_CHANGES_MESSAGE]);
    closeIssueIfOpen(gh, issueNumber);
    return;
  }

  const { subject, close } = describeResult(issueLabel, result);

  const { prUrl, validated, deployed } = await openBotPr({
    subject,
    commitBody: `Closes #${issueNumber}`,
    prBody: `Closes #${issueNumber}`,
    autoMerge: true,
    gh,
    git,
    progress,
  });
  if (!validated) {
    reportValidationFailure(gh, issueNumber, prUrl);
    return;
  }

  gh(["issue", "comment", issueNumber, "--body", mergedMessage(close, deployed)]);
  closeIssueIfOpen(gh, issueNumber);
  return { deployPending: !deployed };
}

if (process.env.ISSUE_NUMBER && isEntrypoint(import.meta.url)) {
  await main();
}
