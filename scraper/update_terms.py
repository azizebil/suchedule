"""
Fold a freshly scraped term into terms.json and the data files.

Called by .github/workflows/scrape.yaml after scrape.py has produced data.min.json.
Kept out of the workflow YAML on purpose: this logic can be run and tested locally,
shell embedded in YAML cannot.

    python scraper/update_terms.py <term> <scraped-json>

Also answers two questions the workflow used to work out in shell:

    python scraper/update_terms.py --current     the newest term on record
    python scraper/update_terms.py --next        the term that would follow it

Prints a shell-friendly summary to stdout:

    changed=true|false
    version=<n>
    removed=<file>          (only when a term aged out of the list)

Exit code is always 0 unless something is genuinely wrong.
"""

import json
import os
import subprocess
import sys

MAX_TERMS = 9
TERMS_FILE = "terms.json"
DATA_DIR = "data"


def next_term(term):
    """
    The term code that follows this one.

    Summer terms are real here - 202303, 202403 and 202503 all carry courses - so the cycle
    runs Fall -> Spring -> Summer -> Fall of the next year. A fork that skips summers can
    go straight from Spring to the next Fall; we cannot.
    """
    year, season = term[:4], term[4:]

    if season == "01":
        return f"{year}02"

    if season == "02":
        return f"{year}03"

    return f"{int(year) + 1}01"


def data_file(term, version):
    return os.path.join(DATA_DIR, f"data-{term}-v{version}.min.json")


def read_terms():
    if not os.path.exists(TERMS_FILE):
        return []

    with open(TERMS_FILE, encoding="utf-8") as handle:
        return json.load(handle).get("terms", [])


def write_terms(terms):
    with open(TERMS_FILE, "w", encoding="utf-8") as handle:
        json.dump({"terms": terms}, handle, indent=2)
        handle.write("\n")


def git_rm(path):
    """Remove a tracked file, tolerating one that was never committed."""
    if not os.path.exists(path):
        return

    if subprocess.call(["git", "rm", "-f", "--quiet", path]) != 0:
        os.remove(path)


def same_content(left, right):
    if not os.path.exists(right):
        return False

    with open(left, "rb") as a, open(right, "rb") as b:
        return a.read() == b.read()


def main():
    if len(sys.argv) == 2 and sys.argv[1] in ("--current", "--next"):
        terms = read_terms()

        if not terms:
            print("terms.json carries no terms", file=sys.stderr)
            return 1

        newest = max(entry["term"] for entry in terms)

        print(newest if sys.argv[1] == "--current" else next_term(newest))

        return 0

    if len(sys.argv) != 3:
        print("usage: update_terms.py <term> <scraped-json> | --current | --next",
              file=sys.stderr)
        return 1

    term, scraped = sys.argv[1], sys.argv[2]
    terms = read_terms()
    existing = next((entry for entry in terms if entry["term"] == term), None)

    #  Nothing changed for a term we already carry: drop the scrape and stop.
    if existing is not None and same_content(scraped, data_file(term, existing["dataVersion"])):
        os.remove(scraped)
        print("changed=false")
        return 0

    if existing is not None:
        next_version = existing["dataVersion"] + 1
        git_rm(data_file(term, existing["dataVersion"]))
        existing["dataVersion"] = next_version
    else:
        next_version = 1
        terms.append({"term": term, "dataVersion": next_version})

    os.makedirs(DATA_DIR, exist_ok=True)
    os.replace(scraped, data_file(term, next_version))

    #  Sorted rather than "put the scraped one first": the workflow always scrapes the
    #  current term, but a past term backfilled by hand must not be promoted to current.
    #  Term codes sort chronologically as plain strings - 202601 > 202503 > 202502.
    terms.sort(key=lambda entry: entry["term"], reverse=True)

    #  A new term pushes the oldest one out of the list, and its data file with it.
    while len(terms) > MAX_TERMS:
        dropped = terms.pop()
        git_rm(data_file(dropped["term"], dropped["dataVersion"]))
        print(f"removed={data_file(dropped['term'], dropped['dataVersion'])}")

    write_terms(terms)

    print("changed=true")
    print(f"version={next_version}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
