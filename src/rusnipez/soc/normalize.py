"""Reshape raw Schedule of Classes JSON into the flat form the app consumes.

The upstream payload is verbose and awkward in three specific ways:

1. ``meetingTimes`` carries one entry per meeting *day*, so a Tuesday/Thursday
   lecture appears as two otherwise-identical objects. We regroup them.
2. Times appear twice — as ``startTime`` + ``pmCode`` (ambiguous 12-hour) and
   as ``startTimeMilitary`` (unambiguous). We use the military field only.
3. Rutgers day codes are single letters where ``H`` is Thursday and ``U`` is
   Sunday, which no date library understands.
"""

from __future__ import annotations

from typing import Any

# Rutgers single-letter day codes, in week order.
DAY_ORDER = "MTWHFSU"
DAY_NAMES = {
    "M": "Monday",
    "T": "Tuesday",
    "W": "Wednesday",
    "H": "Thursday",
    "F": "Friday",
    "S": "Saturday",
    "U": "Sunday",
}


def _clean(value: Any) -> str:
    """Upstream uses empty strings, blank padding and nulls interchangeably."""
    return str(value).strip() if value is not None else ""


def format_military(value: Any) -> str | None:
    """``"1550"`` -> ``"15:50"``. Returns None for missing or malformed input."""
    raw = _clean(value)
    if len(raw) != 4 or not raw.isdigit():
        return None
    hour, minute = int(raw[:2]), int(raw[2:])
    if hour > 23 or minute > 59:
        return None
    return f"{hour:02d}:{minute:02d}"


def sort_days(days: set[str]) -> str:
    """Order day letters Monday-first: ``{"H", "T"}`` -> ``"TH"``."""
    return "".join(d for d in DAY_ORDER if d in days)


def collapse_meeting_times(raw_times: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Group per-day meeting entries into one entry per distinct time+place.

    Entries that share a start, end, mode and location differ only by day, so
    they describe a single weekly meeting pattern.
    """
    if not raw_times:
        return []

    groups: dict[tuple[str, ...], dict[str, Any]] = {}
    for entry in raw_times:
        start = format_military(entry.get("startTimeMilitary"))
        end = format_military(entry.get("endTimeMilitary"))
        mode = _clean(entry.get("meetingModeDesc"))
        building = _clean(entry.get("buildingCode"))
        room = _clean(entry.get("roomNumber"))
        campus = _clean(entry.get("campusAbbrev"))

        key = (start or "", end or "", mode, building, room, campus)
        group = groups.setdefault(
            key,
            {
                "days": set(),
                "start": start,
                "end": end,
                "mode": mode,
                "where": " ".join(part for part in (building, room) if part),
                "campus": campus,
            },
        )
        day = _clean(entry.get("meetingDay")).upper()
        if day in DAY_NAMES:
            group["days"].add(day)

    collapsed = []
    for group in groups.values():
        group["days"] = sort_days(group["days"])
        collapsed.append(group)

    # Stable order: earliest meeting first, undated (async) entries last.
    collapsed.sort(key=lambda g: (g["start"] is None, g["start"] or "", g["days"]))
    return collapsed


# sectionCourseType: how the section is taught.
FORMATS = {"T": "in-person", "O": "online", "H": "hybrid"}

# Comments on almost every section that tell a student nothing.
BOILERPLATE_COMMENTS = {"Go to http://canvas.rutgers.edu"}


def section_comments(raw: dict[str, Any]) -> list[str]:
    """Rutgers' per-section comments, minus boilerplate, in their listed order."""
    comments = []
    for item in raw.get("comments") or []:
        text = _clean(item.get("description"))
        if text and text not in BOILERPLATE_COMMENTS and text not in comments:
            comments.append(text)
    return comments


def normalize_section(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Flatten one section. Returns None if it has no usable index."""
    index = _clean(raw.get("index"))
    if not index:
        return None

    cross_listed = sorted(
        {
            _clean(x.get("registrationIndex"))
            for x in raw.get("crossListedSections") or []
            if _clean(x.get("registrationIndex")) and _clean(x.get("registrationIndex")) != index
        }
    )

    instructors = [name for i in raw.get("instructors") or [] if (name := _clean(i.get("name")))]

    return {
        "index": index,
        "number": _clean(raw.get("number")),
        "instructors": instructors,
        "meets": collapse_meeting_times(raw.get("meetingTimes")),
        # finalExam is never filled in; examCodeText carries the exam arrangement.
        "exam": _clean(raw.get("finalExam")) or _clean(raw.get("examCodeText")) or None,
        # A non-null add code means an open seat still needs departmental
        # permission, so it is not actually registrable.
        "spn": raw.get("specialPermissionAddCode") is not None,
        "spnFrom": _clean(raw.get("specialPermissionAddCodeDescription")) or None,
        "crossListed": cross_listed,
        "subtitle": _clean(raw.get("subtitle")) or _clean(raw.get("subtopic")) or None,
        "campus": _clean(raw.get("campusCode")),
        "format": FORMATS.get(_clean(raw.get("sectionCourseType")), "in-person"),
        "honors": bool(raw.get("honorPrograms")),
        "eligibility": _clean(raw.get("sectionEligibility")) or None,
        "openTo": _clean(raw.get("openToText")) or None,
        "comments": section_comments(raw),
        "notes": _clean(raw.get("sectionNotes")) or None,
    }


def normalize_course(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Flatten one course and its sections. Returns None if it has no sections."""
    sections = [
        section
        for raw_section in raw.get("sections") or []
        if (section := normalize_section(raw_section)) is not None
    ]
    if not sections:
        return None

    core = sorted({code for c in raw.get("coreCodes") or [] if (code := _clean(c.get("code")))})
    school = raw.get("school") or {}
    try:
        fee = float(_clean(raw.get("courseFee")) or 0)
    except ValueError:
        fee = 0.0

    return {
        "code": _clean(raw.get("courseString")),
        "title": _clean(raw.get("expandedTitle")) or _clean(raw.get("title")),
        "subject": _clean(raw.get("subject")),
        "subjectName": _clean(raw.get("subjectDescription")),
        "school": _clean(school.get("description")),
        "schoolCode": _clean(school.get("code")),
        # Variable-credit courses report null here; creditsObject carries a
        # code such as "BA" instead.
        "credits": raw.get("credits"),
        "creditsText": _clean((raw.get("creditsObject") or {}).get("description")) or None,
        "level": _clean(raw.get("level")),
        "core": core,
        "synopsis": _clean(raw.get("synopsisUrl")) or None,
        "prereqs": _clean(raw.get("preReqNotes")) or None,
        "fee": fee if fee > 0 else None,
        "notes": _clean(raw.get("courseNotes")) or None,
        "sections": sections,
    }


def normalize_catalog(raw_courses: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize the full catalogue, dropping courses with no usable sections."""
    courses = [course for raw in raw_courses if (course := normalize_course(raw)) is not None]
    courses.sort(key=lambda c: c["code"])
    return courses
