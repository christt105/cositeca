import { readFileSync, readdirSync } from "node:fs";
import { load } from "js-yaml";
import {
  validateTitleFile,
  createTmdbClient,
  loadTmdbCache,
  saveTmdbCache,
  createLinkIndex,
} from "./lib.js";
import { findIndistinguishableVersions } from "../site/rules.js";

const groups = load(readFileSync("groups.yaml", "utf8"));
const qualities = load(readFileSync("qualities.yaml", "utf8"));
const languages = load(readFileSync("languages.yaml", "utf8"));

const cachePath = process.env.TMDB_CACHE_PATH ?? ".cache/tmdb.json";
const tmdbCache = loadTmdbCache(cachePath);
const tmdbClient = process.env.TMDB_API_KEY
  ? createTmdbClient(process.env.TMDB_API_KEY, { cache: tmdbCache })
  : null;

if (!tmdbClient) {
  console.warn("TMDB_API_KEY not set, skipping TMDB existence checks");
}

let errors = 0;
let warnings = 0;
const linkIndex = createLinkIndex();

for (const type of ["movies", "series"]) {
  let filenames;
  try {
    filenames = readdirSync(type);
  } catch {
    continue;
  }
  for (const filename of filenames) {
    const path = `${type}/${filename}`;
    try {
      const data = load(readFileSync(path, "utf8"));
      validateTitleFile(type, filename, data, { qualities, groups, languages });
      for (const entry of data.links) {
        const earlier = linkIndex.add(entry.link, path);
        if (earlier !== undefined) {
          throw new Error(`duplicate link, also used in ${earlier}`);
        }
      }
      for (const group of findIndistinguishableVersions(data.links)) {
        const links = group.map((entry) => entry.link).join(", ");
        console.warn(`${path}: indistinguishable versions: ${links}`);
        warnings++;
      }
      if (tmdbClient) {
        const tmdbType = type === "movies" ? "movie" : "tv";
        const id = filename.replace(/\.yaml$/, "");
        try {
          if (tmdbType === "movie") {
            await tmdbClient.getMovie(id);
          } else {
            await tmdbClient.getTv(id);
          }
        } catch (err) {
          throw new Error(`TMDB lookup failed: ${err.message}`);
        }
      }
    } catch (err) {
      console.error(`${path}: ${err.message}`);
      errors++;
    }
  }
}

if (tmdbClient) {
  saveTmdbCache(cachePath, tmdbCache);
}

if (warnings > 0) {
  console.warn(`\n${warnings} indistinguishable version group(s) found`);
}

if (errors > 0) {
  console.error(`\n${errors} error(s) found`);
  process.exit(1);
}
console.log("validate: OK");
