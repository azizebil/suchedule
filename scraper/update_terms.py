"""
Fold a freshly scraped term into terms.json and the data files.

Called by .github/workflows/scrape.yaml after scrape.py has produced data.min.json.
Kept out of the workflow YAML on purpose: this logic can be run and tested locally,
shell embedded in YAML cannot.

    python scraper/update_terms.py <term> <scraped-json>

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

MAX_TERMS = 2
TERMS_FILE = "terms.json"


def data_file(term, version):
    return f"data-{term}-v{version}.min.json"


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
    if len(sys.argv) != 3:
        print("usage: update_terms.py <term> <scraped-json>", file=sys.stderr)
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
        #  Keep the freshest term first; the app treats terms[0] as the current one.
        terms.remove(existing)
        terms.insert(0, existing)
    else:
        next_version = 1
        terms.insert(0, {"term": term, "dataVersion": next_version})

    os.replace(scraped, data_file(term, next_version))

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
