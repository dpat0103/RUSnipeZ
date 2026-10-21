"""Pure open-seat detection logic: no I/O, no clock, no database.

Rutgers publishes the set of open section indexes. An opening is news only when
an index appears that was not in the previous set, so detection is a set
difference rather than a yes/no check. A section that stays open produces no
event and needs no cooldown.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True, slots=True)
class Changes:
    opened: list[str]
    closed: list[str]

    @property
    def size(self) -> int:
        return len(self.opened) + len(self.closed)


def diff_open_sets(previous: set[str], current: set[str]) -> Changes:
    """Indexes that opened and closed between two observations, sorted."""
    return Changes(opened=sorted(current - previous), closed=sorted(previous - current))


def fingerprint(indexes: set[str]) -> str:
    """Content hash of an open set, independent of upstream ordering."""
    return hashlib.sha256(",".join(sorted(indexes)).encode()).hexdigest()


class ChangeGuard:
    """Hold a mass change until it has persisted long enough to trust.

    Rutgers' load-balanced endpoint sometimes serves a frozen, stale snapshot
    for a minute or so: thousands of sections vanish, a few long-closed ones
    reappear, then everything returns. Applying it would record false
    closings, then false openings and alerts on recovery.

    A poll whose changes reach the threshold is applied only once it has been
    seen for ``confirm_after``; if upstream recovers first, nothing is recorded
    and the held snapshot's fingerprint is remembered, so that exact snapshot
    is never applied however long it is served later. Ordinary polls (a
    handful of changes) are never delayed.
    """

    MAX_REMEMBERED = 32

    def __init__(self, *, ratio: float, minimum: int, confirm_after: timedelta) -> None:
        if not 0 < ratio < 1:
            raise ValueError("ratio must be between 0 and 1")
        self.ratio = ratio
        self.minimum = minimum
        self.confirm_after = confirm_after
        self.held_since: datetime | None = None
        self._held: set[str] = set()
        self._stale: dict[str, None] = {}  # insertion-ordered set

    def is_mass_change(self, previous_count: int, changes: Changes) -> bool:
        return changes.size >= max(self.minimum, self.ratio * previous_count)

    def is_known_stale(self, snapshot: str) -> bool:
        return snapshot in self._stale

    def should_apply(
        self, previous_count: int, changes: Changes, observed_at: datetime, snapshot: str
    ) -> bool:
        """True when the observation can be applied; False while it is held.

        ``snapshot`` is the :func:`fingerprint` of the observed open set.
        """
        # With no stored state the first poll is a baseline, which never alerts.
        if previous_count == 0 or not self.is_mass_change(previous_count, changes):
            # Upstream came back before confirmation: what was held was stale.
            for held in self._held:
                self._stale[held] = None
            while len(self._stale) > self.MAX_REMEMBERED:
                del self._stale[next(iter(self._stale))]
            self._held.clear()
            self.held_since = None
            return True
        if snapshot in self._stale:
            return False
        self._held.add(snapshot)
        if self.held_since is None:
            self.held_since = observed_at
            return False
        if observed_at - self.held_since >= self.confirm_after:
            self._held.clear()
            self.held_since = None
            return True
        return False
