"""CLI: portfolio synthesis pass.

Usage:
    uv run synthesize-portfolio path/to/portfolio.json [--model haiku]
"""

from __future__ import annotations

from pathlib import Path

import typer

from .env import load_env
from .synthesizer import synthesize

app = typer.Typer(add_completion=False, no_args_is_help=True)

MODEL_ALIAS = {
    "haiku": "claude-haiku-4-5",
    "sonnet": "claude-sonnet-4-6",
}


@app.command()
def run(
    portfolio_path: Path = typer.Argument(..., exists=True, dir_okay=False, readable=True),
    model: str = typer.Option("haiku", "--model", "-m", help="haiku (default) | sonnet"),
) -> None:
    load_env()
    if model not in MODEL_ALIAS:
        typer.secho(f"unknown model alias '{model}'; pick: {list(MODEL_ALIAS)}", fg="red")
        raise typer.Exit(2)

    typer.echo(f"synthesizing {portfolio_path} with {MODEL_ALIAS[model]}...")
    try:
        synth = synthesize(portfolio_path, MODEL_ALIAS[model])
    except RuntimeError as e:
        typer.secho(f"error: {e}", fg="red")
        raise typer.Exit(1)

    typer.secho(f"wrote synthesis for portfolio {synth.portfolioId}", fg="green")
    typer.echo(f"actual cost: ${synth.usage.costUsd:.4f}")
    typer.echo(f"decisions: {len(synth.decisions)}, factors: {len(synth.factorExposure)}")


def main() -> None:
    app()


if __name__ == "__main__":
    main()
