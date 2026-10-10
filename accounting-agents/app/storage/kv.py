"""Tiny key-value seam so domain classes persist through the same Store in
production (shared by API and worker) and stay dependency-free in unit tests."""
from __future__ import annotations

import copy
from typing import Protocol

from .store import Store


class KV(Protocol):
    def get(self, ns: str, key: str) -> dict | None: ...
    def add(self, ns: str, key: str, data: dict) -> bool: ...   # insert-only; False if present
    def put(self, ns: str, key: str, data: dict) -> None: ...
    def list(self, ns: str) -> list[dict]: ...


class MemoryKV:
    def __init__(self) -> None:
        self._d: dict[str, dict[str, dict]] = {}

    def get(self, ns, key):
        v = self._d.get(ns, {}).get(key)
        return copy.deepcopy(v) if v is not None else None

    def add(self, ns, key, data):
        bucket = self._d.setdefault(ns, {})
        if key in bucket:
            return False
        bucket[key] = copy.deepcopy(data)
        return True

    def put(self, ns, key, data):
        self._d.setdefault(ns, {})[key] = copy.deepcopy(data)

    def list(self, ns):
        return [copy.deepcopy(v) for v in self._d.get(ns, {}).values()]


class StoreKV:
    def __init__(self, store: Store):
        self.store = store

    def get(self, ns, key):
        d = self.store.get(ns, key)
        if d is not None:
            d.pop("_version", None)
        return d

    def add(self, ns, key, data):
        return self.store.put_if_absent(ns, key, data)

    def put(self, ns, key, data):
        self.store.put(ns, key, data)

    def list(self, ns):
        out = self.store.list(ns)
        for d in out:
            d.pop("_version", None)
        return out
