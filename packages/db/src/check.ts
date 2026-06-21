import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

type CheckMode = 'auto' | 'offline' | 'database';

type CheckResult = {
  readonly ok: boolean;
  readonly label: string;
  readonly detail: string;
};

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = dirname(dirname(packageRoot));
const schemaDirectory = join(packageRoot, 'src', 'schema');
const migrationsDirectory = join(packageRoot, 'migrations');
const seedsDirectory = join(packageRoot, 'src', 'seeds');
const drizzleConfigPath = join(packageRoot, 'drizzle.config.ts');

function getMode(args: readonly string[]): CheckMode {
  if (args.includes('--offline')) {
    return 'offline';
  }

  if (args.includes('--database')) {
    return 'database';
  }

  return 'auto';
}

function findFiles(root: string, predicate: (filePath: string) => boolean): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const found: string[] = [];
  const entries = readdirSync(root, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(root, entry.name);

    if (entry.isDirectory()) {
      found.push(...findFiles(path, predicate));
      continue;
    }

    if (entry.isFile() && predicate(path)) {
      found.push(path);
    }
  }

  return found.sort();
}

function toWorkspacePath(path: string): string {
  return relative(workspaceRoot, path);
}

function getDatabaseUrl(): string | undefined {
  const configuredUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_CHECK_URL;

  return configuredUrl === undefined || configuredUrl.trim() === '' ? undefined : configuredUrl;
}

function checkCommittedStructure(): CheckResult[] {
  const schemaFiles = findFiles(schemaDirectory, (path) => extname(path) === '.ts');
  const migrationSqlFiles = findFiles(migrationsDirectory, (path) => extname(path) === '.sql');
  const migrationMetadataFiles = findFiles(migrationsDirectory, (path) => extname(path) === '.json');
  const seedFiles = findFiles(seedsDirectory, (path) => extname(path) === '.ts');

  const results: CheckResult[] = [
    {
      ok: existsSync(drizzleConfigPath),
      label: 'drizzle-config',
      detail: existsSync(drizzleConfigPath)
        ? `Found ${toWorkspacePath(drizzleConfigPath)}.`
        : `Missing ${toWorkspacePath(drizzleConfigPath)}; schema/migration owner must provide Drizzle config before DB validation can pass.`,
    },
    {
      ok: schemaFiles.length > 0,
      label: 'schema-files',
      detail:
        schemaFiles.length > 0
          ? `Found ${schemaFiles.length} schema file(s).`
          : `Missing committed schema files under ${toWorkspacePath(schemaDirectory)}.`,
    },
    {
      ok: migrationSqlFiles.length > 0,
      label: 'migration-sql',
      detail:
        migrationSqlFiles.length > 0
          ? `Found ${migrationSqlFiles.length} migration SQL file(s).`
          : `Missing committed migration SQL files under ${toWorkspacePath(migrationsDirectory)}.`,
    },
    {
      ok: migrationMetadataFiles.length > 0 || migrationSqlFiles.length === 0,
      label: 'migration-metadata',
      detail:
        migrationMetadataFiles.length > 0
          ? `Found ${migrationMetadataFiles.length} migration metadata file(s).`
          : migrationSqlFiles.length === 0
            ? 'Skipped because no migration SQL files are committed yet.'
            : `Missing migration metadata journal/snapshot JSON under ${toWorkspacePath(migrationsDirectory)}.`,
    },
    {
      ok: seedFiles.length > 0,
      label: 'seed-separation',
      detail:
        seedFiles.length > 0
          ? `Found ${seedFiles.length} separated seed metadata file(s).`
          : `Missing seed separation metadata under ${toWorkspacePath(seedsDirectory)}.`,
    },
  ];

  return results;
}

function checkSeedsDoNotContainObviousSecrets(): CheckResult {
  const seedFiles = findFiles(seedsDirectory, (path) => extname(path) === '.ts');
  const suspiciousNames = ['providerKey', 'provider_key', 'apiKey', 'api_key', 'secret', 'plaintext'];
  const suspiciousFileNames = seedFiles
    .map((path) => basename(path))
    .filter((name) => suspiciousNames.some((needle) => name.toLowerCase().includes(needle.toLowerCase())));
  const suspiciousContentPatterns = [
    /\b(apiKey|api_key|providerKey|provider_key|plaintext)\b\s*[:=]\s*['"`][^'"`]+['"`]/i,
    /\b(secret|password|token)\b\s*[:=]\s*['"`](?!false\b|true\b|hash\b|metadata\b)[^'"`]{8,}['"`]/i,
    /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,})\b/,
    /\b(storesPlaintextCredentials|storesProviderKeys)\s*:\s*true\b/i,
  ];
  const suspiciousContentFiles = seedFiles.filter((path) => {
    const content = readFileSync(path, 'utf8');
    return suspiciousContentPatterns.some((pattern) => pattern.test(content));
  });
  const failures = [
    ...suspiciousFileNames.map((name) => `suspicious filename ${name}`),
    ...suspiciousContentFiles.map((path) => `suspicious content in ${toWorkspacePath(path)}`),
  ];

  return {
    ok: failures.length === 0,
    label: 'seed-secret-boundary',
    detail:
      failures.length === 0
        ? 'Seed files are metadata-only and do not contain obvious committed provider-key/plaintext secret fixtures.'
        : `Seed files must not contain committed secret fixtures: ${failures.join('; ')}`,
  };
}

function checkMigrationOrdering(): CheckResult {
  const migrationSqlFiles = findFiles(migrationsDirectory, (path) => extname(path) === '.sql');
  const failures: string[] = [];

  for (const migrationPath of migrationSqlFiles) {
    const sql = readFileSync(migrationPath, 'utf8');
    const auditEventUniqueIndex = sql.indexOf('CREATE UNIQUE INDEX "audit_event_audit_event_id_key"');
    const evalGateAuditForeignKey = sql.indexOf(
      'FOREIGN KEY ("audit_event_id") REFERENCES "public"."audit_event"("audit_event_id")',
    );

    if (
      evalGateAuditForeignKey !== -1 &&
      (auditEventUniqueIndex === -1 || auditEventUniqueIndex > evalGateAuditForeignKey)
    ) {
      failures.push(
        `${toWorkspacePath(migrationPath)} references audit_event.audit_event_id before creating its unique index`,
      );
    }
  }

  return {
    ok: failures.length === 0,
    label: 'migration-fk-ordering',
    detail:
      failures.length === 0
        ? 'Migration SQL creates referenced unique keys before dependent foreign keys.'
        : failures.join('; '),
  };
}

function readMigrationStatements(): string[] {
  return findFiles(migrationsDirectory, (path) => extname(path) === '.sql')
    .flatMap((path) => readFileSync(path, 'utf8').split('--> statement-breakpoint'))
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function checkDatabaseMigrations(databaseUrl: string): Promise<CheckResult[]> {
  const postgres = (await import('postgres')).default;
  const client = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 1,
    max_lifetime: 30,
  });
  const results: CheckResult[] = [];

  try {
    await client`select 1 as ok`;
    results.push({
      ok: true,
      label: 'database-connectivity',
      detail: 'Connected to configured Postgres database and completed SELECT 1.',
    });

    const existingTables = await client<{ table_name: string }[]>`
      select tablename as table_name
      from pg_tables
      where schemaname = 'public'
      order by tablename
    `;

    if (existingTables.length > 0) {
      results.push({
        ok: false,
        label: 'database-empty-disposable',
        detail: `Database validation requires an empty disposable/shadow database; found tables: ${existingTables.map((row) => row.table_name).join(', ')}.`,
      });
      return results;
    }

    for (const statement of readMigrationStatements()) {
      await client.unsafe(statement);
    }

    results.push({
      ok: true,
      label: 'migration-apply',
      detail: 'Applied committed migration SQL to the configured disposable Postgres database.',
    });

    const auditRows = await client<{ id: number }[]>`
      insert into audit_event (
        audit_event_id,
        event_name,
        action,
        outcome,
        trace_id,
        request_id
      )
      values (
        'audit_evt_db_check',
        'db.check.audit',
        'validate',
        'success',
        '00000000000000000000000000000001',
        'req_db_check'
      )
      returning id
    `;
    const auditEventId = auditRows[0]?.id;

    if (auditEventId === undefined) {
      results.push({
        ok: false,
        label: 'append-only-fixture',
        detail: 'Could not create audit_event fixture row for append-only validation.',
      });
      return results;
    }

    await client`
      insert into eval_gate_result (
        gate_result_id,
        change_id,
        dataset_version,
        eval_suite_version,
        runner_version,
        target_kind,
        artifact_version,
        pass,
        blocking_severity,
        artifact_storage_policy_ref,
        retention_policy_ref,
        audit_event_id
      )
      values (
        'gate_db_check',
        'change_db_check',
        'dataset.v0',
        'suite.v0',
        'runner.v0',
        'model_alias',
        'artifact.v0',
        true,
        'none',
        'artifact-storage-policy-db-check',
        'retention-policy-db-check',
        ${auditEventId}
      )
    `;

    const rejectedOperations = [
      ['audit_event update', () => client`update audit_event set outcome = 'failure' where id = ${auditEventId}`],
      ['audit_event delete', () => client`delete from audit_event where id = ${auditEventId}`],
      ['audit_event truncate cascade', () => client`truncate audit_event cascade`],
      ['eval_gate_result update', () => client`update eval_gate_result set pass = false where gate_result_id = 'gate_db_check'`],
      ['eval_gate_result delete', () => client`delete from eval_gate_result where gate_result_id = 'gate_db_check'`],
      ['eval_gate_result truncate', () => client`truncate eval_gate_result`],
    ] as const;

    const unexpectedAllows: string[] = [];

    for (const [operation, execute] of rejectedOperations) {
      try {
        await execute();
        unexpectedAllows.push(operation);
      } catch {
        // Expected: append-only trigger rejects the mutation.
      }
    }

    results.push({
      ok: unexpectedAllows.length === 0,
      label: 'append-only-enforcement',
      detail:
        unexpectedAllows.length === 0
          ? 'audit_event and eval_gate_result reject UPDATE, DELETE, and TRUNCATE in the disposable database.'
          : `Append-only enforcement allowed: ${unexpectedAllows.join(', ')}`,
    });
  } catch (error) {
    results.push({
      ok: false,
      label: 'database-migration-validation',
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await client.end({ timeout: 5 });
  }

  return results;
}

function printResults(results: readonly CheckResult[]): void {
  for (const result of results) {
    const status = result.ok ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${result.label}: ${result.detail}`);
  }
}

async function main(): Promise<void> {
  const mode = getMode(process.argv.slice(2));
  const databaseUrl = getDatabaseUrl();
  const results = [...checkCommittedStructure(), checkSeedsDoNotContainObviousSecrets(), checkMigrationOrdering()];

  if (mode !== 'offline' && databaseUrl === undefined) {
    results.push({
      ok: false,
      label: 'database-url',
      detail:
        'DATABASE_MIGRATION_URL or DATABASE_CHECK_URL is required for default database validation. Use a disposable/shadow database; runtime DATABASE_URL and OPERATIONAL_DATABASE_URL are intentionally ignored. Use db:check:offline for explicit structural checks without Postgres.',
    });
  } else if (databaseUrl !== undefined && mode !== 'offline') {
    results.push(...(await checkDatabaseMigrations(databaseUrl)));
  } else {
    results.push({
      ok: true,
      label: 'database-connectivity',
      detail:
        'No database URL configured; ran explicit offline structural checks only. Use db:check:database with a disposable/shadow Postgres URL for DB validation.',
    });
  }

  printResults(results);

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

await main();
