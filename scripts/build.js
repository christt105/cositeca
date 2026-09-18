import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { load } from "js-yaml";
import {
  parseTelegramLink,
  createTmdbClient,
  loadTmdbCache,
  saveTmdbCache,
} from "./lib.js";

const groups = load(readFileSync("groups.yaml", "utf8"));
const qualities = load(readFileSync("qualities.yaml", "utf8"));
const languages = load(readFileSync("languages.yaml", "utf8"));

const apiKey = process.env.TMDB_API_KEY;
if (!apiKey) {
  console.error("TMDB_API_KEY is required to build");
  process.exit(1);
}
const cachePath = process.env.TMDB_CACHE_PATH ?? ".cache/tmdb.json";
const tmdbCache = loadTmdbCache(cachePath);
const tmdb = createTmdbClient(apiKey, { cache: tmdbCache });

const seasonNameOverrides = { all: "Serie completa" };

function backdropUrl(path) {
  return path ? `https://image.tmdb.org/t/p/w780${path}` : null;
}

function baseDetail(info) {
  return {
    overview: info.overview || "",
    tagline: info.tagline || "",
    genres: (info.genres ?? []).map((g) => g.name),
    backdrop: backdropUrl(info.backdrop_path),
    voteAverage: info.vote_average ?? null,
  };
}

async function buildMovieEntry(id, data) {
  const info = await tmdb.getMovie(id);
  const links = data.links.map((entry) => {
    const { groupId } = parseTelegramLink(entry.link);
    return {
      quality: entry.quality,
      audio: entry.audio ?? [],
      subs: entry.subs ?? [],
      tags: entry.tags ?? [],
      group: groups[groupId],
      link: entry.link,
    };
  });
  const entry = {
    type: "movie",
    tmdb: info.id,
    imdb: info.imdb_id ?? null,
    title: info.title,
    originalTitle: info.original_title,
    year: info.release_date ? info.release_date.slice(0, 4) : null,
    poster: data.poster ?? tmdb.posterUrl(info.poster_path),
    qualities: dedupeQualities(links.map((l) => l.quality)),
    links,
  };
  const detail = { ...baseDetail(info), runtime: info.runtime || null };
  return { entry, detail };
}

async function buildSeriesEntry(id, data) {
  const info = await tmdb.getTv(id);
  const externalIds = await tmdb.getTvExternalIds(id);
  const seasonCache = new Map();
  const seriesPoster = data.poster ?? tmdb.posterUrl(info.poster_path);

  async function seasonInfo(season) {
    if (season === "all") {
      return { name: seasonNameOverrides.all, poster: seriesPoster };
    }
    if (seasonCache.has(season)) return seasonCache.get(season);
    const seasonData = await tmdb.getTvSeason(id, season);
    const result = {
      name: seasonData.name,
      poster: tmdb.posterUrl(seasonData.poster_path) ?? seriesPoster,
      episodeCount: seasonData.episodes?.length ?? null,
      airDate: seasonData.air_date || null,
    };
    seasonCache.set(season, result);
    return result;
  }

  const links = [];
  for (const entry of data.links) {
    const { groupId } = parseTelegramLink(entry.link);
    const { name, poster } = await seasonInfo(entry.season);
    links.push({
      season: entry.season,
      seasonName: name,
      seasonPoster: poster,
      quality: entry.quality,
      audio: entry.audio ?? [],
      subs: entry.subs ?? [],
      tags: entry.tags ?? [],
      group: groups[groupId],
      link: entry.link,
    });
  }

  const entry = {
    type: "series",
    tmdb: info.id,
    imdb: externalIds.imdb_id ?? null,
    title: info.name,
    originalTitle: info.original_name,
    year: info.first_air_date ? info.first_air_date.slice(0, 4) : null,
    poster: seriesPoster,
    qualities: dedupeQualities(links.map((l) => l.quality)),
    links,
  };
  const seasons = {};
  for (const [season, { episodeCount, airDate }] of seasonCache) {
    seasons[season] = { episodeCount, airDate };
  }
  const detail = {
    ...baseDetail(info),
    numberOfSeasons: info.number_of_seasons ?? null,
    seasons,
  };
  return { entry, detail };
}

function dedupeQualities(list) {
  const set = new Set(list);
  return qualities.filter((q) => set.has(q));
}

function getAddedTimestamps() {
  const output = execFileSync(
    "git",
    ["log", "--no-renames", "--diff-filter=A", "--name-only", "--format=%x00%at"],
    { maxBuffer: 1024 * 1024 * 200 }
  ).toString();
  const timestamps = new Map();
  let currentTimestamp = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("\0")) {
      currentTimestamp = Number(line.slice(1));
    } else if (line.trim() && currentTimestamp !== null) {
      // git log walks newest to oldest, so the last write for a given path
      // (from the oldest commit that added it) is the one that sticks.
      timestamps.set(line, currentTimestamp);
    }
  }
  return timestamps;
}

async function main() {
  const addedTimestamps = getAddedTimestamps();
  const now = Math.floor(Date.now() / 1000);
  const entries = [];
  for (const [type, builder] of [
    ["movies", buildMovieEntry],
    ["series", buildSeriesEntry],
  ]) {
    let filenames;
    try {
      filenames = readdirSync(type);
    } catch {
      continue;
    }
    for (const filename of filenames) {
      const id = filename.replace(/\.yaml$/, "");
      const path = `${type}/${filename}`;
      const data = load(readFileSync(path, "utf8"));
      try {
        const { entry, detail } = await builder(id, data);
        entries.push({ entry, detail, addedAt: addedTimestamps.get(path) ?? now });
      } catch (err) {
        console.warn(`skipping ${path}: ${err.message}`);
      }
    }
  }
  entries.sort((a, b) => {
    if (a.addedAt !== b.addedAt) return b.addedAt - a.addedAt;
    return a.entry.title.localeCompare(b.entry.title, "es");
  });
  const catalog = entries.map((e) => e.entry);
  rmSync("site/titles", { recursive: true, force: true });
  mkdirSync("site/titles", { recursive: true });
  for (const { entry, detail } of entries) {
    writeFileSync(
      `site/titles/${entry.type}-${entry.tmdb}.json`,
      JSON.stringify(detail)
    );
  }
  writeFileSync("site/catalog.json", JSON.stringify(catalog));
  writeFileSync("site/meta.json", JSON.stringify({ qualities, languages, groups }));
  saveTmdbCache(cachePath, tmdbCache);
  console.log(
    `build: wrote ${catalog.length} titles to site/catalog.json, site/meta.json and site/titles/`
  );
}

await main();
