import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { load, dump } from "js-yaml";

const languages = load(readFileSync("languages.yaml", "utf8"));
const dryRun = process.argv.includes("--dry-run");
const keyOrder = ["season", "quality", "audio", "subs", "tags", "link"];

let changed = 0;
for (const dir of ["movies", "series"]) {
  for (const filename of readdirSync(dir)) {
    const path = `${dir}/${filename}`;
    const data = load(readFileSync(path, "utf8"));
    let touched = false;
    data.links = data.links.map((link) => {
      if (!Array.isArray(link.tags)) return link;
      const audio = link.tags.filter((t) => languages.audio.includes(t));
      if (audio.length === 0) return link;
      const tags = link.tags.filter((t) => !languages.audio.includes(t));
      const next = { ...link, audio: [...new Set([...(link.audio ?? []), ...audio])] };
      if (tags.length) next.tags = tags; else delete next.tags;
      touched = true;
      const ordered = {};
      for (const key of keyOrder) if (next[key] !== undefined) ordered[key] = next[key];
      return ordered;
    });
    if (!touched) continue;
    changed++;
    console.log(path);
    if (!dryRun) writeFileSync(path, dump(data));
  }
}
console.log(`${changed} file(s) ${dryRun ? "would change" : "changed"}`);
