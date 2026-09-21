import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "js-yaml";
import {
  MAX_OPERATIONS,
  extractOperationsJson,
  parseOperations,
  applyBatch,
  makeOverlayFs,
} from "../scripts/apply-batch.js";
import { config, fakeTmdb, link, yaml, MOVIE_INFO, TV_INFO } from "./fixtures.js";

const MOVIE_URL = "https://www.themoviedb.org/movie/550";
const TV_URL = "https://www.themoviedb.org/tv/1396";
const OTHER_MOVIE_URL = "https://www.themoviedb.org/movie/680";

describe("extractOperationsJson", () => {
  const heading = "### Operaciones (JSON)";

  test("reads the JSON that follows the heading", () => {
    const body = `### Otra cosa\n\nvalor\n\n${heading}\n\n[{"type":"add"}]`;
    assert.equal(extractOperationsJson(body), '[{"type":"add"}]');
  });

  test("unwraps a fenced code block, with or without a language", () => {
    assert.equal(
      extractOperationsJson(`${heading}\n\n\`\`\`json\n[{"type":"add"}]\n\`\`\``),
      '[{"type":"add"}]'
    );
    assert.equal(
      extractOperationsJson(`${heading}\n\n\`\`\`\n[{"type":"add"}]\n\`\`\``),
      '[{"type":"add"}]'
    );
  });

  test("normalises CRLF bodies", () => {
    const body = `${heading}\r\n\r\n[{"type":"add"}]`;
    assert.equal(extractOperationsJson(body), '[{"type":"add"}]');
  });

  test("normalises stray carriage returns", () => {
    const body = `${heading}\r\r[{"type":"add"}]`;
    assert.equal(extractOperationsJson(body), '[{"type":"add"}]');
  });

  test("returns an empty string when the heading is missing, empty or _No response_", () => {
    assert.equal(extractOperationsJson("### Calidad\n\n1080p"), "");
    assert.equal(extractOperationsJson(""), "");
    assert.equal(extractOperationsJson(undefined), "");
    assert.equal(extractOperationsJson(`${heading}\n\n_No response_`), "");
  });

  test("keeps everything after the heading, including later headings", () => {
    const body = `${heading}\n\n[{"type":"add"}]\n\n### Otra cosa\n\nvalor`;
    assert.match(extractOperationsJson(body), /^\[\{"type":"add"\}\]/);
  });
});

describe("parseOperations", () => {
  test("parses a non-empty array", () => {
    assert.deepEqual(parseOperations('[{"type":"add"}]'), [{ type: "add" }]);
  });

  test("rejects invalid JSON", () => {
    assert.throws(() => parseOperations("{not json"), /el JSON de operaciones no es válido/);
  });

  test("rejects anything that is not a non-empty array", () => {
    assert.throws(() => parseOperations("[]"), /array no vacío/);
    assert.throws(() => parseOperations('{"type":"add"}'), /array no vacío/);
  });

  test(`rejects more than ${MAX_OPERATIONS} operations`, () => {
    const many = JSON.stringify(Array.from({ length: MAX_OPERATIONS + 1 }, () => ({ type: "add" })));
    assert.throws(() => parseOperations(many), /demasiadas operaciones/);
    const exact = JSON.stringify(Array.from({ length: MAX_OPERATIONS }, () => ({ type: "add" })));
    assert.doesNotThrow(() => parseOperations(exact));
  });
});

describe("applyBatch", () => {
  let root;
  let cwd;
  let cfg;
  let fs;
  let tmdbClient;

  before(() => {
    cwd = process.cwd();
    root = mkdtempSync(join(tmpdir(), "cositeca-batch-"));
    process.chdir(root);
  });

  after(() => {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    rmSync(join(root, "movies"), { recursive: true, force: true });
    rmSync(join(root, "series"), { recursive: true, force: true });
    mkdirSync(join(root, "movies"), { recursive: true });
    mkdirSync(join(root, "series"), { recursive: true });
    writeFileSync(
      join(root, "movies/550.yaml"),
      yaml({ title: "El club de la lucha", links: [{ quality: "1080p", link: link(1) }] })
    );
    writeFileSync(
      join(root, "series/1396.yaml"),
      yaml({ title: "Breaking Bad", links: [{ season: 1, quality: "1080p", link: link(2) }] })
    );
    cfg = config();
    fs = makeOverlayFs();
    tmdbClient = fakeTmdb({
      movies: { 550: MOVIE_INFO, 680: { id: 680, title: "Pulp Fiction" } },
      tv: { 1396: TV_INFO },
    });
  });

  const ctx = () => ({ ...cfg, tmdbClient, fs });

  test("applies every valid operation and reports one line each", async () => {
    const result = await applyBatch(
      [
        { type: "add", tmdb: MOVIE_URL, quality: "4K", link: link(10) },
        { type: "poster", tmdb: TV_URL, poster: "https://image.tmdb.org/t/p/w342/x.jpg" },
      ],
      ctx()
    );
    assert.equal(result.applied.length, 2);
    assert.deepEqual(result.skipped, []);
    assert.match(result.applied[0], /^operación 1: Añadido: El club de la lucha \(4K\)\./);
    assert.match(result.applied[1], /^operación 2: Portada actualizada para Breaking Bad\./);
  });

  test("writes nothing to disk until flush", async () => {
    await applyBatch([{ type: "add", tmdb: OTHER_MOVIE_URL, quality: "4K", link: link(11) }], ctx());
    assert.equal(existsSync(join(root, "movies/680.yaml")), false);
    fs.flush();
    assert.equal(
      load(readFileSync(join(root, "movies/680.yaml"), "utf8")).links[0].link,
      link(11)
    );
  });

  test("flush deletes the files an operation removed", async () => {
    const result = await applyBatch([{ type: "fix", old_link: link(1) }], ctx());
    assert.equal(result.applied.length, 1);
    assert.equal(existsSync(join(root, "movies/550.yaml")), true);
    fs.flush();
    assert.equal(existsSync(join(root, "movies/550.yaml")), false);
  });

  test("a later operation sees the file an earlier one created", async () => {
    const result = await applyBatch(
      [
        { type: "add", tmdb: OTHER_MOVIE_URL, quality: "1080p", link: link(12) },
        { type: "add", tmdb: OTHER_MOVIE_URL, quality: "4K", link: link(13) },
      ],
      ctx()
    );
    assert.equal(result.applied.length, 2);
    fs.flush();
    const data = load(readFileSync(join(root, "movies/680.yaml"), "utf8"));
    assert.deepEqual(data.links.map((l) => l.link), [link(12), link(13)]);
  });

  test("a fix finds a link added earlier in the same batch", async () => {
    const result = await applyBatch(
      [
        { type: "add", tmdb: OTHER_MOVIE_URL, quality: "1080p", link: link(14) },
        { type: "fix", old_link: link(14), new_link: link(15), quality: "4K" },
      ],
      ctx()
    );
    assert.deepEqual(result.skipped, []);
    fs.flush();
    const data = load(readFileSync(join(root, "movies/680.yaml"), "utf8"));
    assert.deepEqual(data.links, [{ quality: "4K", link: link(15) }]);
  });

  test("an operation on a file deleted earlier in the batch is skipped", async () => {
    const result = await applyBatch(
      [
        { type: "fix", old_link: link(1) },
        { type: "poster", tmdb: MOVIE_URL, poster: "https://image.tmdb.org/t/p/w342/x.jpg" },
      ],
      ctx()
    );
    assert.equal(result.applied.length, 1);
    assert.deepEqual(result.skipped, [
      "operación 2: title not found in the catalog: movies/550.yaml",
    ]);
  });

  test("keeps the existing links up to date across operations", async () => {
    const result = await applyBatch(
      [
        { type: "add", tmdb: MOVIE_URL, quality: "4K", link: link(16) },
        { type: "add", tmdb: MOVIE_URL, quality: "1080p", link: link(16) },
      ],
      ctx()
    );
    assert.equal(result.applied.length, 1);
    assert.deepEqual(result.skipped, [
      `operación 2: link already exists in the catalog: ${link(16)}`,
    ]);
  });

  test("a deleted link can be added again later in the same batch", async () => {
    const result = await applyBatch(
      [
        { type: "fix", old_link: link(2) },
        { type: "add", tmdb: TV_URL, quality: "4K", season: 1, link: link(2) },
      ],
      ctx()
    );
    assert.equal(result.applied.length, 2);
    assert.deepEqual(result.skipped, []);
  });

  test("skips malformed operations without touching the valid ones", async () => {
    const result = await applyBatch(
      [
        null,
        { type: "rename", tmdb: MOVIE_URL },
        { type: "add", tmdb: MOVIE_URL, quality: "4K" },
        { type: "add", tmdb: MOVIE_URL, quality: "4K", link: link(17) },
      ],
      ctx()
    );
    assert.equal(result.applied.length, 1);
    assert.deepEqual(result.skipped, [
      "operación 1: operación inválida, se omite",
      'operación 2: tipo de operación desconocido, se omite: "rename"',
      'operación 3: falta el campo "link" en una operación de tipo add, se omite',
    ]);
  });

  test("reports the validation error of an operation that cannot be applied", async () => {
    const result = await applyBatch(
      [{ type: "add", tmdb: MOVIE_URL, quality: "720p", link: link(18) }],
      ctx()
    );
    assert.deepEqual(result.applied, []);
    assert.deepEqual(result.skipped, [
      "operación 1: quality \"720p\" is not one of: 1080p, 4K",
    ]);
  });

  test("skips an operation with a non-string field instead of aborting the batch", async () => {
    const result = await applyBatch(
      [
        { type: "poster", tmdb: MOVIE_URL, poster: 42 },
        { type: "add", tmdb: MOVIE_URL, quality: "4K", audio: ["Castellano"], link: link(22) },
        { type: "add", tmdb: MOVIE_URL, quality: "4K", link: link(23) },
      ],
      ctx()
    );
    assert.equal(result.applied.length, 1);
    assert.match(result.applied[0], /^operación 3: /);
    assert.deepEqual(result.skipped, [
      "operación 1: poster must be a string, got number",
      "operación 2: audio must be a string, got array",
    ]);
  });

  test("rolls back a new language when the operation is rejected afterwards", async () => {
    const result = await applyBatch(
      [
        {
          type: "add",
          tmdb: MOVIE_URL,
          quality: "1080p",
          new_audio_language: "Alemán",
          link: "https://t.me/c/999/1",
        },
      ],
      ctx()
    );
    assert.equal(result.applied.length, 0);
    assert.equal(result.languagesChanged, false);
    assert.deepEqual(cfg.languages.audio, config().languages.audio);
  });

  test("reports a new language that was actually applied", async () => {
    const result = await applyBatch(
      [{ type: "add", tmdb: MOVIE_URL, quality: "1080p", new_subs_language: "Alemán", link: link(19) }],
      ctx()
    );
    assert.equal(result.languagesChanged, true);
    assert.ok(cfg.languages.subs.includes("Alemán"));
  });

  test("lets a non-validation error abort the whole batch", async () => {
    await assert.rejects(
      () =>
        applyBatch(
          [
            { type: "add", tmdb: MOVIE_URL, quality: "4K", link: link(20) },
            { type: "add", tmdb: "https://www.themoviedb.org/movie/999", quality: "4K", link: link(21) },
          ],
          ctx()
        ),
      /TMDB \/movie\/999 failed/
    );
  });

  test("moves links between titles with a reidentify operation", async () => {
    const result = await applyBatch(
      [{ type: "reidentify", tmdb: MOVIE_URL, new_tmdb: OTHER_MOVIE_URL }],
      ctx()
    );
    assert.equal(result.applied.length, 1);
    fs.flush();
    assert.equal(existsSync(join(root, "movies/550.yaml")), false);
    assert.deepEqual(
      load(readFileSync(join(root, "movies/680.yaml"), "utf8")).links.map((l) => l.link),
      [link(1)]
    );
  });
});

describe("makeOverlayFs", () => {
  let root;
  let cwd;

  before(() => {
    cwd = process.cwd();
    root = mkdtempSync(join(tmpdir(), "cositeca-overlay-"));
    process.chdir(root);
    mkdirSync(join(root, "movies"));
    writeFileSync(join(root, "movies/550.yaml"), "on disk\n");
  });

  after(() => {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  });

  test("falls back to disk for paths it does not hold", () => {
    const fs = makeOverlayFs();
    assert.equal(fs.fileExists("movies/550.yaml"), true);
    assert.equal(fs.fileExists("movies/1.yaml"), false);
    assert.equal(fs.readFile("movies/550.yaml"), "on disk\n");
    assert.deepEqual(fs.readdir("movies"), ["550.yaml"]);
    assert.deepEqual(fs.readdir("series"), []);
  });

  test("serves written files from memory and lists them in readdir", () => {
    const fs = makeOverlayFs();
    fs.write("movies/680.yaml", "in memory\n");
    assert.equal(fs.fileExists("movies/680.yaml"), true);
    assert.equal(fs.readFile("movies/680.yaml"), "in memory\n");
    assert.deepEqual(fs.readdir("movies").sort(), ["550.yaml", "680.yaml"]);
  });

  test("hides removed files from fileExists and readdir, and fails on read", () => {
    const fs = makeOverlayFs();
    fs.remove("movies/550.yaml");
    assert.equal(fs.fileExists("movies/550.yaml"), false);
    assert.deepEqual(fs.readdir("movies"), []);
    assert.throws(() => fs.readFile("movies/550.yaml"), /deleted earlier in this batch/);
  });

  test("flush writes and deletes on disk", () => {
    const fs = makeOverlayFs();
    fs.write("movies/680.yaml", "written\n");
    fs.remove("movies/550.yaml");
    fs.flush();
    assert.equal(readFileSync(join(root, "movies/680.yaml"), "utf8"), "written\n");
    assert.equal(existsSync(join(root, "movies/550.yaml")), false);
  });
});
