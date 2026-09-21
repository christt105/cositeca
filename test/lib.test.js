import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ValidationError,
  parseTelegramLink,
  parseTmdbInput,
  validateQuality,
  validateSeason,
  validateTags,
  validateLanguages,
  sanitizeNewLanguage,
  validatePoster,
  validateSeasonPosters,
  validateLinkEntry,
  createTmdbClient,
  resolveTmdbTarget,
} from "../scripts/lib.js";
import { config, fakeTmdb, GROUP_ID, link } from "./fixtures.js";

describe("parseTelegramLink", () => {
  test("parses a link without topic", () => {
    assert.deepEqual(parseTelegramLink(`https://t.me/c/${GROUP_ID}/42`), {
      groupId: GROUP_ID,
      topicId: null,
      messageId: "42",
    });
  });

  test("parses a link with topic", () => {
    assert.deepEqual(parseTelegramLink(`https://t.me/c/${GROUP_ID}/7/42`), {
      groupId: GROUP_ID,
      topicId: "7",
      messageId: "42",
    });
  });

  test("rejects invite links", () => {
    assert.throws(() => parseTelegramLink("https://t.me/+abcdef"), ValidationError);
    assert.throws(() => parseTelegramLink("https://t.me/joinchat/abcdef"), ValidationError);
  });

  test("rejects public links, trailing slashes and non-strings", () => {
    assert.throws(() => parseTelegramLink("https://t.me/somechannel/42"), ValidationError);
    assert.throws(() => parseTelegramLink(`https://t.me/c/${GROUP_ID}/42/`), ValidationError);
    assert.throws(() => parseTelegramLink(undefined), ValidationError);
    assert.throws(() => parseTelegramLink(42), ValidationError);
  });
});

describe("parseTmdbInput", () => {
  test("parses movie and tv URLs, with and without slug", () => {
    assert.deepEqual(parseTmdbInput("https://www.themoviedb.org/movie/550"), {
      source: "url",
      type: "movie",
      id: 550,
    });
    assert.deepEqual(parseTmdbInput("https://www.themoviedb.org/tv/1396-breaking-bad"), {
      source: "url",
      type: "tv",
      id: 1396,
    });
    assert.deepEqual(parseTmdbInput("http://themoviedb.org/movie/550"), {
      source: "url",
      type: "movie",
      id: 550,
    });
  });

  test("trims surrounding whitespace", () => {
    assert.deepEqual(parseTmdbInput("  https://www.themoviedb.org/movie/550  "), {
      source: "url",
      type: "movie",
      id: 550,
    });
  });

  test("parses an IMDB id", () => {
    assert.deepEqual(parseTmdbInput("tt0137523"), { source: "imdb", imdbId: "tt0137523" });
  });

  test("known bug B2: tmdb:<id> without season resolves to a movie", () => {
    assert.deepEqual(parseTmdbInput("tmdb:1396"), {
      source: "tmdbId",
      type: "movie",
      id: 1396,
    });
  });

  test("tmdb:<id> resolves to tv only when a season is known", () => {
    assert.deepEqual(parseTmdbInput("tmdb:1396", { hasSeason: true }), {
      source: "tmdbId",
      type: "tv",
      id: 1396,
    });
  });

  test("known limitation: TMDB URLs with a trailing slash, a language prefix or a season are rejected", () => {
    assert.throws(() => parseTmdbInput("https://www.themoviedb.org/movie/550/"), ValidationError);
    assert.throws(() => parseTmdbInput("https://www.themoviedb.org/es/movie/550"), ValidationError);
    assert.throws(
      () => parseTmdbInput("https://www.themoviedb.org/tv/1396/season/1"),
      ValidationError
    );
  });

  test("rejects empty and unrecognised input", () => {
    assert.throws(() => parseTmdbInput(""), ValidationError);
    assert.throws(() => parseTmdbInput("   "), ValidationError);
    assert.throws(() => parseTmdbInput(undefined), ValidationError);
    assert.throws(() => parseTmdbInput("550"), ValidationError);
    assert.throws(() => parseTmdbInput("https://www.imdb.com/title/tt0137523/"), ValidationError);
  });
});

describe("validateQuality", () => {
  test("accepts a listed quality", () => {
    assert.doesNotThrow(() => validateQuality("1080p", ["1080p", "4K"]));
  });

  test("rejects anything else, listing the allowed values", () => {
    assert.throws(() => validateQuality("720p", ["1080p", "4K"]), {
      name: "Error",
      message: 'quality "720p" is not one of: 1080p, 4K',
    });
  });
});

describe("validateSeason", () => {
  test("accepts integers >= 0 and \"all\" for series", () => {
    assert.doesNotThrow(() => validateSeason(0, "series"));
    assert.doesNotThrow(() => validateSeason(3, "series"));
    assert.doesNotThrow(() => validateSeason("all", "series"));
  });

  test("requires a season for series", () => {
    assert.throws(() => validateSeason(undefined, "series"), ValidationError);
    assert.throws(() => validateSeason(null, "series"), ValidationError);
  });

  test("rejects negative, fractional and string seasons", () => {
    assert.throws(() => validateSeason(-1, "series"), ValidationError);
    assert.throws(() => validateSeason(1.5, "series"), ValidationError);
    assert.throws(() => validateSeason("1", "series"), ValidationError);
  });

  test("rejects any season on movies", () => {
    assert.doesNotThrow(() => validateSeason(undefined, "movie"));
    assert.throws(() => validateSeason(1, "movie"), ValidationError);
  });
});

describe("validateTags", () => {
  test("accepts undefined and arrays of strings", () => {
    assert.doesNotThrow(() => validateTags(undefined));
    assert.doesNotThrow(() => validateTags([]));
    assert.doesNotThrow(() => validateTags(["Extendida"]));
  });

  test("rejects non-arrays and non-string members", () => {
    assert.throws(() => validateTags("Extendida"), ValidationError);
    assert.throws(() => validateTags([1]), ValidationError);
  });
});

describe("validateLanguages", () => {
  const allowed = ["Castellano", "Inglés"];

  test("accepts undefined and listed values", () => {
    assert.doesNotThrow(() => validateLanguages(undefined, "audio", allowed));
    assert.doesNotThrow(() => validateLanguages(["Castellano", "Inglés"], "audio", allowed));
  });

  test("rejects unlisted values", () => {
    assert.throws(() => validateLanguages(["Aleman"], "audio", allowed), {
      message: 'audio "Aleman" is not one of: Castellano, Inglés',
    });
  });

  test("rejects duplicates", () => {
    assert.throws(() => validateLanguages(["Castellano", "Castellano"], "subs", allowed), {
      message: 'subs has duplicate value "Castellano"',
    });
  });

  test("rejects non-arrays", () => {
    assert.throws(() => validateLanguages("Castellano", "audio", allowed), ValidationError);
  });
});

describe("sanitizeNewLanguage", () => {
  const existing = ["Castellano", "Inglés"];

  test("returns undefined for nothing to add", () => {
    assert.equal(sanitizeNewLanguage(undefined, existing), undefined);
    assert.equal(sanitizeNewLanguage(null, existing), undefined);
    assert.equal(sanitizeNewLanguage("", existing), undefined);
    assert.equal(sanitizeNewLanguage("   ", existing), undefined);
  });

  test("collapses inner whitespace and trims", () => {
    assert.equal(sanitizeNewLanguage("  Aleman   antiguo ", existing), "Aleman antiguo");
  });

  test("reuses an existing value regardless of case", () => {
    assert.equal(sanitizeNewLanguage("castellano", existing), "Castellano");
    assert.equal(sanitizeNewLanguage("INGLÉS", existing), "Inglés");
  });

  test("rejects values longer than 30 characters", () => {
    assert.throws(() => sanitizeNewLanguage("a".repeat(31), existing), ValidationError);
    assert.equal(sanitizeNewLanguage("a".repeat(30), existing), "a".repeat(30));
  });

  test("rejects values shorter than 2 characters", () => {
    assert.throws(() => sanitizeNewLanguage("a", existing), ValidationError);
    assert.equal(sanitizeNewLanguage("ab", existing), "ab");
  });

  test("rejects commas, digits and punctuation", () => {
    assert.throws(() => sanitizeNewLanguage("Italiano, Portugués", existing), ValidationError);
    assert.throws(() => sanitizeNewLanguage("Italiano 2", existing), ValidationError);
    assert.throws(() => sanitizeNewLanguage("<script>", existing), ValidationError);
    assert.throws(() => sanitizeNewLanguage("Italiano/Portugués", existing), ValidationError);
    assert.throws(() => sanitizeNewLanguage("Italiano.", existing), ValidationError);
  });

  test("raises a Spanish message for an invalid value", () => {
    assert.throws(
      () => sanitizeNewLanguage("Italiano, Portugués", existing),
      (err) => err instanceof ValidationError && /idioma nuevo/.test(err.message) && err.message.includes("Italiano, Portugués")
    );
  });

  test("accepts letters with accents and marks", () => {
    assert.equal(sanitizeNewLanguage("Portugués", existing), "Portugués");
    assert.equal(sanitizeNewLanguage("Árabe", existing), "Árabe");
    assert.equal(sanitizeNewLanguage("Portugue\u0301s", existing), "Portugu\u00e9s");
  });

  test("reuses an existing value regardless of accents and case", () => {
    assert.equal(sanitizeNewLanguage("Ingles", existing), "Inglés");
    assert.equal(sanitizeNewLanguage("ingles", existing), "Inglés");
    assert.equal(sanitizeNewLanguage("INGLES", existing), "Inglés");
    assert.equal(sanitizeNewLanguage("Cástellano", existing), "Castellano");
  });
});

describe("validatePoster", () => {
  test("accepts undefined and non-empty strings", () => {
    assert.doesNotThrow(() => validatePoster(undefined));
    assert.doesNotThrow(() => validatePoster("https://image.tmdb.org/t/p/w342/a.jpg"));
  });

  test("rejects empty strings and non-strings", () => {
    assert.throws(() => validatePoster(""), ValidationError);
    assert.throws(() => validatePoster("   "), ValidationError);
    assert.throws(() => validatePoster(42), ValidationError);
  });

  test("known limitation: any non-empty string passes, no scheme or host check", () => {
    assert.doesNotThrow(() => validatePoster("not-a-url"));
    assert.doesNotThrow(() => validatePoster("javascript:alert(1)"));
  });
});

describe("validateSeasonPosters", () => {
  test("accepts undefined and a mapping of season to URL on series", () => {
    assert.doesNotThrow(() => validateSeasonPosters(undefined, "movie"));
    assert.doesNotThrow(() =>
      validateSeasonPosters({ all: "https://a", 0: "https://b", 12: "https://c" }, "series")
    );
  });

  test("rejects seasonPosters on movies", () => {
    assert.throws(() => validateSeasonPosters({ 1: "https://a" }, "movie"), ValidationError);
  });

  test("rejects arrays, non-objects and bad keys or values", () => {
    assert.throws(() => validateSeasonPosters([], "series"), ValidationError);
    assert.throws(() => validateSeasonPosters("x", "series"), ValidationError);
    assert.throws(() => validateSeasonPosters({ first: "https://a" }, "series"), ValidationError);
    assert.throws(() => validateSeasonPosters({ 1: "" }, "series"), ValidationError);
  });
});

describe("validateLinkEntry", () => {
  const base = config();

  test("accepts a complete movie entry", () => {
    assert.doesNotThrow(() =>
      validateLinkEntry(
        { quality: "1080p", audio: ["Castellano"], subs: ["Inglés"], tags: ["Extendida"], link: link(1) },
        { type: "movie", ...base }
      )
    );
  });

  test("requires a quality", () => {
    assert.throws(
      () => validateLinkEntry({ link: link(1) }, { type: "movie", ...base }),
      { message: "quality is required" }
    );
  });

  test("rejects unknown telegram groups", () => {
    assert.throws(
      () =>
        validateLinkEntry(
          { quality: "1080p", link: "https://t.me/c/999/1" },
          { type: "movie", ...base }
        ),
      { message: "unknown telegram group id: 999" }
    );
  });

  test("rejects non-objects", () => {
    assert.throws(() => validateLinkEntry(null, { type: "movie", ...base }), ValidationError);
  });
});

describe("createTmdbClient", () => {
  function withFetch(handler, fn) {
    const original = globalThis.fetch;
    globalThis.fetch = handler;
    return Promise.resolve(fn()).finally(() => {
      globalThis.fetch = original;
    });
  }

  function okResponse(body) {
    return { ok: true, status: 200, statusText: "OK", json: async () => body };
  }

  test("sends the api key as a query parameter and asks for es-ES", async () => {
    const urls = [];
    await withFetch(
      async (url, options) => {
        urls.push({ url: String(url), headers: options.headers });
        return okResponse({ id: 550 });
      },
      async () => {
        const client = createTmdbClient("plain-key");
        assert.deepEqual(await client.getMovie(550), { id: 550 });
      }
    );
    assert.equal(urls.length, 1);
    const url = new URL(urls[0].url);
    assert.equal(url.pathname, "/3/movie/550");
    assert.equal(url.searchParams.get("api_key"), "plain-key");
    assert.equal(url.searchParams.get("language"), "es-ES");
    assert.deepEqual(urls[0].headers, {});
  });

  test("sends a JWT-looking key as a bearer token", async () => {
    const urls = [];
    await withFetch(
      async (url, options) => {
        urls.push({ url: String(url), headers: options.headers });
        return okResponse({ id: 1396 });
      },
      async () => {
        const client = createTmdbClient("eyJhbGciOiJIUzI1NiJ9");
        await client.getTv(1396);
      }
    );
    assert.equal(urls[0].headers.Authorization, "Bearer eyJhbGciOiJIUzI1NiJ9");
    assert.equal(new URL(urls[0].url).searchParams.get("api_key"), null);
  });

  test("serves repeated lookups from the cache and fills it", async () => {
    const cache = {};
    let calls = 0;
    await withFetch(
      async () => {
        calls++;
        return okResponse({ id: 550 });
      },
      async () => {
        const client = createTmdbClient("plain-key", { cache });
        await client.getMovie(550);
        await client.getMovie(550);
      }
    );
    assert.equal(calls, 1);
    assert.deepEqual(cache, { "movie:550": { id: 550 } });
  });

  test("known limitation: cached values never expire", async () => {
    const cache = { "movie:550": { id: 550, title: "stale" } };
    await withFetch(
      async () => {
        throw new Error("should not reach the network");
      },
      async () => {
        const client = createTmdbClient("plain-key", { cache });
        assert.equal((await client.getMovie(550)).title, "stale");
      }
    );
  });

  test("throws a plain Error (not a ValidationError) on a failed response", async () => {
    await withFetch(
      async () => ({ ok: false, status: 404, statusText: "Not Found", json: async () => ({}) }),
      async () => {
        const client = createTmdbClient("plain-key");
        await assert.rejects(() => client.getMovie(1), (err) => {
          assert.equal(err instanceof ValidationError, false);
          assert.match(err.message, /TMDB \/movie\/1 failed: 404 Not Found/);
          return true;
        });
      }
    );
  });

  test("builds poster URLs", () => {
    const client = createTmdbClient("plain-key");
    assert.equal(client.posterUrl("/a.jpg"), "https://image.tmdb.org/t/p/w342/a.jpg");
    assert.equal(client.posterUrl(null), null);
  });
});

describe("resolveTmdbTarget", () => {
  test("passes through a descriptor that already has a type and id", async () => {
    const client = fakeTmdb();
    assert.deepEqual(
      await resolveTmdbTarget({ source: "url", type: "tv", id: 1396 }, client),
      { type: "tv", id: 1396 }
    );
    assert.deepEqual(client.calls, []);
  });

  test("resolves an IMDB id to a movie or a series", async () => {
    const client = fakeTmdb({
      find: {
        tt0137523: { movie_results: [{ id: 550 }], tv_results: [] },
        tt0903747: { movie_results: [], tv_results: [{ id: 1396 }] },
      },
    });
    assert.deepEqual(
      await resolveTmdbTarget({ source: "imdb", imdbId: "tt0137523" }, client),
      { type: "movie", id: 550 }
    );
    assert.deepEqual(
      await resolveTmdbTarget({ source: "imdb", imdbId: "tt0903747" }, client),
      { type: "tv", id: 1396 }
    );
  });

  test("prefers the movie result when TMDB returns both", async () => {
    const client = fakeTmdb({
      find: { tt1: { movie_results: [{ id: 1 }], tv_results: [{ id: 2 }] } },
    });
    assert.deepEqual(await resolveTmdbTarget({ source: "imdb", imdbId: "tt1" }, client), {
      type: "movie",
      id: 1,
    });
  });

  test("rejects an IMDB id with no results", async () => {
    const client = fakeTmdb();
    await assert.rejects(
      () => resolveTmdbTarget({ source: "imdb", imdbId: "tt9999999" }, client),
      ValidationError
    );
  });
});
