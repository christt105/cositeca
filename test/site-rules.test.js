import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  TELEGRAM_LINK_RE,
  TMDB_URL_RE,
  TMDB_ID_RE,
  IMDB_ID_RE,
  REPO_URL,
  TMDB_PROXY_URL,
  tmdbUrl,
  imdbUrl,
  issueUrl,
  listFieldValue,
  matchesSearch,
  normalizeText,
  newLanguageError,
  telegramMessageId,
  findIndistinguishableVersions,
} from "../site/rules.js";
import { esc, typeIcon, renderChips, TYPE_LABELS } from "../site/ui.js";
import { GROUP_ID, link } from "./fixtures.js";

describe("shared regexes", () => {
  test("TELEGRAM_LINK_RE captures group, optional topic and message", () => {
    assert.deepEqual(TELEGRAM_LINK_RE.exec(`https://t.me/c/${GROUP_ID}/42`)?.slice(1), [
      GROUP_ID,
      undefined,
      "42",
    ]);
    assert.deepEqual(TELEGRAM_LINK_RE.exec(`https://t.me/c/${GROUP_ID}/7/42`)?.slice(1), [
      GROUP_ID,
      "7",
      "42",
    ]);
  });

  test("TELEGRAM_LINK_RE rejects public channels, invites and query strings", () => {
    for (const value of [
      "https://t.me/canal/42",
      "https://t.me/+abcdef",
      `http://t.me/c/${GROUP_ID}/42`,
      `https://t.me/c/${GROUP_ID}/42?single`,
      `https://t.me/c/${GROUP_ID}/42/`,
    ]) {
      assert.equal(TELEGRAM_LINK_RE.test(value), false, value);
    }
  });

  test("TMDB_URL_RE accepts movie and tv URLs with an optional slug", () => {
    assert.deepEqual(TMDB_URL_RE.exec("https://www.themoviedb.org/movie/550")?.slice(1), [
      "movie",
      "550",
    ]);
    assert.deepEqual(
      TMDB_URL_RE.exec("https://themoviedb.org/tv/1396-breaking-bad")?.slice(1),
      ["tv", "1396"]
    );
  });

  test("TMDB_URL_RE accepts trailing slashes, language prefixes, queries and season URLs", () => {
    for (const [value, expected] of [
      ["https://www.themoviedb.org/movie/550/", ["movie", "550"]],
      ["https://www.themoviedb.org/es/movie/550", ["movie", "550"]],
      ["https://www.themoviedb.org/es-ES/movie/550-el-club-de-la-lucha/", ["movie", "550"]],
      ["https://www.themoviedb.org/movie/550-fight-club?language=es-ES", ["movie", "550"]],
      ["https://www.themoviedb.org/tv/1396/season/1", ["tv", "1396"]],
      ["https://www.themoviedb.org/tv/1396-breaking-bad/season/2/", ["tv", "1396"]],
    ]) {
      assert.deepEqual(TMDB_URL_RE.exec(value)?.slice(1), expected, value);
    }
  });

  test("TMDB_URL_RE rejects other TMDB pages and hosts", () => {
    for (const value of [
      "https://www.themoviedb.org/person/287",
      "https://www.themoviedb.org/movie/550/cast",
      "https://www.themoviedb.org/tv/1396/season/one",
      "https://www.themoviedb.org/spanish/movie/550",
      "https://evil.example/themoviedb.org/movie/550",
    ]) {
      assert.equal(TMDB_URL_RE.test(value), false, value);
    }
  });

  test("TMDB_ID_RE only accepts tmdb:<digits>", () => {
    assert.equal(TMDB_ID_RE.exec("tmdb:550")?.[1], "550");
    assert.equal(TMDB_ID_RE.test("tmdb:abc"), false);
    assert.equal(TMDB_ID_RE.test("550"), false);
  });

  test("IMDB_ID_RE accepts tt ids of up to 12 digits", () => {
    assert.equal(IMDB_ID_RE.test("tt0137523"), true);
    assert.equal(IMDB_ID_RE.test("tt1"), true);
    assert.equal(IMDB_ID_RE.test("nm0000138"), false);
    assert.equal(IMDB_ID_RE.test("tt"), false);
  });

  test("IMDB_ID_RE rejects more than 12 digits", () => {
    assert.equal(IMDB_ID_RE.test(`tt${"1".repeat(12)}`), true);
    assert.equal(IMDB_ID_RE.test(`tt${"1".repeat(13)}`), false);
    assert.equal(IMDB_ID_RE.test(`tt${"1".repeat(40)}`), false);
  });
});

describe("URL helpers", () => {
  test("tmdbUrl maps site types to TMDB paths", () => {
    assert.equal(tmdbUrl("movie", 550), "https://www.themoviedb.org/movie/550");
    assert.equal(tmdbUrl("series", 1396), "https://www.themoviedb.org/tv/1396");
    assert.equal(tmdbUrl("tv", 1396), "https://www.themoviedb.org/tv/1396");
  });

  test("imdbUrl builds a title URL", () => {
    assert.equal(imdbUrl("tt0137523"), "https://www.imdb.com/title/tt0137523/");
  });

  test("listFieldValue sends \"-\" only when a list with values is emptied", () => {
    assert.equal(listFieldValue("Castellano, Inglés", ["Castellano"]), "Castellano, Inglés");
    assert.equal(listFieldValue("", ["Castellano"]), "-");
    assert.equal(listFieldValue("", []), "");
    assert.equal(listFieldValue("", undefined), "");
  });

  test("issueUrl points at the repo issue form and keeps the template", () => {
    const url = new URL(issueUrl("add.yml"));
    assert.equal(`${url.origin}${url.pathname}`, `${REPO_URL}/issues/new`);
    assert.equal(url.searchParams.get("template"), "add.yml");
  });

  test("issueUrl adds only the params that have a value", () => {
    const url = new URL(
      issueUrl("add.yml", { tmdb: "https://www.themoviedb.org/movie/550", quality: "", season: undefined, tags: null })
    );
    assert.equal(url.searchParams.get("tmdb"), "https://www.themoviedb.org/movie/550");
    assert.equal(url.searchParams.has("quality"), false);
    assert.equal(url.searchParams.has("season"), false);
    assert.equal(url.searchParams.has("tags"), false);
  });

  test("issueUrl encodes values", () => {
    const url = issueUrl("add.yml", { title: "Amélie & cía" });
    assert.match(url, /title=Am%C3%A9lie\+%26\+c%C3%ADa/);
  });

  test("TMDB_PROXY_URL is an absolute https URL", () => {
    assert.match(TMDB_PROXY_URL, /^https:\/\//);
  });
});

describe("ui helpers", () => {
  test("esc escapes the characters that break HTML text and double-quoted attributes", () => {
    assert.equal(esc(`<a href="x">Tom & Jerry</a>`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&lt;/a&gt;");
  });

  test("esc turns null and undefined into an empty string", () => {
    assert.equal(esc(null), "");
    assert.equal(esc(undefined), "");
    assert.equal(esc(0), "0");
  });

  test("esc escapes single quotes for single-quoted attributes", () => {
    assert.equal(esc("it's"), "it&#39;s");
  });

  test("typeIcon labels the icon and escapes the extra text", () => {
    const icon = typeIcon("series", "T1-3");
    assert.match(icon, /aria-label="Serie"/);
    assert.match(icon, /<span>T1-3<\/span>/);
    assert.match(typeIcon("movie"), /aria-label="Película"/);
    assert.doesNotMatch(typeIcon("movie"), /<span>/);
    assert.match(typeIcon("movie", "<b>"), /&lt;b&gt;/);
  });

  test("renderChips renders one escaped chip per value", () => {
    assert.equal(
      renderChips(["Castellano", "<b>"], "chip--audio"),
      '<span class="chip chip--audio">Castellano</span><span class="chip chip--audio">&lt;b&gt;</span>'
    );
    assert.equal(renderChips(undefined, "chip--audio"), "");
    assert.equal(renderChips([], "chip--audio"), "");
  });

  test("TYPE_LABELS covers the two catalog types", () => {
    assert.deepEqual(TYPE_LABELS, { movie: "Película", series: "Serie" });
  });
});

describe("matchesSearch", () => {
  const item = { tmdb: 1917, imdb: "tt8579674", title: "1917", originalTitle: "1917" };
  const other = { tmdb: 550, imdb: "tt0137523", title: "El club de la lucha", originalTitle: "Fight Club" };

  test("an empty query matches everything", () => {
    assert.equal(matchesSearch(other, ""), true);
  });

  test("a numeric query matches the TMDB id", () => {
    assert.equal(matchesSearch(other, "550"), true);
    assert.equal(matchesSearch(other, "551"), false);
  });

  test("a numeric query also matches titles containing the digits", () => {
    const numericTitle = { tmdb: 1, imdb: "tt1", title: "2012", originalTitle: "2012" };
    assert.equal(matchesSearch(numericTitle, "2012"), true);
    assert.equal(matchesSearch(item, "1917"), true);
    assert.equal(matchesSearch(other, "1917"), false);
  });

  test("an IMDb id matches only the imdb field", () => {
    assert.equal(matchesSearch(other, "tt0137523"), true);
    assert.equal(matchesSearch(other, "tt9999999"), false);
  });

  test("text queries ignore case and accents in title and original title", () => {
    assert.equal(matchesSearch(other, "CLUB"), true);
    assert.equal(matchesSearch(other, "fight"), true);
    assert.equal(matchesSearch({ tmdb: 2, title: "Pelicula" }, "película"), true);
    assert.equal(matchesSearch(other, "xyz"), false);
  });
});

describe("normalizeText", () => {
  test("lowercases and strips diacritics", () => {
    assert.equal(normalizeText("Árbol Ñandú"), "arbol nandu");
  });
});

describe("telegramMessageId", () => {
  test("reads the message id from a link without a topic", () => {
    assert.equal(telegramMessageId(link(31341)), "31341");
  });

  test("reads the message id from a link with a topic", () => {
    assert.equal(telegramMessageId(link(31341, 7)), "31341");
  });

  test("is empty for an invalid link", () => {
    assert.equal(telegramMessageId("https://t.me/canal/42"), "");
    assert.equal(telegramMessageId(""), "");
    assert.equal(telegramMessageId(undefined), "");
  });
});

describe("findIndistinguishableVersions", () => {
  test("groups two entries with identical attributes", () => {
    const a = { quality: "1080p", audio: ["Castellano"], link: link(1) };
    const b = { quality: "1080p", audio: ["Castellano"], link: link(2) };
    assert.deepEqual(findIndistinguishableVersions([a, b]), [[a, b]]);
  });

  test("ignores the order of audio, subs and tags", () => {
    const a = { quality: "1080p", audio: ["Castellano", "Inglés"], tags: ["HDR", "Remux"], link: link(1) };
    const b = { quality: "1080p", audio: ["Inglés", "Castellano"], tags: ["Remux", "HDR"], link: link(2) };
    assert.deepEqual(findIndistinguishableVersions([a, b]), [[a, b]]);
  });

  test("treats a missing list the same as an empty one", () => {
    const a = { quality: "1080p", subs: [], link: link(1) };
    const b = { quality: "1080p", link: link(2) };
    assert.deepEqual(findIndistinguishableVersions([a, b]), [[a, b]]);
  });

  test("does not flag entries with a different season or tags", () => {
    const a = { season: 1, quality: "1080p", link: link(1) };
    const b = { season: 2, quality: "1080p", link: link(2) };
    const c = { season: 1, quality: "1080p", tags: ["Extendida"], link: link(3) };
    assert.deepEqual(findIndistinguishableVersions([a, b, c]), []);
  });

  test("groups three indistinguishable entries together", () => {
    const a = { quality: "4K", link: link(1) };
    const b = { quality: "4K", link: link(2) };
    const c = { quality: "4K", link: link(3) };
    const d = { quality: "1080p", link: link(4) };
    assert.deepEqual(findIndistinguishableVersions([a, b, c, d]), [[a, b, c]]);
  });
});

describe("newLanguageError", () => {
  test("is empty for nothing typed and for a single language", () => {
    assert.equal(newLanguageError(""), "");
    assert.equal(newLanguageError("   "), "");
    assert.equal(newLanguageError("Portugués"), "");
    assert.equal(newLanguageError("  Alemán   antiguo "), "");
  });

  test("explains the rule for commas, digits, punctuation and bad lengths", () => {
    for (const value of ["Italiano, Portugués", "Latino 2", "<script>", "a", "a".repeat(31)]) {
      assert.match(newLanguageError(value), /idioma nuevo/);
    }
  });
});
