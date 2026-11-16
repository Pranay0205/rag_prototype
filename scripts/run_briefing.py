"""Generate one briefing from the command line and print it.

Run: uv run python scripts/run_briefing.py alex C-001
"""

import sys

from briefing import orchestrator
from briefing.db import connect
from briefing.tools import Tools


def main(user_id: str, client_id: str) -> None:
    b = orchestrator.run_briefing(Tools(connect()), user_id, client_id)
    viewer = f"{b.viewer.user_id} ({b.viewer.clearance})"
    print(f"# {b.client.name} | viewer {viewer} | access_limited={b.access_limited}")
    if b.meeting:
        print(f"Meeting: {b.meeting.date:%Y-%m-%d %H:%M} {b.meeting.purpose}")
    for s in b.sections:
        print(f"\n## {s.title} [{s.confidence.value}]" + (f" WARN {s.warnings}" if s.warnings else ""))
        for c in s.claims:
            mark = "OK " if c.status.value == "verified" else "?? "
            print(f"  {mark}{c.text}  <- {', '.join(x.source_id for x in c.citations)}")
    print("\n## Conflicts")
    for c in b.conflicts:
        print(
            f"  - {c.topic}: "
            + " vs ".join(f"{v.value} ({v.citation.source_id})" for v in c.values)
            + f" => {c.resolution}"
        )
    print("\n## Unknowns")
    for u in b.unknowns:
        print(f"  - {u.question} ({u.reason})")
    print("\n## Suggested actions")
    for a in b.suggested_actions:
        print(f"  - [{a.kind}] {a.description}")
    print(f"\nRun log: var/runs/{b.briefing_id}.json")


if __name__ == "__main__":
    main(*sys.argv[1:3])
