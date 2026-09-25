import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { findStrandedIssues, issueEnv, sweep } from "../scripts/sweep.js";

const issue = (number, labels, commenters = [], author = "someone") => ({
  number,
  author: { login: author },
  labels: labels.map((name) => ({ name })),
  body: `body of #${number}`,
  comments: commenters.map((login) => ({ author: { login } })),
});

function runners(byLabel, { failScriptFor = [] } = {}) {
  const calls = [];
  const gh = (args) => {
    calls.push(["gh", ...args]);
    const label = args[args.indexOf("--label") + 1];
    return JSON.stringify(byLabel[label] ?? []);
  };
  const git = (args) => {
    calls.push(["git", ...args]);
    return "";
  };
  const runScript = (script, env) => {
    calls.push(["node", script, env.ISSUE_NUMBER]);
    if (failScriptFor.includes(env.ISSUE_NUMBER)) throw new Error("exit 1");
  };
  return { calls, gh, git, runScript };
}

async function quietly(fn) {
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.error = error;
  }
}

describe("findStrandedIssues", () => {
  test("lists open request issues of both kinds that the bot never answered, oldest first", () => {
    const r = runners({
      entry: [issue(12, ["entry", "add"]), issue(9, ["entry", "fix"], ["christt105"])],
      "entry-batch": [issue(10, ["entry-batch"])],
    });
    const stranded = findStrandedIssues(r.gh);
    assert.deepEqual(stranded.map((i) => [i.number, i.script]), [
      ["9", "scripts/add-entry.js"],
      ["10", "scripts/apply-batch.js"],
      ["12", "scripts/add-entry.js"],
    ]);
    assert.deepEqual(stranded[0], {
      number: "9", author: "someone", labels: ["entry", "fix"], body: "body of #9", script: "scripts/add-entry.js",
    });
    assert.deepEqual(r.calls.map((c) => c[c.indexOf("--label") + 1]), ["entry", "entry-batch"]);
    assert.ok(r.calls.every((c) => c.includes("open")));
  });

  test("leaves out issues the bot already commented on, including anti-spam and invalid replies", () => {
    const r = runners({
      entry: [
        issue(1, ["entry", "add"], ["github-actions"]),
        issue(2, ["entry", "add", "invalid"], ["github-actions"]),
        issue(3, ["entry", "add"], ["github-actions[bot]"]),
      ],
    });
    assert.deepEqual(findStrandedIssues(r.gh), []);
  });

  test("leaves out issues on hold even without a bot comment", () => {
    const r = runners({
      entry: [issue(1, ["entry", "add", "bug"])],
      "entry-batch": [issue(2, ["entry-batch", "validation-failed"])],
    });
    assert.deepEqual(findStrandedIssues(r.gh), []);
  });

  test("lists an issue carrying both labels once", () => {
    const both = issue(4, ["entry", "entry-batch"]);
    const r = runners({ entry: [both], "entry-batch": [both] });
    assert.deepEqual(findStrandedIssues(r.gh).map((i) => i.number), ["4"]);
  });
});

describe("issueEnv", () => {
  test("mirrors the variables the issue workflows pass and keeps the rest", () => {
    const env = issueEnv(
      { number: "9", author: "someone", labels: ["entry", "fix"], body: "b" },
      { GH_TOKEN: "t", TMDB_API_KEY: "k" }
    );
    assert.deepEqual(env, {
      GH_TOKEN: "t", TMDB_API_KEY: "k",
      ISSUE_NUMBER: "9", ISSUE_AUTHOR: "someone", ISSUE_LABELS: "entry,fix", ISSUE_BODY: "b",
    });
  });
});

describe("sweep", () => {
  const RESET = [
    ["git", "fetch", "origin", "main"],
    ["git", "checkout", "--force", "--detach", "FETCH_HEAD"],
    ["git", "clean", "-fd"],
  ];

  test("runs each stranded issue from a clean checkout of the latest main", async () => {
    const r = runners({ entry: [issue(5, ["entry", "add"])], "entry-batch": [issue(6, ["entry-batch"])] });
    const result = await quietly(() => sweep({ gh: r.gh, git: r.git, runScript: r.runScript, env: {} }));
    assert.deepEqual(result, { processed: ["5", "6"], failed: [] });
    assert.deepEqual(r.calls.slice(2), [
      ...RESET, ["node", "scripts/add-entry.js", "5"],
      ...RESET, ["node", "scripts/apply-batch.js", "6"],
    ]);
  });

  test("keeps going after a failing issue and reports it", async () => {
    const r = runners({ entry: [issue(5, ["entry", "add"]), issue(7, ["entry", "add"])] }, { failScriptFor: ["5"] });
    const result = await quietly(() => sweep({ gh: r.gh, git: r.git, runScript: r.runScript, env: {} }));
    assert.deepEqual(result, { processed: ["5", "7"], failed: ["5"] });
    assert.deepEqual(r.calls.at(-1), ["node", "scripts/add-entry.js", "7"]);
  });

  test("does nothing when no issue is stranded", async () => {
    const r = runners({});
    const result = await quietly(() => sweep({ gh: r.gh, git: r.git, runScript: r.runScript, env: {} }));
    assert.deepEqual(result, { processed: [], failed: [] });
    assert.equal(r.calls.some(([tool]) => tool !== "gh"), false);
  });
});
