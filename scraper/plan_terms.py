"""
Decide which terms today's run should scrape, one per line.

    python scraper/plan_terms.py

The workflow used to work this out in awk, purely from the calendar. A calendar is
reliable about one thing and unreliable about another, and the old line used it for
both: it is right about which term students are sitting in, and wrong about which terms
exist - it says "it is August, so it is autumn" on a date the registrar may have
published nothing for, and goes on saying it. So existence is asked of bannerweb now,
and the calendar is kept only for the question it can answer.

That comes to at most two terms:

  - the newest term bannerweb carries, plus anything the walk forward turned up on the
    way, so a newly opened term is picked up the day it appears and never stepped over;
  - the term the calendar says is in session, when that is not already one of them. By
    mid September bannerweb already carries the following spring while the autumn term
    is running, and refreshing only the newer of the two would freeze the term students
    are actually in - rooms move and instructors change all semester.

In the quiet stretches, when nothing new has been published and the newest term is the
one in session, that is a single scrape, exactly as before.

Exits non-zero only when terms.json cannot be read.
"""

import datetime
import sys

from scrape import SUcheduleCourseScraper
from update_terms import next_term, read_terms

#  A bug in has_courses must not turn the walk into an unbounded crawl into the future.
#  Two terms of headroom is already more than a daily run can fall behind.
MAX_LOOKAHEAD = 2


def calendar_term(today=None):
    """
    The term the calendar says is in session, as the workflow's awk line computed it:
    August onward is that year's autumn, through April is the previous year's spring, and
    what is left over - May, June, July - is its summer. The year in a term code is the
    start of the academic year, which is why the later months carry year - 1.
    """
    today = today or datetime.date.today()
    year, month = today.year, today.month

    if month >= 8:
        return f"{year}01"

    if month <= 4:
        return f"{year - 1}02"

    return f"{year - 1}03"


def main():
    recorded = read_terms()

    if not recorded:
        print("terms.json carries no terms", file=sys.stderr)
        return 1

    known = {entry["term"] for entry in recorded}
    newest = max(known)
    targets = []

    for _ in range(MAX_LOOKAHEAD):
        candidate = next_term(newest)

        if not SUcheduleCourseScraper(term=int(candidate)).has_courses():
            break

        targets.append(candidate)
        newest = candidate

    if newest not in targets:
        targets.append(newest)

    in_session = calendar_term()

    #  A term already on record needs no asking - it exists because we hold its data. Only
    #  a term we have never scraped costs the two requests to check.
    if in_session not in targets and (
            in_session in known
            or SUcheduleCourseScraper(term=int(in_session)).has_courses()):
        targets.append(in_session)

    #  Newest first: if a run is cut short, the term most people are looking at is the
    #  one that already got scraped.
    print("\n".join(sorted(targets, reverse=True)))

    return 0


if __name__ == "__main__":
    sys.exit(main())
