import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { yearOf, nameOf, seasonOptions, checkboxGroup, validateLink } from "../site/forms.js";
import { GROUP_ID, OTHER_GROUP_ID, config, link } from "./fixtures.js";

describe("yearOf", () => {
  test("takes the year from a movie release date", () => {
    assert.equal(yearOf({ release_date: "2016-09-17" }), "2016");
  });

  test("falls back to the first air date of a series", () => {
    assert.equal(yearOf({ first_air_date: "2002-10-03" }), "2002");
  });

  test("prefers the release date when both are present", () => {
    assert.equal(yearOf({ release_date: "2001-11-16", first_air_date: "1999-01-01" }), "2001");
  });

  test("returns an empty string when there is no date", () => {
    assert.equal(yearOf({}), "");
    assert.equal(yearOf({ release_date: "" }), "");
  });
});

describe("nameOf", () => {
  test("uses the movie title", () => {
    assert.equal(nameOf({ title: "Koe no Katachi" }), "Koe no Katachi");
  });

  test("falls back to the series name", () => {
    assert.equal(nameOf({ name: "Naruto" }), "Naruto");
  });

  test("prefers the title when both are present", () => {
    assert.equal(nameOf({ title: "A", name: "B" }), "A");
  });

  test("returns an empty string when there is neither", () => {
    assert.equal(nameOf({}), "");
  });
});

describe("seasonOptions", () => {
  test("adds specials, sorts the seasons and ends with all and other", () => {
    const options = seasonOptions([
      { season_number: 2, name: "Temporada 2" },
      { season_number: 1, name: "Temporada 1" },
    ]);
    assert.deepEqual(options, [
      { value: 0, label: "Especiales (0)" },
      { value: 1, label: "Temporada 1 (1)" },
      { value: 2, label: "Temporada 2 (2)" },
      { value: "all", label: "Serie completa (all)" },
      { value: "other", label: "Otra (escribir número)" },
    ]);
  });

  test("uses the TMDB specials entry instead of the generic one when it exists", () => {
    const options = seasonOptions([
      { season_number: 1, name: "Temporada 1" },
      { season_number: 0, name: "Especiales" },
    ]);
    assert.deepEqual(options.map((o) => o.value), [0, 1, "all", "other"]);
    assert.equal(options[0].label, "Especiales (0)");
    assert.equal(options.filter((o) => o.value === 0).length, 1);
  });

  test("does not reorder the input array", () => {
    const seasons = [{ season_number: 2, name: "B" }, { season_number: 1, name: "A" }];
    seasonOptions(seasons);
    assert.deepEqual(seasons.map((s) => s.season_number), [2, 1]);
  });

  test("still offers specials, all and other when TMDB lists no seasons", () => {
    assert.deepEqual(seasonOptions([]).map((o) => o.value), [0, "all", "other"]);
  });
});

describe("checkboxGroup", () => {
  test("renders one checkbox per value and checks the selected ones", () => {
    const html = checkboxGroup("audio", ["Castellano", "Inglés"], ["Inglés"]);
    assert.equal(
      html,
      '<label class="check"><input type="checkbox" name="audio" value="Castellano"> Castellano</label>' +
        '<label class="check"><input type="checkbox" name="audio" value="Inglés" checked> Inglés</label>'
    );
  });

  test("escapes the values", () => {
    assert.match(checkboxGroup("subs", ['<b>"x"</b>']), /value="&lt;b&gt;&quot;x&quot;&lt;\/b&gt;"/);
  });

  test("renders nothing for an empty list", () => {
    assert.equal(checkboxGroup("audio", []), "");
  });
});

describe("validateLink", () => {
  const { groups } = config();

  test("accepts an empty link so the required check can handle it", () => {
    assert.equal(validateLink("", groups), "");
  });

  test("accepts message links from any known group, with or without topic", () => {
    assert.equal(validateLink(link(42), groups), "");
    assert.equal(validateLink(link(42, 7), groups), "");
    assert.equal(validateLink(`https://t.me/c/${OTHER_GROUP_ID}/1`, groups), "");
  });

  test("rejects invite links with a specific message", () => {
    for (const value of ["https://t.me/+AbCdEf", "https://t.me/joinchat/AbCdEf"]) {
      assert.match(validateLink(value, groups), /invitación/);
    }
  });

  test("rejects anything that is not a private message link", () => {
    for (const value of ["https://t.me/canal/42", `https://t.me/c/${GROUP_ID}`, "hola", `https://t.me/c/${GROUP_ID}/42?single`]) {
      assert.match(validateLink(value, groups), /Tiene que ser/);
    }
  });

  test("rejects links from groups outside the Cositeca", () => {
    assert.match(validateLink("https://t.me/c/1111111111/42", groups), /ninguno de los grupos/);
  });
});
