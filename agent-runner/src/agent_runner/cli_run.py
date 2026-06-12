"""CLI: run a single per-ticker analysis and write Run JSON.

Usage:
    uv run run-analysis NVDA --date 2026-12-04 --model haiku --depth 1
"""

from __future__ import annotations

import os
import sys
from datetime import date
from pathlib import Path

import typer

from .env import load_env
from .meter import estimate_run_cost
from .runner import RunRequest, execute

app = typer.Typer(add_completion=False, no_args_is_help=True)

MODEL_ALIAS = {
    "haiku": ("claude-haiku-4-5", "claude-haiku-4-5"),
    "sonnet": ("claude-sonnet-4-6", "claude-haiku-4-5"),
}


@app.command()
def run(
    ticker: str = typer.Argument(..., help="US ticker symbol, e.g. NVDA"),
    analysis_date: str = typer.Option(
        None, "--date", "-d", help="Analysis date YYYY-MM-DD (default: today UTC)"
    ),
    model: str = typer.Option(
        "haiku", "--model", "-m", help="haiku (default) | sonnet"
    ),
    depth: int = typer.Option(1, "--depth", min=0, max=3, help="Bull/bear debate rounds"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Print plan and exit"),
) -> None:
    load_env()

    if model not in MODEL_ALIAS:
        typer.secho(f"unknown model alias '{model}'; pick: {list(MODEL_ALIAS)}", fg="red")
        raise typer.Exit(2)

    deep_model, quick_model = MODEL_ALIAS[model]
    as_of = analysis_date or date.today().isoformat()

    req = RunRequest(
        ticker=ticker.upper(),
        as_of_date=as_of,
        deep_model=deep_model,
        quick_model=quick_model,
        debate_rounds=depth,
    )

    estimated = estimate_run_cost(deep_model)
    typer.echo(f"plan:")
    typer.echo(f"  ticker:   {req.ticker}")
    typer.echo(f"  as_of:    {req.as_of_date}")
    typer.echo(f"  deep:     {deep_model}")
    typer.echo(f"  quick:    {quick_model}")
    typer.echo(f"  rounds:   {req.debate_rounds}")
    typer.echo(f"  estimate: ${estimated:.2f}")

    if dry_run:
        typer.echo("dry-run; not executing.")
        return

    typer.echo("running... this can take several minutes")
    try:
        result = execute(req)
    except RuntimeError as e:
        typer.secho(f"error: {e}", fg="red")
        raise typer.Exit(1)

    typer.secho(f"\nwrote {result.json_path}", fg="green")
    typer.echo(f"actual cost: ${result.actual_cost_usd:.4f} "
               f"(estimated ${result.estimated_cost_usd:.4f})")
    typer.echo(f"decision: {result.run.decision} (confidence {result.run.confidence:.2f})")
    typer.echo(f"tokens: {result.run.usage.inputTokens} in / "
               f"{result.run.usage.outputTokens} out")


def main() -> None:
    app()


if __name__ == "__main__":
    main()
