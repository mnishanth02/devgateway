from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

import pytest


AGENT_RUNTIME_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = AGENT_RUNTIME_ROOT.parents[1]
SRC_ROOT = AGENT_RUNTIME_ROOT / "src"
MIGRATIONS_ROOT = REPOSITORY_ROOT / "packages" / "db" / "migrations"

if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))


def _postgres_url() -> str | None:
    return os.environ.get("DATABASE_CHECK_URL") or os.environ.get("AGENT_RUNTIME_POSTGRES_TEST_URL")


def _require_psycopg():
    try:
        import psycopg
        from psycopg import sql
        from psycopg.rows import dict_row
    except ModuleNotFoundError as exc:
        pytest.skip(f"Postgres durability tests require psycopg: {exc}", allow_module_level=False)
    return psycopg, dict_row, sql


def _database_url(base_url: str, database_name: str) -> str:
    parsed = urlsplit(base_url)
    return urlunsplit((parsed.scheme, parsed.netloc, f"/{database_name}", parsed.query, parsed.fragment))


def _identifier_seed(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", value)[:48].strip("_") or "devgateway"


def _migration_statements(sql_text: str) -> list[str]:
    return [
        statement.strip()
        for statement in sql_text.split("--> statement-breakpoint")
        if statement.strip()
    ]


def _apply_migrations(psycopg, database_url: str) -> None:
    migration_files = sorted(
        path for path in MIGRATIONS_ROOT.glob("*.sql") if path.is_file()
    )
    if not migration_files:
        pytest.skip(f"no committed migrations found in {MIGRATIONS_ROOT}")

    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            for migration in migration_files:
                for statement in _migration_statements(migration.read_text(encoding="utf-8")):
                    cur.execute(statement)
        conn.commit()


@pytest.fixture(scope="session")
def postgres_database_url() -> str:
    base_url = _postgres_url()
    if not base_url:
        pytest.skip(
            "Postgres durability tests require DATABASE_CHECK_URL or "
            "AGENT_RUNTIME_POSTGRES_TEST_URL pointing at disposable Postgres."
        )

    psycopg, _dict_row, sql = _require_psycopg()
    database_name = f"{_identifier_seed(REPOSITORY_ROOT.name)}_agent_runtime_pytest_{uuid4().hex[:12]}".lower()

    try:
        with psycopg.connect(base_url, autocommit=True) as admin:
            with admin.cursor() as cur:
                cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))
    except Exception as exc:
        pytest.skip(f"could not provision disposable Postgres database from DATABASE_CHECK_URL: {exc}")

    test_url = _database_url(base_url, database_name)
    try:
        _apply_migrations(psycopg, test_url)
        yield test_url
    finally:
        with psycopg.connect(base_url, autocommit=True) as admin:
            with admin.cursor() as cur:
                cur.execute(
                    """
                    SELECT pg_terminate_backend(pid)
                      FROM pg_stat_activity
                     WHERE datname = %s
                       AND pid <> pg_backend_pid()
                    """,
                    (database_name,),
                )
                cur.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(database_name)))


@pytest.fixture(scope="session")
def postgres_connection_factory(postgres_database_url: str) -> Callable[[], object]:
    psycopg, dict_row, _sql = _require_psycopg()

    def factory() -> object:
        return psycopg.connect(postgres_database_url, row_factory=dict_row)

    return factory


@pytest.fixture(scope="session")
def postgres_runtime_scope(postgres_connection_factory: Callable[[], object]):
    try:
        from devgateway_agent_runtime.postgres_repository import RepositoryScope
    except ModuleNotFoundError as exc:
        if exc.name and exc.name.startswith("devgateway_agent_runtime"):
            pytest.skip(f"Postgres runtime repository is not importable yet: {exc}")
        raise

    suffix = uuid4().hex[:12]
    with postgres_connection_factory() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO org (org_id, name, slug, status)
                VALUES (%s, %s, %s, 'active')
                RETURNING id
                """,
                (f"org_agent_runtime_{suffix}", "Agent Runtime Tests", f"agent-runtime-{suffix}"),
            )
            org_id = int(cur.fetchone()["id"])

            cur.execute(
                """
                INSERT INTO principal (principal_id, principal_type, org_id, display_name, status)
                VALUES (%s, 'system', %s, %s, 'active')
                RETURNING id
                """,
                (f"principal_agent_runtime_{suffix}", org_id, "Agent Runtime Test Principal"),
            )
            principal_id = int(cur.fetchone()["id"])

            cur.execute(
                """
                INSERT INTO project (project_id, org_id, name, slug, environment, status)
                VALUES (%s, %s, %s, %s, 'test', 'active')
                RETURNING id
                """,
                (f"project_agent_runtime_{suffix}", org_id, "Agent Runtime Tests", f"agent-runtime-{suffix}"),
            )
            project_id = int(cur.fetchone()["id"])

            cur.execute(
                """
                INSERT INTO budget_scope (
                    budget_scope_id, scope_type, owner_ref, project_id, principal_id,
                    status, policy_version
                )
                VALUES (%s, 'workflow', %s, %s, %s, 'active', %s)
                RETURNING id
                """,
                (
                    f"budget_scope_agent_runtime_{suffix}",
                    f"fixture-ref:workflow:agent-runtime:{suffix}",
                    project_id,
                    principal_id,
                    "test-policy-v1",
                ),
            )
            budget_scope_id = int(cur.fetchone()["id"])
        conn.commit()

    return RepositoryScope(
        project_id=project_id,
        principal_id=principal_id,
        budget_scope_id=budget_scope_id,
        policy_version="test-policy-v1",
        registry_version="test-registry-v1",
        data_class="internal",
    )
