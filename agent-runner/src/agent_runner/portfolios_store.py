"""Server-side portfolio storage (DynamoDB).

Single shared book — all visitors authenticated by AGENT_PASSWORD see the
same 3 portfolio slots (p1, p2, p3). Each slot is one DDB row keyed by
slotId. The full Portfolio JSON is stored under the `data` attribute as a
nested map.

Schema:
  PartitionKey: slotId (str)  — "p1" | "p2" | "p3"
  Attribute: data (map)       — JSON of schema.Portfolio
"""

from __future__ import annotations

import os
from decimal import Decimal
from typing import Any

from .schema import Portfolio

TABLE_ENV = "PORTFOLIOS_TABLE"
DEFAULT_TABLE = "yeyaxin-trade-portfolios"

# These slot IDs are the only valid keys; mirrors PORTFOLIO_SLOT_IDS in TS.
VALID_SLOTS = ("p1", "p2", "p3")


def _table_name() -> str:
    return os.environ.get(TABLE_ENV, DEFAULT_TABLE)


def _client() -> Any:
    import boto3

    return boto3.resource(
        "dynamodb",
        region_name=os.environ.get("AWS_REGION", "us-west-2"),
    ).Table(_table_name())


def _to_ddb_safe(obj: Any) -> Any:
    """Recursively convert floats to Decimals (DDB rejects floats)."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, list):
        return [_to_ddb_safe(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _to_ddb_safe(v) for k, v in obj.items()}
    return obj


def _from_ddb(obj: Any) -> Any:
    """Decimals → floats/ints for JSON serialization."""
    if isinstance(obj, Decimal):
        # Try to express as int when whole, else float
        if obj == obj.to_integral_value():
            return int(obj)
        return float(obj)
    if isinstance(obj, list):
        return [_from_ddb(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _from_ddb(v) for k, v in obj.items()}
    return obj


def list_portfolios() -> list[Portfolio]:
    t = _client()
    resp = t.scan()
    out: list[Portfolio] = []
    for item in resp.get("Items", []):
        data = _from_ddb(item.get("data"))
        if isinstance(data, dict):
            try:
                out.append(Portfolio.model_validate(data))
            except Exception:
                # Drop malformed rows rather than failing the whole list
                continue
    # Sort by slot id for stable order
    out.sort(key=lambda p: p.id)
    return out


def get_portfolio(slot_id: str) -> Portfolio | None:
    if slot_id not in VALID_SLOTS:
        return None
    t = _client()
    resp = t.get_item(Key={"slotId": slot_id})
    item = resp.get("Item")
    if not item:
        return None
    data = _from_ddb(item.get("data"))
    if not isinstance(data, dict):
        return None
    try:
        return Portfolio.model_validate(data)
    except Exception:
        return None


def put_portfolio(portfolio: Portfolio) -> None:
    if portfolio.id not in VALID_SLOTS:
        raise ValueError(f"slot id {portfolio.id!r} must be one of {VALID_SLOTS}")
    t = _client()
    payload = portfolio.model_dump(exclude_none=True)
    t.put_item(
        Item={
            "slotId": portfolio.id,
            "data": _to_ddb_safe(payload),
        }
    )


def delete_portfolio(slot_id: str) -> bool:
    if slot_id not in VALID_SLOTS:
        return False
    t = _client()
    t.delete_item(Key={"slotId": slot_id})
    return True


def update_position_state(
    slot_id: str,
    ticker: str,
    *,
    last_job_id: str | None = ...,  # type: ignore[assignment]
    last_analyzed_at: str | None = ...,  # type: ignore[assignment]
    last_run_id: str | None = ...,  # type: ignore[assignment]
    last_error: str | None = ...,  # type: ignore[assignment]
) -> bool:
    """Read-modify-write a single Position's analysis-state fields.

    Use the sentinel default (Ellipsis) to leave a field untouched. Pass
    `None` explicitly to clear a field. Returns True if the position was
    found and updated, False otherwise.

    NOTE: read-modify-write isn't strictly serializable. Two concurrent
    runs for the same ticker (which we don't support — UI gates on
    'already running') could lose one update. Acceptable for this scale.
    """
    if slot_id not in VALID_SLOTS:
        return False
    p = get_portfolio(slot_id)
    if not p:
        return False

    upper = ticker.upper()
    found = False
    for pos in p.positions:
        if pos.ticker.upper() != upper:
            continue
        found = True
        if last_job_id is not ...:
            pos.lastJobId = last_job_id
        if last_analyzed_at is not ...:
            pos.lastAnalyzedAt = last_analyzed_at
        if last_run_id is not ...:
            pos.lastRunId = last_run_id
        if last_error is not ...:
            pos.lastError = last_error
        break
    if not found:
        return False
    p.updatedAt = (
        os.environ.get("__test_now__")
        or __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
        .strftime("%Y-%m-%dT%H:%M:%SZ")
    )
    put_portfolio(p)
    return True
