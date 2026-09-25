import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { run as runAddEntry } from "../scripts/add-entry.js";
import { run as runBatch } from "../scripts/apply-batch.js";

function closedIssue() {
  const calls = [];
  const gh = (args) => {
    calls.push(["gh", ...args]);
    return JSON.stringify({ state: "CLOSED", labels: [{ name: "entry" }] });
  };
  const git = (args) => {
    calls.push(["git", ...args]);
    return "";
  };
  return { calls, gh, git };
}

async function quietly(fn) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = originalLog;
  }
}

describe("a run queued behind another one for the same issue", () => {
  for (const [name, run, branch] of [
    ["add-entry", runAddEntry, "bot/entry-7"],
    ["apply-batch", runBatch, "bot/entry-batch-7"],
  ]) {
    test(`${name} exits quietly when the issue is already closed`, async () => {
      const { calls, gh, git } = closedIssue();
      const progress = { branch, pushed: false, prCreated: false, merged: false };
      await quietly(() => run({ issueNumber: "7", issueAuthor: "someone", issueLabel: "add", body: "", gh, git, progress }));
      assert.deepEqual(calls, [["gh", "issue", "view", "7", "--json", "state,labels"]]);
      assert.deepEqual(progress, { branch, pushed: false, prCreated: false, merged: false });
    });
  }
});
