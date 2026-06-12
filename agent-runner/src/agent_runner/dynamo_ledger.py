"""DynamoDB-backed spend ledger. Same interface as meter.SpendLedger.

Schema:
  Table: yeyaxin-trade-agent-spend (configurable via DYNAMODB_TABLE)
  PartitionKey: pk (str) - either 'month#YYYY-MM' or 'day#YYYY-MM-DD'
  Attribute: spentUsd (number)

We store day and month rows separately so you can read either independently.
Writes use ADD (atomic increment) to avoid lost-update on concurrent runs.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any


@dataclass
class DynamoSpendLedger:
    """Read/write a row keyed by `month#YYYY-MM` and `day#YYYY-MM-DD`.
    Mirrors SpendLedger's .can_spend / .commit interface."""

    table_name: str
    region: str = "us-west-2"
    day: str = ""
    month: str = ""
    day_spent_usd: float = 0.0
    month_spent_usd: float = 0.0

    @classmethod
    def load(cls, table_name: str, region: str | None = None) -> "DynamoSpendLedger":
        ledger = cls(
            table_name=table_name,
            region=region or os.environ.get("AWS_REGION", "us-west-2"),
        )
        today = date.today()
        ledger.day = today.isoformat()
        ledger.month = today.strftime("%Y-%m")
        ledger._refresh()
        return ledger

    def _client(self) -> Any:
        import boto3  # local import so non-cloud installs don't need it

        return boto3.resource("dynamodb", region_name=self.region).Table(self.table_name)

    def _refresh(self) -> None:
        t = self._client()
        day_resp = t.get_item(Key={"pk": f"day#{self.day}"}).get("Item")
        month_resp = t.get_item(Key={"pk": f"month#{self.month}"}).get("Item")
        self.day_spent_usd = float(day_resp.get("spentUsd", 0)) if day_resp else 0.0
        self.month_spent_usd = float(month_resp.get("spentUsd", 0)) if month_resp else 0.0

    def can_spend(
        self,
        planned_usd: float,
        today: date,
        daily_cap: float,
        monthly_cap: float,
    ) -> tuple[bool, str]:
        d, m = today.isoformat(), today.strftime("%Y-%m")
        if d != self.day or m != self.month:
            self.day, self.month = d, m
            self._refresh()
        if self.day_spent_usd + planned_usd > daily_cap:
            return (
                False,
                f"daily cap: would push ${self.day_spent_usd:.2f} -> "
                f"${self.day_spent_usd + planned_usd:.2f} above ${daily_cap:.2f}",
            )
        if self.month_spent_usd + planned_usd > monthly_cap:
            return (
                False,
                f"monthly cap: would push ${self.month_spent_usd:.2f} -> "
                f"${self.month_spent_usd + planned_usd:.2f} above ${monthly_cap:.2f}",
            )
        return True, ""

    def commit(self, actual_usd: float, today: date) -> None:
        d, m = today.isoformat(), today.strftime("%Y-%m")
        delta = Decimal(str(round(actual_usd, 6)))
        t = self._client()
        # ADD performs atomic increment server-side, race-safe
        for pk in (f"day#{d}", f"month#{m}"):
            t.update_item(
                Key={"pk": pk},
                UpdateExpression="ADD spentUsd :v",
                ExpressionAttributeValues={":v": delta},
            )
        # Update local cache
        if d != self.day or m != self.month:
            self.day, self.month = d, m
        self.day_spent_usd += actual_usd
        self.month_spent_usd += actual_usd

    def save(self) -> None:  # for SpendLedger interface compatibility
        pass
