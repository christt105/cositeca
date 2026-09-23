import { load } from "js-yaml";
import { TMDB_PROXY_URL } from "../../site/rules.js";
import {
  BotValidationError,
  buildIssueBody,
  buildLanguageKeyboard,
  buildSummary,
  formatCandidates,
  newSession,
  parseTelegramLink,
  toggleLanguage,
} from "./lib.js";

const REPO = "christt105/cositeca";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main`;
const CONFIG_CACHE_TTL = 3600;
const SESSION_TTL = 1800;
const ISSUE_MAP_TTL = 21600;

const WELCOME_UNAUTHED = "Hola, soy el bot para añadir pelis/series a Cositeca. Escribe la contraseña para empezar.";
const WELCOME_AUTHED = "Pégame el link del mensaje de Telegram con el archivo (usa 'Copiar enlace' en el mensaje).";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/telegram-webhook") {
      return handleTelegramWebhook(request, env);
    }
    if (request.method === "POST" && url.pathname === "/github-webhook") {
      return handleGithubWebhook(request, env);
    }
    return new Response("not found", { status: 404 });
  },
};

async function handleTelegramWebhook(request, env) {
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const update = await request.json();
  try {
    if (update.callback_query) {
      await handleCallback(env, update.callback_query);
    } else if (update.message) {
      await handleMessage(env, update.message);
    }
  } catch (err) {
    console.error(err);
  }
  return new Response("ok");
}

async function handleGithubWebhook(request, env) {
  const bodyText = await request.text();
  const signature = request.headers.get("X-Hub-Signature-256");
  if (!(await verifyGithubSignature(env.GITHUB_WEBHOOK_SECRET, bodyText, signature))) {
    return new Response("forbidden", { status: 403 });
  }
  if (request.headers.get("X-GitHub-Event") !== "issue_comment") {
    return new Response("ignored");
  }
  const payload = JSON.parse(bodyText);
  if (payload.action !== "created") return new Response("ignored");
  const issueNumber = payload.issue?.number;
  if (!issueNumber) return new Response("ignored");
  const chatId = await env.BOT_KV.get(`issue:${issueNumber}`);
  if (!chatId) return new Response("no session");
  await sendMessage(env, chatId, payload.comment.body);
  await env.BOT_KV.delete(`issue:${issueNumber}`);
  return new Response("ok");
}

async function verifyGithubSignature(secret, bodyText, signatureHeader) {
  if (!secret || !signatureHeader?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(bodyText));
  const expected = "sha256=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(expected, signatureHeader);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handleMessage(env, message) {
  const chatId = message.chat.id;
  const text = (message.text ?? message.caption ?? "").trim();
  const authed = await isAuthorized(env, chatId);

  if (text === "/start") {
    if (!authed) return sendMessage(env, chatId, WELCOME_UNAUTHED);
    await setSession(env, chatId, newSession());
    return sendMessage(env, chatId, WELCOME_AUTHED);
  }

  if (!authed) {
    if (text && text === env.BOT_PASSPHRASE) {
      await env.BOT_KV.put(`auth:${chatId}`, "1");
      await setSession(env, chatId, newSession());
      return sendMessage(env, chatId, `Contraseña correcta.\n\n${WELCOME_AUTHED}`);
    }
    return sendMessage(env, chatId, "Contraseña incorrecta. Escribe la contraseña para usar el bot.");
  }

  if (text === "/cancel") {
    await env.BOT_KV.delete(`session:${chatId}`);
    return sendMessage(env, chatId, "Cancelado. Escribe /start para empezar de nuevo.");
  }

  const session = (await getSession(env, chatId)) ?? newSession();
  switch (session.step) {
    case "AWAIT_LINK":
      return onLink(env, chatId, session, text);
    case "AWAIT_TITLE":
      return onTitle(env, chatId, session, text);
    case "AWAIT_SEASON":
      return onSeason(env, chatId, session, text);
    case "AWAIT_NEW_AUDIO":
      return onNewLanguage(env, chatId, session, text, "audio");
    case "AWAIT_NEW_SUBS":
      return onNewLanguage(env, chatId, session, text, "subs");
    case "AWAIT_TAGS":
      return onTags(env, chatId, session, text);
    case "AWAIT_POSTER":
      return onPoster(env, chatId, session, text);
    default:
      return sendMessage(env, chatId, "Usa los botones del mensaje anterior, o /cancel para empezar de nuevo.");
  }
}

async function handleCallback(env, cq) {
  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;
  if (!(await isAuthorized(env, chatId))) {
    return answerCallback(env, cq.id, "Primero escribe la contraseña.");
  }
  const session = (await getSession(env, chatId)) ?? newSession();
  const [prefix, value] = cq.data.split(/:(.+)/);

  if (prefix === "pick") return onPick(env, chatId, session, value, cq.id);
  if (prefix === "quality") return onQuality(env, chatId, session, value, cq.id);
  if (prefix === "a") return onLanguageCallback(env, chatId, messageId, session, "audio", value, cq.id);
  if (prefix === "s") return onLanguageCallback(env, chatId, messageId, session, "subs", value, cq.id);
  if (prefix === "tags" && value === "skip") return onTags(env, chatId, session, "", cq.id);
  if (prefix === "poster" && value === "skip") return onPoster(env, chatId, session, "", cq.id);
  if (prefix === "confirm") return onConfirm(env, chatId, session, value, cq.id);
  return answerCallback(env, cq.id);
}

async function onLink(env, chatId, session, text) {
  const groups = await getConfig(env, "groups.yaml");
  let link;
  try {
    link = parseTelegramLink(text, groups);
  } catch (err) {
    if (err instanceof BotValidationError) return sendMessage(env, chatId, err.message);
    throw err;
  }
  session.fields.link = link;
  session.step = "AWAIT_TITLE";
  await setSession(env, chatId, session);
  await sendMessage(env, chatId, "¿Cómo se llama la película o serie?");
}

async function onTitle(env, chatId, session, text) {
  if (!text) return sendMessage(env, chatId, "Escríbeme el título para buscarlo en TMDB.");
  const results = await searchTmdb(env, text);
  const candidates = formatCandidates(results);
  if (!candidates.length) {
    return sendMessage(env, chatId, "No he encontrado nada en TMDB con ese título. Prueba con otro nombre.");
  }
  session.candidates = candidates;
  session.step = "AWAIT_TMDB_PICK";
  await setSession(env, chatId, session);
  const keyboard = candidates.map((c) => [{ text: c.label, callback_data: `pick:${c.idx}` }]);
  keyboard.push([{ text: "🔍 Buscar otra vez", callback_data: "pick:retry" }]);
  await sendMessage(env, chatId, "¿Cuál de estos es?", keyboard);
}

async function onPick(env, chatId, session, value, callbackId) {
  if (value === "retry") {
    session.step = "AWAIT_TITLE";
    await setSession(env, chatId, session);
    await answerCallback(env, callbackId);
    return sendMessage(env, chatId, "Vale, ¿cómo se llama?");
  }
  const candidate = session.candidates[Number(value)];
  if (!candidate) return answerCallback(env, callbackId, "Opción no válida");

  session.fields.tmdb = candidate.url;
  session.type = candidate.type;
  session.title = candidate.title;
  await answerCallback(env, callbackId, `Elegido: ${candidate.title}`);

  if (candidate.type === "tv") {
    session.step = "AWAIT_SEASON";
    await setSession(env, chatId, session);
    return sendMessage(env, chatId, "¿Qué temporada? Escribe un número (0 para especiales), o 'all' para la serie completa.");
  }
  session.step = "AWAIT_QUALITY";
  await setSession(env, chatId, session);
  return sendQualityStep(env, chatId);
}

async function onSeason(env, chatId, session, text) {
  const value = text.trim();
  if (value !== "all" && !/^\d+$/.test(value)) {
    return sendMessage(env, chatId, "La temporada tiene que ser un número (0 para especiales) o 'all'.");
  }
  session.fields.season = value;
  session.step = "AWAIT_QUALITY";
  await setSession(env, chatId, session);
  return sendQualityStep(env, chatId);
}

async function sendQualityStep(env, chatId) {
  const qualities = await getConfig(env, "qualities.yaml");
  const keyboard = [qualities.map((q) => ({ text: q, callback_data: `quality:${q}` }))];
  await sendMessage(env, chatId, "¿Qué calidad?", keyboard);
}

async function onQuality(env, chatId, session, value, callbackId) {
  session.fields.quality = value;
  session.step = "AWAIT_AUDIO";
  await setSession(env, chatId, session);
  await answerCallback(env, callbackId, value);
  return sendLanguageStep(env, chatId, session, "audio");
}

async function sendLanguageStep(env, chatId, session, kind) {
  const languages = await getConfig(env, "languages.yaml");
  const options = languages[kind];
  const selected = kind === "audio" ? session.audioSelected : session.subsSelected;
  const keyboard = buildLanguageKeyboard(options, selected, kind);
  const prompt = kind === "audio" ? "¿Audio? (puedes elegir varios)" : "¿Subtítulos? (puedes elegir varios)";
  await sendMessage(env, chatId, prompt, keyboard);
}

async function editLanguageStep(env, chatId, messageId, session, kind) {
  const languages = await getConfig(env, "languages.yaml");
  const options = languages[kind];
  const selected = kind === "audio" ? session.audioSelected : session.subsSelected;
  const keyboard = buildLanguageKeyboard(options, selected, kind);
  await tg(env, "editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function onLanguageCallback(env, chatId, messageId, session, kind, value, callbackId) {
  const stepField = kind === "audio" ? "audioSelected" : "subsSelected";
  const newStep = kind === "audio" ? "AWAIT_NEW_AUDIO" : "AWAIT_NEW_SUBS";
  const fieldName = kind === "audio" ? "audio" : "subs";
  const nextKind = kind === "audio" ? "subs" : null;

  if (value === "new") {
    session.step = newStep;
    await setSession(env, chatId, session);
    await answerCallback(env, callbackId);
    return sendMessage(env, chatId, `Escribe el nombre del idioma de ${kind === "audio" ? "audio" : "subtítulos"} nuevo.`);
  }

  if (value === "done") {
    session.fields[fieldName] = session[stepField].join(", ");
    await answerCallback(env, callbackId);
    if (nextKind) {
      session.step = "AWAIT_SUBS";
      await setSession(env, chatId, session);
      return sendLanguageStep(env, chatId, session, nextKind);
    }
    session.step = "AWAIT_TAGS";
    await setSession(env, chatId, session);
    return sendTagsStep(env, chatId);
  }

  session[stepField] = toggleLanguage(session[stepField], value);
  await setSession(env, chatId, session);
  await answerCallback(env, callbackId);
  return editLanguageStep(env, chatId, messageId, session, kind);
}

async function onNewLanguage(env, chatId, session, text, kind) {
  const value = text.trim();
  if (!value) return sendMessage(env, chatId, "Escribe el nombre del idioma.");
  session.fields[kind === "audio" ? "new_audio_language" : "new_subs_language"] = value;
  session.step = kind === "audio" ? "AWAIT_AUDIO" : "AWAIT_SUBS";
  await setSession(env, chatId, session);
  return sendLanguageStep(env, chatId, session, kind);
}

function sendTagsStep(env, chatId) {
  return sendMessage(env, chatId, "¿Etiquetas? Sepáralas por comas, o pulsa Saltar.", [
    [{ text: "Saltar", callback_data: "tags:skip" }],
  ]);
}

async function onTags(env, chatId, session, text, callbackId) {
  session.fields.tags = text.trim();
  session.step = "AWAIT_POSTER";
  await setSession(env, chatId, session);
  if (callbackId) await answerCallback(env, callbackId);
  return sendPosterStep(env, chatId);
}

function sendPosterStep(env, chatId) {
  return sendMessage(env, chatId, "¿Portada distinta a la de TMDB? Pega la URL, o pulsa Saltar.", [
    [{ text: "Saltar", callback_data: "poster:skip" }],
  ]);
}

async function onPoster(env, chatId, session, text, callbackId) {
  session.fields.poster = text.trim();
  session.step = "AWAIT_CONFIRM";
  await setSession(env, chatId, session);
  if (callbackId) await answerCallback(env, callbackId);
  return sendMessage(env, chatId, buildSummary(session), [
    [
      { text: "✅ Confirmar", callback_data: "confirm:yes" },
      { text: "❌ Cancelar", callback_data: "confirm:no" },
    ],
  ]);
}

async function onConfirm(env, chatId, session, value, callbackId) {
  await answerCallback(env, callbackId);
  if (value !== "yes") {
    await env.BOT_KV.delete(`session:${chatId}`);
    return sendMessage(env, chatId, "Cancelado. Escribe /start para empezar de nuevo.");
  }
  try {
    const issue = await createGithubIssue(env, {
      title: `[add] ${session.title}`,
      body: buildIssueBody(session.fields),
    });
    await env.BOT_KV.put(`issue:${issue.number}`, String(chatId), { expirationTtl: ISSUE_MAP_TTL });
    await env.BOT_KV.delete(`session:${chatId}`);
    await sendMessage(env, chatId, `Creado: ${issue.html_url}\nEn un par de minutos te aviso si se ha añadido bien.`);
  } catch (err) {
    console.error(err);
    await sendMessage(env, chatId, "No he podido crear el issue en GitHub, avisa a Christian.");
  }
}

async function searchTmdb(env, query) {
  const url = new URL(`${TMDB_PROXY_URL}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("type", "multi");
  const res = await env.TMDB_PROXY.fetch(url);
  if (!res.ok) {
    throw new Error(`TMDB proxy search failed: ${res.status}`);
  }
  const data = await res.json();
  return data.results ?? [];
}

async function createGithubIssue(env, { title, body }) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "User-Agent": "cositeca-telegram-bot",
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, body, labels: ["entry", "add"] }),
  });
  if (!res.ok) {
    throw new Error(`GitHub issue creation failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function getConfig(env, filename) {
  const cacheKey = `cache:${filename}`;
  const cached = await env.BOT_KV.get(cacheKey, "json");
  if (cached) return cached;
  const res = await fetch(`${RAW_BASE}/${filename}`);
  if (!res.ok) throw new Error(`failed to fetch ${filename}: ${res.status}`);
  const parsed = load(await res.text());
  await env.BOT_KV.put(cacheKey, JSON.stringify(parsed), { expirationTtl: CONFIG_CACHE_TTL });
  return parsed;
}

async function getSession(env, chatId) {
  return env.BOT_KV.get(`session:${chatId}`, "json");
}

async function setSession(env, chatId, session) {
  await env.BOT_KV.put(`session:${chatId}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
}

async function isAuthorized(env, chatId) {
  return (await env.BOT_KV.get(`auth:${chatId}`)) === "1";
}

async function tg(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function sendMessage(env, chatId, text, keyboard) {
  return tg(env, "sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });
}

function answerCallback(env, callbackQueryId, text) {
  return tg(env, "answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}
