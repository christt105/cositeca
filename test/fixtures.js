import { dump } from "js-yaml";

export const GROUP_ID = "2229558644";
export const OTHER_GROUP_ID = "2142474284";

export function link(messageId, topicId) {
  return topicId
    ? `https://t.me/c/${GROUP_ID}/${topicId}/${messageId}`
    : `https://t.me/c/${GROUP_ID}/${messageId}`;
}

export function config() {
  return {
    qualities: ["1080p", "4K"],
    groups: { [GROUP_ID]: "Grupo 1", [OTHER_GROUP_ID]: "Grupo 2" },
    languages: {
      audio: ["Castellano", "Latino", "Inglés"],
      subs: ["Castellano", "Inglés", "Forzados"],
    },
  };
}

export function yaml(data) {
  return dump(data);
}

export function fakeFs(files = {}) {
  const store = new Map(Object.entries(files));
  return {
    store,
    fileExists: (path) => store.has(path),
    readFile: (path) => {
      if (!store.has(path)) throw new Error(`ENOENT: ${path}`);
      return store.get(path);
    },
    readdir: (dir) => {
      const names = [...store.keys()]
        .filter((path) => path.startsWith(`${dir}/`))
        .map((path) => path.slice(dir.length + 1));
      if (names.length === 0) throw new Error(`ENOENT: ${dir}`);
      return names;
    },
  };
}

export function fakeTmdb({ movies = {}, tv = {}, find = {} } = {}) {
  const calls = [];
  function lookup(kind, table, id) {
    calls.push(`${kind}:${id}`);
    const info = table[id];
    if (!info) throw new Error(`TMDB /${kind}/${id} failed: 404 Not Found`);
    return info;
  }
  return {
    calls,
    getMovie: async (id) => lookup("movie", movies, id),
    getTv: async (id) => lookup("tv", tv, id),
    getTvExternalIds: async (id) => ({ imdb_id: tv[id]?.imdb_id ?? null }),
    findByImdb: async (imdbId) => {
      calls.push(`find:${imdbId}`);
      return find[imdbId] ?? { movie_results: [], tv_results: [] };
    },
    posterUrl: (path) => (path ? `https://image.tmdb.org/t/p/w342${path}` : null),
  };
}

export const MOVIE_INFO = { id: 550, title: "El club de la lucha", poster_path: "/a.jpg" };
export const TV_INFO = { id: 1396, name: "Breaking Bad", poster_path: "/b.jpg" };
