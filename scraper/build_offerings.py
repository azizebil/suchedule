"""
Build courses/offerings index: which terms each course was opened in.

    python scraper/build_offerings.py

Reads every term listed in terms.json, writes offerings.json:

    {"CS 201": ["202302", "202401", ...], "CS 512": ["202401", ...]}

Kept as a compiled index rather than something the page works out for itself: the
alternative is downloading all nine term files in the browser, which would undo the
cache limit and slow the first paint for a line of text on a course card.

Run after update_terms.py so it always reflects the current term list.
"""

import json
import os
import sys

TERMS_FILE = "terms.json"
DATA_DIR = "data"
OUT_FILE = "offerings.json"


def data_file(term, version):
    return os.path.join(DATA_DIR, f"data-{term}-v{version}.min.json")


def main():
    if not os.path.exists(TERMS_FILE):
        print(f"{TERMS_FILE} not found", file=sys.stderr)
        return 1

    with open(TERMS_FILE, encoding="utf-8") as handle:
        terms = json.load(handle).get("terms", [])

    offerings = {}
    missing = []

    #  Oldest first, so each course's list reads chronologically without a later sort.
    for entry in sorted(terms, key=lambda item: item["term"]):
        path = data_file(entry["term"], entry["dataVersion"])

        if not os.path.exists(path):
            missing.append(path)
            continue

        with open(path, encoding="utf-8") as handle:
            courses = json.load(handle).get("courses", [])

        for course in courses:
            offerings.setdefault(course["code"], []).append(entry["term"])

        print(f"  {entry['term']}: {len(courses)} courses")

    if missing:
        print(f"missing data files: {', '.join(missing)}", file=sys.stderr)
        return 1

    with open(OUT_FILE, "w", encoding="utf-8") as handle:
        json.dump(offerings, handle, ensure_ascii=False, separators=(",", ":"))

    size = os.path.getsize(OUT_FILE)
    every = sum(1 for value in offerings.values() if len(value) == len(terms))
    once = sum(1 for value in offerings.values() if len(value) == 1)

    print(f"\n{OUT_FILE}: {len(offerings)} courses, {size // 1024} KB")
    print(f"  offered in every term: {every}")
    print(f"  offered once only    : {once}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
