"""Agent base: spec, restricted tool access, structured LLM decisions, audit."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypeVar

from pydantic import BaseModel, ConfigDict

from ..llm.client import LLM, LLMError
from ..security.permissions import PERMISSIONS, Op, Role
from ..orchestration.services import Services

PROMPTS = Path(__file__).parent / "prompts"
T = TypeVar("T", bound=BaseModel)


class Strict(BaseModel):
    """Base for every agent input/output: unknown fields are rejected."""
    model_config = ConfigDict(extra="forbid")


class ToolNotAllowed(PermissionError):
    pass


@dataclass(frozen=True)
class AgentSpec:
    role: Role
    title: str
    responsibility: str
    tools: frozenset[str]
    effort: str = "medium"

    @property
    def prompt_path(self) -> Path:
        return PROMPTS / f"{self.role.value}.md"

    @property
    def operations(self) -> frozenset[Op]:
        return PERMISSIONS[self.role]


class Agent:
    spec: AgentSpec

    def __init__(self, services: Services, llm: LLM | None = None):
        self.s, self.llm = services, llm
        # Fail fast at construction: every declared tool must be one this role may use.
        for name in self.spec.tools:
            if self.s.gateway.tool(name).op not in self.spec.operations:
                raise ToolNotAllowed(f"{self.spec.role.value} declares {name} without holding its operation")

    @property
    def role(self) -> Role:
        return self.spec.role

    @property
    def system_prompt(self) -> str:
        return self.spec.prompt_path.read_text(encoding="utf-8")

    def tool(self, name: str, payload: dict, *, key: str, approval_id: str | None = None) -> Any:
        if name not in self.spec.tools:
            self.s.audit.record(self.role.value, f"tool.{name}", key, "denied", {"reason": "not in agent toolset"})
            raise ToolNotAllowed(f"{self.role.value} may not use {name}")
        return self.s.gateway.call(self.role, name, payload, idempotency_key=key, approval_id=approval_id)

    def decide(self, schema: type[T], payload: dict, *, key: str) -> T:
        """Ask the model for a structured decision; audited with the validated output."""
        if self.llm is None:
            raise LLMError(f"{self.role.value} has no LLM configured")
        import json
        out = self.llm.structured(system=self.system_prompt, user=json.dumps(payload, ensure_ascii=False, default=str),
                                  schema=schema, effort=self.spec.effort)
        self.s.audit.record(self.role.value, f"decision.{schema.__name__}", key, "made", out.model_dump())
        return out
