"""Bridge client: engine side of voice bridge v1 (see bridge/PROTOCOL.md)."""
import asyncio
import json
import logging

import websockets

from .util import now_ms

log = logging.getLogger("bridge")


class Bridge:
    def __init__(self, url: str, session_id: str, on_message, counters: dict) -> None:
        self.url, self.session_id, self.on_message, self.c = url, session_id, on_message, counters
        self.ws = None
        self._reader: asyncio.Task | None = None
        self.closed = False

    async def connect(self) -> None:
        self.ws = await websockets.connect(self.url, max_size=None, ping_interval=None)
        self._reader = asyncio.create_task(self._read(), name=f"bridge-reader-{self.session_id}")

    async def _read(self) -> None:
        try:
            async for raw in self.ws:
                try:
                    m = json.loads(raw)
                except Exception:
                    self.c["bridge_bad_in"] = self.c.get("bridge_bad_in", 0) + 1
                    continue
                self.c["bridge_in"] = self.c.get("bridge_in", 0) + 1
                await self.on_message(m)
        except websockets.ConnectionClosed:
            pass
        finally:
            self.closed = True

    async def send(self, type_: str, **fields) -> None:
        if self.ws is None or self.closed:
            return
        msg = {"type": type_, "sessionId": self.session_id, "ts": now_ms(), **fields}
        self.c["bridge_out"] = self.c.get("bridge_out", 0) + 1
        try:
            await self.ws.send(json.dumps(msg, ensure_ascii=False))
        except websockets.ConnectionClosed:
            self.closed = True

    async def close(self) -> None:
        self.closed = True
        if self.ws is not None:
            try:
                await self.ws.close()
            except Exception:
                pass
        if self._reader:
            self._reader.cancel()
            try:
                await self._reader
            except (asyncio.CancelledError, Exception):
                pass
