import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  BotValidationError,
  buildIssueBody,
  buildLanguageKeyboard,
  buildSummary,
  formatCandidates,
  parseTelegramLink,
  toggleLanguage,
} from "../tools/telegram-bot/lib.js";

const GROUPS = { "2229558644": "Grupo 1", "2142474284": "Grupo 2" };

describe("parseTelegramLink", () => {
  test("accepts a link from a known group", () => {
    const link = "https://t.me/c/2229558644/42";
    assert.equal(parseTelegramLink(link, GROUPS), link);
  });

  test("accepts a link with a topic", () => {
    const link = "https://t.me/c/2229558644/7/42";
    assert.equal(parseTelegramLink(link, GROUPS), link);
  });

  test("rejects invite links", () => {
    assert.throws(() => parseTelegramLink("https://t.me/+abcdef", GROUPS), BotValidationError);
    assert.throws(() => parseTelegramLink("https://t.me/joinchat/abcdef", GROUPS), BotValidationError);
  });

  test("rejects malformed links", () => {
    assert.throws(() => parseTelegramLink("not a link", GROUPS), BotValidationError);
  });

  test("rejects links from unknown groups", () => {
    assert.throws(() => parseTelegramLink("https://t.me/c/999/42", GROUPS), BotValidationError);
  });

  test("rejects empty input", () => {
    assert.throws(() => parseTelegramLink("", GROUPS), BotValidationError);
  });
});

describe("formatCandidates", () => {
  test("maps movie and tv results, skipping people", () => {
    const results = [
      { media_type: "movie", id: 550, title: "Fight Club", release_date: "1999-10-15" },
      { media_type: "person", id: 1, name: "Someone" },
      { media_type: "tv", id: 1399, name: "Game of Thrones", first_air_date: "2011-04-17" },
    ];
    const candidates = formatCandidates(results);
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].label, "🎬 Fight Club (1999)");
    assert.equal(candidates[0].url, "https://www.themoviedb.org/movie/550");
    assert.equal(candidates[1].label, "📺 Game of Thrones (2011)");
    assert.equal(candidates[1].url, "https://www.themoviedb.org/tv/1399");
  });

  test("caps at the given limit", () => {
    const results = Array.from({ length: 10 }, (_, i) => ({
      media_type: "movie",
      id: i,
      title: `Movie ${i}`,
      release_date: "2020-01-01",
    }));
    assert.equal(formatCandidates(results, 5).length, 5);
  });

  test("falls back to ???? when there's no date", () => {
    const results = [{ media_type: "movie", id: 1, title: "No Date", release_date: "" }];
    assert.equal(formatCandidates(results)[0].label, "🎬 No Date (????)");
  });
});

describe("toggleLanguage", () => {
  test("adds a language that isn't selected", () => {
    assert.deepEqual(toggleLanguage(["Castellano"], "Inglés"), ["Castellano", "Inglés"]);
  });

  test("removes a language that is already selected", () => {
    assert.deepEqual(toggleLanguage(["Castellano", "Inglés"], "Castellano"), ["Inglés"]);
  });
});

describe("buildLanguageKeyboard", () => {
  test("marks selected languages and appends control buttons", () => {
    const keyboard = buildLanguageKeyboard(["Castellano", "Inglés"], ["Inglés"], "audio");
    assert.equal(keyboard.length, 3);
    assert.equal(keyboard[0][0].text, "Castellano");
    assert.equal(keyboard[0][0].callback_data, "a:Castellano");
    assert.equal(keyboard[1][0].text, "✅ Inglés");
    assert.equal(keyboard[2][0].callback_data, "a:new");
    assert.equal(keyboard[2][1].callback_data, "a:done");
  });

  test("uses the subs prefix for subs", () => {
    const keyboard = buildLanguageKeyboard(["Castellano"], [], "subs");
    assert.equal(keyboard[0][0].callback_data, "s:Castellano");
  });
});

describe("buildIssueBody", () => {
  test("formats fields as GitHub issue-form sections in a fixed order", () => {
    const body = buildIssueBody({
      tmdb: "https://www.themoviedb.org/movie/550",
      quality: "1080p",
      audio: "Castellano, Inglés",
      link: "https://t.me/c/2229558644/42",
    });
    assert.equal(
      body,
      [
        "### URL de TMDB o id de IMDB\n\nhttps://www.themoviedb.org/movie/550",
        "### Calidad\n\n1080p",
        "### Temporada\n\n_No response_",
        "### Audio\n\nCastellano, Inglés",
        "### Subtítulos\n\n_No response_",
        "### Nuevo idioma (audio)\n\n_No response_",
        "### Nuevo idioma (subtítulos)\n\n_No response_",
        "### Etiquetas\n\n_No response_",
        "### Portada\n\n_No response_",
        "### Link de Telegram\n\nhttps://t.me/c/2229558644/42",
      ].join("\n\n")
    );
  });
});

describe("buildSummary", () => {
  test("lists only the fields that were filled in", () => {
    const summary = buildSummary({
      title: "Fight Club",
      fields: { tmdb: "https://www.themoviedb.org/movie/550", quality: "1080p", link: "https://t.me/c/2229558644/42" },
    });
    assert.match(summary, /Título: Fight Club/);
    assert.match(summary, /Calidad: 1080p/);
    assert.doesNotMatch(summary, /Etiquetas/);
    assert.doesNotMatch(summary, /Portada/);
  });
});
