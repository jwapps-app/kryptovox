"""Unit tests for the security-critical auth helpers (no DB/network needed)."""
import uuid

import pyotp
import pytest
from jwt import InvalidTokenError

from app.security import (
    consume_totp,
    create_access_token,
    create_pending_2fa_token,
    decode_access_token,
    decode_pending_2fa_token,
    generate_backup_codes,
    hash_backup_code,
)


class FakeUser:
    def __init__(self, secret):
        self.totp_secret = secret
        self.totp_last_step = None


def test_consume_totp_accepts_current_code():
    secret = pyotp.random_base32()
    user = FakeUser(secret)
    code = pyotp.TOTP(secret).now()
    assert consume_totp(user, code) is True
    assert user.totp_last_step is not None


def test_consume_totp_rejects_replay_of_same_code():
    secret = pyotp.random_base32()
    user = FakeUser(secret)
    code = pyotp.TOTP(secret).now()
    assert consume_totp(user, code) is True
    # Same code, same window → must be rejected as a replay.
    assert consume_totp(user, code) is False


def test_consume_totp_rejects_wrong_code():
    secret = pyotp.random_base32()
    user = FakeUser(secret)
    current = pyotp.TOTP(secret).now()
    wrong = "000000" if current != "000000" else "111111"
    assert consume_totp(user, wrong) is False


def test_consume_totp_without_secret():
    assert consume_totp(FakeUser(None), "123456") is False


def test_backup_codes_generation_and_hashing():
    codes = generate_backup_codes(8)
    assert len(codes) == 8
    assert all("-" in c for c in codes)
    assert len(set(codes)) == 8  # unique
    # Hash is stable and dash/case-insensitive; distinct codes differ.
    c = codes[0]
    assert hash_backup_code(c) == hash_backup_code(c.upper().replace("-", ""))
    assert hash_backup_code(codes[0]) != hash_backup_code(codes[1])


def test_pending_2fa_token_roundtrip_with_jti():
    uid = uuid.uuid4()
    tok = create_pending_2fa_token(uid)
    got_uid, jti = decode_pending_2fa_token(tok)
    assert got_uid == uid
    assert jti  # non-empty single-use id
    # Two tokens for the same user get distinct jtis.
    _, jti2 = decode_pending_2fa_token(create_pending_2fa_token(uid))
    assert jti != jti2


def test_access_token_not_accepted_as_pending_and_vice_versa():
    uid, did = uuid.uuid4(), uuid.uuid4()
    access = create_access_token(uid, did)
    claims = decode_access_token(access)
    assert claims["sub"] == str(uid) and claims["did"] == str(did)
    with pytest.raises(InvalidTokenError):
        decode_pending_2fa_token(access)
    with pytest.raises(InvalidTokenError):
        decode_access_token(create_pending_2fa_token(uid))
