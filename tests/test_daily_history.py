from datetime import UTC, datetime

import pytest

from rusnipez.history.daily import import_snapshot, update_history, write_history


def at(value: str) -> datetime:
    return datetime.fromisoformat(value)


def test_snapshot_records_open_dates_without_claiming_transitions():
    first = update_history(None, {"10001", "10002"}, "92026", at("2026-10-14T13:00:00Z"))
    second = update_history(first, {"10002"}, "92026", at("2026-10-15T13:00:00Z"))
    assert second["sections"]["10001"]["lastSeenOpen"] == "2026-10-14"
    assert second["sections"]["10002"]["lastSeenOpen"] == "2026-10-15"
    assert second["sections"]["10002"]["daysSeenOpen"] == 2
    assert second["sampleDays"] == 2
    assert first["sections"]["10002"]["daysSeenOpen"] == 1  # Does not mutate input.


def test_same_day_retry_is_idempotent_and_empty_day_preserves_history():
    first = update_history(None, {"10001"}, "92026", at("2026-10-14T13:00:00Z"))
    retry = update_history(first, {"10001", "10002"}, "92026", at("2026-10-14T15:00:00Z"))
    assert retry["sampleDays"] == 1
    assert retry["sections"]["10001"]["daysSeenOpen"] == 1
    empty = update_history(retry, set(), "92026", at("2026-10-15T13:00:00Z"))
    assert empty["sections"] == retry["sections"]
    assert empty["sampleDate"] == "2026-10-15"


@pytest.mark.parametrize(
    ("timestamp", "day"),
    [("2026-10-15T02:00:00Z", "2026-10-14"), ("2026-12-15T04:30:00Z", "2026-12-14")],
)
def test_dates_use_eastern_time_across_daylight_saving(timestamp, day):
    assert update_history(None, {"10001"}, "92026", at(timestamp))["sampleDate"] == day


def test_invalid_input_cannot_replace_good_history(tmp_path):
    saved = update_history(None, {"10001"}, "92026", datetime(2026, 10, 14, 13, tzinfo=UTC))
    path = tmp_path / "history.json"
    write_history(path, saved)
    original = path.read_bytes()
    for indexes in [{"bad"}, {"None"}]:
        with pytest.raises(ValueError):
            update_history(saved, indexes, "92026", at("2026-10-15T13:00:00Z"))
    with pytest.raises(ValueError, match="newer"):
        update_history(saved, set(), "92026", at("2026-10-13T13:00:00Z"))
    with pytest.raises(ValueError, match="term"):
        update_history(saved, set(), "12027", at("2026-10-15T13:00:00Z"))
    assert path.read_bytes() == original


def test_import_preserves_legacy_dates_without_inventing_day_counts():
    imported = import_snapshot(
        {
            "schemaVersion": 2,
            "term": "92026",
            "checkedAt": "2026-10-15T02:00:00Z",
            "openIndexes": ["10002"],
            "sections": {
                "10001": {"lastOpenedAt": "2026-10-13T13:00:00Z", "openingCount": 200},
            },
        },
        "92026",
    )
    assert imported["sections"]["10001"]["lastSeenOpen"] == "2026-10-13"
    assert imported["sections"]["10001"]["daysSeenOpen"] == 1
    assert imported["sections"]["10002"]["lastSeenOpen"] == "2026-10-14"
