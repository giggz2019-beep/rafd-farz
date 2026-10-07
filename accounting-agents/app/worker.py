"""24/7 agent runtime: pulls jobs from the queue and runs the workflows.

This is the unattended runtime. It calls the Claude API directly with its own
ANTHROPIC_API_KEY — it does not use Claude Code or a Claude subscription.

Recovery: on start-up every job still marked "running" (the process died
mid-job) or "failed" with a retryable cause is re-run; completed steps are
skipped and finished tool calls are replayed from the idempotency store.
"""
from __future__ import annotations

import logging
import signal
import time

from .api.queue import JobQueue, make_queue
from .config import Settings
from .daftra.adapter import DaftraUnavailable
from .llm.client import ClaudeLLM, LLMUnavailable
from .orchestration.services import build_services
from .orchestration.workflows import Agents, JobFailed, JobRunner

log = logging.getLogger("rafd.worker")
RETRYABLE = (LLMUnavailable.__name__, DaftraUnavailable.__name__, "ApprovalRequired")
MAX_ATTEMPTS = 5


def run_job(runner: JobRunner, job: dict) -> dict:
    if job["kind"] == "purchase-invoice":
        return runner.process_purchase_invoice(job["job_id"], job["invoice"])
    if job["kind"] == "sales-invoice":
        return runner.process_sales_invoice(job["job_id"], job["invoice"], job.get("context"))
    raise ValueError(f"unknown job kind {job['kind']}")


def recover(runner: JobRunner, queue: JobQueue) -> int:
    n = 0
    for j in runner.s.store.list(JobRunner.KIND):
        retryable = j["status"] == "failed" and any(c in j.get("error", "") for c in RETRYABLE)
        if (j["status"] == "running" or retryable) and j.get("attempts", 0) < MAX_ATTEMPTS:
            kind = "purchase-invoice" if j["workflow"] == "purchase_invoice" else "sales-invoice"
            queue.enqueue({"kind": kind, "job_id": j["id"], **j["payload"]})
            n += 1
    return n


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = Settings.from_env()
    if not settings.anthropic_api_key:
        raise SystemExit("ANTHROPIC_API_KEY is required for the worker (Claude API, billed separately)")
    services = build_services(settings)
    llm = ClaudeLLM(settings.anthropic_api_key, settings.claude_model, use_fallbacks=settings.claude_fallbacks)
    runner = JobRunner(services, Agents.build(services, llm))
    queue = make_queue(settings)
    log.info("recovered %d interrupted job(s)", recover(runner, queue))

    stop = False

    def _stop(*_):
        nonlocal stop
        stop = True
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    while not stop:
        job = queue.dequeue(timeout=5)
        if job is None:
            continue
        try:
            result = run_job(runner, job)
            log.info("job %s → %s", job["job_id"], result["status"])
        except JobFailed as exc:
            stored = services.store.get(JobRunner.KIND, job["job_id"]) or {}
            if any(c in str(exc) for c in RETRYABLE) and stored.get("attempts", 0) < MAX_ATTEMPTS:
                delay = min(2 ** stored.get("attempts", 1), 300)
                log.warning("job %s retryable failure, retry in %ss: %s", job["job_id"], delay, exc)
                time.sleep(delay)
                queue.enqueue(job)
            else:
                log.error("job %s failed permanently: %s", job["job_id"], exc)


if __name__ == "__main__":
    main()
