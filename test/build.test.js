import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTitleEntries } from "../scripts/build.js";
import { config, fakeTmdb, link, yaml, MOVIE_INFO } from "./fixtures.js";

describe("loadTitleEntries", () => {
  let root;
  let cwd;

  before(() => {
    root = mkdtempSync(join(tmpdir(), "cositeca-build-"));
    mkdirSync(join(root, "movies"));
    writeFileSync(
      join(root, "movies", "550.yaml"),
      yaml({ title: "El club de la lucha", links: [{ quality: "1080p", link: link(1) }] })
    );
    writeFileSync(join(root, "movies", "680.yaml"), "title: [unclosed\nlinks: {");
    cwd = process.cwd();
    process.chdir(root);
  });

  after(() => {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  });

  test("skips a corrupt YAML with a warning and keeps building the rest", async () => {
    const warn = mock.method(console, "warn", () => {});
    try {
      const { groups, qualities } = config();
      const tmdb = fakeTmdb({ movies: { 550: MOVIE_INFO } });
      const entries = await loadTitleEntries(
        { tmdb, groups, qualities },
        { addedTimestamps: new Map(), now: 1000 }
      );

      assert.deepEqual(entries.map((e) => e.entry.tmdb), [550]);
      assert.equal(entries[0].addedAt, 1000);
      const messages = warn.mock.calls.map((call) => call.arguments[0]);
      assert.equal(messages.length, 1);
      assert.match(messages[0], /^skipping movies\/680\.yaml: /);
    } finally {
      warn.mock.restore();
    }
  });
});
