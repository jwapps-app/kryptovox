"""The resource-limit caps and the public-user field redaction added in the
security pass — guard against silent regressions."""
import pytest
from pydantic import ValidationError

from app.schemas import MessageCreate, PublicUserOut, UserOut


def _valid_message(**over):
    base = dict(ciphertext="aGk", iv="x" * 16, encrypted_keys={"u": "k"}, type="text")
    base.update(over)
    return MessageCreate(**base)


def test_message_accepts_normal_payload():
    m = _valid_message()
    assert m.type == "text"


def test_message_rejects_oversized_ciphertext():
    with pytest.raises(ValidationError):
        _valid_message(ciphertext="a" * 300_000)


def test_message_rejects_too_many_recipient_keys():
    with pytest.raises(ValidationError):
        _valid_message(encrypted_keys={str(i): "k" for i in range(600)})


def test_message_rejects_oversized_wrapped_key():
    with pytest.raises(ValidationError):
        _valid_message(encrypted_keys={"u": "k" * 2000})


def test_public_user_out_hides_security_posture():
    hidden = {"is_admin", "twofa_enabled", "has_recovery"}
    assert hidden.isdisjoint(PublicUserOut.model_fields)
    # The full self-view still exposes them.
    assert hidden.issubset(UserOut.model_fields)
