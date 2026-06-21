from __future__ import annotations

import argparse
import json
import sys

from .fixtures import run_fixture_workflow_smoke
from .supervisor import run_supervisor_execution_fixture


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="devgateway-agent-runtime",
        description="Fixture-only workflow runtime smoke. It never calls live providers, tools, Bifrost, or an external DB.",
    )
    parser.add_argument("--mode", choices=["fixture"], default="fixture")
    parser.add_argument("--fixture", choices=["workflow", "execution"], default="workflow")
    parser.add_argument("--format", choices=["json", "pretty"], default="pretty")
    args = parser.parse_args(argv)

    if args.mode != "fixture":
        print("only fixture mode is supported in the runtime skeleton", file=sys.stderr)
        return 2
    payload = run_supervisor_execution_fixture() if args.fixture == "execution" else run_fixture_workflow_smoke()
    print(json.dumps(payload, indent=2 if args.format == "pretty" else None, sort_keys=args.format == "pretty"))
    workflow = payload["workflow"]
    return 0 if isinstance(workflow, dict) and workflow.get("state") == "completed" else 1
