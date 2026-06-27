"""Per-process pub/sub hub.

Maintains the set of locally-connected WebSockets and bridges them to Redis
pub/sub channels. One background task per process pattern-subscribes to
`conv:*` and `user:*`; incoming Redis messages are routed to the matching
local sockets. Outgoing messages are published to Redis so every worker's
hub delivers to its own local sockets.
"""
import asyncio
import json
import logging
from collections import defaultdict
from typing import Any

import redis.asyncio as aioredis
from fastapi import WebSocket

from app.config import settings
from app.ws.events import conv_channel, thread_channel, user_channel

log = logging.getLogger("kryptovox.ws")


class Hub:
    def __init__(self) -> None:
        self._conv_subs: dict[str, set[WebSocket]] = defaultdict(set)
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
        await pubsub.psubscribe("conv:*", "user:*", "thread:*")
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
        if channel.startswith("conv:"):
            targets = list(self._conv_subs.get(channel[5:], ()))
        elif channel.startswith("user:"):
            targets = list(self._user_subs.get(channel[5:], ()))
        elif channel.startswith("thread:"):
            targets = list(self._thread_subs.get(channel[7:], ()))
        else:
            return
        # A thread envelope carries `_src` (the originating connection id) so the
        # sender's own socket can skip its echo.
        src = envelope.get("_src")
        for ws in targets:
            if src is not None and getattr(ws, "_kv_src", None) == src:
                continue
            try:
                await ws.send_json(envelope)
            except Exception:  # noqa: BLE001 — drop dead sockets silently
                pass

    # ---- connection registration ----
    def register(
        self, ws: WebSocket, user_id: str, conversation_ids: list[str]
    ) -> None:
        self._user_subs[user_id].add(ws)
        for cid in conversation_ids:
            self._conv_subs[cid].add(ws)

    def add_conversation(self, ws: WebSocket, conversation_id: str) -> None:
        self._conv_subs[conversation_id].add(ws)

    def register_thread(self, ws: WebSocket, thread_id: str) -> None:
        self._thread_subs[thread_id].add(ws)

    def unregister_thread(self, ws: WebSocket, thread_id: str) -> None:
        self._thread_subs.get(thread_id, set()).discard(ws)

    def unregister(
        self, ws: WebSocket, user_id: str, conversation_ids: list[str]
    ) -> None:
        self._user_subs.get(user_id, set()).discard(ws)
        for cid in conversation_ids:
            self._conv_subs.get(cid, set()).discard(ws)

    # ---- publishing ----
    async def publish_conv(self, conversation_id: str, envelope: dict[str, Any]) -> None:
        await self._publish(conv_channel(conversation_id), envelope)

    async def publish_user(self, user_id: str, envelope: dict[str, Any]) -> None:
        await self._publish(user_channel(user_id), envelope)

    async def publish_thread(self, thread_id: str, envelope: dict[str, Any]) -> None:
        await self._publish(thread_channel(thread_id), envelope)

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
