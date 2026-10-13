"""LLM access for the runtime agents (Claude API).

Design rule: the model classifies, explains and recommends — it never produces
an amount that gets posted. Every response is constrained to a JSON schema
(structured outputs) and validated with Pydantic before any code acts on it.

The Claude API is billed separately from any Claude/Claude Code subscription:
the runtime needs its own ANTHROPIC_API_KEY from console.anthropic.com.
"""
from __future__ import annotations

import json
from typing import Callable, Protocol, TypeVar

from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)


class LLMError(RuntimeError):
    """Non-retryable: refusal, truncation, invalid output, 4xx."""


class LLMUnavailable(RuntimeError):
    """Retryable: rate limit, overload, network."""


class LLM(Protocol):
    def structured(self, *, system: str, user: str, schema: type[T], effort: str = "medium") -> T: ...


class ClaudeLLM:
    def __init__(self, api_key: str, model: str = "claude-opus-5-5", *, use_fallbacks: bool = True,
                 timeout: float = 120.0, max_retries: int = 2):
        import anthropic
        self._anthropic = anthropic
        self.client = anthropic.Anthropic(api_key=api_key, timeout=timeout, max_retries=max_retries)
        self.model = model
        self.use_fallbacks = use_fallbacks

    def structured(self, *, system: str, user: str, schema: type[T], effort: str = "medium") -> T:
        a = self._anthropic
        params = dict(
            model=self.model, max_tokens=16000, system=system,
            messages=[{"role": "user", "content": user}],
            output_config={"effort": effort,
                           "format": {"type": "json_schema", "schema": schema.model_json_schema()}},
        )
        try:
            if self.use_fallbacks:
                # Server-side refusal fallback (beta): a declined request is re-run on a
                # fallback model chosen by refusal category instead of failing outright.
                resp = self.client.beta.messages.create(**params, betas=["server-side-fallback-2026-07-01"],
                                                        fallbacks="default")
            else:
                resp = self.client.messages.create(**params)
        except (a.RateLimitError, a.APIConnectionError, a.InternalServerError) as exc:
            raise LLMUnavailable(str(exc)) from exc
        except a.APIStatusError as exc:
            if exc.status_code in (529,):
                raise LLMUnavailable(str(exc)) from exc
            raise LLMError(f"Claude API {exc.status_code}: {exc}") from exc

        if resp.stop_reason == "refusal":
            raise LLMError("model declined the request")
        if resp.stop_reason == "max_tokens":
            raise LLMError("response truncated at max_tokens")
        text = next((b.text for b in resp.content if b.type == "text"), None)
        if text is None:
            raise LLMError("no text block in response")
        try:
            return schema.model_validate_json(text)
        except ValidationError as exc:
            raise LLMError(f"model output failed validation: {exc}") from exc


class ScriptedLLM:
    """Deterministic stand-in for tests and offline evals.

    ``responses`` maps a schema class name to a dict, a list of dicts (consumed in
    order), an Exception instance (raised), or a callable(system, user) -> dict.
    """
    def __init__(self, responses: dict[str, object] | None = None):
        self.responses = dict(responses or {})
        self.calls: list[dict] = []

    def structured(self, *, system: str, user: str, schema: type[T], effort: str = "medium") -> T:
        self.calls.append({"schema": schema.__name__, "system": system, "user": user, "effort": effort})
        r = self.responses.get(schema.__name__)
        if r is None:
            raise LLMError(f"no scripted response for {schema.__name__}")
        if isinstance(r, list):
            if not r:
                raise LLMError(f"scripted responses for {schema.__name__} exhausted")
            r = r.pop(0)
        if isinstance(r, Exception):
            raise r
        if callable(r):
            r = r(system, user)
        try:
            return schema.model_validate_json(json.dumps(r))
        except ValidationError as exc:
            raise LLMError(f"scripted output failed validation: {exc}") from exc
