import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { load } from "js-yaml";
import { ValidationError } from "../scripts/lib.js";
import { processAdd } from "../scripts/add-entry.js";
import { config, fakeFs, fakeTmdb, link, yaml, MOVIE_INFO, TV_INFO } from "./fixtures.js";

function deps({ files = {}, existing = [] } = {}) {
  const fs = fakeFs(files);
  const cfg = config();
  return {
    fs,
    cfg,
    ctx: {
      ...cfg,
      tmdbClient: fakeTmdb({ movies: { 550: MOVIE_INFO }, tv: { 1396: TV_INFO } }),
      existingLinks: new Set(existing),
      fileExists: fs.fileExists,
      readFile: fs.readFile,
    },
  };
}

const MOVIE_URL = "https://www.themoviedb.org/movie/550";
const TV_URL = "https://www.themoviedb.org/tv/1396";

describe("processAdd", () => {
  test("creates a new movie file", async () => {
    const { ctx } = deps();
    const result = await processAdd(
      { tmdb: MOVIE_URL, quality: "1080p", audio: "Castellano", link: link(1) },
      ctx
    );
    assert.equal(result.filePath, "movies/550.yaml");
    assert.equal(result.action, "write");
    assert.equal(result.title, "El club de la lucha");
    assert.equal(result.quality, "1080p");
    assert.equal(result.languagesChanged, false);
    assert.deepEqual(load(result.content), {
      title: "El club de la lucha",
      links: [{ quality: "1080p", audio: ["Castellano"], link: link(1) }],
    });
  });

  test("creates a new series file and keeps the season", async () => {
    const { ctx } = deps();
    const result = await processAdd(
      { tmdb: TV_URL, quality: "4K", season: "2", link: link(2) },
      ctx
    );
    assert.equal(result.filePath, "series/1396.yaml");
    assert.deepEqual(load(result.content).links, [
      { season: 2, quality: "4K", link: link(2) },
    ]);
  });

  test("accepts season \"all\" and season 0", async () => {
    const { ctx } = deps();
    const all = await processAdd({ tmdb: TV_URL, quality: "4K", season: "all", link: link(3) }, ctx);
    assert.equal(load(all.content).links[0].season, "all");
    const zero = await processAdd({ tmdb: TV_URL, quality: "4K", season: "0", link: link(4) }, ctx);
    assert.equal(load(zero.content).links[0].season, 0);
  });

  test("appends a link to an existing file and keeps its poster", async () => {
    const { ctx } = deps({
      files: {
        "movies/550.yaml": yaml({
          title: "El club de la lucha",
          poster: "https://image.tmdb.org/t/p/w342/manual.jpg",
          links: [{ quality: "1080p", link: link(1) }],
        }),
      },
    });
    const result = await processAdd({ tmdb: MOVIE_URL, quality: "4K", link: link(2) }, ctx);
    const data = load(result.content);
    assert.equal(data.poster, "https://image.tmdb.org/t/p/w342/manual.jpg");
    assert.deepEqual(data.links.map((l) => l.link), [link(1), link(2)]);
  });

  test("keeps the stored title of an existing file instead of the TMDB one", async () => {
    const { ctx } = deps({
      files: {
        "movies/550.yaml": yaml({ title: "Título editado a mano", links: [{ quality: "1080p", link: link(1) }] }),
      },
    });
    const result = await processAdd({ tmdb: MOVIE_URL, quality: "4K", link: link(2) }, ctx);
    assert.equal(load(result.content).title, "Título editado a mano");
    assert.equal(result.title, "El club de la lucha");
  });

  test("orders the entry keys as season, quality, audio, subs, tags, link", async () => {
    const { ctx } = deps();
    const result = await processAdd(
      {
        tmdb: TV_URL,
        quality: "1080p",
        season: "1",
        audio: "Castellano",
        subs: "Inglés",
        tags: "Extendida",
        link: link(5),
      },
      ctx
    );
    assert.deepEqual(Object.keys(load(result.content).links[0]), [
      "season", "quality", "audio", "subs", "tags", "link",
    ]);
  });

  test("splits comma separated lists and drops empty members", async () => {
    const { ctx } = deps();
    const result = await processAdd(
      { tmdb: MOVIE_URL, quality: "1080p", audio: "Castellano, , Inglés", subs: " ", link: link(6) },
      ctx
    );
    const entry = load(result.content).links[0];
    assert.deepEqual(entry.audio, ["Castellano", "Inglés"]);
    assert.equal(entry.subs, undefined);
  });

  test("adds a new language to the list and reports the change", async () => {
    const { ctx, cfg } = deps();
    const result = await processAdd(
      { tmdb: MOVIE_URL, quality: "1080p", new_audio_language: "Alemán", link: link(7) },
      ctx
    );
    assert.equal(result.languagesChanged, true);
    assert.deepEqual(load(result.content).links[0].audio, ["Alemán"]);
    assert.ok(cfg.languages.audio.includes("Alemán"));
  });

  test("reuses an existing language regardless of case and reports no change", async () => {
    const { ctx, cfg } = deps();
    const result = await processAdd(
      { tmdb: MOVIE_URL, quality: "1080p", audio: "Inglés", new_subs_language: "castellano", link: link(8) },
      ctx
    );
    assert.equal(result.languagesChanged, false);
    assert.deepEqual(load(result.content).links[0].subs, ["Castellano"]);
    assert.deepEqual(cfg.languages.subs, config().languages.subs);
  });

  test("reuses the canonical spelling of an existing language regardless of accents", async () => {
    const { ctx, cfg } = deps();
    const result = await processAdd(
      { tmdb: MOVIE_URL, quality: "1080p", new_audio_language: "INGLES", new_subs_language: "ingles", link: link(12) },
      ctx
    );
    assert.equal(result.languagesChanged, false);
    assert.deepEqual(load(result.content).links[0].audio, ["Inglés"]);
    assert.deepEqual(load(result.content).links[0].subs, ["Inglés"]);
    assert.deepEqual(cfg.languages, config().languages);
  });

  test("reuses the spelling a new language already has in the other list", async () => {
    const { ctx, cfg } = deps();
    const result = await processAdd(
      { tmdb: MOVIE_URL, quality: "1080p", new_subs_language: "latino", link: link(14) },
      ctx
    );
    assert.equal(result.languagesChanged, true);
    assert.deepEqual(load(result.content).links[0].subs, ["Latino"]);
    assert.deepEqual(cfg.languages.subs, [...config().languages.subs, "Latino"]);
    assert.deepEqual(cfg.languages.audio, config().languages.audio);
  });

  test("rejects two languages typed in the new language field", async () => {
    const { ctx, cfg } = deps();
    await assert.rejects(
      processAdd(
        { tmdb: MOVIE_URL, quality: "1080p", new_subs_language: "Italiano, Portugués", link: link(13) },
        ctx
      ),
      ValidationError
    );
    assert.deepEqual(cfg.languages, config().languages);
  });

  test("does not duplicate a language already picked in the checkboxes", async () => {
    const { ctx } = deps();
    const result = await processAdd(
      { tmdb: MOVIE_URL, quality: "1080p", audio: "Castellano", new_audio_language: "Castellano", link: link(9) },
      ctx
    );
    assert.deepEqual(load(result.content).links[0].audio, ["Castellano"]);
  });

  test("sets a manual poster", async () => {
    const { ctx } = deps();
    const result = await processAdd(
      { tmdb: MOVIE_URL, quality: "1080p", poster: " https://image.tmdb.org/t/p/w342/x.jpg ", link: link(10) },
      ctx
    );
    assert.deepEqual(Object.keys(load(result.content)), ["title", "poster", "links"]);
    assert.equal(load(result.content).poster, "https://image.tmdb.org/t/p/w342/x.jpg");
  });

  test("rejects a link that is already in the catalog", async () => {
    const { ctx } = deps({ existing: [link(11)] });
    await assert.rejects(
      () => processAdd({ tmdb: MOVIE_URL, quality: "1080p", link: link(11) }, ctx),
      { name: "Error", message: `link already exists in the catalog: ${link(11)}` }
    );
  });

  test("rejects an unknown quality before asking TMDB for the title", async () => {
    const { ctx } = deps();
    await assert.rejects(
      () => processAdd({ tmdb: MOVIE_URL, quality: "720p", link: link(12) }, ctx),
      ValidationError
    );
    assert.deepEqual(ctx.tmdbClient.calls, []);
  });

  test("rejects a series entry without season and a movie entry with one", async () => {
    const { ctx } = deps();
    await assert.rejects(
      () => processAdd({ tmdb: TV_URL, quality: "1080p", link: link(13) }, ctx),
      { message: "season is required for series entries" }
    );
    await assert.rejects(
      () => processAdd({ tmdb: MOVIE_URL, quality: "1080p", season: "1", link: link(14) }, ctx),
      { message: "season is not allowed for movie entries" }
    );
  });

  test("rejects a malformed season", async () => {
    const { ctx } = deps();
    await assert.rejects(
      () => processAdd({ tmdb: TV_URL, quality: "1080p", season: "primera", link: link(15) }, ctx),
      ValidationError
    );
  });

  test("rejects an unknown language and an invalid link", async () => {
    const { ctx } = deps();
    await assert.rejects(
      () => processAdd({ tmdb: MOVIE_URL, quality: "1080p", audio: "Klingon", link: link(16) }, ctx),
      ValidationError
    );
    await assert.rejects(
      () => processAdd({ tmdb: MOVIE_URL, quality: "1080p", link: "https://t.me/publico/1" }, ctx),
      ValidationError
    );
  });

  test("rejects a non-string list field with a ValidationError naming the field", async () => {
    const { ctx } = deps();
    await assert.rejects(
      () => processAdd({ tmdb: MOVIE_URL, quality: "1080p", audio: ["Castellano"], link: link(21) }, ctx),
      (err) => err instanceof ValidationError && err.message === "audio must be a string, got array"
    );
  });

  test("rejects a non-string poster with a ValidationError naming the field", async () => {
    const { ctx } = deps();
    await assert.rejects(
      () => processAdd({ tmdb: MOVIE_URL, quality: "1080p", poster: 42, link: link(22) }, ctx),
      (err) => err instanceof ValidationError && err.message === "poster must be a string, got number"
    );
  });

  test("lets a TMDB failure through as a plain Error", async () => {
    const { ctx } = deps();
    await assert.rejects(
      () => processAdd({ tmdb: "https://www.themoviedb.org/movie/999", quality: "1080p", link: link(17) }, ctx),
      (err) => {
        assert.equal(err instanceof ValidationError, false);
        return true;
      }
    );
  });

  test("known bug B2: tmdb:<id> without season is looked up as a movie", async () => {
    const { ctx } = deps();
    await assert.rejects(
      () => processAdd({ tmdb: "tmdb:1396", quality: "1080p", link: link(18) }, ctx),
      /TMDB \/movie\/1396 failed/
    );
  });

  test("keeps seasonPosters when a new poster is sent", async () => {
    const { ctx } = deps({
      files: {
        "series/1396.yaml": yaml({
          title: "Breaking Bad",
          seasonPosters: { 1: "https://image.tmdb.org/t/p/w342/s1.jpg" },
          links: [{ season: 1, quality: "1080p", link: link(1) }],
        }),
      },
    });
    const result = await processAdd(
      { tmdb: TV_URL, quality: "4K", season: "1", poster: "https://image.tmdb.org/t/p/w342/new.jpg", link: link(19) },
      ctx
    );
    const data = load(result.content);
    assert.deepEqual(Object.keys(data), ["title", "poster", "seasonPosters", "links"]);
    assert.equal(data.poster, "https://image.tmdb.org/t/p/w342/new.jpg");
    assert.deepEqual(data.seasonPosters, { 1: "https://image.tmdb.org/t/p/w342/s1.jpg" });
  });

  test("keeps seasonPosters when no poster is sent", async () => {
    const { ctx } = deps({
      files: {
        "series/1396.yaml": yaml({
          title: "Breaking Bad",
          seasonPosters: { 1: "https://image.tmdb.org/t/p/w342/s1.jpg" },
          links: [{ season: 1, quality: "1080p", link: link(1) }],
        }),
      },
    });
    const result = await processAdd({ tmdb: TV_URL, quality: "4K", season: "1", link: link(20) }, ctx);
    assert.deepEqual(load(result.content).seasonPosters, { 1: "https://image.tmdb.org/t/p/w342/s1.jpg" });
  });
});
