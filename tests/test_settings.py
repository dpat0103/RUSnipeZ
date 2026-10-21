from __future__ import annotations

import pytest
from pydantic import ValidationError

from rusnipez.settings import Settings


def test_active_terms_parse_from_comma_separated_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RUSNIPEZ_ACTIVE_TERMS", " 92026, 12027 ")
    assert Settings().active_terms == ["92026", "12027"]


@pytest.mark.parametrize("value", ["", "12027,12027", "52027", "1202"])
def test_invalid_active_terms_are_rejected(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv("RUSNIPEZ_ACTIVE_TERMS", value)
    with pytest.raises(ValidationError):
        Settings()


def test_precise_window_tracks_poll_interval() -> None:
    assert Settings(poll_seconds=30).precise_window_seconds == 90
