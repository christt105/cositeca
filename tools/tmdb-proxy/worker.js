const TMDB = "https://api.themoviedb.org/3";

const ALLOWED_ORIGINS = [
  /^https:\/\/christt105\.github\.io$/,
  /^https?:\/\/localhost(:\d{1,5})?$/,
  /^https?:\/\/127\.0\.0\.1(:\d{1,5})?$/,
  /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d{1,5})?$/,
];

const ROUTES = [
  {
    pattern: /^\/search$/,
    ttl: 3600,
    build(_, params) {
      const q = params.get("q")?.trim();
      if (!q || q.length > 200) return null;
      const type = params.get("type") ?? "multi";
      if (!["movie", "tv", "multi"].includes(type)) return null;
      const page = params.get("page") ?? "1";
      if (!/^\d{1,2}$/.test(page)) return null;
      return { path: `/search/${type}`, query: { query: q, page, include_adult: "false" } };
    },
  },
  {
    pattern: /^\/images$/,
    ttl: 86400,
    build(_, params) {
      const type = params.get("type");
      const id = params.get("id");
      if (!["movie", "tv"].includes(type) || !/^\d{1,9}$/.test(id ?? "")) return null;
      return { path: `/${type}/${id}/images`, query: { include_image_language: "es,en,null" } };
    },
  },
  {
    pattern: /^\/(movie|tv)\/(\d{1,9})$/,
    ttl: 86400,
    build(match) {
      return { path: `/${match[1]}/${match[2]}`, query: {} };
    },
  },
  {
    pattern: /^\/find\/(tt\d{1,12})$/,
    ttl: 86400,
    build(match) {
      return { path: `/find/${match[1]}`, query: { external_source: "imdb_id" } };
    },
  },
];

function parseOrigin(value) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isAllowedOrigin(origin) {
  return Boolean(origin) && parseOrigin(origin) === origin && ALLOWED_ORIGINS.some((re) => re.test(origin));
}

/** The caller's origin: the Origin header, or the origin of the Referer when Origin is absent. */
function requestOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin !== null) return origin;
  return parseOrigin(request.headers.get("Referer"));
}

/** Compares two strings without returning early on the first differing character. */
function safeEqual(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) {
    diff |= x[i] ^ (y[i] ?? 0);
  }
  return diff === 0;
}

/** True when the request carries the shared INTERNAL_TOKEN (sent by the Telegram bot over its service binding). */
function isInternalRequest(request, env) {
  const expected = env.INTERNAL_TOKEN;
  const provided = request.headers.get("X-Internal-Token");
  if (!expected || !provided) return false;
  return safeEqual(provided, expected);
}

function corsHeaders(origin) {
  if (!isAllowedOrigin(origin)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

export default {
  async fetch(request, env, ctx) {
    const internal = isInternalRequest(request, env);
    const origin = requestOrigin(request);
    const cors = corsHeaders(origin);

    if (!internal && !isAllowedOrigin(origin)) {
      return json({ error: "origin not allowed" }, 403, cors);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "GET") {
      return json({ error: "method not allowed" }, 405, cors);
    }

    const url = new URL(request.url);
    let target = null;
    let ttl = 0;
    for (const route of ROUTES) {
      const match = route.pattern.exec(url.pathname);
      if (!match) continue;
      target = route.build(match, url.searchParams);
      ttl = route.ttl;
      break;
    }
    if (!target) {
      return json({ error: "not found" }, 404, cors);
    }
    if (!env.TMDB_API_KEY) {
      return json({ error: "TMDB_API_KEY secret is not set" }, 500, cors);
    }

    if (!env.RATE_LIMITER) {
      console.error("RATE_LIMITER binding is missing; refusing to serve unlimited requests");
      return json({ error: "rate limiter is not configured" }, 503, cors);
    }
    const key = internal ? "internal" : (request.headers.get("CF-Connecting-IP") ?? "unknown");
    const { success } = await env.RATE_LIMITER.limit({ key });
    if (!success) {
      return json({ error: "too many requests" }, 429, cors);
    }

    const upstream = new URL(`${TMDB}${target.path}`);
    upstream.searchParams.set("language", "es-ES");
    for (const [key, value] of Object.entries(target.query)) {
      upstream.searchParams.set(key, value);
    }

    const cache = caches.default;
    const cacheKey = new Request(upstream.toString(), { method: "GET" });
    let response = await cache.match(cacheKey);
    if (!response) {
      const headers = {};
      if (env.TMDB_API_KEY.startsWith("eyJ")) {
        headers.Authorization = `Bearer ${env.TMDB_API_KEY}`;
      } else {
        upstream.searchParams.set("api_key", env.TMDB_API_KEY);
      }
      const tmdbRes = await fetch(upstream, { headers });
      response = new Response(tmdbRes.body, {
        status: tmdbRes.status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": tmdbRes.ok ? `public, max-age=${ttl}` : "no-store",
        },
      });
      if (tmdbRes.ok) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }
    }

    const out = new Response(response.body, response);
    for (const [key, value] of Object.entries(cors)) {
      out.headers.set(key, value);
    }
    return out;
  },
};
