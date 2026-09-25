import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { openBotPr, findRunId, closeIssueIfOpen, hasPendingChanges } from "../scripts/gh-flow.js";

const BRANCH = "bot/entry-7";
const PR_URL = "https://github.com/christt105/cositeca/pull/42";

function runners({ runLists = ['[{"databaseId":99}]'], watchFails = false, issueState = "OPEN" } = {}) {
  const calls = [];
  const pending = [...runLists];
  const gh = (args) => {
    calls.push(["gh", ...args]);
    if (args[0] === "run" && args[1] === "list") return pending.shift() ?? "[]";
    if (args[0] === "pr" && args[1] === "create") return `${PR_URL}\n`;
    if (args[0] === "run" && args[1] === "watch" && watchFails) throw new Error("run failed");
    if (args[0] === "issue" && args[1] === "view") return `${issueState}\n`;
    return "";
  };
  const git = (args) => {
    calls.push(["git", ...args]);
    return "";
  };
  return { calls, gh, git };
}

const noWait = async () => {};

function flowArgs(r, overrides = {}) {
  return {
    subject: "feat: add Fight Club 1080p",
    commitBody: "Closes #7",
    prBody: "Closes #7",
    autoMerge: true,
    gh: r.gh,
    git: r.git,
    progress: { branch: BRANCH, pushed: false, prCreated: false },
    wait: noWait,
    ...overrides,
  };
}

const COMMON_PREFIX = (commitBody) => [
  ["git", "config", "user.name", "cositeca-bot"],
  ["git", "config", "user.email", "cositeca-bot@users.noreply.github.com"],
  ["git", "checkout", "-b", BRANCH],
  ["git", "add", "-A"],
  ["git", "commit", "-m", "feat: add Fight Club 1080p", "-m", commitBody],
  ["git", "push", "-u", "origin", BRANCH],
  ["gh", "workflow", "run", "validate.yml", "--ref", BRANCH],
  ["gh", "run", "list", "--workflow", "validate.yml", "--branch", BRANCH, "--limit", "1", "--json", "databaseId"],
];

describe("openBotPr", () => {
  test("auto-merge variant commits, pushes, validates, opens the PR, merges and deploys", async () => {
    const r = runners();
    const args = flowArgs(r);
    const result = await openBotPr(args);
    assert.deepEqual(result, { prUrl: PR_URL, prNumber: "42", validated: true });
    assert.deepEqual(r.calls, [
      ...COMMON_PREFIX("Closes #7"),
      ["gh", "pr", "create", "--base", "main", "--head", BRANCH, "--title", "feat: add Fight Club 1080p", "--body", "Closes #7"],
      ["gh", "run", "watch", "99", "--exit-status"],
      ["gh", "pr", "merge", "42", "--squash", "--delete-branch"],
      ["gh", "workflow", "run", "deploy.yml"],
    ]);
    assert.equal(args.progress.pushed, true);
    assert.equal(args.progress.prCreated, true);
  });

  test("manual-merge variant stops after the validation run", async () => {
    const r = runners();
    const result = await openBotPr(flowArgs(r, {
      commitBody: "2 operation(s) applied, ref #7",
      prBody: "Ref #7",
      autoMerge: false,
    }));
    assert.deepEqual(result, { prUrl: PR_URL, prNumber: "42", validated: true });
    assert.deepEqual(r.calls, [
      ...COMMON_PREFIX("2 operation(s) applied, ref #7"),
      ["gh", "pr", "create", "--base", "main", "--head", BRANCH, "--title", "feat: add Fight Club 1080p", "--body", "Ref #7"],
      ["gh", "run", "watch", "99", "--exit-status"],
    ]);
  });

  test("a failed validation run never merges and reports validated false", async () => {
    const r = runners({ watchFails: true });
    const args = flowArgs(r);
    const result = await openBotPr(args);
    assert.deepEqual(result, { prUrl: PR_URL, prNumber: "42", validated: false });
    assert.deepEqual(r.calls.at(-1), ["gh", "run", "watch", "99", "--exit-status"]);
    assert.equal(r.calls.some((c) => c[1] === "pr" && c[2] === "merge"), false);
    assert.equal(args.progress.prCreated, true);
  });

  test("a push failure leaves pushed and prCreated false", async () => {
    const r = runners();
    const git = (args) => {
      if (args[0] === "push") throw new Error("push rejected");
      return r.git(args);
    };
    const args = flowArgs(r, { git });
    await assert.rejects(openBotPr(args), /push rejected/);
    assert.equal(args.progress.pushed, false);
    assert.equal(args.progress.prCreated, false);
  });

  test("a validation run that never starts fails after pushing but before the PR", async () => {
    const r = runners({ runLists: [] });
    const args = flowArgs(r);
    await assert.rejects(openBotPr(args), /validate.yml did not start on bot\/entry-7/);
    assert.equal(args.progress.pushed, true);
    assert.equal(args.progress.prCreated, false);
    assert.equal(r.calls.some((c) => c[1] === "pr"), false);
  });
});

describe("findRunId", () => {
  test("polls until the run shows up, waiting 1.5 s before each poll", async () => {
    const r = runners({ runLists: ["[]", "[]", '[{"databaseId":5}]'] });
    const waits = [];
    const id = await findRunId(r.gh, "validate.yml", BRANCH, { wait: async (ms) => waits.push(ms) });
    assert.equal(id, 5);
    assert.deepEqual(waits, [1500, 1500, 1500]);
  });

  test("gives up after 20 polls", async () => {
    const r = runners({ runLists: [] });
    await assert.rejects(findRunId(r.gh, "validate.yml", BRANCH, { wait: noWait }), /did not start/);
    assert.equal(r.calls.length, 20);
  });
});

describe("closeIssueIfOpen", () => {
  test("closes an open issue", () => {
    const r = runners();
    closeIssueIfOpen(r.gh, "7");
    assert.deepEqual(r.calls, [
      ["gh", "issue", "view", "7", "--json", "state", "--jq", ".state"],
      ["gh", "issue", "close", "7"],
    ]);
  });

  test("leaves an already closed issue alone", () => {
    const r = runners({ issueState: "CLOSED" });
    closeIssueIfOpen(r.gh, "7");
    assert.deepEqual(r.calls, [["gh", "issue", "view", "7", "--json", "state", "--jq", ".state"]]);
  });
});

describe("hasPendingChanges", () => {
  test("is false for a clean working tree and true otherwise", () => {
    assert.equal(hasPendingChanges(() => ""), false);
    assert.equal(hasPendingChanges(() => " M movies/671.yaml\n"), true);
  });
});
