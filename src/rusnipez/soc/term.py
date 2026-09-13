"""Rutgers term encoding.

The Schedule of Classes API and WebReg encode the same term differently:
the API takes ``year`` and ``term`` as separate parameters, while WebReg
takes a single concatenated ``semesterSelection`` code (term digit first).
"""

from __future__ import annotations

from dataclasses import dataclass

# Rutgers season codes. Note these are not sequential by calendar order.
WINTER, SPRING, SUMMER, FALL = 0, 1, 7, 9

_SEASON_NAMES = {WINTER: "Winter", SPRING: "Spring", SUMMER: "Summer", FALL: "Fall"}


@dataclass(frozen=True, slots=True)
class Term:
    """A Rutgers academic term, e.g. ``Term(2026, FALL)``."""

    year: int
    term: int

    def __post_init__(self) -> None:
        if self.term not in _SEASON_NAMES:
            valid = ", ".join(str(t) for t in sorted(_SEASON_NAMES))
            raise ValueError(f"term must be one of {valid}, got {self.term!r}")
        if not 2000 <= self.year <= 2100:
            raise ValueError(f"year out of range: {self.year!r}")

    @classmethod
    def parse(cls, code: str) -> Term:
        """Parse a WebReg-style code such as ``"92026"``."""
        code = code.strip()
        if len(code) != 5 or not code.isdigit():
            raise ValueError(f"expected a 5-digit term code like '92026', got {code!r}")
        return cls(year=int(code[1:]), term=int(code[0]))

    @property
    def code(self) -> str:
        """The WebReg ``semesterSelection`` code, e.g. ``"92026"``."""
        return f"{self.term}{self.year}"

    @property
    def season(self) -> str:
        return _SEASON_NAMES[self.term]

    def soc_params(self, campus: str) -> dict[str, str]:
        """Query parameters for the Schedule of Classes API."""
        return {"year": str(self.year), "term": str(self.term), "campus": campus}

    def __str__(self) -> str:
        return f"{self.season} {self.year}"
