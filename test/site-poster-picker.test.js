import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { groupPosters, languageName } from "../site/poster-picker.js";

const poster = (file, lang, votes = 0, rating = 0) => ({ file_path: `/${file}.jpg`, iso_639_1: lang, vote_count: votes, vote_average: rating });

const keys = (groups) => groups.map((g) => g.key);
const files = (group) => group.posters.map((p) => p.file_path);

describe("groupPosters", () => {
  const posters = [
    poster("en1", "en", 10),
    poster("ja1", "ja", 3),
    poster("es1", "es", 1),
    poster("none1", null, 2),
    poster("zh1", "zh", 9),
    poster("es2", "es", 5),
  ];

  test("orders groups as castellano, inglés, sin texto and VO", () => {
    assert.deepEqual(keys(groupPosters(posters, "ja")), ["es", "en", "null", "vo"]);
  });

  test("the VO group holds only posters in the original language", () => {
    const vo = groupPosters(posters, "ja").find((g) => g.key === "vo");
    assert.deepEqual(files(vo), ["/ja1.jpg"]);
    assert.equal(vo.label, `VO (${languageName("ja")})`);
  });

  test("leaves out other languages", () => {
    const all = groupPosters(posters, "ja").flatMap(files);
    assert.equal(all.includes("/zh1.jpg"), false);
    assert.equal(all.length, 5);
  });

  test("has no VO group when the original language is es or en", () => {
    assert.deepEqual(keys(groupPosters(posters, "en")), ["es", "en", "null"]);
    assert.deepEqual(keys(groupPosters(posters, "es")), ["es", "en", "null"]);
  });

  test("has no VO group when the original language is unknown", () => {
    assert.deepEqual(keys(groupPosters(posters, null)), ["es", "en", "null"]);
    assert.deepEqual(keys(groupPosters(posters, undefined)), ["es", "en", "null"]);
  });

  test("sorts each group by votes and then by rating", () => {
    const es = groupPosters(
      [poster("a", "es", 2, 5), poster("b", "es", 7, 1), poster("c", "es", 2, 8), poster("d", "es", 0, 9)],
      null,
    )[0];
    assert.deepEqual(files(es), ["/b.jpg", "/c.jpg", "/a.jpg", "/d.jpg"]);
  });

  test("drops empty groups so the first one is the first with posters", () => {
    const groups = groupPosters([poster("en1", "en"), poster("ja1", "ja")], "ja");
    assert.deepEqual(keys(groups), ["en", "vo"]);
  });

  test("treats a missing iso_639_1 as sin texto", () => {
    const groups = groupPosters([{ file_path: "/x.jpg", vote_count: 1 }], null);
    assert.deepEqual(keys(groups), ["null"]);
  });

  test("returns no groups when there are no posters", () => {
    assert.deepEqual(groupPosters([], "ja"), []);
    assert.deepEqual(groupPosters(undefined, "ja"), []);
  });

  test("does not mutate the input array", () => {
    const input = [poster("a", "es", 1), poster("b", "es", 9)];
    groupPosters(input, null);
    assert.deepEqual(input.map((p) => p.file_path), ["/a.jpg", "/b.jpg"]);
  });
});

describe("languageName", () => {
  test("names a language in Spanish", () => {
    assert.equal(languageName("ja"), "japonés");
  });

  test("falls back to the code when it is not a valid language", () => {
    assert.equal(languageName("!!"), "!!");
  });
});
