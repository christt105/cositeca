import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "js-yaml";
import { loadConfig, saveLanguages } from "../scripts/config.js";

describe("loadConfig", () => {
  let root;

  before(() => {
    root = mkdtempSync(join(tmpdir(), "cositeca-config-"));
    writeFileSync(join(root, "groups.yaml"), '"1234": Grupo\n');
    writeFileSync(join(root, "qualities.yaml"), "- 1080p\n- 720p\n");
    writeFileSync(join(root, "languages.yaml"), "audio:\n  - es\nsubs:\n  - en\n");
  });

  after(() => rmSync(root, { recursive: true, force: true }));

  test("reads the three config files from the given root", () => {
    assert.deepEqual(loadConfig(root), {
      groups: { 1234: "Grupo" },
      qualities: ["1080p", "720p"],
      languages: { audio: ["es"], subs: ["en"] },
    });
  });

  test("saveLanguages writes a file that loadConfig reads back", () => {
    const languages = { audio: ["es", "ja"], subs: ["en"] };
    saveLanguages(root, languages);
    assert.deepEqual(load(readFileSync(join(root, "languages.yaml"), "utf8")), languages);
    assert.deepEqual(loadConfig(root).languages, languages);
  });

  test("throws when a config file is missing", () => {
    const empty = mkdtempSync(join(tmpdir(), "cositeca-config-"));
    try {
      assert.throws(() => loadConfig(empty), { code: "ENOENT" });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
