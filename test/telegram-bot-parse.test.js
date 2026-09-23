import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseEntryLine, parseLanguages, cleanTitleForSearch } from "../tools/telegram-bot/parse.js";

const LANGUAGES = {
  audio: ["Castellano", "Latino", "Inglés", "Japonés", "Francés", "Catalán", "Gallego", "Euskera", "VO", "Italiano"],
  subs: ["Castellano", "Latino", "Inglés", "Japonés", "Francés", "Catalán", "Gallego", "Euskera", "VO", "Forzados"],
};

describe("parseEntryLine", () => {
  test("parses a movie with quality only", () => {
    assert.deepEqual(parseEntryLine("El Camino: Una película de Breaking Bad (1080p)\n\nCastellano y VOSE"), {
      kind: "movie",
      title: "El Camino: Una película de Breaking Bad",
      year: null,
      season: undefined,
      quality: "1080p",
      tags: [],
    });
  });

  test("parses a series with a season", () => {
    // Real message Christian forwarded from the group while testing the bot.
    const text =
      "Stranger Things: Relatos del 85 - Temporada 2 (1080p)\n\nCastellano, Latino y VOSE\n\n(8 episodios)\n\nTemporadas: [Temporada 1]\n\nSerie Principal: [Stranger Things]";
    const parsed = parseEntryLine(text);
    assert.equal(parsed.kind, "series");
    assert.equal(parsed.title, "Stranger Things: Relatos del 85");
    assert.equal(parsed.season, 2);
    assert.equal(parsed.quality, "1080p");
  });

  test("parses a series with a year in the title and 'Serie Completa'", () => {
    const parsed = parseEntryLine("Star Wars: Clone Wars (2003) - Serie Completa (1080p)");
    assert.deepEqual(parsed, {
      kind: "series",
      title: "Star Wars: Clone Wars",
      year: "2003",
      season: "all",
      quality: "1080p",
      tags: [],
    });
  });

  test("parses a miniserie without an explicit quality, defaulting to 1080p", () => {
    const parsed = parseEntryLine("El Espectacular Spider-Man - Serie Completa (1080p)");
    assert.equal(parsed.season, "all");
    assert.equal(parsed.quality, "1080p");
  });

  test("detects REMUX and HDR tags from the quality bracket", () => {
    const parsed = parseEntryLine("Alguna Peli (2020) (1080p REMUX HDR)");
    assert.equal(parsed.quality, "1080p");
    assert.deepEqual(parsed.tags, ["REMUX", "HDR"]);
  });

  test("returns null when the first line doesn't end in a bracketed quality", () => {
    assert.equal(parseEntryLine("Un mensaje cualquiera sin formato reconocible"), null);
  });

  test("returns null for empty input", () => {
    assert.equal(parseEntryLine(""), null);
    assert.equal(parseEntryLine(undefined), null);
  });
});

describe("parseLanguages", () => {
  test("resolves an implicit 'X y VOSE' line", () => {
    const { audio, subs } = parseLanguages("Título (1080p)\n\nCastellano y VOSE\n\n(Son 12 partes en zip)", LANGUAGES);
    assert.deepEqual(audio, ["Castellano", "VO"]);
    assert.deepEqual(subs, ["Castellano"]);
  });

  test("resolves 'Solo VOSE'", () => {
    const { audio, subs } = parseLanguages("Título (1080p)\n\nSolo VOSE", LANGUAGES);
    assert.deepEqual(audio, ["VO"]);
    assert.deepEqual(subs, ["Castellano"]);
  });

  test("reads explicit Audio:/Subtítulos: lines, splitting on 'y' and 'e'", () => {
    // Real message from the group (Nimona).
    const text =
      "Nimona (1080p)\n\nAudio: Castellano, Latino, Catalán, Euskera, Gallego y VO (Inglés)\n\nSubtítulos: Castellano, Latino, Catalán, Euskera, Gallego e Inglés";
    const { audio, subs } = parseLanguages(text, LANGUAGES);
    assert.deepEqual(audio, ["Castellano", "Latino", "Catalán", "Euskera", "Gallego", "VO", "Inglés"]);
    assert.deepEqual(subs, ["Castellano", "Latino", "Catalán", "Euskera", "Gallego", "Inglés"]);
  });

  test("returns nothing it can't confidently read, rather than guessing", () => {
    // Known limitation (same as the original Python lang_parser.py): a language
    // line with extra parenthetical prose isn't a "pure" language line, so it's
    // left for the person to fill in by hand instead of risking a wrong guess.
    const { audio, subs } = parseLanguages("Gravity Falls - Temporada 1 (1080p)\n\nCastellano y VO (solo subs en inglés)", LANGUAGES);
    assert.deepEqual(audio, []);
    assert.deepEqual(subs, []);
  });
});

describe("cleanTitleForSearch", () => {
  test("strips known prefixes and edition suffixes", () => {
    assert.equal(cleanTitleForSearch("Fitgirl Repacks Alguna Peli - Versión Extendida"), "Alguna Peli");
  });

  test("leaves an already-clean title untouched", () => {
    assert.equal(cleanTitleForSearch("Fight Club"), "Fight Club");
  });
});
