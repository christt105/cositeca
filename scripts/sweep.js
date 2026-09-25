import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isEntrypoint } from "./lib.js";
import { HOLD_LABELS } from "./gh-flow.js";

export const BOT_LOGINS = ["github-actions", "github-actions[bot]"];
export const SCRIPT_BY_LABEL = {
  entry: "scripts/add-entry.js",
  "entry-batch": "scripts/apply-batch.js",
};

/**
 * Open request issues the bot never answered: no comment from the bot and
 * no hold label. Every run that reaches an issue comments on it or closes
 * it, so these are the ones whose run was cancelled while pending in the
 * `catalog-writes` concurrency group.
 */
export function findStrandedIssues(gh) {
  const stranded = [];
  const seen = new Set();
  for (const [label, script] of Object.entries(SCRIPT_BY_LABEL)) {
    const issues = JSON.parse(gh([
      "issue", "list", "--state", "open", "--label", label, "--limit", "100",
      "--json", "number,author,labels,body,comments",
    ]));
    for (const issue of issues) {
      const labels = issue.labels.map((l) => l.name);
      if (seen.has(issue.number)) continue;
      if (labels.some((name) => HOLD_LABELS.includes(name))) continue;
      if (issue.comments.some((c) => BOT_LOGINS.includes(c.author?.login))) continue;
      seen.add(issue.number);
      stranded.push({
        number: String(issue.number),
        author: issue.author.login,
        labels,
        body: issue.body,
        script,
      });
    }
  }
  return stranded.sort((a, b) => Number(a.number) - Number(b.number));
}

/** Environment the issue workflows would give the script for this issue. */
export function issueEnv(issue, env = process.env) {
  return {
    ...env,
    ISSUE_NUMBER: issue.number,
    ISSUE_AUTHOR: issue.author,
    ISSUE_LABELS: issue.labels.join(","),
    ISSUE_BODY: issue.body,
  };
}

/**
 * Runs the matching bot script for each stranded issue, oldest first, each
 * one from a clean checkout of the latest main. A failing issue does not
 * stop the others; its script has already reported on the issue. Returns
 * the processed and failed issue numbers.
 */
export function sweep({ gh, git, runScript, env = process.env }) {
  const issues = findStrandedIssues(gh);
  const failed = [];
  for (const issue of issues) {
    console.log(`Reprocessing issue #${issue.number} with ${issue.script}`);
    try {
      git(["fetch", "origin", "main"]);
      git(["checkout", "--force", "--detach", "FETCH_HEAD"]);
      git(["clean", "-fd"]);
      runScript(issue.script, issueEnv(issue, env));
    } catch (err) {
      console.error(`issue #${issue.number} failed: ${err.message}`);
      failed.push(issue.number);
    }
  }
  return { processed: issues.map((i) => i.number), failed };
}

function main() {
  const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });
  if (process.argv.includes("--list")) {
    const numbers = findStrandedIssues(gh).map((i) => i.number);
    console.log(numbers.length ? `Stranded issues: ${numbers.join(", ")}` : "No stranded issues.");
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `stranded=${numbers.length}\n`);
    return;
  }
  const git = (args) => execFileSync("git", args, { encoding: "utf8" });
  const runScript = (script, env) => execFileSync("node", [script], { env, stdio: "inherit" });
  const { failed } = sweep({ gh, git, runScript });
  if (failed.length) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  main();
}
