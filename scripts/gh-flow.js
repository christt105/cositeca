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
 * dispatched. Sets `progress.pushed`, `progress.prCreated` and
 * `progress.merged` as each step succeeds. Returns the PR url and number,
 * whether validation passed and whether the deploy was dispatched. A failed
 * dispatch is logged instead of thrown, since the PR is already merged.
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
    return { prUrl, prNumber, validated: false, deployed: false };
  }

  if (!autoMerge) return { prUrl, prNumber, validated: true, deployed: false };

  gh(["pr", "merge", prNumber, "--squash", "--delete-branch"]);
  progress.merged = true;
  try {
    gh(["workflow", "run", "deploy.yml"]);
  } catch (err) {
    console.error(`::warning::deploy.yml dispatch failed: ${err.message}`);
    return { prUrl, prNumber, validated: true, deployed: false };
  }
  return { prUrl, prNumber, validated: true, deployed: true };
}

export const DEPLOYED_SUFFIX = "La web se actualiza en un par de minutos.";
export const DEPLOY_PENDING_SUFFIX =
  "No se ha podido lanzar la actualización de la web, así que tardará más en aparecer: alguien lo revisará.";

/** Success comment for a merged entry, depending on whether the deploy was dispatched. */
export function mergedMessage(close, deployed) {
  return `${close} ${deployed ? DEPLOYED_SUFFIX : DEPLOY_PENDING_SUFFIX}`;
}

export const VALIDATION_FAILED_LABEL = "validation-failed";

/**
 * Reports a bot PR whose validation failed: labels the issue so the issue
 * workflows leave it alone, and tells the author.
 */
export function reportValidationFailure(gh, issueNumber, prUrl) {
  gh(["issue", "edit", issueNumber, "--add-label", VALIDATION_FAILED_LABEL]);
  gh([
    "issue", "comment", issueNumber, "--body",
    `La validación automática ha fallado en el PR generado (${prUrl}), alguien lo revisará a mano.`,
  ]);
}

export const NO_CHANGES_MESSAGE =
  "La petición no cambia nada: el catálogo ya estaba así. No se ha creado ningún PR.";

/** Whether the working tree has anything for openBotPr to commit. */
export function hasPendingChanges(git) {
  return git(["status", "--porcelain"]).trim() !== "";
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
  if (accountAgeDays < 1) {
    return "Tu cuenta de GitHub es demasiado nueva (menos de 1 día) para enviar peticiones.";
  }
  if (openEntryIssueCount > 3) {
    return "Tienes demasiadas peticiones abiertas (más de 3), espera a que se procesen antes de enviar otra.";
  }
  return null;
}

export const INTERNAL_ERROR_LABEL = "bug";
export const INTERNAL_ERROR_MESSAGE =
  "Error interno al procesar la petición. No es culpa tuya: alguien lo revisará a mano.";
export const MERGED_FOLLOWUP_MESSAGE =
  "Tu petición ya está aplicada en el catálogo, pero ha fallado un paso posterior del bot. No tienes que hacer nada: alguien lo revisará.";

/** Link to the current Actions run, or null outside Actions. */
export function runUrl(env = process.env) {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = env;
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return null;
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}

function withRunLink(message, url) {
  return url ? `${message}\n\nDetalles del run: ${url}` : message;
}

/**
 * Reports a failed run on its issue. A ValidationError is explained to the
 * author and labelled invalid. A failure after the bot PR was merged only
 * gets a reassuring comment with the run link and closes the issue. Any
 * other error gets a generic internal-error comment with the run link and
 * label, and deletes the bot branch if it was pushed and GitHub has no PR
 * for it. Non-validation errors are rethrown so the job still fails. Each
 * cleanup step is best effort.
 */
export function reportFailure(err, { issueNumber, branch, pushed, prCreated, merged, runUrl: url, gh, git }) {
  if (err instanceof ValidationError) {
    gh(["issue", "comment", issueNumber, "--body", err.message]);
    gh(["issue", "edit", issueNumber, "--add-label", "invalid"]);
    return;
  }
  const steps = merged
    ? [
        () => gh(["issue", "comment", issueNumber, "--body", withRunLink(MERGED_FOLLOWUP_MESSAGE, url)]),
        () => closeIssueIfOpen(gh, issueNumber),
      ]
    : [
        () => gh(["issue", "comment", issueNumber, "--body", withRunLink(INTERNAL_ERROR_MESSAGE, url)]),
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
