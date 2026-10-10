"""Job queue: Redis in production, in-memory for tests and single-process dev."""
from __future__ import annotations

import json
from collections import deque
from typing import Protocol

from ..config import Settings


class JobQueue(Protocol):
    def enqueue(self, job: dict) -> None: ...
    def dequeue(self, timeout: int = 5) -> dict | None: ...


class MemoryQueue:
    def __init__(self) -> None:
        self.q: deque[dict] = deque()

    def enqueue(self, job: dict) -> None:
        self.q.append(job)

    def dequeue(self, timeout: int = 5) -> dict | None:
        return self.q.popleft() if self.q else None


class RedisQueue:
    KEY = "rafd:jobs"

    def __init__(self, url: str):
        import redis
        self.r = redis.Redis.from_url(url)

    def enqueue(self, job: dict) -> None:
        self.r.lpush(self.KEY, json.dumps(job))

    def dequeue(self, timeout: int = 5) -> dict | None:
        item = self.r.brpop([self.KEY], timeout=timeout)
        return json.loads(item[1]) if item else None


def make_queue(settings: Settings) -> JobQueue:
    return RedisQueue(settings.redis_url) if settings.redis_url else MemoryQueue()
