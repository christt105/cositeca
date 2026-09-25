import csv
import sys

import yaml

from generate_yaml import REPO_ROOT, dump, link_key
from tmdb_client import details_with_retry

KIND_TO_TMDB_TYPE = {"movies": "movie", "series": "tv"}


def load_working_tree(kind, tmdb_id):
    path = REPO_ROOT / kind / f"{tmdb_id}.yaml"
    if not path.exists():
        return {"title": None, "links": []}
    return yaml.safe_load(path.read_text())


def fetch_title(kind, tmdb_id):
    data = details_with_retry(KIND_TO_TMDB_TYPE[kind], tmdb_id)
    return data.get("title") or data.get("name")


def adapt_for_kind(entry, new_kind, row):
    entry = dict(entry)
    if new_kind == "series":
        if "season" not in entry:
            season = row.get("season", "").strip()
            if not season:
                raise SystemExit(
                    f"fatal: {row['link']} pasa a series/{row['new_tmdb_id']}.yaml "
                    f"pero no tiene 'season'. Añade una columna 'season' a la fila "
                    f"de corrections.csv (entero o 'all') y vuelve a correr."
                )
            if season != "all" and not season.isdigit():
                raise SystemExit(
                    f"fatal: temporada '{season}' no válida para {row['link']}; "
                    f"usa un entero o 'all'."
                )
            entry["season"] = int(season) if season != "all" else season
    elif new_kind == "movies":
        entry.pop("season", None)
    return entry


def apply_row(row):
    old_kind, old_id, link = row["kind"], row["old_tmdb_id"], row["link"]
    new_kind, new_id = row["new_kind"], row["new_tmdb_id"]
    key = link_key(link)

    old_data = load_working_tree(old_kind, old_id)
    moved = [entry for entry in old_data["links"] if link_key(entry["link"]) == key]
    if not moved:
        print(f"skip: {link} no está en {old_kind}/{old_id}.yaml")
        return

    old_path = REPO_ROOT / old_kind / f"{old_id}.yaml"
    kept = [entry for entry in old_data["links"] if link_key(entry["link"]) != key]
    if kept:
        dump(old_path, {"title": old_data["title"], "links": kept})
    else:
        old_path.unlink()

    new_data = load_working_tree(new_kind, new_id)
    if any(link_key(entry["link"]) == key for entry in new_data["links"]):
        print(f"warn: {link} ya estaba en {new_kind}/{new_id}.yaml, no se duplica")
        return
    if new_data["title"] is None:
        new_data["title"] = fetch_title(new_kind, new_id)
    new_data["links"].append(adapt_for_kind(moved[0], new_kind, row))
    dump(REPO_ROOT / new_kind / f"{new_id}.yaml", new_data)
    print(f"moved {link}: {old_kind}/{old_id} -> {new_kind}/{new_id}")


def main(corrections_path):
    with open(corrections_path, newline="") as f:
        rows = list(csv.DictReader(f))
    for row in rows:
        apply_row(row)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "cache/corrections.csv")
