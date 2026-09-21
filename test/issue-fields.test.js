import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  FIELD_LABELS,
  parseIssueBody,
  checkAntiSpam,
  reportFailure,
  INTERNAL_ERROR_LABEL,
  INTERNAL_ERROR_MESSAGE,
  describeResult,
  resultFiles,
} from "../scripts/add-entry.js";
import { ValidationError } from "../scripts/lib.js";
import { link } from "./fixtures.js";

const ADD_FIELDS = ["tmdb", "quality", "season", "audio", "subs", "tags", "poster", "link"];

const ADD_BODY = [
  "### URL de TMDB o id de IMDB",
  "",
  "https://www.themoviedb.org/movie/550",
  "",
  "### Calidad",
  "",
  "1080p",
  "",
  "### Temporada",
  "",
  "_No response_",
  "",
  "### Audio",
  "",
  "Castellano, Inglés",
  "",
  "### Link de Telegram",
  "",
  link(42),
].join("\n");

describe("parseIssueBody", () => {
  test("reads every labelled section of an LF body", () => {
    const fields = parseIssueBody(ADD_BODY, ADD_FIELDS);
    assert.equal(fields.tmdb, "https://www.themoviedb.org/movie/550");
    assert.equal(fields.quality, "1080p");
    assert.equal(fields.audio, "Castellano, Inglés");
    assert.equal(fields.link, link(42));
  });

  test("turns _No response_ into an empty string", () => {
    assert.equal(parseIssueBody(ADD_BODY, ADD_FIELDS).season, "");
  });

  test("returns an empty string for sections the body does not have", () => {
    const fields = parseIssueBody(ADD_BODY, ADD_FIELDS);
    assert.equal(fields.subs, "");
    assert.equal(fields.tags, "");
    assert.equal(fields.poster, "");
  });

  test("only returns the requested field ids", () => {
    assert.deepEqual(Object.keys(parseIssueBody(ADD_BODY, ["tmdb", "link"])), ["tmdb", "link"]);
  });

  test("ignores sections whose heading is not a known label", () => {
    const body = `### Otra cosa\n\nvalor\n\n### Calidad\n\n4K`;
    const fields = parseIssueBody(body, ADD_FIELDS);
    assert.equal(fields.quality, "4K");
    assert.equal(fields.tmdb, "");
  });

  test("keeps multi-line values and trims them", () => {
    const body = "### Etiquetas\n\n  Extendida,\nSin censura  ";
    assert.equal(parseIssueBody(body, ["tags"]).tags, "Extendida,\nSin censura");
  });

  test("returns empty fields for an empty body", () => {
    assert.deepEqual(parseIssueBody("", ["tmdb", "quality"]), { tmdb: "", quality: "" });
  });

  test("parses a CRLF body exactly like its LF version", () => {
    const crlf = ADD_BODY.replace(/\n/g, "\r\n");
    assert.deepEqual(parseIssueBody(crlf, ADD_FIELDS), parseIssueBody(ADD_BODY, ADD_FIELDS));
  });

  test("reads a single CRLF section and bodies with stray carriage returns", () => {
    assert.equal(parseIssueBody("### Calidad\r\n\r\n1080p", ["quality"]).quality, "1080p");
    const cr = ADD_BODY.replace(/\n/g, "\r");
    assert.deepEqual(parseIssueBody(cr, ADD_FIELDS), parseIssueBody(ADD_BODY, ADD_FIELDS));
  });

  test("every field id used by the workflows has a label", () => {
    const used = [
      "tmdb", "quality", "season", "audio", "subs", "new_audio_language",
      "new_subs_language", "tags", "poster", "link", "old_link", "new_link", "new_tmdb",
    ];
    for (const id of used) {
      assert.equal(typeof FIELD_LABELS[id], "string", `missing label for ${id}`);
    }
  });
});

describe("checkAntiSpam", () => {
  const daysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString();

  test("lets through an old account with few open issues", () => {
    assert.equal(checkAntiSpam(daysAgo(400), 0), null);
    assert.equal(checkAntiSpam(daysAgo(400), 3), null);
  });

  test("blocks accounts younger than 7 days", () => {
    assert.equal(typeof checkAntiSpam(daysAgo(1), 0), "string");
    assert.equal(typeof checkAntiSpam(daysAgo(6.9), 0), "string");
  });

  test("blocks more than 3 open entry issues", () => {
    assert.equal(typeof checkAntiSpam(daysAgo(400), 4), "string");
  });

  test("blocks a missing or unparseable created_at", () => {
    for (const createdAt of [undefined, null, "", "not a date"]) {
      assert.equal(typeof checkAntiSpam(createdAt, 0), "string", String(createdAt));
    }
  });

  test("gives each rejection reason its own message", () => {
    const tooNew = checkAntiSpam(daysAgo(1), 0);
    const tooMany = checkAntiSpam(daysAgo(400), 4);
    const unknown = checkAntiSpam(undefined, 0);
    assert.equal(new Set([tooNew, tooMany, unknown]).size, 3);
    assert.match(tooNew, /nueva/);
    assert.match(tooMany, /abiertas/);
  });
});

describe("describeResult", () => {
  test("describes an add", () => {
    const { subject, close } = describeResult("add", { title: "Alien", quality: "4K" });
    assert.equal(subject, "feat: add Alien 4K");
    assert.match(close, /^Añadido: Alien \(4K\)\./);
  });

  test("tells apart a fix that updates a link from one that deletes it", () => {
    const updated = describeResult("fix", { title: "Alien", quality: "1080p", deleted: false });
    const deleted = describeResult("fix", { title: "Alien", quality: "1080p", deleted: true });
    assert.equal(updated.subject, "fix: update link for Alien");
    assert.equal(deleted.subject, "fix: remove link from Alien");
  });

  test("describes a poster change and a reidentify", () => {
    assert.equal(
      describeResult("poster", { title: "Alien" }).subject,
      "fix: update poster for Alien"
    );
    assert.equal(
      describeResult("reidentify", { title: "Alien", targetTitle: "Aliens", count: 2 }).subject,
      "fix: move 2 link(s) from Alien to Aliens"
    );
  });

  test("returns undefined for an unknown label", () => {
    assert.equal(describeResult("unknown", {}), undefined);
  });
});

describe("resultFiles", () => {
  test("passes through the list of a multi-file result", () => {
    const files = [
      { filePath: "movies/680.yaml", content: "a" },
      { filePath: "movies/550.yaml", content: null },
    ];
    assert.deepEqual(resultFiles({ files }), files);
  });

  test("wraps a single-file write", () => {
    assert.deepEqual(resultFiles({ filePath: "movies/550.yaml", content: "a", action: "write" }), [
      { filePath: "movies/550.yaml", content: "a" },
    ]);
  });

  test("turns a delete into a null content", () => {
    assert.deepEqual(resultFiles({ filePath: "movies/550.yaml", content: null, action: "delete" }), [
      { filePath: "movies/550.yaml", content: null },
    ]);
  });
});

describe("reportFailure", () => {
  function runners({ failOn } = {}) {
    const calls = [];
    const make = (tool) => (args) => {
      calls.push([tool, ...args]);
      if (failOn && failOn(tool, args)) throw new Error(`${tool} failed`);
      return "";
    };
    return { calls, gh: make("gh"), git: make("git") };
  }

  const base = { issueNumber: "7", branch: "bot/entry-7" };

  test("explains a ValidationError, labels it invalid and does not rethrow", () => {
    const { calls, gh, git } = runners();
    reportFailure(new ValidationError("quality is required"), {
      ...base, pushed: false, prCreated: false, gh, git,
    });
    assert.deepEqual(calls, [
      ["gh", "issue", "comment", "7", "--body", "quality is required"],
      ["gh", "issue", "edit", "7", "--add-label", "invalid"],
    ]);
  });

  test("reports an internal error, labels the issue and rethrows it", () => {
    const { calls, gh, git } = runners();
    const err = new Error("TMDB /movie/999 failed: 404 Not Found");
    assert.throws(
      () => reportFailure(err, { ...base, pushed: false, prCreated: false, gh, git }),
      (thrown) => thrown === err
    );
    assert.deepEqual(calls, [
      ["gh", "issue", "comment", "7", "--body", INTERNAL_ERROR_MESSAGE],
      ["gh", "issue", "edit", "7", "--add-label", INTERNAL_ERROR_LABEL],
    ]);
  });

  test("deletes a pushed branch that never got a PR", () => {
    const { calls, gh, git } = runners();
    assert.throws(() =>
      reportFailure(new Error("validate.yml did not start"), {
        ...base, pushed: true, prCreated: false, gh, git,
      })
    );
    assert.deepEqual(calls.at(-1), ["git", "push", "origin", "--delete", "bot/entry-7"]);
  });

  test("keeps the branch once the PR exists", () => {
    const { calls, gh, git } = runners();
    assert.throws(() =>
      reportFailure(new Error("merge failed"), { ...base, pushed: true, prCreated: true, gh, git })
    );
    assert.equal(calls.some(([tool]) => tool === "git"), false);
  });

  test("keeps going when a reporting step fails and still rethrows the original error", () => {
    const { calls, gh, git } = runners({ failOn: (tool) => tool === "gh" });
    const err = new Error("boom");
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      assert.throws(
        () => reportFailure(err, { ...base, pushed: true, prCreated: false, gh, git }),
        (thrown) => thrown === err
      );
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[2], ["git", "push", "origin", "--delete", "bot/entry-7"]);
  });
});
