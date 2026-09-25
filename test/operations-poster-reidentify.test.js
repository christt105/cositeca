import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { load } from "js-yaml";
import { ValidationError } from "../scripts/lib.js";
import { processPoster, processReidentify } from "../scripts/add-entry.js";
import { config, fakeFs, fakeTmdb, link, yaml, MOVIE_INFO, TV_INFO } from "./fixtures.js";

const MOVIE_URL = "https://www.themoviedb.org/movie/550";
const TV_URL = "https://www.themoviedb.org/tv/1396";
const OTHER_MOVIE_URL = "https://www.themoviedb.org/movie/680";
const OTHER_TV_URL = "https://www.themoviedb.org/tv/1399";

function deps(files = {}) {
  const fs = fakeFs(files);
  const cfg = config();
  return {
    fs,
    cfg,
    ctx: {
      ...cfg,
      tmdbClient: fakeTmdb({
        movies: { 550: MOVIE_INFO, 680: { id: 680, title: "Pulp Fiction" } },
        tv: { 1396: TV_INFO, 1399: { id: 1399, name: "Juego de Tronos" } },
      }),
      fileExists: fs.fileExists,
      readFile: fs.readFile,
    },
  };
}

describe("processPoster", () => {
  test("sets a manual poster on an existing title", async () => {
    const { ctx } = deps({
      "movies/550.yaml": yaml({ title: "El club de la lucha", links: [{ quality: "1080p", link: link(1) }] }),
    });
    const result = await processPoster(
      { tmdb: MOVIE_URL, poster: " https://image.tmdb.org/t/p/w342/x.jpg " },
      ctx
    );
    assert.equal(result.filePath, "movies/550.yaml");
    assert.equal(result.action, "write");
    assert.equal(result.title, "El club de la lucha");
    assert.deepEqual(Object.keys(load(result.content)), ["title", "poster", "links"]);
    assert.equal(load(result.content).poster, "https://image.tmdb.org/t/p/w342/x.jpg");
  });

  test("an empty poster clears the manual one", async () => {
    const { ctx } = deps({
      "movies/550.yaml": yaml({
        title: "El club de la lucha",
        poster: "https://image.tmdb.org/t/p/w342/old.jpg",
        links: [{ quality: "1080p", link: link(1) }],
      }),
    });
    const result = await processPoster({ tmdb: MOVIE_URL, poster: "" }, ctx);
    assert.equal(load(result.content).poster, undefined);
  });

  test("rejects a title that is not in the catalog", async () => {
    const { ctx } = deps();
    await assert.rejects(() => processPoster({ tmdb: MOVIE_URL, poster: "https://a" }, ctx), {
      message: "title not found in the catalog: movies/550.yaml",
    });
  });

  test("rejects an invalid tmdb input", async () => {
    const { ctx } = deps();
    await assert.rejects(() => processPoster({ tmdb: "", poster: "https://a" }, ctx), ValidationError);
  });

  test("keeps seasonPosters when the poster changes or is cleared", async () => {
    const { ctx } = deps({
      "series/1396.yaml": yaml({
        title: "Breaking Bad",
        seasonPosters: { 1: "https://image.tmdb.org/t/p/w342/s1.jpg" },
        links: [{ season: 1, quality: "1080p", link: link(1) }],
      }),
    });
    const seasonPosters = { 1: "https://image.tmdb.org/t/p/w342/s1.jpg" };
    const changed = await processPoster({ tmdb: TV_URL, poster: "https://image.tmdb.org/t/p/w342/new.jpg" }, ctx);
    assert.deepEqual(load(changed.content).seasonPosters, seasonPosters);
    assert.equal(load(changed.content).poster, "https://image.tmdb.org/t/p/w342/new.jpg");
    const cleared = await processPoster({ tmdb: TV_URL, poster: "" }, ctx);
    assert.deepEqual(load(cleared.content).seasonPosters, seasonPosters);
    assert.equal(load(cleared.content).poster, undefined);
  });
});

describe("processReidentify", () => {
  const sourceMovie = {
    "movies/550.yaml": yaml({
      title: "El club de la lucha",
      poster: "https://image.tmdb.org/t/p/w342/old.jpg",
      links: [
        { quality: "1080p", link: link(1) },
        { quality: "4K", link: link(2) },
      ],
    }),
  };

  test("moves every link to a new movie file and deletes the empty source", async () => {
    const { ctx } = deps(sourceMovie);
    const result = await processReidentify({ tmdb: MOVIE_URL, new_tmdb: OTHER_MOVIE_URL }, ctx);
    assert.equal(result.count, 2);
    assert.equal(result.title, "El club de la lucha");
    assert.equal(result.targetTitle, "Pulp Fiction");
    assert.equal(result.languagesChanged, false);
    assert.deepEqual(result.files.map((f) => f.filePath), ["movies/680.yaml", "movies/550.yaml"]);
    assert.equal(result.files[1].content, null);
    assert.deepEqual(load(result.files[0].content), {
      title: "Pulp Fiction",
      links: [
        { quality: "1080p", link: link(1) },
        { quality: "4K", link: link(2) },
      ],
    });
  });

  test("does not carry the poster of the old title over", async () => {
    const { ctx } = deps(sourceMovie);
    const result = await processReidentify({ tmdb: MOVIE_URL, new_tmdb: OTHER_MOVIE_URL }, ctx);
    assert.equal(load(result.files[0].content).poster, undefined);
  });

  test("sets the poster given in the issue on the target", async () => {
    const { ctx } = deps(sourceMovie);
    const result = await processReidentify(
      { tmdb: MOVIE_URL, new_tmdb: OTHER_MOVIE_URL, poster: "https://image.tmdb.org/t/p/w342/new.jpg" },
      ctx
    );
    assert.equal(load(result.files[0].content).poster, "https://image.tmdb.org/t/p/w342/new.jpg");
  });

  test("moves a single link and leaves the rest in place", async () => {
    const { ctx } = deps(sourceMovie);
    const result = await processReidentify(
      { tmdb: MOVIE_URL, new_tmdb: OTHER_MOVIE_URL, old_link: link(1) },
      ctx
    );
    assert.equal(result.count, 1);
    assert.deepEqual(load(result.files[0].content).links.map((l) => l.link), [link(1)]);
    const source = load(result.files[1].content);
    assert.deepEqual(source.links.map((l) => l.link), [link(2)]);
    assert.equal(source.poster, "https://image.tmdb.org/t/p/w342/old.jpg");
  });

  test("appends to an existing target file and keeps its title and poster", async () => {
    const { ctx } = deps({
      ...sourceMovie,
      "movies/680.yaml": yaml({
        title: "Pulp Fiction (editado)",
        poster: "https://image.tmdb.org/t/p/w342/target.jpg",
        links: [{ quality: "1080p", link: link(3) }],
      }),
    });
    const result = await processReidentify({ tmdb: MOVIE_URL, new_tmdb: OTHER_MOVIE_URL }, ctx);
    const target = load(result.files[0].content);
    assert.equal(target.title, "Pulp Fiction (editado)");
    assert.equal(target.poster, "https://image.tmdb.org/t/p/w342/target.jpg");
    assert.deepEqual(target.links.map((l) => l.link), [link(3), link(1), link(2)]);
  });

  test("applies the given season when moving a movie to a series", async () => {
    const { ctx } = deps(sourceMovie);
    const result = await processReidentify(
      { tmdb: MOVIE_URL, new_tmdb: OTHER_TV_URL, season: "3" },
      ctx
    );
    assert.deepEqual(load(result.files[0].content).links.map((l) => l.season), [3, 3]);
  });

  test("drops the season when moving a series to a movie", async () => {
    const { ctx } = deps({
      "series/1396.yaml": yaml({
        title: "Breaking Bad",
        links: [{ season: 1, quality: "1080p", link: link(4) }],
      }),
    });
    const result = await processReidentify({ tmdb: TV_URL, new_tmdb: MOVIE_URL }, ctx);
    assert.deepEqual(load(result.files[0].content).links, [{ quality: "1080p", link: link(4) }]);
  });

  test("keeps each season when moving a series to another series", async () => {
    const { ctx } = deps({
      "series/1396.yaml": yaml({
        title: "Breaking Bad",
        links: [
          { season: 1, quality: "1080p", link: link(5) },
          { season: "all", quality: "4K", link: link(6) },
        ],
      }),
    });
    const result = await processReidentify({ tmdb: TV_URL, new_tmdb: OTHER_TV_URL }, ctx);
    assert.deepEqual(load(result.files[0].content).links.map((l) => l.season), [1, "all"]);
  });

  test("keeps the seasonPosters of the seasons that still have links", async () => {
    const { ctx } = deps({
      "series/1396.yaml": yaml({
        title: "Breaking Bad",
        seasonPosters: {
          1: "https://image.tmdb.org/t/p/w342/s1.jpg",
          2: "https://image.tmdb.org/t/p/w342/s2.jpg",
        },
        links: [
          { season: 1, quality: "1080p", link: link(7) },
          { season: 2, quality: "1080p", link: link(8) },
        ],
      }),
    });
    const result = await processReidentify(
      { tmdb: TV_URL, new_tmdb: OTHER_TV_URL, old_link: link(7) },
      ctx
    );
    const source = load(result.files[1].content);
    assert.deepEqual(source.seasonPosters, { 2: "https://image.tmdb.org/t/p/w342/s2.jpg" });
    assert.equal(load(result.files[0].content).seasonPosters, undefined);
  });

  test("drops seasonPosters entirely when no season keeps a link", async () => {
    const { ctx } = deps({
      "series/1396.yaml": yaml({
        title: "Breaking Bad",
        seasonPosters: { 1: "https://image.tmdb.org/t/p/w342/s1.jpg" },
        links: [
          { season: 1, quality: "1080p", link: link(9) },
          { season: 2, quality: "1080p", link: link(10) },
        ],
      }),
    });
    const result = await processReidentify(
      { tmdb: TV_URL, new_tmdb: OTHER_TV_URL, old_link: link(9) },
      ctx
    );
    assert.equal(load(result.files[1].content).seasonPosters, undefined);
  });

  test("rejects a source that is not in the catalog", async () => {
    const { ctx } = deps();
    await assert.rejects(() => processReidentify({ tmdb: MOVIE_URL, new_tmdb: OTHER_MOVIE_URL }, ctx), {
      message: "title not found in the catalog: movies/550.yaml",
    });
  });

  test("rejects moving a title onto itself", async () => {
    const { ctx } = deps(sourceMovie);
    await assert.rejects(() => processReidentify({ tmdb: MOVIE_URL, new_tmdb: MOVIE_URL }, ctx), {
      message: "the new title is the same as the current one",
    });
  });

  test("ignores a season when the target is a movie", async () => {
    const { ctx } = deps(sourceMovie);
    const result = await processReidentify({ tmdb: MOVIE_URL, new_tmdb: OTHER_MOVIE_URL, season: "1" }, ctx);
    assert.ok(load(result.files[0].content).links.every((l) => l.season === undefined));
  });

  test("rejects moving a movie to a series without a season", async () => {
    const { ctx } = deps(sourceMovie);
    await assert.rejects(() => processReidentify({ tmdb: MOVIE_URL, new_tmdb: OTHER_TV_URL }, ctx), {
      message: "season is required when moving a movie to a series",
    });
  });

  test("rejects a link that the source file does not have", async () => {
    const { ctx } = deps(sourceMovie);
    await assert.rejects(
      () => processReidentify({ tmdb: MOVIE_URL, new_tmdb: OTHER_MOVIE_URL, old_link: link(99) }, ctx),
      { message: `link not found in movies/550.yaml: ${link(99)}` }
    );
  });

  test("rejects an empty string poster", async () => {
    const { ctx } = deps(sourceMovie);
    const result = await processReidentify(
      { tmdb: MOVIE_URL, new_tmdb: OTHER_MOVIE_URL, poster: "   " },
      ctx
    );
    assert.equal(load(result.files[0].content).poster, undefined);
  });

  test("rejects a non-string poster with a ValidationError naming the field", async () => {
    const { ctx } = deps(sourceMovie);
    await assert.rejects(
      () => processReidentify({ tmdb: MOVIE_URL, new_tmdb: OTHER_MOVIE_URL, poster: 42 }, ctx),
      (err) => err instanceof ValidationError && err.message === "poster must be a string, got number"
    );
  });
});
