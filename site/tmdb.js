import { TMDB_PROXY_URL, resolveProxyUrl } from "./rules.js";

export const IMG = "https://image.tmdb.org/t/p";

let meta = null;

function proxyUrl() {
  return resolveProxyUrl(localStorage.getItem("tmdbProxy"), TMDB_PROXY_URL);
}

export function hasProxy() {
  return Boolean(proxyUrl());
}

export async function proxyGet(path) {
  const res = await fetch(`${proxyUrl()}${path}`);
  if (!res.ok) throw new Error(`proxy ${path} failed: ${res.status}`);
  return res.json();
}

export async function loadMeta() {
  if (meta) return meta;
  const res = await fetch("meta.json", { cache: "no-cache" });
  meta = await res.json();
  return meta;
}
