"""Local-only HTTP server. Lets the dev site fire real agent runs.

NOT intended for production deployment. Phase 3 replaces this with API
Gateway + Fargate using the same JSON contract.
"""

from __future__ import annotations

import os
import threading
import uuid
from datetime import date as _date
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import __version__
from .env import load_env, project_root
from .meter import (
    SpendLedger,
    estimate_run_cost,
    get_caps_from_env,
)
from .runner import RunRequest, execute
from .synthesizer import synthesize


load_env()


JOBS: dict[str, dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()


class HealthResp(BaseModel):
    ok: bool
    version: str
    monthSpentUsd: float
    daySpentUsd: float
    monthlyCapUsd: float
    dailyCapUsd: float
    anthropicConfigured: bool


class RunReq(BaseModel):
    ticker: str = Field(min_length=1, max_length=10)
    asOfDate: str | None = None
    model: str = "haiku"  # alias as in cli_run.py
    depth: int = Field(default=1, ge=0, le=3)


class RunStartResp(BaseModel):
    jobId: str
    estimatedCostUsd: float


class JobResp(BaseModel):
    jobId: str
    state: str  # "queued" | "running" | "done" | "error"
    error: str | None = None
    runId: str | None = None
    decision: str | None = None
    actualCostUsd: float | None = None


class SynthReq(BaseModel):
    portfolioPath: str
    model: str = "haiku"


def _ledger_path() -> Path:
    return project_root() / ".spend.json"


def _new_job() -> str:
    jid = uuid.uuid4().hex[:12]
    with JOBS_LOCK:
        JOBS[jid] = {"state": "queued"}
    return jid


def _set_job(jid: str, **fields: Any) -> None:
    with JOBS_LOCK:
        JOBS[jid] = {**JOBS.get(jid, {}), **fields}


def _get_job(jid: str) -> dict[str, Any] | None:
    with JOBS_LOCK:
        return JOBS.get(jid)


def _do_run(jid: str, req: RunReq) -> None:
    from .cli_run import MODEL_ALIAS

    if req.model not in MODEL_ALIAS:
        _set_job(jid, state="error", error=f"unknown model {req.model!r}")
        return

    deep_model, quick_model = MODEL_ALIAS[req.model]
    as_of = req.asOfDate or _date.today().isoformat()
    rr = RunRequest(
        ticker=req.ticker.upper(),
        as_of_date=as_of,
        deep_model=deep_model,
        quick_model=quick_model,
        debate_rounds=req.depth,
    )

    _set_job(jid, state="running")
    try:
        result = execute(rr)
        _set_job(
            jid,
            state="done",
            runId=result.run.id,
            decision=result.run.decision,
            actualCostUsd=round(result.actual_cost_usd, 4),
        )
    except Exception as e:  # noqa: BLE001 — surface anything to the UI
        _set_job(jid, state="error", error=str(e))


def _do_synth(jid: str, req: SynthReq) -> None:
    from .cli_synthesize import MODEL_ALIAS

    if req.model not in MODEL_ALIAS:
        _set_job(jid, state="error", error=f"unknown model {req.model!r}")
        return

    _set_job(jid, state="running")
    try:
        path = Path(req.portfolioPath).expanduser()
        synth = synthesize(path, MODEL_ALIAS[req.model])
        _set_job(
            jid,
            state="done",
            runId=synth.id,
            actualCostUsd=round(synth.usage.costUsd, 4),
        )
    except Exception as e:  # noqa: BLE001
        _set_job(jid, state="error", error=str(e))


app = FastAPI(title="yeyaxin agent-runner", version=__version__)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3007",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3007",
    ],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/health", response_model=HealthResp)
def health() -> HealthResp:
    daily_cap, monthly_cap = get_caps_from_env()
    ledger = SpendLedger.load(_ledger_path())
    today = _date.today()
    today_str = today.isoformat()
    month_str = today.strftime("%Y-%m")
    day_spent = ledger.day_spent_usd if ledger.day == today_str else 0.0
    month_spent = ledger.month_spent_usd if ledger.month == month_str else 0.0
    return HealthResp(
        ok=True,
        version=__version__,
        monthSpentUsd=round(month_spent, 4),
        daySpentUsd=round(day_spent, 4),
        monthlyCapUsd=monthly_cap,
        dailyCapUsd=daily_cap,
        anthropicConfigured=bool(os.environ.get("ANTHROPIC_API_KEY")),
    )


@app.post("/run", response_model=RunStartResp)
def start_run(req: RunReq, background_tasks: BackgroundTasks) -> RunStartResp:
    from .cli_run import MODEL_ALIAS

    if req.model not in MODEL_ALIAS:
        raise HTTPException(status_code=400, detail=f"unknown model alias {req.model}")

    deep_model, _ = MODEL_ALIAS[req.model]
    estimated = estimate_run_cost(deep_model)

    daily_cap, monthly_cap = get_caps_from_env()
    ledger = SpendLedger.load(_ledger_path())
    ok, why = ledger.can_spend(estimated, _date.today(), daily_cap, monthly_cap)
    if not ok:
        raise HTTPException(status_code=402, detail=why)

    jid = _new_job()
    background_tasks.add_task(_do_run, jid, req)
    return RunStartResp(jobId=jid, estimatedCostUsd=round(estimated, 4))


@app.post("/synthesize", response_model=RunStartResp)
def start_synth(req: SynthReq, background_tasks: BackgroundTasks) -> RunStartResp:
    from .meter import cost_for

    estimated = cost_for("claude-haiku-4-5", 5_000, 3_000)
    daily_cap, monthly_cap = get_caps_from_env()
    ledger = SpendLedger.load(_ledger_path())
    ok, why = ledger.can_spend(estimated, _date.today(), daily_cap, monthly_cap)
    if not ok:
        raise HTTPException(status_code=402, detail=why)

    jid = _new_job()
    background_tasks.add_task(_do_synth, jid, req)
    return RunStartResp(jobId=jid, estimatedCostUsd=round(estimated, 4))


@app.get("/jobs/{job_id}", response_model=JobResp)
def get_job(job_id: str) -> JobResp:
    job = _get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="unknown job")
    return JobResp(jobId=job_id, **job)


def main() -> None:
    host = os.environ.get("AGENT_SERVER_HOST", "127.0.0.1")
    port = int(os.environ.get("AGENT_SERVER_PORT", "8787"))
    uvicorn.run("agent_runner.server:app", host=host, port=port, reload=False, log_level="info")


if __name__ == "__main__":
    main()
