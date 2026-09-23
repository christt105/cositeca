import csv
import sys
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
CORRECTIONS_HEADER = ["kind", "old_tmdb_id", "link", "new_kind", "new_tmdb_id"]


def main(corrections_path, suspects_path):
    with open(corrections_path, newline="") as f:
        applied_links = {row["link"] for row in csv.DictReader(f)}

    with open(suspects_path, newline="") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames
        remaining = [row for row in reader if row["link"] not in applied_links]

    with open(suspects_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(remaining)

    with open(corrections_path, "w", newline="") as f:
        csv.writer(f).writerow(CORRECTIONS_HEADER)

    print(f"removed {len(applied_links)} applied link(s); {len(remaining)} suspects left")


if __name__ == "__main__":
    main(
        sys.argv[1] if len(sys.argv) > 1 else "cache/corrections.csv",
        sys.argv[2] if len(sys.argv) > 2 else "cache/suspects.csv",
    )
