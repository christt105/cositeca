import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import bot from "../tools/telegram-bot/worker.js";
import proxy from "../tools/tmdb-proxy/worker.js";

const CHAT_ID = 1234;
const WEBHOOK_SECRET = "webhook-secret";
const TOKEN = "shared-internal-token";

function makeKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key, type) {
      const value = store.get(key) ?? null;
      return type === "json" && value !== null ? JSON.parse(value) : value;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

function makeLimiter() {
  const calls = [];
  return {
    calls,
    async limit(options) {
      calls.push(options);
      return { success: true };
    },
  };
}

function makeProxyEnv(overrides = {}) {
  return { TMDB_API_KEY: "dummy-key", RATE_LIMITER: makeLimiter(), INTERNAL_TOKEN: TOKEN, ...overrides };
}

function makeBotEnv(proxyEnv, overrides = {}) {
  const proxyRequests = [];
  const session = { step: "AWAIT_TITLE", fields: {}, candidates: [], audioSelected: [], subsSelected: [] };
  return {
    proxyRequests,
    env: {
      TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
      TELEGRAM_BOT_TOKEN: "bot-token",
      INTERNAL_TOKEN: TOKEN,
      BOT_KV: makeKv({ [`auth:${CHAT_ID}`]: "1", [`session:${CHAT_ID}`]: JSON.stringify(session) }),
      TMDB_PROXY: {
        async fetch(input, init) {
          const request = new Request(input, init);
          proxyRequests.push(request);
          return proxy.fetch(request, proxyEnv, { waitUntil() {} });
        },
      },
      ...overrides,
    },
  };
}

function sendTitle(env, text) {
  return bot.fetch(
    new Request("https://bot.test/telegram-webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { chat: { id: CHAT_ID }, text } }),
    }),
    env,
  );
}

let telegramCalls;
let tmdbCalls;
let originalFetch;
let originalCaches;
let originalConsoleError;

beforeEach(() => {
  telegramCalls = [];
  tmdbCalls = [];
  originalFetch = globalThis.fetch;
  originalCaches = globalThis.caches;
  originalConsoleError = console.error;
  console.error = () => {};
  globalThis.fetch = async (url, init) => {
    const target = new URL(String(url));
    if (target.hostname === "api.telegram.org") {
      telegramCalls.push({ method: target.pathname.split("/").pop(), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true, result: {} }));
    }
    tmdbCalls.push(target);
    return new Response(
      JSON.stringify({ results: [{ media_type: "movie", id: 550, title: "El club de la lucha", release_date: "1999-10-15" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
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

describe("Telegram bot search through the TMDB proxy", () => {
  test("the bot sends the internal token and the proxy serves it without an Origin", async () => {
    const proxyEnv = makeProxyEnv();
    const { env, proxyRequests } = makeBotEnv(proxyEnv);
    const res = await sendTitle(env, "Fight Club");
    assert.equal(res.status, 200);

    assert.equal(proxyRequests.length, 1);
    const request = proxyRequests[0];
    assert.equal(request.headers.get("Origin"), null);
    assert.equal(request.headers.get("X-Internal-Token"), TOKEN);
    assert.equal(new URL(request.url).pathname, "/search");
    assert.equal(new URL(request.url).searchParams.get("q"), "Fight Club");

    assert.equal(tmdbCalls.length, 1);
    assert.equal(tmdbCalls[0].pathname, "/3/search/multi");
    assert.deepEqual(proxyEnv.RATE_LIMITER.calls, [{ key: "internal" }]);

    const reply = telegramCalls.find((c) => c.method === "sendMessage");
    assert.equal(reply.body.text, "¿Cuál de estos es?");
    assert.match(reply.body.reply_markup.inline_keyboard[0][0].text, /El club de la lucha \(1999\)/);
    const session = JSON.parse(env.BOT_KV.store.get(`session:${CHAT_ID}`));
    assert.equal(session.step, "AWAIT_TMDB_PICK");
  });

  test("without the token on the bot, the proxy rejects the search and no candidates are offered", async () => {
    const proxyEnv = makeProxyEnv();
    const { env, proxyRequests } = makeBotEnv(proxyEnv, { INTERNAL_TOKEN: undefined });
    await sendTitle(env, "Fight Club");
    assert.equal(proxyRequests[0].headers.get("X-Internal-Token"), null);
    assert.equal(tmdbCalls.length, 0);
    assert.equal(telegramCalls.length, 0);
    const session = JSON.parse(env.BOT_KV.store.get(`session:${CHAT_ID}`));
    assert.equal(session.step, "AWAIT_TITLE");
  });

  test("a mismatched token is rejected by the proxy", async () => {
    const proxyEnv = makeProxyEnv({ INTERNAL_TOKEN: "another-token" });
    const { env } = makeBotEnv(proxyEnv);
    await sendTitle(env, "Fight Club");
    assert.equal(tmdbCalls.length, 0);
    assert.equal(telegramCalls.length, 0);
  });
});
