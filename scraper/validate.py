"""
Sanity thresholds for a freshly scraped data file.

The catalog scrape degrades silently: if Banner changes the attribute block the
regexes stop matching, every course gets null credits, and nothing raises. The
workflow would then commit that file, bump the data version, and the app would
wipe every user's saved schedule for a term to make room for junk. So the file is
checked before it is allowed anywhere near a commit.

    python scraper/validate.py data.min.json

Exits non-zero when a threshold is missed, which fails the workflow step.
"""

import json
import sys

#  Ratios, not absolute counts. Absolute floors looked fine against a full term but
#  would have failed every summer scrape: a summer term carries ~70 courses against
#  ~470 in the autumn, so "at least 300 courses with ECTS" is unreachable in May.
#  Measured: autumn 471 courses / 100% cr / 99.6% ects / 20.6% eng>0,
#            summer  70 courses / 100% cr / 100%  ects / 28.6% eng>0.
#  A parser that stopped matching produces 0% and is caught by all three.
MIN_COURSES = 50

RATIOS = [
    ("courses with cr", 0.90, lambda c: c.get("cr") is not None),
    ("courses with ects", 0.85, lambda c: c.get("ects") is not None),
    ("courses with eng > 0", 0.08, lambda c: (c.get("eng") or 0) > 0),
]


def main():
    if len(sys.argv) != 2:
        print("usage: validate.py <data.min.json>", file=sys.stderr)
        return 2

    with open(sys.argv[1], encoding="utf-8") as handle:
        courses = json.load(handle).get("courses", [])

    total = len(courses)
    failures = []

    ok = total >= MIN_COURSES
    print(f"{'ok  ' if ok else 'FAIL'} courses: {total} (min {MIN_COURSES})")

    if not ok:
        failures.append(f"only {total} courses, expected at least {MIN_COURSES}")

    for label, floor, matches in RATIOS:
        count = sum(1 for course in courses if matches(course))
        share = count / total if total else 0
        ok = share >= floor

        print(f"{'ok  ' if ok else 'FAIL'} {label}: {count}/{total} = {share:.0%} (min {floor:.0%})")

        if not ok:
            failures.append(f"{label} at {share:.0%}, expected at least {floor:.0%}")

    if failures:
        print("\nThe scrape looks broken, refusing to publish it:", file=sys.stderr)

        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)

        return 1

    print("\nAll thresholds met.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
