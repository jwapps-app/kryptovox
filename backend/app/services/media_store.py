"""Filesystem store for encrypted media blobs.

The server only ever holds ciphertext — blobs are AES-GCM encrypted on the
client before upload and decrypted on the recipient's device. Files are named by
a random id and live flat under settings.media_dir.
"""
import os
import time
import uuid

from app.config import settings

_SAFE = set("0123456789abcdef")


def _path(media_id: str) -> str:
    # ids are uu4 hex; reject anything else so a crafted id can't escape the dir.
    if not media_id or len(media_id) > 64 or any(c not in _SAFE for c in media_id):
        raise ValueError("bad media id")
    return os.path.join(settings.media_dir, media_id)


def save(data: bytes) -> str:
    os.makedirs(settings.media_dir, exist_ok=True)
    media_id = uuid.uuid4().hex
    with open(_path(media_id), "wb") as f:
        f.write(data)
    return media_id


def load(media_id: str) -> bytes | None:
    try:
        path = _path(media_id)
    except ValueError:
        return None
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        return f.read()


def delete(media_id: str) -> None:
    try:
        path = _path(media_id)
    except ValueError:
        return
    try:
        os.remove(path)
    except OSError:
        pass


def list_ids(min_age_seconds: float = 0.0) -> list[str]:
    """Ids of stored blobs whose file is at least `min_age_seconds` old. The age
    floor keeps the orphan GC from reaping a blob that was just uploaded but whose
    referencing row hasn't been written yet (uploads precede the message insert)."""
    d = settings.media_dir
    if not os.path.isdir(d):
        return []
    cutoff = time.time() - min_age_seconds
    out: list[str] = []
    for name in os.listdir(d):
        path = os.path.join(d, name)
        try:
            if os.path.isfile(path) and os.path.getmtime(path) <= cutoff:
                out.append(name)
        except OSError:
            continue
    return out
