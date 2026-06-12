"""S3 → GitHub workflow_dispatch bridge.

Triggered by ObjectCreated events on s3://trade.yeyaxin.com (filtered to
runs/*.json and portfolios/*-synthesis.json by the bucket notification).

Calls POST /repos/yeyaxin/yeyaxin-trading-agent-site/actions/workflows/deploy.yml/dispatches
to rebuild + redeploy the static site.

The CI deploy workflow's `concurrency` block (group: deploy-trade,
cancel-in-progress: false) serializes overlapping triggers, so a burst of
S3 writes won't cause overlapping deploys — each gets queued.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request

import boto3

log = logging.getLogger()
log.setLevel(logging.INFO)

GITHUB_OWNER = "yeyaxin"
GITHUB_REPO = "yeyaxin-trading-agent-site"
WORKFLOW_FILE = "deploy.yml"
WORKFLOW_REF = "main"

PAT_SECRET_ARN = os.environ["PAT_SECRET_ARN"]
_pat_cache: str | None = None


def _get_pat() -> str:
    global _pat_cache
    if _pat_cache:
        return _pat_cache
    sm = boto3.client("secretsmanager")
    resp = sm.get_secret_value(SecretId=PAT_SECRET_ARN)
    _pat_cache = (resp["SecretString"] or "").strip()
    if not _pat_cache:
        raise RuntimeError("PAT secret is empty")
    return _pat_cache


def _dispatch(reason: str) -> None:
    url = (
        f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}"
        f"/actions/workflows/{WORKFLOW_FILE}/dispatches"
    )
    body = json.dumps({"ref": WORKFLOW_REF, "inputs": {}}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {_get_pat()}",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "yeyaxin-trade-agent-rebuild-trigger/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            log.info("workflow_dispatch -> %s (%s)", resp.status, reason)
    except urllib.error.HTTPError as e:
        log.error("workflow_dispatch failed: %s %s", e.code, e.read().decode("utf-8", "ignore"))
        raise


def handler(event: dict, _context: object) -> dict:
    records = event.get("Records") or []
    if not records:
        log.warning("no S3 records in event")
        return {"ok": True, "dispatched": False, "reason": "no records"}

    keys = []
    for r in records:
        s3 = r.get("s3") or {}
        obj = s3.get("object") or {}
        key = obj.get("key")
        if not key:
            continue
        keys.append(key)

    if not keys:
        return {"ok": True, "dispatched": False, "reason": "no keys"}

    reason = f"{len(keys)} object(s) created: {', '.join(keys[:5])}" + (
        f" (+{len(keys) - 5} more)" if len(keys) > 5 else ""
    )
    _dispatch(reason)
    return {"ok": True, "dispatched": True, "keys": keys, "reason": reason}
