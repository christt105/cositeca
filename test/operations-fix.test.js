import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { load } from "js-yaml";
import { ValidationError } from "../scripts/lib.js";
import { findFileByLink, processFix } from "../scripts/add-entry.js";
import { config, fakeFs, link, yaml } from "./fixtures.js";

const MOVIE_FILE = {
  title: "El club de la lucha",
  links: [
    { quality: "1080p", audio: ["Castellano"], link: link(1) },
    { quality: "4K", link: link(2) },
  ],
};

const SERIES_FILE = {
  title: "Breaking Bad",
  links: [{ season: 1, quality: "1080p", tags: ["Extendida"], link: link(3) }],
};

function deps({ files, existing = [] } = {}) {
  const fs = fakeFs(
    files ?? {
      "movies/550.yaml": yaml(MOVIE_FILE),
      "series/1396.yaml": yaml(SERIES_FILE),
    }
  );
  const cfg = config();
  return {
    fs,
    cfg,
    ctx: {
      ...cfg,
      existingLinks: new Set(existing),
      readdir: fs.readdir,
      readFile: fs.readFile,
    },
  };
}

describe("findFileByLink", () => {
  test("finds a link in movies and in series", () => {
    const { ctx } = deps();
    const inMovies = findFileByLink(link(2), ctx);
    assert.equal(inMovies.filePath, "movies/550.yaml");
    assert.equal(inMovies.idx, 1);
    assert.equal(inMovies.type, "movie");
    const inSeries = findFileByLink(link(3), ctx);
    assert.equal(inSeries.filePath, "series/1396.yaml");
    assert.equal(inSeries.type, "series");
  });

  test("returns null when no file has the link", () => {
    const { ctx } = deps();
    assert.equal(findFileByLink(link(99), ctx), null);
  });

  test("skips directories that do not exist", () => {
    const { ctx } = deps({ files: { "movies/550.yaml": yaml(MOVIE_FILE) } });
    assert.equal(findFileByLink(link(1), ctx).filePath, "movies/550.yaml");
    assert.equal(findFileByLink(link(3), ctx), null);
  });
});

describe("processFix: updating a link", () => {
  test("replaces the link and keeps the rest of the entry", () => {
    const { ctx } = deps();
    const result = processFix({ old_link: link(1), new_link: link(10) }, ctx);
    assert.equal(result.filePath, "movies/550.yaml");
    assert.equal(result.action, "write");
    assert.equal(result.deleted, false);
    assert.equal(result.quality, "1080p");
    assert.deepEqual(load(result.content).links[0], {
      quality: "1080p",
      audio: ["Castellano"],
      link: link(10),
    });
  });

  test("ignores the season of a movie entry", () => {
    const { ctx } = deps();
    const result = processFix({ old_link: link(1), new_link: link(1), season: "0" }, ctx);
    assert.equal(load(result.content).links[0].season, undefined);
  });

  test("changes the quality, the season, the audio and the subs", () => {
    const { ctx } = deps();
    const result = processFix(
      { old_link: link(3), new_link: link(3), quality: "4K", season: "2", audio: "Latino", subs: "Inglés" },
      ctx
    );
    assert.deepEqual(load(result.content).links[0], {
      season: 2,
      quality: "4K",
      audio: ["Latino"],
      subs: ["Inglés"],
      tags: ["Extendida"],
      link: link(3),
    });
  });

  test("deletes every tag with the \"-\" convention", () => {
    const { ctx } = deps();
    const result = processFix({ old_link: link(3), new_link: link(3), tags: "-" }, ctx);
    assert.equal(load(result.content).links[0].tags, undefined);
  });

  test("adds a new language to the entry and to the list", () => {
    const { ctx, cfg } = deps();
    const result = processFix(
      { old_link: link(1), new_link: link(1), new_audio_language: "Alemán" },
      ctx
    );
    assert.equal(result.languagesChanged, true);
    assert.deepEqual(load(result.content).links[0].audio, ["Castellano", "Alemán"]);
    assert.ok(cfg.languages.audio.includes("Alemán"));
  });

  test("reuses the canonical spelling of an existing language regardless of accents", () => {
    const { ctx, cfg } = deps();
    const result = processFix(
      { old_link: link(1), new_link: link(1), new_subs_language: "INGLES" },
      ctx
    );
    assert.equal(result.languagesChanged, false);
    assert.deepEqual(load(result.content).links[0].subs, ["Inglés"]);
    assert.deepEqual(cfg.languages, config().languages);
  });

  test("rejects a new language with digits or commas", () => {
    const { ctx, cfg } = deps();
    for (const value of ["Italiano, Portugués", "Latino 2"]) {
      assert.throws(
        () => processFix({ old_link: link(1), new_link: link(1), new_audio_language: value }, ctx),
        ValidationError
      );
    }
    assert.deepEqual(cfg.languages, config().languages);
  });

  test("keeps the entry key order after an update", () => {
    const { ctx } = deps();
    const result = processFix(
      { old_link: link(3), new_link: link(3), audio: "Castellano", quality: "4K" },
      ctx
    );
    assert.deepEqual(Object.keys(load(result.content).links[0]), [
      "season", "quality", "audio", "tags", "link",
    ]);
  });

  test("an empty audio or subs field keeps the stored value", () => {
    const { ctx } = deps({
      files: {
        "movies/550.yaml": yaml({
          title: "El club de la lucha",
          links: [{ quality: "1080p", audio: ["Castellano"], subs: ["Inglés"], link: link(1) }],
        }),
      },
    });
    const result = processFix(
      { old_link: link(1), new_link: link(1), audio: "", subs: "" },
      ctx
    );
    assert.deepEqual(load(result.content).links[0], {
      quality: "1080p",
      audio: ["Castellano"],
      subs: ["Inglés"],
      link: link(1),
    });
  });

  test("\"-\" combined with a new audio language replaces the audio with it", () => {
    const { ctx } = deps();
    const result = processFix(
      { old_link: link(1), new_link: link(1), audio: "-", new_audio_language: "Alemán" },
      ctx
    );
    assert.deepEqual(load(result.content).links[0].audio, ["Alemán"]);
  });

  test("clears the audio with the \"-\" convention", () => {
    const { ctx } = deps();
    const result = processFix({ old_link: link(1), new_link: link(1), audio: "-" }, ctx);
    assert.deepEqual(load(result.content).links[0], { quality: "1080p", link: link(1) });
  });

  test("clears the subs with the \"-\" convention", () => {
    const { ctx } = deps({
      files: {
        "movies/550.yaml": yaml({
          title: "El club de la lucha",
          links: [{ quality: "1080p", audio: ["Castellano"], subs: ["Inglés", "Forzados"], link: link(1) }],
        }),
      },
    });
    const result = processFix({ old_link: link(1), new_link: link(1), subs: "-" }, ctx);
    assert.deepEqual(load(result.content).links[0], {
      quality: "1080p",
      audio: ["Castellano"],
      link: link(1),
    });
  });

  test("rejects a new link that already exists elsewhere", () => {
    const { ctx } = deps({ existing: [link(20)] });
    assert.throws(() => processFix({ old_link: link(1), new_link: link(20) }, ctx), {
      message: `link already exists in the catalog: ${link(20)}`,
    });
  });

  test("allows resubmitting the same link", () => {
    const { ctx } = deps({ existing: [link(1)] });
    assert.doesNotThrow(() => processFix({ old_link: link(1), new_link: link(1), quality: "4K" }, ctx));
  });

  test("rejects an unknown link, quality, language or new link format", () => {
    const { ctx } = deps();
    assert.throws(() => processFix({ old_link: link(99), new_link: link(98) }, ctx), {
      message: `link not found in the catalog: ${link(99)}`,
    });
    assert.throws(() => processFix({ old_link: link(1), new_link: link(1), quality: "720p" }, ctx), ValidationError);
    assert.throws(() => processFix({ old_link: link(1), new_link: link(1), audio: "Klingon" }, ctx), ValidationError);
    assert.throws(() => processFix({ old_link: link(1), new_link: "https://t.me/publico/1" }, ctx), ValidationError);
  });

  test("rejects moving a series entry to a season that is not valid", () => {
    const { ctx } = deps();
    assert.throws(
      () => processFix({ old_link: link(3), new_link: link(3), season: "-1" }, ctx),
      ValidationError
    );
  });
});

describe("processFix: deleting a link", () => {
  test("removes the entry when the new link is empty", () => {
    const { ctx } = deps();
    const result = processFix({ old_link: link(1), new_link: "" }, ctx);
    assert.equal(result.deleted, true);
    assert.equal(result.action, "write");
    assert.equal(result.quality, "1080p");
    assert.deepEqual(load(result.content).links.map((l) => l.link), [link(2)]);
  });

  test("deletes the whole file when it runs out of links", () => {
    const { ctx } = deps();
    const result = processFix({ old_link: link(3) }, ctx);
    assert.equal(result.filePath, "series/1396.yaml");
    assert.equal(result.action, "delete");
    assert.equal(result.content, null);
    assert.equal(result.deleted, true);
  });

  test("an empty new link next to other fields keeps the link and applies them", () => {
    const { ctx } = deps();
    const result = processFix({ old_link: link(1), new_link: "", quality: "4K", audio: "Latino" }, ctx);
    assert.equal(result.deleted, false);
    assert.equal(result.quality, "4K");
    assert.deepEqual(load(result.content).links, [
      { quality: "4K", audio: ["Latino"], link: link(1) },
      { quality: "4K", link: link(2) },
    ]);
  });

  test("a missing new link next to other fields keeps the link", () => {
    const { ctx } = deps();
    const result = processFix({ old_link: link(1), tags: "HDR" }, ctx);
    assert.equal(result.deleted, false);
    assert.equal(load(result.content).links[0].link, link(1));
  });

  test("\"-\" as the new link deletes it even with other fields", () => {
    const { ctx } = deps();
    const result = processFix({ old_link: link(1), new_link: "-", quality: "4K" }, ctx);
    assert.equal(result.deleted, true);
    assert.equal(result.quality, "1080p");
    assert.deepEqual(load(result.content).links.map((l) => l.link), [link(2)]);
  });

  test("the issue form fields left empty still delete the link", () => {
    const { ctx } = deps();
    const result = processFix(
      {
        tmdb: "https://www.themoviedb.org/movie/550", old_link: link(1), new_link: "", quality: "",
        audio: "", subs: "", new_audio_language: "", new_subs_language: "", season: "", tags: "",
      },
      ctx
    );
    assert.equal(result.deleted, true);
  });
});
