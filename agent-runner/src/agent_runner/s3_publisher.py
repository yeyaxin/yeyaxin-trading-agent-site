"""Publish run + synthesis JSON to the production S3 bucket.

When env RUN_JSON_BUCKET is set (e.g. "trade.yeyaxin.com"), writes:
  s3://{bucket}/runs/{run.id}.json
  s3://{bucket}/portfolios/{portfolioId}-synthesis.json

We also write a manifest at runs/_index.json so the static site can fetch a
list of all available runs at runtime without listing the bucket.
"""

from __future__ import annotations

import json
import os
from typing import Any

from .schema import PortfolioSynthesis, Run


def _bucket() -> str | None:
    return os.environ.get("RUN_JSON_BUCKET") or None


def _client() -> Any:
    import boto3

    return boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-west-2"))


def _put_json(key: str, payload: dict[str, Any], cache: str = "public, max-age=60") -> None:
    bucket = _bucket()
    if not bucket:
        return
    body = json.dumps(payload, indent=2).encode("utf-8")
    _client().put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType="application/json; charset=utf-8",
        CacheControl=cache,
    )


def publish_run(run: Run) -> str | None:
    bucket = _bucket()
    if not bucket:
        return None
    key = f"runs/{run.id}.json"
    _put_json(key, run.model_dump(exclude_none=True))
    _refresh_runs_index()
    return f"s3://{bucket}/{key}"


def publish_synthesis(synth: PortfolioSynthesis) -> str | None:
    bucket = _bucket()
    if not bucket:
        return None
    key = f"portfolios/{synth.portfolioId}-synthesis.json"
    _put_json(key, synth.model_dump(exclude_none=True))
    return f"s3://{bucket}/{key}"


def _refresh_runs_index() -> None:
    """Write runs/_index.json listing all run IDs in the bucket. Site uses this
    to discover available runs at page load. Cheap (1 ListObjectsV2 + 1 PutObject)."""
    bucket = _bucket()
    if not bucket:
        return
    s3 = _client()
    paginator = s3.get_paginator("list_objects_v2")
    summaries: list[dict[str, Any]] = []
    for page in paginator.paginate(Bucket=bucket, Prefix="runs/"):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if not key.endswith(".json") or key.endswith("/_index.json"):
                continue
            run_id = key.removeprefix("runs/").removesuffix(".json")
            summaries.append(
                {
                    "id": run_id,
                    "lastModified": obj["LastModified"].isoformat() if obj.get("LastModified") else None,
                    "size": int(obj.get("Size", 0)),
                }
            )
    summaries.sort(key=lambda s: s.get("lastModified") or "", reverse=True)
    _put_json("runs/_index.json", {"runs": summaries}, cache="public, max-age=30")
