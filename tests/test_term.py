"""Tests for Rutgers term-code encoding."""

from __future__ import annotations

import pytest

from rusnipez.soc.term import FALL, SPRING, Term


class TestParse:
    def test_round_trips_webreg_code(self) -> None:
        assert Term.parse("92026").code == "92026"

    def test_splits_term_digit_from_year(self) -> None:
        term = Term.parse("92026")
        assert (term.term, term.year) == (FALL, 2026)

    @pytest.mark.parametrize("bad", ["", "9202", "920266", "x2026", "9 2026"])
    def test_rejects_malformed(self, bad: str) -> None:
        with pytest.raises(ValueError, match="5-digit term code"):
            Term.parse(bad)


class TestValidation:
    def test_rejects_unknown_season(self) -> None:
        with pytest.raises(ValueError, match="term must be one of"):
            Term(2026, 5)

    def test_rejects_implausible_year(self) -> None:
        with pytest.raises(ValueError, match="year out of range"):
            Term(1899, FALL)


class TestEncoding:
    def test_soc_params_split_year_and_term(self) -> None:
        assert Term(2026, FALL).soc_params("NB") == {"year": "2026", "term": "9", "campus": "NB"}

    def test_webreg_code_concatenates_term_first(self) -> None:
        assert Term(2027, SPRING).code == "12027"

    def test_human_readable(self) -> None:
        assert str(Term(2026, FALL)) == "Fall 2026"
