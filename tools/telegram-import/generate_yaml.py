import csv
import re
import subprocess
from collections import defaultdict
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
GROUP_ID = "2229558644"

SOURCES = [
    {"csv": "cache/movies_preview.csv", "kind": "movies", "topic": 2},
    {"csv": "cache/series_preview.csv", "kind": "series", "topic": 4},
    {"csv": "cache/movies4k_preview.csv", "kind": "movies", "topic": 16088},
]

BAD_STATUSES = {"no_results", "unparsed"}
VALID_QUALITIES = {"1080p", "4K"}

LINK_KEY_RE = re.compile(r"^https://t\.me/c/(\d+)/(?:\d+/)?(\d+)$")


class IndentDumper(yaml.Dumper):
    def increase_indent(self, flow=False, indentless=False):
        return super().increase_indent(flow, False)


def link_key(link):
    match = LINK_KEY_RE.match(link)
    return (match.group(1), match.group(2)) if match else link


def load_rows(source):
    path = Path(__file__).resolve().parent / source["csv"]
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            if row["status"] in BAD_STATUSES or row["status"].startswith("tmdb_error"):
                continue
            if not row.get("tmdb_id"):
                continue
            if row.get("quality") not in VALID_QUALITIES:
                continue
            yield row


def build_entry(row, source):
    entry = {}
    if source["kind"] == "series":
        season = row["season"]
        entry["season"] = int(season) if season.lstrip("-").isdigit() else season
    entry["quality"] = row["quality"]
    if row.get("audio"):
        entry["audio"] = [a for a in row["audio"].split(",") if a]
    if row.get("subs"):
        entry["subs"] = [s for s in row["subs"].split(",") if s]
    if row.get("tags"):
        entry["tags"] = [t for t in row["tags"].split(",") if t]
    entry["link"] = f"https://t.me/c/{GROUP_ID}/{source['topic']}/{row['id']}"
    entry["_title"] = row.get("tmdb_title") or row.get("title")
    return entry


def baseline(kind, tmdb_id):
    rel_path = f"{kind}/{tmdb_id}.yaml"
    result = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "show", f"HEAD:{rel_path}"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        return {"title": None, "links": []}
    return yaml.safe_load(result.stdout)


def dump(path, data):
    key_order = {
        "title": 0, "links": 1,
        "season": 0, "quality": 1, "audio": 2, "subs": 3, "tags": 4, "link": 5,
    }

    def sort_keys(d):
        return dict(sorted(d.items(), key=lambda kv: key_order.get(kv[0], 99)))

    ordered = {
        "title": data["title"],
        "links": [sort_keys(link) for link in data["links"]],
    }
    with open(path, "w") as f:
        yaml.dump(ordered, f, Dumper=IndentDumper, allow_unicode=True, sort_keys=False, default_flow_style=False)


def main():
    groups = defaultdict(list)
    for source in SOURCES:
        for row in load_rows(source):
            groups[(source["kind"], row["tmdb_id"])].append(build_entry(row, source))

    files_written, links_added, skipped_dupe = 0, 0, 0
    for (kind, tmdb_id), entries in groups.items():
        data = baseline(kind, tmdb_id)
        seen = {link_key(link["link"]) for link in data["links"]}
        title = data["title"]
        changed = False
        for entry in entries:
            key = link_key(entry["link"])
            if key in seen:
                skipped_dupe += 1
                continue
            seen.add(key)
            if title is None:
                title = entry["_title"]
            data["links"].append({k: v for k, v in entry.items() if k != "_title"})
            links_added += 1
            changed = True
        if changed:
            data["title"] = title
            path = REPO_ROOT / kind / f"{tmdb_id}.yaml"
            dump(path, data)
            files_written += 1

    print(f"files written: {files_written}, links added: {links_added}, already present: {skipped_dupe}")


if __name__ == "__main__":
    main()
