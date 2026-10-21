from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from rusnipez.core.detection import ChangeGuard, Changes, diff_open_sets, fingerprint

T0 = datetime(2026, 11, 16, 14, 0, tzinfo=UTC)
GOOD, STALE, OTHER = "good-snapshot", "stale-snapshot", "other-snapshot"


def test_diff_reports_only_changes_and_leaves_inputs_untouched() -> None:
    previous, current = {"10001", "10002"}, {"10002", "10003"}
    changes = diff_open_sets(previous, current)
    assert changes.opened == ["10003"]
    assert changes.closed == ["10001"]
    assert previous == {"10001", "10002"} and current == {"10002", "10003"}


def test_diff_of_identical_sets_is_empty() -> None:
    changes = diff_open_sets({"10001"}, {"10001"})
    assert changes.opened == [] and changes.closed == []


def test_diff_output_is_sorted() -> None:
    assert diff_open_sets(set(), {"30000", "10000", "20000"}).opened == ["10000", "20000", "30000"]


def guard() -> ChangeGuard:
    return ChangeGuard(ratio=0.02, minimum=50, confirm_after=timedelta(seconds=120))


def changes(opened: int = 0, closed: int = 0) -> Changes:
    return Changes(
        opened=[f"1{n:04d}" for n in range(opened)], closed=[f"2{n:04d}" for n in range(closed)]
    )


def at(seconds: float) -> datetime:
    return T0 + timedelta(seconds=seconds)


def test_ordinary_polls_apply_immediately() -> None:
    g = guard()
    assert g.should_apply(15000, changes(opened=20, closed=30), at(0), GOOD)
    assert g.should_apply(15000, changes(opened=299), at(30), GOOD)  # just under 2% of 15000


def test_threshold_has_a_floor_for_small_terms() -> None:
    assert guard().should_apply(200, changes(closed=49), at(0), GOOD)
    assert not guard().should_apply(200, changes(closed=50), at(0), STALE)


def test_baseline_is_never_held() -> None:
    assert guard().should_apply(0, changes(opened=15000), at(0), GOOD)


def test_observed_stale_snapshot_is_never_applied() -> None:
    """Replays 21 Oct 2026: 4,308 sections vanished and 19 old ones reappeared
    for two polls, then everything returned."""
    g = guard()
    assert g.should_apply(15351, changes(), at(0), GOOD)
    assert not g.should_apply(15351, changes(opened=19, closed=4308), at(30), STALE)
    assert not g.should_apply(15351, changes(opened=19, closed=4308), at(60), STALE)
    assert g.should_apply(15351, changes(), at(90), GOOD)
    assert g.held_since is None


def test_reverted_snapshot_is_never_applied_again() -> None:
    """The same frozen snapshot returned 15 minutes later in the live run."""
    g = guard()
    assert not g.should_apply(15351, changes(closed=4308), at(0), STALE)
    assert g.should_apply(15351, changes(), at(60), GOOD)
    assert g.is_known_stale(STALE)
    for seconds in range(900, 1500, 30):  # served for ten minutes this time
        assert not g.should_apply(15351, changes(closed=4308), at(seconds), STALE)
    # A different mass change is still confirmed normally.
    assert not g.should_apply(15351, changes(opened=900), at(1500), OTHER)
    assert g.should_apply(15351, changes(opened=900), at(1620), OTHER)


def test_persistent_mass_change_applies_after_confirmation_window() -> None:
    g = guard()
    assert not g.should_apply(1000, changes(closed=1000), at(0), OTHER)
    assert not g.should_apply(1000, changes(closed=1000), at(90), OTHER)
    assert g.should_apply(1000, changes(closed=1000), at(120), OTHER)
    assert not g.is_known_stale(OTHER)  # confirmed changes are not remembered as stale
    # Confirmation is not sticky: the next mass change waits again.
    assert not g.should_apply(1000, changes(opened=500), at(150), GOOD)


def test_remembered_snapshots_are_bounded() -> None:
    g = guard()
    for n in range(ChangeGuard.MAX_REMEMBERED + 5):
        g.should_apply(1000, changes(closed=500), at(n * 60), f"stale-{n}")
        g.should_apply(1000, changes(), at(n * 60 + 30), GOOD)
    assert not g.is_known_stale("stale-0")
    assert g.is_known_stale(f"stale-{ChangeGuard.MAX_REMEMBERED + 4}")


def test_fingerprint_ignores_order() -> None:
    assert fingerprint({"10002", "10001"}) == fingerprint({"10001", "10002"})
    assert fingerprint({"10001"}) != fingerprint({"10002"})


@pytest.mark.parametrize("ratio", [0, 1, -0.5, 1.5])
def test_guard_rejects_invalid_ratio(ratio: float) -> None:
    with pytest.raises(ValueError):
        ChangeGuard(ratio=ratio, minimum=50, confirm_after=timedelta(seconds=120))
