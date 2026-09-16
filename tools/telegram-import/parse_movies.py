import csv
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor

from tmdb_client import search_with_retry

LINE_RE = re.compile(
    r"^(?P<title>.*?)(?:\s*\((?P<year>\d{4})\))?\s*[\(\[](?P<quality>[^()\[\]]*)[\)\]]\s*$"
)

BRACKET_RE = re.compile(r"\s*[\(\[][^()\[\]]*[\)\]]")
EDITION_SUFFIX_RE = re.compile(
    r"\s*[-+]\s*(Versi[oó]n .*|Montaje del [Dd]irector|Director'?s Cut|"
    r"Extendida.*|Remasterizada.*|Documental.*)$",
    re.IGNORECASE,
)
KNOWN_PREFIXES = ["Fitgirl Repacks ", "Marvel Television presenta "]


def clean_title(title):
    cleaned = title
    for prefix in KNOWN_PREFIXES:
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix):]
    cleaned = BRACKET_RE.sub("", cleaned)
    cleaned = EDITION_SUFFIX_RE.sub("", cleaned)
    return cleaned.strip(" -+")


def parse_line(text):
    first_line = (text or "").split("\n", 1)[0].strip()
    match = LINE_RE.match(first_line)
    if not match:
        return None
    quality_raw = match.group("quality")
    quality = "4K" if "4K" in quality_raw else "1080p" if "1080p" in quality_raw else None
    tags = []
    if "REMUX" in quality_raw:
        tags.append("REMUX")
    if "HDR" in quality_raw:
        tags.append("HDR")
    return {
        "title": match.group("title").strip(),
        "year": match.group("year"),
        "quality": quality,
        "tags": tags,
        "raw": first_line,
    }


def match_tmdb(parsed):
    query = parsed["title"]
    results = search_with_retry("movie", query, parsed["year"])
    cleaned = clean_title(query)
    used_cleaned = False
    if not results and cleaned and cleaned != query:
        results = search_with_retry("movie", cleaned, parsed["year"])
        used_cleaned = True
    if not results:
        return None, "no_results", 0, used_cleaned
    if parsed["year"]:
        exact = [r for r in results if (r.get("release_date") or "")[:4] == parsed["year"]]
        if exact:
            return exact[0], "year_match", len(results), used_cleaned
    status = "ambiguous_no_year" if not parsed["year"] and len(results) > 1 else "no_year_or_first_result"
    return results[0], status, len(results), used_cleaned


def process(item):
    parsed = parse_line(item["text"])
    row = {"id": item["id"], "raw": item["text"].split("\n", 1)[0].strip()}
    if parsed is None:
        row.update({"status": "unparsed"})
        return row
    row.update(
        {
            "title": parsed["title"],
            "year": parsed["year"],
            "quality": parsed["quality"],
            "tags": ",".join(parsed["tags"]),
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
        row["tmdb_title"] = best.get("title")
        row["tmdb_year"] = (best.get("release_date") or "")[:4]
    return row


def main(in_path, out_path):
    with open(in_path) as f:
        items = json.load(f)
    with ThreadPoolExecutor(max_workers=6) as pool:
        rows = list(pool.map(process, items))
    fields = [
        "id", "raw", "title", "year", "quality", "tags", "status",
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
