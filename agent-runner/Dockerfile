# Multi-stage build for the agent-runner FastAPI service.
# Stage 1: build deps with uv (fast resolver, mirrors local dev)
# Stage 2: slim runtime with only what's needed.

FROM python:3.13-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# uv binary
COPY --from=ghcr.io/astral-sh/uv:0.11.21 /uv /uvx /usr/local/bin/

WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY src ./src

# Install into a project-local venv at /app/.venv
RUN uv sync --frozen --no-dev

# ---- runtime stage ----
FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/src /app/src

# App Runner sends SIGTERM on stop; uvicorn handles it gracefully.
EXPOSE 8787

# Bind to 0.0.0.0 so App Runner's load balancer can reach us.
CMD ["uvicorn", "agent_runner.server:app", "--host", "0.0.0.0", "--port", "8787"]
