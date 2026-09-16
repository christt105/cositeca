import { readFileSync, readdirSync } from "node:fs";
import { load } from "js-yaml";
import { validateTitleFile, createTmdbClient } from "./lib.js";

const groups = load(readFileSync("groups.yaml", "utf8"));
const qualities = load(readFileSync("qualities.yaml", "utf8"));

const tmdbClient = process.env.TMDB_API_KEY
  ? createTmdbClient(process.env.TMDB_API_KEY)
  : null;

if (!tmdbClient) {
  console.warn("TMDB_API_KEY not set, skipping TMDB existence checks");
}

let errors = 0;
const seenLinks = new Map();

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
      validateTitleFile(type, filename, data, { qualities, groups });
      for (const entry of data.links) {
        const { link } = entry;
        if (seenLinks.has(link)) {
          throw new Error(`duplicate link, also used in ${seenLinks.get(link)}`);
        }
        seenLinks.set(link, path);
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

if (errors > 0) {
  console.error(`\n${errors} error(s) found`);
  process.exit(1);
}
console.log("validate: OK");
