import csv
import sys

import yaml

from generate_yaml import REPO_ROOT, link_key

CORRECTIONS_HEADER = ["kind", "old_tmdb_id", "link", "new_kind", "new_tmdb_id", "season"]


def links_in(kind, tmdb_id):
    path = REPO_ROOT / kind / f"{tmdb_id}.yaml"
    if not path.exists():
        return set()
    return {link_key(entry["link"]) for entry in yaml.safe_load(path.read_text())["links"]}


def is_applied(row):
    key = link_key(row["link"])
    return key not in links_in(row["kind"], row["old_tmdb_id"]) and key in links_in(
        row["new_kind"], row["new_tmdb_id"]
    )


def main(corrections_path, suspects_path):
    with open(corrections_path, newline="") as f:
        corrections = list(csv.DictReader(f))
    applied = [row for row in corrections if is_applied(row)]
    pending = [row for row in corrections if not is_applied(row)]
    applied_links = {row["link"] for row in applied}

    with open(suspects_path, newline="") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames
        remaining = [row for row in reader if row["link"] not in applied_links]

    with open(suspects_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(remaining)

    with open(corrections_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CORRECTIONS_HEADER, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(pending)

    print(
        f"removed {len(applied)} applied link(s); {len(pending)} correction(s) not applied yet; "
        f"{len(remaining)} suspects left"
    )


if __name__ == "__main__":
    main(
        sys.argv[1] if len(sys.argv) > 1 else "cache/corrections.csv",
        sys.argv[2] if len(sys.argv) > 2 else "cache/suspects.csv",
    )
