import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { load, dump } from "js-yaml";

/** Reads groups.yaml, qualities.yaml and languages.yaml from the repo root. */
export function loadConfig(root) {
  const read = (name) => load(readFileSync(join(root, name), "utf8"));
  return {
    groups: read("groups.yaml"),
    qualities: read("qualities.yaml"),
    languages: read("languages.yaml"),
  };
}

/** Writes the languages back to languages.yaml in the repo root. */
export function saveLanguages(root, languages) {
  writeFileSync(join(root, "languages.yaml"), dump(languages));
}
