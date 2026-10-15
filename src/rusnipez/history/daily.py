"""Record which sections were seen open in one daily Eastern-time snapshot."""

from __future__ import annotations

import argparse
import asyncio
import json
import re
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from rusnipez.soc.client import SocClient
from rusnipez.soc.term import Term

EASTERN = ZoneInfo("America/New_York")


def update_history(previous: dict | None, indexes: set[str], term: str, at: datetime) -> dict:
    """Merge positive observations; absence never erases a last-seen date."""
    if at.tzinfo is None:
        raise ValueError("Observation time must have a timezone")
    if any(not isinstance(i, str) or not re.fullmatch(r"\d{5}", i) for i in indexes):
        raise ValueError("Open section indexes must be five-digit strings")
    Term.parse(term)
    day = at.astimezone(EASTERN).date().isoformat()
    if previous is not None:
        if previous.get("schemaVersion") != 3 or previous.get("term") != term:
            raise ValueError("History schema or term mismatch")
        if not isinstance(previous.get("sections"), dict):
            raise ValueError("Invalid saved history")
        if datetime.fromisoformat(previous["checkedAt"]) > at:
            raise ValueError("Refusing to overwrite a newer observation")
    result = (
        deepcopy(previous)
        if previous
        else {
            "schemaVersion": 3,
            "term": term,
            "sampling": "daily",
            "timeZone": "America/New_York",
            "startedAt": at.isoformat(),
            "sampleDays": 0,
            "sections": {},
        }
    )
    if result.get("sampleDate") != day:
        result["sampleDays"] += 1
    for index in sorted(indexes):
        entry = result["sections"].setdefault(
            index,
            {
                "firstSeenOpen": day,
                "lastSeenOpen": day,
                "daysSeenOpen": 0,
            },
        )
        # Rerunning the workflow on the same date never double-counts a day.
        if entry["daysSeenOpen"] == 0 or entry["lastSeenOpen"] != day:
            entry["daysSeenOpen"] += 1
        entry["lastSeenOpen"] = day
    result.update({"checkedAt": at.isoformat(), "sampleDate": day})
    result["sections"] = dict(sorted(result["sections"].items()))
    return result


def import_snapshot(snapshot: dict, term: str) -> dict:
    """Preserve dated evidence from the retired collector, without inferring counts."""
    if snapshot.get("schemaVersion") != 2 or snapshot.get("term") != term:
        raise ValueError("Invalid legacy snapshot")
    at = datetime.fromisoformat(snapshot["checkedAt"])
    result = update_history(None, set(), term, at)
    for index, entry in snapshot["sections"].items():
        if not re.fullmatch(r"\d{5}", index):
            raise ValueError("Invalid legacy index")
        seen = datetime.fromisoformat(entry["lastOpenedAt"]).astimezone(EASTERN).date()
        result["sections"][index] = {
            "firstSeenOpen": seen.isoformat(),
            "lastSeenOpen": seen.isoformat(),
            "daysSeenOpen": 1,
        }
    return update_history(result, set(snapshot["openIndexes"]), term, at)


def write_history(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


async def collect(term: Term) -> set[str]:
    # Rutgers returns university-wide indexes even when campus=NB is specified.
    async with SocClient(campus="NB") as client:
        return await client.open_sections(term)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--term", default="02027")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--seed", type=Path)
    parser.add_argument("--import-snapshot", type=Path)
    args = parser.parse_args()
    term = Term.parse(args.term)
    previous = None
    source = args.out if args.out.exists() else args.seed
    if source and source.exists():
        previous = json.loads(source.read_text(encoding="utf-8"))
    if previous is None and args.import_snapshot:
        previous = import_snapshot(
            json.loads(args.import_snapshot.read_text(encoding="utf-8")), term.code
        )
    indexes = asyncio.run(collect(term))
    payload = update_history(previous, indexes, term.code, datetime.now(UTC))
    write_history(args.out, payload)
    print(f"{payload['sampleDate']}: saw {len(indexes)} open indexes; saved {args.out}")


if __name__ == "__main__":
    main()
