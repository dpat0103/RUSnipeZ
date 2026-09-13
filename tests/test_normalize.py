"""Tests for the awkward parts of the SoC payload: day codes and time formats."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from rusnipez.soc.normalize import (
    collapse_meeting_times,
    format_military,
    normalize_course,
    normalize_section,
    sort_days,
)

SAMPLE = json.loads((Path(__file__).parent.parent / "docs" / "soc-api-sample.json").read_text())


def meeting(day: str, **overrides) -> dict:
    base = {
        "meetingDay": day,
        "startTimeMilitary": "1550",
        "endTimeMilitary": "1710",
        "meetingModeDesc": "LEC",
        "buildingCode": "HH",
        "roomNumber": "A2",
        "campusAbbrev": "CAC",
    }
    return base | overrides


class TestFormatMilitary:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [("1550", "15:50"), ("0350", "03:50"), ("0000", "00:00"), ("2359", "23:59")],
    )
    def test_valid(self, raw: str, expected: str) -> None:
        assert format_military(raw) == expected

    @pytest.mark.parametrize("raw", ["", None, "  ", "abcd", "155", "15500", "2460", "1099"])
    def test_rejects_unusable(self, raw) -> None:
        assert format_military(raw) is None


class TestSortDays:
    def test_orders_monday_first(self) -> None:
        assert sort_days({"H", "T"}) == "TH"
        assert sort_days({"F", "M", "W"}) == "MWF"

    def test_h_is_thursday_and_sorts_after_wednesday(self) -> None:
        assert sort_days({"H", "W"}) == "WH"

    def test_u_is_sunday_and_sorts_last(self) -> None:
        assert sort_days({"U", "M", "S"}) == "MSU"


class TestCollapseMeetingTimes:
    def test_identical_entries_differing_only_by_day_become_one(self) -> None:
        collapsed = collapse_meeting_times([meeting("T"), meeting("H")])
        assert len(collapsed) == 1
        assert collapsed[0]["days"] == "TH"
        assert collapsed[0]["start"] == "15:50"
        assert collapsed[0]["where"] == "HH A2"

    def test_different_rooms_stay_separate(self) -> None:
        collapsed = collapse_meeting_times([meeting("T"), meeting("H", roomNumber="B1")])
        assert len(collapsed) == 2
        assert {g["days"] for g in collapsed} == {"T", "H"}

    def test_different_times_stay_separate(self) -> None:
        collapsed = collapse_meeting_times(
            [meeting("T"), meeting("H", startTimeMilitary="0900", endTimeMilitary="1020")]
        )
        assert len(collapsed) == 2

    def test_recitation_and_lecture_stay_separate(self) -> None:
        collapsed = collapse_meeting_times([meeting("T"), meeting("H", meetingModeDesc="REC")])
        assert {g["mode"] for g in collapsed} == {"LEC", "REC"}

    @pytest.mark.parametrize("empty", [None, []])
    def test_no_meeting_times(self, empty) -> None:
        assert collapse_meeting_times(empty) == []

    def test_async_online_section_survives_without_times_or_room(self) -> None:
        collapsed = collapse_meeting_times(
            [
                {
                    "meetingDay": "",
                    "startTimeMilitary": "",
                    "endTimeMilitary": "",
                    "meetingModeDesc": "ONLINE INSTRUCTION",
                    "buildingCode": "",
                    "roomNumber": "",
                    "campusAbbrev": "",
                }
            ]
        )
        assert len(collapsed) == 1
        assert collapsed[0]["days"] == ""
        assert collapsed[0]["start"] is None
        assert collapsed[0]["where"] == ""

    def test_unknown_day_letter_is_dropped_not_crashed(self) -> None:
        collapsed = collapse_meeting_times([meeting("X"), meeting("M")])
        assert collapsed[0]["days"] == "M"

    def test_timed_meetings_sort_before_async_ones(self) -> None:
        collapsed = collapse_meeting_times(
            [meeting("M", startTimeMilitary="", endTimeMilitary=""), meeting("T")]
        )
        assert collapsed[0]["start"] == "15:50"
        assert collapsed[1]["start"] is None


class TestNormalizeSection:
    def test_real_sample_section(self) -> None:
        section = normalize_section(SAMPLE["sections"][0])
        assert section is not None
        assert section["index"] == "10052"
        assert section["number"] == "01"
        assert section["instructors"] == ["SELIM, SAMAH"]
        assert section["meets"] == [
            {
                "days": "TH",
                "start": "15:50",
                "end": "17:10",
                "mode": "LEC",
                "where": "HH A2",
                "campus": "CAC",
            }
        ]

    def test_cross_listed_index_captured_and_self_excluded(self) -> None:
        section = normalize_section(SAMPLE["sections"][0])
        assert section["crossListed"] == ["10053"]

    def test_section_without_index_is_dropped(self) -> None:
        assert normalize_section({"number": "01", "index": ""}) is None

    def test_spn_flag_follows_add_code_presence(self) -> None:
        assert normalize_section({"index": "12345", "specialPermissionAddCode": None})["spn"] is False
        assert normalize_section({"index": "12345", "specialPermissionAddCode": "P"})["spn"] is True


class TestNormalizeCourse:
    def test_real_sample_course(self) -> None:
        course = normalize_course(SAMPLE)
        assert course is not None
        assert course["code"] == "01:013:120"
        assert course["title"] == "LITERARY EGYPT"
        assert course["core"] == ["HST", "SOEHS"]
        assert course["school"] == "School of Arts and Sciences"
        assert course["credits"] == 3
        assert len(course["sections"]) == 1

    def test_course_with_no_sections_is_dropped(self) -> None:
        assert normalize_course({"courseString": "01:000:000", "sections": []}) is None

    def test_variable_credit_course_keeps_null_credits(self) -> None:
        course = normalize_course(
            {
                "courseString": "01:000:001",
                "title": "RESEARCH",
                "credits": None,
                "creditsObject": {"description": "BA credits"},
                "sections": [{"index": "99999"}],
            }
        )
        assert course["credits"] is None
        assert course["creditsText"] == "BA credits"
