"""HTTP server for agent-runner. Runs locally (uvicorn) and on App Runner.

Auth: any request to /run, /synthesize, /jobs/{id} requires
Authorization: Bearer <password> matching env AGENT_PASSWORD. /health is open.

Spend ledger: DynamoDB (when DYNAMODB_TABLE is set) or local file (default).
"""

from __future__ import annotations

import os
import secrets
import threading
import uuid
from datetime import date as _date
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
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


def _ledger() -> Any:
    """Return either DynamoSpendLedger (when configured) or local file ledger."""
    table = os.environ.get("DYNAMODB_TABLE")
    if table:
        from .dynamo_ledger import DynamoSpendLedger

        return DynamoSpendLedger.load(table)
    return SpendLedger.load(project_root() / ".spend.json")


def _check_auth(request: Request) -> None:
    """Constant-time password check. Raises 401 if not allowed.

    AGENT_PASSWORD unset means auth is disabled (local dev default).
    """
    expected = os.environ.get("AGENT_PASSWORD")
    if not expected:
        return
    auth = request.headers.get("authorization", "")
    prefix = "Bearer "
    if not auth.startswith(prefix):
        raise HTTPException(status_code=401, detail="missing bearer token")
    provided = auth[len(prefix) :].strip()
    if not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="invalid password")


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
    portfolioId: str | None = None


class RunStartResp(BaseModel):
    jobId: str
    estimatedCostUsd: float


class JobResp(BaseModel):
    jobId: str
    state: str  # "queued" | "running" | "done" | "error"
    kind: str | None = None  # "run" | "synth"
    ticker: str | None = None
    portfolioId: str | None = None
    error: str | None = None
    runId: str | None = None
    decision: str | None = None
    actualCostUsd: float | None = None
    createdAt: str | None = None


class JobsListResp(BaseModel):
    jobs: list[JobResp]


class SynthReq(BaseModel):
    portfolioPath: str
    model: str = "haiku"
    portfolioId: str | None = None


class RunReqWithContext(RunReq):
    portfolioId: str | None = None


def _new_job(**context: Any) -> str:
    jid = uuid.uuid4().hex[:12]
    from datetime import datetime, timezone

    with JOBS_LOCK:
        JOBS[jid] = {
            "state": "queued",
            "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            **context,
        }
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
_default_origins = [
    "http://localhost:3000",
    "http://localhost:3007",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3007",
    "https://yeyaxin.com",
    "https://www.yeyaxin.com",
]
_extra = os.environ.get("CORS_EXTRA_ORIGINS", "").strip()
_origins = _default_origins + ([o.strip() for o in _extra.split(",") if o.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.get("/health", response_model=HealthResp)
def health() -> HealthResp:
    daily_cap, monthly_cap = get_caps_from_env()
    try:
        ledger = _ledger()
        day_spent = ledger.day_spent_usd
        month_spent = ledger.month_spent_usd
    except Exception:
        # If DynamoDB is unreachable, return 0 spend rather than 500ing the
        # health probe. Site treats /health failure as "agent server down".
        day_spent = 0.0
        month_spent = 0.0
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
def start_run(req: RunReq, request: Request, background_tasks: BackgroundTasks) -> RunStartResp:
    _check_auth(request)
    from .cli_run import MODEL_ALIAS

    if req.model not in MODEL_ALIAS:
        raise HTTPException(status_code=400, detail=f"unknown model alias {req.model}")

    deep_model, _ = MODEL_ALIAS[req.model]
    estimated = estimate_run_cost(deep_model)

    daily_cap, monthly_cap = get_caps_from_env()
    ledger = _ledger()
    ok, why = ledger.can_spend(estimated, _date.today(), daily_cap, monthly_cap)
    if not ok:
        raise HTTPException(status_code=402, detail=why)

    jid = _new_job(
        kind="run",
        ticker=req.ticker.upper(),
        portfolioId=getattr(req, "portfolioId", None),
    )
    background_tasks.add_task(_do_run, jid, req)
    return RunStartResp(jobId=jid, estimatedCostUsd=round(estimated, 4))


@app.post("/synthesize", response_model=RunStartResp)
def start_synth(req: SynthReq, request: Request, background_tasks: BackgroundTasks) -> RunStartResp:
    _check_auth(request)
    from .meter import cost_for

    estimated = cost_for("claude-haiku-4-5", 5_000, 3_000)
    daily_cap, monthly_cap = get_caps_from_env()
    ledger = _ledger()
    ok, why = ledger.can_spend(estimated, _date.today(), daily_cap, monthly_cap)
    if not ok:
        raise HTTPException(status_code=402, detail=why)

    jid = _new_job(kind="synth", portfolioId=req.portfolioId)
    background_tasks.add_task(_do_synth, jid, req)
    return RunStartResp(jobId=jid, estimatedCostUsd=round(estimated, 4))


@app.get("/jobs/{job_id}", response_model=JobResp)
def get_job(job_id: str, request: Request) -> JobResp:
    _check_auth(request)
    job = _get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="unknown job")
    return JobResp(jobId=job_id, **job)


@app.get("/jobs", response_model=JobsListResp)
def list_jobs(
    request: Request,
    state: str | None = None,
    portfolioId: str | None = None,
) -> JobsListResp:
    """List jobs in the current container's memory. Filterable by state +
    portfolioId. The site uses this on portfolio detail mount to find any
    in-flight job that started before a navigation."""
    _check_auth(request)
    with JOBS_LOCK:
        items = [(jid, dict(rec)) for jid, rec in JOBS.items()]
    out: list[JobResp] = []
    for jid, rec in items:
        if state is not None and rec.get("state") != state:
            continue
        if portfolioId is not None and rec.get("portfolioId") != portfolioId:
            continue
        out.append(JobResp(jobId=jid, **rec))
    # newest first
    out.sort(key=lambda j: j.createdAt or "", reverse=True)
    return JobsListResp(jobs=out)


def main() -> None:
    host = os.environ.get("AGENT_SERVER_HOST", "127.0.0.1")
    port = int(os.environ.get("AGENT_SERVER_PORT", "8787"))
    uvicorn.run("agent_runner.server:app", host=host, port=port, reload=False, log_level="info")


if __name__ == "__main__":
    main()
