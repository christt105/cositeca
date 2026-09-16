import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { load } from "js-yaml";
import { parseTelegramLink, createTmdbClient } from "./lib.js";

const groups = load(readFileSync("groups.yaml", "utf8"));
const qualities = load(readFileSync("qualities.yaml", "utf8"));

const apiKey = process.env.TMDB_API_KEY;
if (!apiKey) {
  console.error("TMDB_API_KEY is required to build");
  process.exit(1);
}
const tmdb = createTmdbClient(apiKey);

const seasonNameOverrides = { all: "Serie completa" };

async function buildMovieEntry(id, data) {
  const info = await tmdb.getMovie(id);
  const links = data.links.map((entry) => {
    const { groupId } = parseTelegramLink(entry.link);
    return {
      quality: entry.quality,
      tags: entry.tags ?? [],
      group: groups[groupId],
      link: entry.link,
    };
  });
  return {
    type: "movie",
    tmdb: info.id,
    imdb: info.imdb_id ?? null,
    title: info.title,
    originalTitle: info.original_title,
    year: info.release_date ? info.release_date.slice(0, 4) : null,
    poster: tmdb.posterUrl(info.poster_path),
    qualities: dedupeQualities(links.map((l) => l.quality)),
    links,
  };
}

async function buildSeriesEntry(id, data) {
  const info = await tmdb.getTv(id);
  const externalIds = await tmdb.getTvExternalIds(id);
  const seasonCache = new Map();

  async function seasonInfo(season) {
    if (season === "all") {
      return { name: seasonNameOverrides.all, poster: tmdb.posterUrl(info.poster_path) };
    }
    if (seasonCache.has(season)) return seasonCache.get(season);
    const data = await tmdb.getTvSeason(id, season);
    const result = {
      name: data.name,
      poster: tmdb.posterUrl(data.poster_path) ?? tmdb.posterUrl(info.poster_path),
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
      tags: entry.tags ?? [],
      group: groups[groupId],
      link: entry.link,
    });
  }

  return {
    type: "series",
    tmdb: info.id,
    imdb: externalIds.imdb_id ?? null,
    title: info.name,
    originalTitle: info.original_name,
    year: info.first_air_date ? info.first_air_date.slice(0, 4) : null,
    poster: tmdb.posterUrl(info.poster_path),
    qualities: dedupeQualities(links.map((l) => l.quality)),
    links,
  };
}

function dedupeQualities(list) {
  const set = new Set(list);
  return qualities.filter((q) => set.has(q));
}

async function main() {
  const catalog = [];
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
      const data = load(readFileSync(`${type}/${filename}`, "utf8"));
      try {
        catalog.push(await builder(id, data));
      } catch (err) {
        console.warn(`skipping ${type}/${filename}: ${err.message}`);
      }
    }
  }
  catalog.sort((a, b) => a.title.localeCompare(b.title, "es"));
  mkdirSync("site", { recursive: true });
  writeFileSync("site/catalog.json", JSON.stringify(catalog, null, 2));
  console.log(`build: wrote ${catalog.length} titles to site/catalog.json`);
}

await main();
