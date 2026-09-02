"""Per-process pub/sub hub.

Maintains the set of locally-connected WebSockets and bridges them to Redis
pub/sub channels. One background task per process pattern-subscribes to
`user:*` and `thread:*`; incoming Redis messages are routed to the matching
local sockets. Outgoing messages are published to Redis so every worker's
hub delivers to its own local sockets.

All conversation fanout routes through per-USER channels (see fanout.py) — a
member added mid-session receives events without resubscribing, and sockets
don't need per-conversation bookkeeping.
"""
import asyncio
import json
import logging
from collections import defaultdict
from typing import Any

import redis.asyncio as aioredis
from fastapi import WebSocket

from app.config import settings
from app.ws.events import thread_channel, user_channel

log = logging.getLogger("kryptovox.ws")


class Hub:
    def __init__(self) -> None:
        self._user_subs: dict[str, set[WebSocket]] = defaultdict(set)
        self._thread_subs: dict[str, set[WebSocket]] = defaultdict(set)
        self._redis: aioredis.Redis | None = None
        self._listener: asyncio.Task | None = None

    async def start(self) -> None:
        self._redis = aioredis.from_url(
            settings.redis_url, encoding="utf-8", decode_responses=True
        )
        self._listener = asyncio.create_task(self._listen())

    async def stop(self) -> None:
        if self._listener:
            self._listener.cancel()
        if self._redis:
            await self._redis.aclose()

    async def _listen(self) -> None:
        assert self._redis is not None
        pubsub = self._redis.pubsub()
        await pubsub.psubscribe("user:*", "thread:*")
        try:
            async for msg in pubsub.listen():
                if msg.get("type") != "pmessage":
                    continue
                channel: str = msg["channel"]
                try:
                    envelope = json.loads(msg["data"])
                except (ValueError, TypeError):
                    continue
                await self._deliver_local(channel, envelope)
        except asyncio.CancelledError:
            await pubsub.aclose()
            raise

    async def _deliver_local(self, channel: str, envelope: dict[str, Any]) -> None:
        if channel.startswith("user:"):
            targets = list(self._user_subs.get(channel[5:], ()))
        elif channel.startswith("thread:"):
            targets = list(self._thread_subs.get(channel[7:], ()))
        else:
            return
        # A thread envelope carries `_src` (the originating connection id) so the
        # sender skips its own echo, and an optional `_to` (a target connection
        # id) so a 1:1 call frame reaches only the paired peer — not every other
        # holder of the secret link.
        src = envelope.get("_src")
        to = envelope.get("_to")
        for ws in targets:
            ws_src = getattr(ws, "_kv_src", None)
            if src is not None and ws_src == src:
                continue
            if to is not None and ws_src != to:
                continue
            try:
                await ws.send_json(envelope)
            except Exception:  # noqa: BLE001 — drop dead sockets silently
                pass

    # ---- connection registration ----
    def register(self, ws: WebSocket, user_id: str) -> None:
        self._user_subs[user_id].add(ws)

    def register_thread(self, ws: WebSocket, thread_id: str) -> None:
        self._thread_subs[thread_id].add(ws)

    @staticmethod
    def _discard(subs: dict[str, set[WebSocket]], key: str, ws: WebSocket) -> None:
        # Drop the key once its set empties — otherwise a long-lived process
        # accumulates an entry per user/thread that ever connected.
        bucket = subs.get(key)
        if bucket is None:
            return
        bucket.discard(ws)
        if not bucket:
            subs.pop(key, None)

    def unregister_thread(self, ws: WebSocket, thread_id: str) -> None:
        self._discard(self._thread_subs, thread_id, ws)

    def unregister(self, ws: WebSocket, user_id: str) -> None:
        self._discard(self._user_subs, user_id, ws)

    # ---- publishing ----
    async def publish_user(self, user_id: str, envelope: dict[str, Any]) -> None:
        await self._publish(user_channel(user_id), envelope)

    async def publish_thread(self, thread_id: str, envelope: dict[str, Any]) -> None:
        await self._publish(thread_channel(thread_id), envelope)

    async def publish_users(self, user_ids: list[str], envelope: dict[str, Any]) -> None:
        """Publish one envelope to many user channels in a single pipelined round
        trip — conversation fanout was doing one awaited PUBLISH per member, which
        scaled with group size."""
        if not user_ids:
            return
        if self._redis is None:
            log.warning("Hub not started; dropping fanout to %d user(s)", len(user_ids))
            return
        data = json.dumps(envelope, default=str)
        try:
            async with self._redis.pipeline(transaction=False) as pipe:
                for uid in user_ids:
                    pipe.publish(user_channel(uid), data)
                await pipe.execute()
        except Exception as exc:  # noqa: BLE001 — best-effort realtime fanout
            log.warning("Hub fanout to %d user(s) failed (Redis): %s", len(user_ids), exc)

    async def _publish(self, channel: str, envelope: dict[str, Any]) -> None:
        if self._redis is None:
            log.warning("Hub not started; dropping publish to %s", channel)
            return
        # Best-effort: a Redis blip drops the real-time fanout for this event but
        # must not fail the request that triggered it (the message is already
        # persisted; clients reconcile on reconnect / next fetch).
        try:
            await self._redis.publish(channel, json.dumps(envelope, default=str))
        except Exception as exc:  # noqa: BLE001
            log.warning("Hub publish to %s failed (Redis): %s", channel, exc)


hub = Hub()
