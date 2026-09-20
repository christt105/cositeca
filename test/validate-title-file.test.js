import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ValidationError, validateTitleFile } from "../scripts/lib.js";
import { config, link } from "./fixtures.js";

const base = config();

function movieFile(overrides = {}) {
  return {
    title: "El club de la lucha",
    links: [{ quality: "1080p", audio: ["Castellano"], link: link(1) }],
    ...overrides,
  };
}

function seriesFile(overrides = {}) {
  return {
    title: "Breaking Bad",
    links: [{ season: 1, quality: "1080p", link: link(2) }],
    ...overrides,
  };
}

describe("validateTitleFile: valid files", () => {
  test("accepts a minimal movie file", () => {
    assert.doesNotThrow(() => validateTitleFile("movies", "550.yaml", movieFile(), base));
  });

  test("accepts a movie file with poster, subs and tags", () => {
    const data = movieFile({
      poster: "https://image.tmdb.org/t/p/w342/a.jpg",
      links: [
        {
          quality: "4K",
          audio: ["Castellano", "Inglés"],
          subs: ["Forzados"],
          tags: ["Extendida"],
          link: link(3, 7),
        },
      ],
    });
    assert.doesNotThrow(() => validateTitleFile("movies", "550.yaml", data, base));
  });

  test("accepts a series file with seasonPosters and season \"all\"", () => {
    const data = seriesFile({
      seasonPosters: { all: "https://image.tmdb.org/t/p/w342/b.jpg" },
      links: [
        { season: 1, quality: "1080p", link: link(4) },
        { season: "all", quality: "4K", link: link(5) },
      ],
    });
    assert.doesNotThrow(() => validateTitleFile("series", "1396.yaml", data, base));
  });
});

describe("validateTitleFile: invalid files", () => {
  test("rejects filenames that are not <id>.yaml", () => {
    for (const filename of ["550.yml", "550.yaml.bak", "fight-club.yaml", "550"]) {
      assert.throws(() => validateTitleFile("movies", filename, movieFile(), base), {
        message: `invalid filename: ${filename}`,
      });
    }
  });

  test("rejects unknown types", () => {
    assert.throws(() => validateTitleFile("books", "550.yaml", movieFile(), base), {
      message: "invalid type: books",
    });
  });

  test("rejects content that is not a mapping", () => {
    assert.throws(() => validateTitleFile("movies", "550.yaml", null, base), ValidationError);
    assert.throws(() => validateTitleFile("movies", "550.yaml", "text", base), ValidationError);
  });

  test("rejects missing or empty links", () => {
    assert.throws(
      () => validateTitleFile("movies", "550.yaml", { title: "x" }, base),
      { message: "links must be a non-empty array" }
    );
    assert.throws(
      () => validateTitleFile("movies", "550.yaml", { title: "x", links: [] }, base),
      { message: "links must be a non-empty array" }
    );
  });

  test("rejects an empty poster", () => {
    assert.throws(
      () => validateTitleFile("movies", "550.yaml", movieFile({ poster: "" }), base),
      ValidationError
    );
  });

  test("rejects seasonPosters on a movie", () => {
    assert.throws(
      () => validateTitleFile("movies", "550.yaml", movieFile({ seasonPosters: { 1: "https://a" } }), base),
      ValidationError
    );
  });

  test("rejects a series link without season and a movie link with one", () => {
    assert.throws(
      () =>
        validateTitleFile("series", "1396.yaml", seriesFile({ links: [{ quality: "1080p", link: link(6) }] }), base),
      { message: "season is required for series entries" }
    );
    assert.throws(
      () =>
        validateTitleFile("movies", "550.yaml", movieFile({ links: [{ season: 1, quality: "1080p", link: link(7) }] }), base),
      { message: "season is not allowed for movie entries" }
    );
  });

  test("rejects unknown qualities and languages", () => {
    assert.throws(
      () => validateTitleFile("movies", "550.yaml", movieFile({ links: [{ quality: "720p", link: link(8) }] }), base),
      ValidationError
    );
    assert.throws(
      () =>
        validateTitleFile(
          "movies",
          "550.yaml",
          movieFile({ links: [{ quality: "1080p", subs: ["Klingon"], link: link(9) }] }),
          base
        ),
      ValidationError
    );
  });

  test("rejects invite links and unknown groups", () => {
    assert.throws(
      () =>
        validateTitleFile("movies", "550.yaml", movieFile({ links: [{ quality: "1080p", link: "https://t.me/+secret" }] }), base),
      ValidationError
    );
    assert.throws(
      () =>
        validateTitleFile("movies", "550.yaml", movieFile({ links: [{ quality: "1080p", link: "https://t.me/c/1/2" }] }), base),
      ValidationError
    );
  });

  test("known limitation B9: two entries that differ only in the link are accepted", () => {
    const data = movieFile({
      links: [
        { quality: "1080p", link: link(10) },
        { quality: "1080p", link: link(11) },
      ],
    });
    assert.doesNotThrow(() => validateTitleFile("movies", "550.yaml", data, base));
  });
});
