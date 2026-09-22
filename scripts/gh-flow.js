import { ValidationError } from "./lib.js";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function findRunId(gh, workflow, branch, { wait = sleep } = {}) {
  for (let attempt = 0; attempt < 20; attempt++) {
    await wait(1500);
    const runs = JSON.parse(gh([
      "run", "list", "--workflow", workflow, "--branch", branch,
      "--limit", "1", "--json", "databaseId",
    ]));
    if (runs.length) return runs[0].databaseId;
  }
  throw new Error(`${workflow} did not start on ${branch}`);
}

/**
 * Commits the working tree as the bot on `progress.branch`, pushes it, runs
 * validate.yml on it, opens a PR against main and waits for the validation.
 * With `autoMerge`, a validated PR is squash-merged and deploy.yml is
 * dispatched. Sets `progress.pushed` and `progress.prCreated` as each step
 * succeeds. Returns the PR url and number and whether validation passed.
 */
export async function openBotPr({ subject, commitBody, prBody, autoMerge, gh, git, progress, wait = sleep }) {
  const { branch } = progress;
  git(["config", "user.name", "cositeca-bot"]);
  git(["config", "user.email", "cositeca-bot@users.noreply.github.com"]);
  git(["checkout", "-b", branch]);
  git(["add", "-A"]);
  git(["commit", "-m", subject, "-m", commitBody]);
  git(["push", "-u", "origin", branch]);
  progress.pushed = true;

  gh(["workflow", "run", "validate.yml", "--ref", branch]);
  const runId = await findRunId(gh, "validate.yml", branch, { wait });

  const prUrl = gh([
    "pr", "create", "--base", "main", "--head", branch,
    "--title", subject, "--body", prBody,
  ]).trim();
  progress.prCreated = true;
  const prNumber = prUrl.split("/").pop();

  try {
    gh(["run", "watch", String(runId), "--exit-status"]);
  } catch {
    return { prUrl, prNumber, validated: false };
  }

  if (autoMerge) {
    gh(["pr", "merge", prNumber, "--squash", "--delete-branch"]);
    gh(["workflow", "run", "deploy.yml"]);
  }
  return { prUrl, prNumber, validated: true };
}

/** Closes the issue unless it is already closed. */
export function closeIssueIfOpen(gh, issueNumber) {
  if (gh(["issue", "view", issueNumber, "--json", "state", "--jq", ".state"]).trim() !== "CLOSED") {
    gh(["issue", "close", issueNumber]);
  }
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
