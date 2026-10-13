"""Encrypted secrets at rest (Fernet: AES-128-CBC + HMAC-SHA256).

The master key comes from ``SECRETS_MASTER_KEY`` (generate with
``python -m app.security.secrets``) and must live outside the database and the
repository — a Docker secret or the VPS's environment, never ``.env`` in git.
"""
from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken

from ..storage.store import Store


class SecretError(RuntimeError):
    pass


class SecretStore:
    KIND = "secret"

    def __init__(self, store: Store, master_key: str):
        if not master_key:
            raise SecretError("SECRETS_MASTER_KEY is not set")
        try:
            self._f = Fernet(master_key.encode())
        except ValueError as exc:
            raise SecretError("SECRETS_MASTER_KEY is not a valid Fernet key") from exc
        self.store = store

    def set(self, name: str, value: str) -> None:
        self.store.put(self.KIND, name, {"ciphertext": self._f.encrypt(value.encode()).decode()})

    def get(self, name: str) -> str | None:
        d = self.store.get(self.KIND, name)
        if not d:
            return None
        try:
            return self._f.decrypt(d["ciphertext"].encode()).decode()
        except InvalidToken as exc:
            raise SecretError(f"secret {name!r} cannot be decrypted with this key") from exc


if __name__ == "__main__":
    print(Fernet.generate_key().decode())
