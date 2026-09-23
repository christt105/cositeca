import csv
import sys
from pathlib import Path

import yaml

from generate_yaml import GROUP_ID, REPO_ROOT, SOURCES, dump, link_key

TOOL_DIR = Path(__file__).resolve().parent


def main(dry_run=True):
    updates = 0
    touched = set()

    for source in SOURCES:
        with open(TOOL_DIR / source["csv"], newline="") as f:
            for row in csv.DictReader(f):
                if not row.get("tmdb_id"):
                    continue
                audio = [a for a in (row.get("audio") or "").split(",") if a]
                subs = [s for s in (row.get("subs") or "").split(",") if s]
                if not audio and not subs:
                    continue

                link = f"https://t.me/c/{GROUP_ID}/{source['topic']}/{row['id']}"
                key = link_key(link)
                yaml_path = REPO_ROOT / source["kind"] / f"{row['tmdb_id']}.yaml"
                if not yaml_path.exists():
                    continue

                data = yaml.safe_load(yaml_path.read_text())
                changed = False
                for entry in data["links"]:
                    if link_key(entry["link"]) != key:
                        continue
                    if audio and "audio" not in entry:
                        entry["audio"] = audio
                        changed = True
                    if subs and "subs" not in entry:
                        entry["subs"] = subs
                        changed = True

                if changed:
                    updates += 1
                    touched.add(yaml_path)
                    if not dry_run:
                        dump(yaml_path, data)

    prefix = "(dry-run) " if dry_run else ""
    print(f"{prefix}{updates} links updated across {len(touched)} files")


if __name__ == "__main__":
    main(dry_run="--apply" not in sys.argv)
