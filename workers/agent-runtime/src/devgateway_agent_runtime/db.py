from __future__ import annotations

import os
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any


OPERATIONAL_DATABASE_URL_ENV = "OPERATIONAL_DATABASE_URL"
STATEMENT_TIMEOUT_MS_ENV = "OPERATIONAL_DATABASE_STATEMENT_TIMEOUT_MS"
DEFAULT_STATEMENT_TIMEOUT_MS = 30_000


@dataclass(frozen=True, slots=True)
class PostgresConnectionSettings:
    database_url: str
    statement_timeout_ms: int = DEFAULT_STATEMENT_TIMEOUT_MS


def operational_database_settings(
    *,
    database_url: str | None = None,
    statement_timeout_ms: int | None = None,
    environ: Mapping[str, str] | None = None,
) -> PostgresConnectionSettings:
    env = os.environ if environ is None else environ
    resolved_url = database_url or env.get(OPERATIONAL_DATABASE_URL_ENV)
    if not resolved_url:
        raise RuntimeError(f"{OPERATIONAL_DATABASE_URL_ENV} is required for Postgres runtime access")

    timeout = resolve_statement_timeout_ms(statement_timeout_ms, environ=env)
    return PostgresConnectionSettings(database_url=resolved_url, statement_timeout_ms=timeout)


def resolve_statement_timeout_ms(
    statement_timeout_ms: int | None = None,
    *,
    environ: Mapping[str, str] | None = None,
) -> int:
    env = os.environ if environ is None else environ
    timeout = statement_timeout_ms
    if timeout is None:
        raw_timeout = env.get(STATEMENT_TIMEOUT_MS_ENV)
        timeout = int(raw_timeout) if raw_timeout else DEFAULT_STATEMENT_TIMEOUT_MS
    if timeout <= 0:
        raise ValueError("statement_timeout_ms must be greater than zero")
    return timeout


def _load_psycopg() -> tuple[Any, Any]:
    import psycopg
    from psycopg.rows import dict_row

    return psycopg, dict_row


def _load_async_pool() -> Any:
    from psycopg_pool import AsyncConnectionPool

    return AsyncConnectionPool


def _connection_kwargs(statement_timeout_ms: int, **kwargs: Any) -> dict[str, Any]:
    _psycopg, dict_row = _load_psycopg()
    merged = dict(kwargs)
    merged.setdefault("row_factory", dict_row)
    merged.setdefault("autocommit", False)
    options = str(merged.get("options") or "").strip()
    timeout_option = f"-c statement_timeout={statement_timeout_ms}"
    merged["options"] = f"{options} {timeout_option}".strip() if options else timeout_option
    return merged


async def open_async_connection(
    *,
    database_url: str | None = None,
    statement_timeout_ms: int | None = None,
    **kwargs: Any,
) -> Any:
    settings = operational_database_settings(
        database_url=database_url,
        statement_timeout_ms=statement_timeout_ms,
    )
    psycopg, _dict_row = _load_psycopg()
    return await psycopg.AsyncConnection.connect(
        settings.database_url,
        **_connection_kwargs(settings.statement_timeout_ms, **kwargs),
    )


async def create_async_pool(
    *,
    database_url: str | None = None,
    statement_timeout_ms: int | None = None,
    min_size: int = 1,
    max_size: int = 10,
    open: bool = True,
    wait: bool = True,
    **kwargs: Any,
) -> Any:
    settings = operational_database_settings(
        database_url=database_url,
        statement_timeout_ms=statement_timeout_ms,
    )
    async_pool = _load_async_pool()
    pool = async_pool(
        conninfo=settings.database_url,
        min_size=min_size,
        max_size=max_size,
        open=False,
        kwargs=_connection_kwargs(settings.statement_timeout_ms, **kwargs),
    )
    if open:
        await pool.open(wait=wait)
    return pool


async def _set_local_statement_timeout(conn: Any, statement_timeout_ms: int) -> None:
    await conn.execute("SELECT set_config('statement_timeout', %s, true)", (str(statement_timeout_ms),))


@asynccontextmanager
async def transaction(
    connection_or_pool: Any | None = None,
    *,
    database_url: str | None = None,
    statement_timeout_ms: int | None = None,
) -> AsyncIterator[Any]:
    if connection_or_pool is None:
        settings = operational_database_settings(
            database_url=database_url,
            statement_timeout_ms=statement_timeout_ms,
        )
        conn = await open_async_connection(
            database_url=settings.database_url,
            statement_timeout_ms=settings.statement_timeout_ms,
        )
        try:
            async with conn.transaction():
                await _set_local_statement_timeout(conn, settings.statement_timeout_ms)
                yield conn
        finally:
            await conn.close()
        return

    timeout = resolve_statement_timeout_ms(statement_timeout_ms)
    if hasattr(connection_or_pool, "connection"):
        async with connection_or_pool.connection() as conn:
            async with conn.transaction():
                await _set_local_statement_timeout(conn, timeout)
                yield conn
        return

    async with connection_or_pool.transaction():
        await _set_local_statement_timeout(connection_or_pool, timeout)
        yield connection_or_pool


create_async_connection = open_async_connection
