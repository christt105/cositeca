export const NEW_SITE = "https://cositalogo.christt105.workers.dev/";

/**
 * Where an old Cositeca address lands on the Cositálogo: title pages and the
 * search keep their place, "Añadir" goes to the new add view, and anything
 * else (batch queue, filters the new grid does not have) opens the grid.
 */
export function redirectTarget(hash) {
  const [path, query = ""] = (hash.startsWith("#/") ? hash.slice(2) : "").split("?");
  if (/^(movie|series)\/\d{1,9}$/.test(path)) return `${NEW_SITE}#/${path}`;
  if (path === "add") return `${NEW_SITE}#/add`;
  const q = path === "" ? new URLSearchParams(query).get("q")?.trim() : "";
  return q ? `${NEW_SITE}#/?q=${encodeURIComponent(q)}` : NEW_SITE;
}

if (typeof location !== "undefined") {
  location.replace(redirectTarget(location.hash));
}
