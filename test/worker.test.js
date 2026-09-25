import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../tools/tmdb-proxy/worker.js";
import { IMDB_ID_RE } from "../site/rules.js";

const PAGES = "https://christt105.github.io";
const BASE = "https://proxy.test";

function makeLimiter(success = true) {
  const calls = [];
  return {
    calls,
    async limit(options) {
      calls.push(options);
      return { success };
    },
  };
}

function makeEnv(overrides = {}) {
  return { TMDB_API_KEY: "dummy-key", RATE_LIMITER: makeLimiter(), ...overrides };
}

function makeCtx() {
  return { waitUntil() {} };
}

function call(path, { method = "GET", headers = {}, env = makeEnv() } = {}) {
  return worker.fetch(new Request(`${BASE}${path}`, { method, headers }), env, makeCtx());
}

let upstreamCalls;
let originalFetch;
let originalCaches;
let originalConsoleError;
let consoleErrors;

beforeEach(() => {
  upstreamCalls = [];
  originalFetch = globalThis.fetch;
  originalCaches = globalThis.caches;
  originalConsoleError = console.error;
  consoleErrors = [];
  console.error = (...args) => consoleErrors.push(args.join(" "));
  globalThis.fetch = async (url, init) => {
    upstreamCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: 550 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  globalThis.caches = {
    default: {
      async match() {
        return undefined;
      },
      async put() {},
    },
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalCaches === undefined) delete globalThis.caches;
  else globalThis.caches = originalCaches;
  console.error = originalConsoleError;
});

describe("origin checks", () => {
  test("an allowed Origin is served with its CORS header", async () => {
    const res = await call("/movie/550", { headers: { Origin: PAGES } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), PAGES);
    assert.deepEqual(await res.json(), { id: 550 });
    assert.equal(upstreamCalls.length, 1);
    assert.equal(new URL(upstreamCalls[0].url).pathname, "/3/movie/550");
  });

  test("a disallowed Origin is rejected with 403 and no CORS allow header", async () => {
    const res = await call("/movie/550", { headers: { Origin: "https://evil.example" } });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(upstreamCalls.length, 0);
  });

  test("a request without Origin and without Referer is rejected with 403", async () => {
    const res = await call("/movie/550");
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "origin not allowed" });
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(upstreamCalls.length, 0);
  });

  test("a request without Origin but with an allowed Referer is served", async () => {
    const res = await call("/movie/550", { headers: { Referer: `${PAGES}/cositeca/add.html` } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), PAGES);
  });

  test("a disallowed or malformed Referer is rejected", async () => {
    for (const referer of ["https://evil.example/page", "not a url"]) {
      const res = await call("/movie/550", { headers: { Referer: referer } });
      assert.equal(res.status, 403, referer);
    }
    assert.equal(upstreamCalls.length, 0);
  });

  test("a Referer with userinfo is judged by its real host", async () => {
    const res = await call("/movie/550", { headers: { Referer: `${PAGES}@evil.example/` } });
    assert.equal(res.status, 403);
    assert.equal(upstreamCalls.length, 0);
  });

  test("a disallowed Origin is not rescued by an allowed Referer", async () => {
    const res = await call("/movie/550", {
      headers: { Origin: "https://evil.example", Referer: `${PAGES}/cositeca/` },
    });
    assert.equal(res.status, 403);
  });

  test("the opaque null Origin is rejected", async () => {
    const res = await call("/movie/550", { headers: { Origin: "null" } });
    assert.equal(res.status, 403);
  });

  test("LAN and localhost dev origins are accepted", async () => {
    for (const origin of [
      "http://192.168.1.15:8098",
      "http://192.168.0.1",
      "http://localhost:1313",
      "http://127.0.0.1:8080",
    ]) {
      const res = await call("/movie/550", { headers: { Origin: origin } });
      assert.equal(res.status, 200, origin);
      assert.equal(res.headers.get("Access-Control-Allow-Origin"), origin);
    }
  });

  test("lookalike origins are rejected", async () => {
    for (const origin of [
      "http://192.168.1.1.evil.com",
      "http://192.168.1.1:80.evil.com",
      "https://192.168.1.15:8098",
      "http://192.168.1.999",
      "http://192.168.01.1",
      "http://10.0.0.1",
      "https://christt105.github.io.evil.com",
      "https://evilchristt105.github.io",
      "http://christt105.github.io",
      "https://christt105.github.io/",
      "http://localhost.evil.com",
    ]) {
      const res = await call("/movie/550", { headers: { Origin: origin } });
      assert.equal(res.status, 403, origin);
      assert.equal(res.headers.get("Access-Control-Allow-Origin"), null, origin);
    }
    assert.equal(upstreamCalls.length, 0);
  });
});

describe("methods", () => {
  test("OPTIONS preflight from an allowed origin returns 204 with CORS headers", async () => {
    const res = await call("/search", { method: "OPTIONS", headers: { Origin: PAGES } });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), PAGES);
    assert.match(res.headers.get("Access-Control-Allow-Methods"), /GET/);
  });

  test("OPTIONS preflight from a disallowed origin is rejected", async () => {
    const res = await call("/search", { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
  });

  test("non-GET methods are rejected with 405", async () => {
    const res = await call("/movie/550", { method: "POST", headers: { Origin: PAGES } });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), PAGES);
  });
});

describe("rate limiting", () => {
  test("a missing RATE_LIMITER binding fails closed with 503 and logs an error", async () => {
    const env = makeEnv();
    delete env.RATE_LIMITER;
    const res = await call("/movie/550", { headers: { Origin: PAGES }, env });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "rate limiter is not configured" });
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), PAGES);
    assert.equal(upstreamCalls.length, 0);
    assert.equal(consoleErrors.length, 1);
    assert.match(consoleErrors[0], /RATE_LIMITER/);
  });

  test("a rate-limited client gets 429 without reaching TMDB", async () => {
    const res = await call("/movie/550", {
      headers: { Origin: PAGES },
      env: makeEnv({ RATE_LIMITER: makeLimiter(false) }),
    });
    assert.equal(res.status, 429);
    assert.equal(upstreamCalls.length, 0);
  });

  test("the limiter is keyed by the client IP", async () => {
    const limiter = makeLimiter();
    await call("/movie/550", {
      headers: { Origin: PAGES, "CF-Connecting-IP": "203.0.113.7" },
      env: makeEnv({ RATE_LIMITER: limiter }),
    });
    assert.deepEqual(limiter.calls, [{ key: "203.0.113.7" }]);
  });
});

describe("cache", () => {
  test("a cached response gets the CORS header of the current requester", async () => {
    const cached = new Response(JSON.stringify({ id: 550 }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": PAGES },
    });
    globalThis.caches = {
      default: {
        async match() {
          return cached.clone();
        },
        async put() {},
      },
    };
    const origin = "http://localhost:1313";
    const res = await call("/movie/550", { headers: { Origin: origin } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), origin);
    assert.deepEqual(await res.json(), { id: 550 });
    assert.equal(upstreamCalls.length, 0);
  });

  test("a disallowed origin never reaches the cache", async () => {
    let lookups = 0;
    globalThis.caches = {
      default: {
        async match() {
          lookups += 1;
          return undefined;
        },
        async put() {},
      },
    };
    const res = await call("/movie/550", { headers: { Origin: "https://evil.example" } });
    assert.equal(res.status, 403);
    assert.equal(lookups, 0);
  });
});

describe("routes", () => {
  async function upstreamFor(path) {
    const res = await call(path, { headers: { Origin: PAGES } });
    assert.equal(res.status, 200, path);
    return new URL(upstreamCalls.at(-1).url);
  }

  test("search maps to TMDB search with Spanish language and the api key", async () => {
    const url = await upstreamFor("/search?q=fight%20club&type=movie&page=2");
    assert.equal(url.pathname, "/3/search/movie");
    assert.equal(url.searchParams.get("query"), "fight club");
    assert.equal(url.searchParams.get("page"), "2");
    assert.equal(url.searchParams.get("include_adult"), "false");
    assert.equal(url.searchParams.get("language"), "es-ES");
    assert.equal(url.searchParams.get("api_key"), "dummy-key");
  });

  test("a JWT-looking key is sent as a Bearer token instead of api_key", async () => {
    const res = await call("/tv/1399", {
      headers: { Origin: PAGES },
      env: makeEnv({ TMDB_API_KEY: "eyJdummy" }),
    });
    assert.equal(res.status, 200);
    const { url, init } = upstreamCalls[0];
    assert.equal(new URL(url).searchParams.get("api_key"), null);
    assert.equal(init.headers.Authorization, "Bearer eyJdummy");
  });

  test("images and find map to their TMDB endpoints", async () => {
    const images = await upstreamFor("/images?type=tv&id=1399");
    assert.equal(images.pathname, "/3/tv/1399/images");
    assert.equal(images.searchParams.get("language"), "");
    assert.equal(images.searchParams.has("include_image_language"), false);
    const find = await upstreamFor("/find/tt0137523");
    assert.equal(find.pathname, "/3/find/tt0137523");
    assert.equal(find.searchParams.get("external_source"), "imdb_id");
  });

  test("invalid paths and parameters return 404 without reaching TMDB", async () => {
    for (const path of [
      "/",
      "/movie/abc",
      "/movie/1234567890",
      "/person/1",
      "/search",
      `/search?q=${"a".repeat(201)}`,
      "/search?q=x&type=person",
      "/search?q=x&page=100",
      "/images?type=person&id=1",
      "/images?type=movie&id=x",
      "/find/nm0000093",
    ]) {
      const res = await call(path, { headers: { Origin: PAGES } });
      assert.equal(res.status, 404, path);
    }
    assert.equal(upstreamCalls.length, 0);
  });

  test("the find route accepts exactly the IMDb ids the site accepts", async () => {
    for (const id of ["tt1", "tt123456789012", "tt1234567890123", "tt", "ttx1"]) {
      const res = await call(`/find/${id}`, { headers: { Origin: PAGES } });
      assert.equal(res.status === 200, IMDB_ID_RE.test(id), id);
    }
  });

  test("a missing TMDB_API_KEY returns 500", async () => {
    const res = await call("/movie/550", {
      headers: { Origin: PAGES },
      env: makeEnv({ TMDB_API_KEY: undefined }),
    });
    assert.equal(res.status, 500);
    assert.equal(upstreamCalls.length, 0);
  });
});
