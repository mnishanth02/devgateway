from __future__ import annotations

import argparse
import json
import os
import sys

from .fixtures import run_fixture_workflow_smoke
from .service import RuntimeServicePolicy, RuntimeWorkerService, postgres_repository_session_from_env
from .supervisor import run_supervisor_execution_fixture


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="devgateway-agent-runtime",
        description="DevGateway workflow runtime. Fixture mode never calls live providers, tools, Bifrost, or an external DB.",
    )
    parser.add_argument("--mode", choices=["fixture", "postgres", "service"], default="fixture")
    parser.add_argument("--fixture", choices=["workflow", "execution"], default="workflow")
    parser.add_argument("--format", choices=["json", "pretty"], default="pretty")
    parser.add_argument("--owner-id", default="agent-runtime-cli")
    parser.add_argument("--workflow-id", default=None)
    parser.add_argument("--max-steps", type=int, default=1)
    parser.add_argument("--idle-sleep-seconds", type=float, default=1.0)
    args = parser.parse_args(argv)

    if args.mode == "fixture":
        payload = run_supervisor_execution_fixture() if args.fixture == "execution" else run_fixture_workflow_smoke()
        print(json.dumps(payload, indent=2 if args.format == "pretty" else None, sort_keys=args.format == "pretty"))
        workflow = payload["workflow"]
        return 0 if isinstance(workflow, dict) and workflow.get("state") == "completed" else 1

    if not os.environ.get("OPERATIONAL_DATABASE_URL"):
        print("OPERATIONAL_DATABASE_URL is required for postgres/service runtime modes", file=sys.stderr)
        return 2

    try:
        session = postgres_repository_session_from_env()
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    service = RuntimeWorkerService(
        session.repository,
        policy=RuntimeServicePolicy(owner_id=args.owner_id, idle_sleep_seconds=args.idle_sleep_seconds),
        commit=session.commit,
        rollback=session.rollback,
    )
    try:
        if args.mode == "postgres":
            stats = service.run_until_idle(
                max_steps=max(1, args.max_steps),
                workflow_id=args.workflow_id,
            )
        else:
            with service.install_signal_handlers():
                stats = service.run_forever(workflow_id=args.workflow_id)
    finally:
        session.close()

    payload = {
        "runtime": "devgateway-agent-runtime",
        "mode": args.mode,
        "workflow_id": args.workflow_id,
        "stats": stats.to_dict(),
        "stopped": service.stop_requested,
    }
    print(json.dumps(payload, indent=2 if args.format == "pretty" else None, sort_keys=args.format == "pretty"))
    return 0 if stats.failed_steps == 0 else 1
