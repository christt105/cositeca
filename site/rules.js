export const TELEGRAM_LINK_RE = /^https:\/\/t\.me\/c\/(\d+)\/(?:(\d+)\/)?(\d+)$/;
export const TMDB_URL_RE = /^https?:\/\/(?:www\.)?themoviedb\.org\/(movie|tv)\/(\d+)(?:-.*)?$/;
export const TMDB_ID_RE = /^tmdb:(\d+)$/;
export const IMDB_ID_RE = /^tt\d+$/;

export const REPO_URL = "https://github.com/christt105/cositeca";
export const TMDB_PROXY_URL = "";

export function tmdbUrl(type, id) {
  const kind = type === "movie" ? "movie" : "tv";
  return `https://www.themoviedb.org/${kind}/${id}`;
}

export function imdbUrl(imdbId) {
  return `https://www.imdb.com/title/${imdbId}/`;
}

export function issueUrl(template, params = {}) {
  const url = new URL(`${REPO_URL}/issues/new`);
  url.searchParams.set("template", template);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}
