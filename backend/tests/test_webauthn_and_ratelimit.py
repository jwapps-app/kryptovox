"""WebAuthn challenge tokens + the rate-limit client-IP derivation."""
import uuid

import pytest
from jwt import InvalidTokenError
from starlette.requests import Request

from app.ratelimit import client_ip
from app.security import create_access_token
from app.services.webauthn_svc import (
    create_challenge_token,
    decode_challenge_token,
    rp_and_origin,
)


def _request(headers: dict, client_host: str | None = "203.0.113.9") -> Request:
    scope = {
        "type": "http",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "client": (client_host, 12345) if client_host else None,
    }
    return Request(scope)


def test_challenge_token_roundtrip():
    uid = uuid.uuid4()
    tok = create_challenge_token(uid, "Y2hhbGxlbmdl")
    got_uid, ch = decode_challenge_token(tok)
    assert got_uid == uid
    assert ch == "Y2hhbGxlbmdl"


def test_non_challenge_token_rejected():
    with pytest.raises(InvalidTokenError):
        decode_challenge_token(create_access_token(uuid.uuid4(), uuid.uuid4()))


def test_rp_and_origin_derives_from_origin_header():
    req = _request({"origin": "https://chat.example.com"})
    rp_id, origin = rp_and_origin(req)
    assert rp_id == "chat.example.com"
    assert origin == "https://chat.example.com"


def test_client_ip_prefers_cf_connecting_ip():
    req = _request(
        {"cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1"},
        client_host="5.5.5.5",
    )
    assert client_ip(req) == "9.9.9.9"


def test_client_ip_ignores_spoofable_forwarded_for():
    # No CF header: must fall back to the socket peer, NOT the client-set XFF.
    req = _request({"x-forwarded-for": "1.1.1.1"}, client_host="5.5.5.5")
    assert client_ip(req) == "5.5.5.5"


def test_client_ip_falls_back_to_peer():
    assert client_ip(_request({}, client_host="5.5.5.5")) == "5.5.5.5"
