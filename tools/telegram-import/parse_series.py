import csv
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor

from lang_parser import parse_languages
from parse_movies import clean_title
from tmdb_client import search_with_retry

LINE_RE = re.compile(
    r"^(?P<title>.*?)\s*-\s*"
    r"(?:Temporada\s+(?P<season>\d+|Especiales?)|(?P<whole>Miniserie|Serie Completa))"
    r"(?:\s*[\(\[](?P<quality>[^()\[\]]*)[\)\]])?\s*$",
    re.IGNORECASE,
)
YEAR_IN_TITLE_RE = re.compile(r"\s*\((\d{4})\)")


def parse_line(text):
    first_line = (text or "").split("\n", 1)[0].strip()
    match = LINE_RE.match(first_line)
    if not match:
        return None
    title = match.group("title").strip()
    year_match = YEAR_IN_TITLE_RE.search(title)
    year = year_match.group(1) if year_match else None
    title_no_year = YEAR_IN_TITLE_RE.sub("", title).strip()
    season_note = None
    if match.group("whole"):
        season = "all"
        season_note = match.group("whole")
    else:
        season_raw = match.group("season").lower()
        season = 0 if season_raw.startswith("especial") else int(season_raw)
    quality_raw = match.group("quality")
    quality = None
    if quality_raw:
        quality = "4K" if "4K" in quality_raw else "1080p" if "1080p" in quality_raw else None
    return {
        "title": title_no_year,
        "year": year,
        "season": season,
        "season_note": season_note,
        "quality": quality or "1080p",
        "raw": first_line,
    }


def match_tmdb(parsed):
    query = parsed["title"]
    results = search_with_retry("tv", query, parsed["year"])
    cleaned = clean_title(query)
    used_cleaned = False
    if not results and cleaned and cleaned != query:
        results = search_with_retry("tv", cleaned, parsed["year"])
        used_cleaned = True
    if not results:
        return None, "no_results", 0, used_cleaned
    if parsed["year"]:
        exact = [r for r in results if (r.get("first_air_date") or "")[:4] == parsed["year"]]
        if exact:
            return exact[0], "year_match", len(results), used_cleaned
    status = "ambiguous_no_year" if not parsed["year"] and len(results) > 1 else "no_year_or_first_result"
    return results[0], status, len(results), used_cleaned


def process(item):
    parsed = parse_line(item["text"])
    row = {"id": item["id"], "date": item.get("date", ""), "raw": item["text"].split("\n", 1)[0].strip()}
    if parsed is None:
        row.update({"status": "unparsed"})
        return row
    audio, subs = parse_languages(item["text"])
    row.update(
        {
            "title": parsed["title"],
            "year": parsed["year"],
            "season": parsed["season"],
            "season_note": parsed["season_note"],
            "quality": parsed["quality"],
            "audio": ",".join(audio),
            "subs": ",".join(subs),
        }
    )
    try:
        best, status, result_count, used_cleaned = match_tmdb(parsed)
    except Exception as exc:
        row["status"] = f"tmdb_error: {exc}"
        return row
    row["status"] = status
    row["result_count"] = result_count
    row["used_cleaned_title"] = used_cleaned
    if best:
        row["tmdb_id"] = best.get("id")
        row["tmdb_title"] = best.get("name")
        row["tmdb_year"] = (best.get("first_air_date") or "")[:4]
    return row


def main(in_path, out_path):
    with open(in_path) as f:
        items = json.load(f)
    with ThreadPoolExecutor(max_workers=6) as pool:
        rows = list(pool.map(process, items))
    fields = [
        "id", "date", "raw", "title", "year", "season", "season_note", "quality", "audio", "subs", "status",
        "result_count", "used_cleaned_title", "tmdb_id", "tmdb_title", "tmdb_year",
    ]
    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

    from collections import Counter

    statuses = Counter(r["status"] for r in rows)
    print(f"total {len(rows)}")
    for status, count in statuses.most_common():
        print(f"  {status}: {count}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
