import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { linkKey } from "../site/rules.js";
import { createLinkIndex } from "../scripts/lib.js";
import { processAdd, processFix } from "../scripts/add-entry.js";
import { config, fakeFs, fakeTmdb, link, yaml, GROUP_ID, OTHER_GROUP_ID, MOVIE_INFO } from "./fixtures.js";

describe("linkKey", () => {
  test("ignores the topic segment", () => {
    assert.equal(linkKey(link(42, 7)), `https://t.me/c/${GROUP_ID}/42`);
    assert.equal(linkKey(link(42)), `https://t.me/c/${GROUP_ID}/42`);
    assert.equal(linkKey(link(42, 7)), linkKey(link(42, 16088)));
  });

  test("keeps group and message id apart", () => {
    assert.notEqual(linkKey(link(42)), linkKey(link(43)));
    assert.notEqual(linkKey(link(42)), linkKey(`https://t.me/c/${OTHER_GROUP_ID}/42`));
  });

  test("returns any other string unchanged", () => {
    assert.equal(linkKey("https://t.me/publico/1"), "https://t.me/publico/1");
    assert.equal(linkKey(`https://t.me/c/${GROUP_ID}/42/`), `https://t.me/c/${GROUP_ID}/42/`);
  });
});

describe("createLinkIndex", () => {
  test("reports the earlier path of the same message linked with and without topic", () => {
    const index = createLinkIndex();
    assert.equal(index.add(link(42), "movies/550.yaml"), undefined);
    assert.equal(index.add(link(42, 2), "movies/551.yaml"), "movies/550.yaml");
  });

  test("reports an exact duplicate and accepts different messages", () => {
    const index = createLinkIndex();
    assert.equal(index.add(link(42, 2), "movies/550.yaml"), undefined);
    assert.equal(index.add(link(43, 2), "movies/550.yaml"), undefined);
    assert.equal(index.add(link(42, 2), "series/1396.yaml"), "movies/550.yaml");
  });
});

describe("duplicate links across topics", () => {
  const MOVIE_URL = "https://www.themoviedb.org/movie/550";

  function ctx(existing, files = {}) {
    const fs = fakeFs(files);
    return {
      ...config(),
      tmdbClient: fakeTmdb({ movies: { 550: MOVIE_INFO } }),
      existingLinks: new Set(existing),
      fileExists: fs.fileExists,
      readFile: fs.readFile,
      readdir: fs.readdir,
    };
  }

  test("processAdd rejects a message already in the catalog under another topic", async () => {
    await assert.rejects(
      () => processAdd({ tmdb: MOVIE_URL, quality: "1080p", link: link(11) }, ctx([link(11, 2)])),
      { message: `link already exists in the catalog: ${link(11)}` }
    );
    await assert.rejects(
      () => processAdd({ tmdb: MOVIE_URL, quality: "1080p", link: link(11, 2) }, ctx([link(11)])),
      { message: `link already exists in the catalog: ${link(11, 2)}` }
    );
  });

  test("processFix rejects a new link whose message is already elsewhere under another topic", () => {
    const files = { "movies/550.yaml": yaml({ title: "El club de la lucha", links: [{ quality: "1080p", link: link(1, 2) }] }) };
    assert.throws(
      () => processFix({ old_link: link(1, 2), new_link: link(20) }, ctx([link(1, 2), link(20, 2)], files)),
      { message: `link already exists in the catalog: ${link(20)}` }
    );
  });

  test("processFix allows changing only the topic of a link", () => {
    const files = { "movies/550.yaml": yaml({ title: "El club de la lucha", links: [{ quality: "1080p", link: link(1, 2) }] }) };
    const result = processFix({ old_link: link(1, 2), new_link: link(1) }, ctx([link(1, 2)], files));
    assert.equal(result.action, "write");
  });
});
