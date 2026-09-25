import csv
import json
import sys
from pathlib import Path

from generate_yaml import GROUP_ID, SOURCES

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
TOOL_DIR = Path(__file__).resolve().parent

KIND_TO_TMDB_TYPE = {"movies": "movie", "series": "tv"}
AMBIGUOUS_RESULT_COUNT = 3
SEASON_MARKERS = ("temporada", "miniserie", "serie completa")

MISSING_STATUSES = {"no_results", "unparsed"}


def load_catalog():
    path = REPO_ROOT / "site" / "catalog.json"
    with open(path) as f:
        entries = json.load(f)
    return {(e["type"], str(e["tmdb"])): e for e in entries}


def reasons_for(row, tmdb_type):
    if row["status"] in MISSING_STATUSES:
        return ["sin_match"]

    reasons = []
    msg_year = (row.get("date") or "")[:4]
    tmdb_year = row.get("tmdb_year") or ""
    if msg_year and tmdb_year and tmdb_year > msg_year:
        reasons.append("anio_imposible")

    if row["status"] == "ambiguous_no_year":
        try:
            if int(row.get("result_count") or 0) >= AMBIGUOUS_RESULT_COUNT:
                reasons.append("ambiguo_muchos_candidatos")
        except ValueError:
            pass

    raw_lower = (row.get("raw") or "").lower()
    has_season_marker = any(marker in raw_lower for marker in SEASON_MARKERS)
    if tmdb_type == "movie" and has_season_marker:
        reasons.append("posible_serie_en_peliculas")

    return reasons


def main(suspects_path, missing_path):
    catalog = load_catalog()
    suspects, missing = [], []

    for source in SOURCES:
        tmdb_type = KIND_TO_TMDB_TYPE[source["kind"]]
        path = TOOL_DIR / source["csv"]
        with open(path, newline="") as f:
            for row in csv.DictReader(f):
                reasons = reasons_for(row, tmdb_type)
                if not reasons:
                    continue
                cat_entry = catalog.get((tmdb_type, row.get("tmdb_id")))
                entry = dict(row)
                entry["kind"] = source["kind"]
                entry["link"] = f"https://t.me/c/{GROUP_ID}/{source['topic']}/{row['id']}"
                entry["reasons"] = ",".join(reasons)
                entry["catalog_title"] = cat_entry["title"] if cat_entry else ""
                entry["catalog_poster"] = cat_entry["poster"] if cat_entry else ""
                (missing if reasons == ["sin_match"] else suspects).append(entry)

    suspect_fields = [
        "kind", "id", "date", "raw", "title", "year", "quality", "audio", "subs", "status",
        "result_count", "tmdb_id", "tmdb_title", "tmdb_year",
        "catalog_title", "catalog_poster", "link", "reasons",
    ]
    with open(suspects_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=suspect_fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(suspects)

    missing_fields = ["kind", "id", "date", "raw", "status", "link"]
    with open(missing_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=missing_fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(missing)

    print(f"suspects: {len(suspects)}, missing: {len(missing)}")


if __name__ == "__main__":
    main(
        sys.argv[1] if len(sys.argv) > 1 else "cache/suspects.csv",
        sys.argv[2] if len(sys.argv) > 2 else "cache/missing.csv",
    )
