const TMDB = "https://api.themoviedb.org/3";

const ALLOWED_ORIGINS = [
  /^https:\/\/christt105\.github\.io$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/,
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
    pattern: /^\/tv\/(\d{1,9})$/,
    ttl: 86400,
    build(match) {
      return { path: `/tv/${match[1]}`, query: {} };
    },
  },
];

function corsHeaders(origin) {
  const allowed = origin && ALLOWED_ORIGINS.some((re) => re.test(origin));
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://christt105.github.io",
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
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "GET") {
      return json({ error: "method not allowed" }, 405, cors);
    }
    if (origin && !ALLOWED_ORIGINS.some((re) => re.test(origin))) {
      return json({ error: "origin not allowed" }, 403, cors);
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

    if (env.RATE_LIMITER) {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) {
        return json({ error: "too many requests" }, 429, cors);
      }
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
