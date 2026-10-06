"""The resource-limit caps and the public-user field redaction added in the
security pass — guard against silent regressions."""
import pytest
from pydantic import ValidationError

from app.schemas import ApnsTokenIn, MessageCreate, PublicUserOut, UserOut


def test_apns_token_validation():
    t = ApnsTokenIn(apns_token="a" * 64, environment="sandbox", device_name="iPhone")
    assert t.environment == "sandbox"
    # environment must be sandbox|production
    with pytest.raises(ValidationError):
        ApnsTokenIn(apns_token="a" * 64, environment="staging")
    # too-short token rejected
    with pytest.raises(ValidationError):
        ApnsTokenIn(apns_token="abc")
    # default environment
    assert ApnsTokenIn(apns_token="a" * 64).environment == "production"


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


def test_step_up_password_required_for_factor_changes():
    from pydantic import ValidationError

    from app.schemas import RecoverySetupIn, StepUpIn

    with pytest.raises(ValidationError):
        StepUpIn()  # type: ignore[call-arg]
    assert StepUpIn(password="hunter22").password == "hunter22"
    blob = {"salt": "s", "iv": "i", "ciphertext": "c", "iterations": 600000}
    with pytest.raises(ValidationError):
        RecoverySetupIn(recovery_key_blob=blob, recovery_verifier="v" * 20)  # type: ignore[call-arg]


def test_login_request_accepts_legacy_password_for_upgrade():
    from app.schemas import LoginRequest, UserOut

    body = LoginRequest(username="alice", password="derived-secret", legacy_password="raw pw")
    assert body.legacy_password == "raw pw"
    assert LoginRequest(username="alice", password="derived-secret").legacy_password is None
    assert UserOut.model_fields["auth_version"].default == 1


def test_create_link_body_has_no_media_field():
    # create_link must not touch body.media — the schema has none (a stray
    # reference 500'd every link creation).
    from app.schemas import GuestThreadCreate

    assert "media" not in GuestThreadCreate.model_fields
    import inspect

    from app.routers import links

    src = inspect.getsource(links.create_link)
    assert "body.media" not in src


def test_db_dependency_commits_before_response():
    # Every get_db dependency must use scope="function" so the commit runs
    # before the response is sent (see get_db's docstring); a bare
    # Depends(get_db) would reintroduce the read-your-writes race.
    import pathlib

    offenders = [
        str(p)
        for p in pathlib.Path(__file__).resolve().parents[1].joinpath("app").rglob("*.py")
        if "Depends(get_db)" in p.read_text()
    ]
    assert offenders == []
