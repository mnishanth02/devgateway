import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

type CheckMode = 'auto' | 'offline' | 'database';

type CheckResult = {
  readonly ok: boolean;
  readonly label: string;
  readonly detail: string;
};

type UniqueIndexDefinition = {
  readonly columns: string[];
  readonly whereSql: string | undefined;
};

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = dirname(dirname(packageRoot));
const schemaDirectory = join(packageRoot, 'src', 'schema');
const migrationsDirectory = join(packageRoot, 'migrations');
const seedsDirectory = join(packageRoot, 'src', 'seeds');
const drizzleConfigPath = join(packageRoot, 'drizzle.config.ts');
const track2ExecutableIdempotencyTables = [
  'workflow_run',
  'workflow_step',
  'delegation',
  'agent_run',
  'step_attempt',
  'tool_call',
  'task_artifact',
  'skill_definition',
  'skill_version',
  'workflow_lease',
] as const;
const track2BudgetScopeTypes = ['workflow', 'delegation', 'tool_class'] as const;

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isCreateTableStatement(statement: string, tableName: string): boolean {
  return new RegExp(
    `^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:"public"\\.)?"${escapeRegExp(tableName)}"\\s*\\(`,
    'i',
  ).test(statement);
}

function isAlterTableStatement(statement: string, tableName: string): boolean {
  return new RegExp(`^ALTER\\s+TABLE\\s+(?:"public"\\.)?"${escapeRegExp(tableName)}"(?=\\s|$)`, 'i').test(
    statement,
  );
}

function findCreateTableStatement(statements: readonly string[], tableName: string): string | undefined {
  return statements.find((statement) => isCreateTableStatement(statement, tableName));
}

function getCreateTableColumns(statement: string): string[] {
  const columns: string[] = [];

  for (const line of statement.split(/\r?\n/)) {
    const match = line.match(/^\s*"([^"]+)"/);
    const columnName = match?.[1];

    if (columnName !== undefined) {
      columns.push(columnName);
    }
  }

  return columns;
}

function getQuotedColumns(columnListSql: string): string[] {
  const columns: string[] = [];

  for (const match of columnListSql.matchAll(/"([^"]+)"/g)) {
    const columnName = match[1];

    if (columnName !== undefined) {
      columns.push(columnName);
    }
  }

  return columns;
}

function sameColumnSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((column) => actual.includes(column));
}

function getUniqueIndexDefinitions(statements: readonly string[], tableName: string): UniqueIndexDefinition[] {
  const uniqueIndexDefinitions: UniqueIndexDefinition[] = [];
  const createUniqueIndexPattern = new RegExp(
    `^CREATE\\s+UNIQUE\\s+INDEX[\\s\\S]*?\\s+ON\\s+(?:"public"\\.)?"${escapeRegExp(tableName)}"\\s+(?:USING\\s+\\w+\\s+)?\\(([^;]+?)\\)(?:\\s+WHERE\\s+([\\s\\S]*?))?;?$`,
    'i',
  );

  for (const statement of statements) {
    const uniqueIndexMatch = statement.match(createUniqueIndexPattern);
    const indexColumnsSql = uniqueIndexMatch?.[1];

    if (indexColumnsSql !== undefined) {
      uniqueIndexDefinitions.push({
        columns: getQuotedColumns(indexColumnsSql),
        whereSql: uniqueIndexMatch?.[2]?.trim(),
      });
      continue;
    }

    if (!isCreateTableStatement(statement, tableName) && !isAlterTableStatement(statement, tableName)) {
      continue;
    }

    for (const match of statement.matchAll(/\bUNIQUE\s*\(([^)]+)\)/gi)) {
      const constraintColumnsSql = match[1];

      if (constraintColumnsSql !== undefined) {
        uniqueIndexDefinitions.push({
          columns: getQuotedColumns(constraintColumnsSql),
          whereSql: undefined,
        });
      }
    }
  }

  return uniqueIndexDefinitions;
}

function getUniqueColumnSets(statements: readonly string[], tableName: string): string[][] {
  return getUniqueIndexDefinitions(statements, tableName).map((definition) => definition.columns);
}

function hasUniqueColumns(statements: readonly string[], tableName: string, columns: readonly string[]): boolean {
  return getUniqueColumnSets(statements, tableName).some((columnSet) => sameColumnSet(columnSet, columns));
}

function normalizeSqlPredicate(sql: string, tableName: string): string {
  return sql
    .replace(new RegExp(`"public"\\."${escapeRegExp(tableName)}"\\.`, 'gi'), '')
    .replace(new RegExp(`"${escapeRegExp(tableName)}"\\.`, 'gi'), '')
    .replace(/"/g, '')
    .replace(/;$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hasActiveStatusPartialUniqueIndex(
  statements: readonly string[],
  tableName: string,
  columns: readonly string[],
): boolean {
  return getUniqueIndexDefinitions(statements, tableName).some((definition) => {
    if (!sameColumnSet(definition.columns, columns) || definition.whereSql === undefined) {
      return false;
    }

    return /(^|\W)status\s*=\s*'active'(?:\W|$)/.test(normalizeSqlPredicate(definition.whereSql, tableName));
  });
}

function migrationDefinesAppendOnlyTrigger(statements: readonly string[], tableName: string): boolean {
  const triggerPattern = new RegExp(
    `^CREATE\\s+(?:OR\\s+REPLACE\\s+)?TRIGGER\\s+"?[^"\\s]+"?\\s+BEFORE\\s+([\\s\\S]*?)\\s+ON\\s+(?:"public"\\.)?"?${escapeRegExp(tableName)}"?(?=\\s|$)`,
    'i',
  );

  return statements.some((statement) => {
    const events = statement.replace(/\s+/g, ' ').match(triggerPattern)?.[1]?.toUpperCase();

    return events !== undefined && ['UPDATE', 'DELETE', 'TRUNCATE'].every((event) => events.includes(event));
  });
}

function isRawArtifactContentColumn(columnName: string): boolean {
  const normalized = columnName.toLowerCase();

  if (normalized === 'content_hash') {
    return false;
  }

  return (
    normalized === 'content' ||
    normalized === 'body' ||
    normalized === 'blob' ||
    normalized.startsWith('raw_content') ||
    normalized.startsWith('raw_body') ||
    normalized.startsWith('raw_blob') ||
    normalized.endsWith('_content') ||
    normalized.endsWith('_body') ||
    normalized.endsWith('_blob')
  );
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

function checkTrack2WorkflowEventMigration(statements: readonly string[]): CheckResult {
  const workflowEventStatement = findCreateTableStatement(statements, 'workflow_event');
  const failures: string[] = [];

  if (workflowEventStatement === undefined) {
    failures.push('missing CREATE TABLE "workflow_event" in committed migration SQL');
  } else {
    const columns = getCreateTableColumns(workflowEventStatement);
    const missingColumns = ['workflow_run_id', 'sequence_number'].filter((column) => !columns.includes(column));

    if (columns.includes('updated_at')) {
      failures.push('workflow_event must not have updated_at; events are append-only');
    }

    if (missingColumns.length > 0) {
      failures.push(`workflow_event missing required column(s): ${missingColumns.join(', ')}`);
    }

    if (!hasUniqueColumns(statements, 'workflow_event', ['workflow_run_id', 'sequence_number'])) {
      failures.push('workflow_event missing unique key on workflow_run_id + sequence_number');
    }
  }

  return {
    ok: failures.length === 0,
    label: 'track2-workflow-event-append-only',
    detail:
      failures.length === 0
        ? 'workflow_event migration has append-only shape: no updated_at and unique workflow_run_id + sequence_number.'
        : failures.join('; '),
  };
}

function checkTrack2WorkflowEventRuntimeConvention(statements: readonly string[]): CheckResult {
  const workflowEventStatement = findCreateTableStatement(statements, 'workflow_event');

  if (workflowEventStatement === undefined) {
    return {
      ok: true,
      label: 'track2-workflow-event-runtime-enforcement',
      detail: 'Skipped runtime append-only enforcement TODO because workflow_event migration is not committed yet.',
    };
  }

  if (!migrationDefinesAppendOnlyTrigger(statements, 'workflow_event')) {
    return {
      ok: true,
      label: 'track2-workflow-event-runtime-enforcement',
      detail:
        'TODO: workflow_event has append-only structural convention but no committed UPDATE/DELETE/TRUNCATE trigger or role enforcement yet; Track 2 only requires convention at this phase.',
    };
  }

  return {
    ok: true,
    label: 'track2-workflow-event-runtime-enforcement',
    detail: 'workflow_event migration defines UPDATE/DELETE/TRUNCATE trigger enforcement for database-backed validation.',
  };
}

function checkTrack2WorkflowIdempotencyKeyMigration(statements: readonly string[]): CheckResult {
  const workflowIdempotencyKeyStatement = findCreateTableStatement(statements, 'workflow_idempotency_key');
  const failures: string[] = [];

  if (workflowIdempotencyKeyStatement === undefined) {
    failures.push('missing CREATE TABLE "workflow_idempotency_key" in committed migration SQL');
  } else {
    const columns = getCreateTableColumns(workflowIdempotencyKeyStatement);
    const requiredColumns = ['project_id', 'operation', 'idempotency_key'];
    const missingColumns = requiredColumns.filter((column) => !columns.includes(column));

    if (missingColumns.length > 0) {
      failures.push(`workflow_idempotency_key missing required column(s): ${missingColumns.join(', ')}`);
    }

    if (!hasUniqueColumns(statements, 'workflow_idempotency_key', requiredColumns)) {
      failures.push('workflow_idempotency_key missing unique key on project_id + operation + idempotency_key');
    }
  }

  return {
    ok: failures.length === 0,
    label: 'track2-workflow-idempotency-key',
    detail:
      failures.length === 0
        ? 'workflow_idempotency_key migration enforces unique project_id + operation + idempotency_key semantics.'
        : failures.join('; '),
  };
}

function checkTrack2ExecutableIdempotencyMigration(statements: readonly string[]): CheckResult {
  const failures: string[] = [];

  for (const tableName of track2ExecutableIdempotencyTables) {
    const tableStatement = findCreateTableStatement(statements, tableName);

    if (tableStatement === undefined) {
      failures.push(`${tableName}: missing table`);
      continue;
    }

    const columns = getCreateTableColumns(tableStatement);

    if (!columns.includes('idempotency_key')) {
      failures.push(`${tableName}: missing idempotency_key column`);
      continue;
    }

    if (!hasUniqueColumns(statements, tableName, ['idempotency_key'])) {
      failures.push(`${tableName}: missing unique idempotency_key index`);
    }
  }

  return {
    ok: failures.length === 0,
    label: 'track2-idempotency-indexes',
    detail:
      failures.length === 0
        ? `Track 2 executable tables enforce unique idempotency_key indexes: ${track2ExecutableIdempotencyTables.join(', ')}.`
        : failures.join('; '),
  };
}

function checkTrack2TaskArtifactObjectRefMigration(statements: readonly string[]): CheckResult {
  const taskArtifactStatement = findCreateTableStatement(statements, 'task_artifact');

  if (taskArtifactStatement === undefined) {
    return {
      ok: false,
      label: 'track2-task-artifact-object-ref',
      detail: 'missing CREATE TABLE "task_artifact" in committed migration SQL',
    };
  }

  const rawContentColumns = getCreateTableColumns(taskArtifactStatement).filter(isRawArtifactContentColumn);

  return {
    ok: rawContentColumns.length === 0,
    label: 'track2-task-artifact-object-ref',
    detail:
      rawContentColumns.length === 0
        ? 'task_artifact migration stores artifact metadata/object references only; content_hash is allowed and no raw content/body/blob columns were found.'
        : `task_artifact must not store raw content/body/blob columns in Postgres: ${rawContentColumns.join(', ')}`,
  };
}

function checkTrack2BudgetScopeTypesMigration(statements: readonly string[]): CheckResult {
  const budgetScopeStatement = findCreateTableStatement(statements, 'budget_scope');

  if (budgetScopeStatement === undefined) {
    return {
      ok: false,
      label: 'track2-budget-scope-types',
      detail: 'missing CREATE TABLE "budget_scope" in committed migration SQL',
    };
  }

  const budgetScopeCheckSql = statements
    .filter((statement) => isCreateTableStatement(statement, 'budget_scope') || isAlterTableStatement(statement, 'budget_scope'))
    .join('\n');
  const missingScopeTypes = track2BudgetScopeTypes.filter(
    (scopeType) => !new RegExp(`'${escapeRegExp(scopeType)}'`, 'i').test(budgetScopeCheckSql),
  );

  return {
    ok: missingScopeTypes.length === 0,
    label: 'track2-budget-scope-types',
    detail:
      missingScopeTypes.length === 0
        ? `budget_scope scope_type check includes Track 2 scope types: ${track2BudgetScopeTypes.join(', ')}.`
        : `budget_scope scope_type check missing Track 2 scope type(s): ${missingScopeTypes.join(', ')}`,
  };
}

function checkTrack2WorkflowLeaseActiveUniquenessMigration(statements: readonly string[]): CheckResult {
  const workflowLeaseStatement = findCreateTableStatement(statements, 'workflow_lease');
  const failures: string[] = [];

  if (workflowLeaseStatement === undefined) {
    failures.push('missing CREATE TABLE "workflow_lease" in committed migration SQL');
  } else {
    const columns = getCreateTableColumns(workflowLeaseStatement);
    const missingColumns = ['lease_key', 'status'].filter((column) => !columns.includes(column));

    if (missingColumns.length > 0) {
      failures.push(`workflow_lease missing required column(s): ${missingColumns.join(', ')}`);
    }

    if (!hasActiveStatusPartialUniqueIndex(statements, 'workflow_lease', ['lease_key'])) {
      failures.push("workflow_lease missing partial unique index on lease_key where status = 'active'");
    }
  }

  return {
    ok: failures.length === 0,
    label: 'track2-workflow-lease-active-unique',
    detail:
      failures.length === 0
        ? "workflow_lease migration enforces one active lease per lease_key with a partial unique index while allowing released/expired/lost history."
        : failures.join('; '),
  };
}

function checkTrack2BudgetReservationMigration(statements: readonly string[]): CheckResult {
  const budgetReservationStatement = findCreateTableStatement(statements, 'budget_reservation');
  const failures: string[] = [];

  if (budgetReservationStatement === undefined) {
    failures.push('missing CREATE TABLE "budget_reservation" in committed migration SQL');
  } else {
    const columns = getCreateTableColumns(budgetReservationStatement);
    const requiredColumns = [
      'reservation_id',
      'budget_scope_id',
      'workflow_run_id',
      'delegation_id',
      'tool_class',
      'model_alias',
      'currency',
      'reserved_amount',
      'actual_amount',
      'reserved_input_tokens',
      'reserved_output_tokens',
      'reserved_total_tokens',
      'actual_input_tokens',
      'actual_output_tokens',
      'actual_total_tokens',
      'status',
      'reserve_idempotency_key',
      'settle_idempotency_key',
      'release_idempotency_key',
      'request_id',
      'trace_id',
      'policy_version',
      'registry_version',
      'cost_event_id',
      'production_enabled',
      'reserved_at',
      'settled_at',
      'released_at',
      'created_at',
      'updated_at',
    ];
    const missingColumns = requiredColumns.filter((column) => !columns.includes(column));

    if (missingColumns.length > 0) {
      failures.push(`budget_reservation missing required column(s): ${missingColumns.join(', ')}`);
    }

    for (const uniqueColumns of [
      ['reservation_id'],
      ['reserve_idempotency_key'],
      ['settle_idempotency_key'],
      ['release_idempotency_key'],
    ] as const) {
      if (!hasUniqueColumns(statements, 'budget_reservation', uniqueColumns)) {
        failures.push(`budget_reservation missing unique key on ${uniqueColumns.join(' + ')}`);
      }
    }

    const budgetReservationCheckSql = statements
      .filter(
        (statement) =>
          isCreateTableStatement(statement, 'budget_reservation') ||
          isAlterTableStatement(statement, 'budget_reservation'),
      )
      .join('\n');
    const missingStatuses = ['reserved', 'settled', 'released'].filter(
      (status) => !new RegExp(`'${escapeRegExp(status)}'`, 'i').test(budgetReservationCheckSql),
    );

    if (missingStatuses.length > 0) {
      failures.push(`budget_reservation status check missing value(s): ${missingStatuses.join(', ')}`);
    }

    if (!/production_enabled"?\s*=\s*false/i.test(budgetReservationCheckSql)) {
      failures.push('budget_reservation missing production_enabled=false check');
    }
  }

  return {
    ok: failures.length === 0,
    label: 'track2-budget-reservation-durability',
    detail:
      failures.length === 0
        ? 'budget_reservation migration persists reservation lifecycle state and enforces public/idempotency uniqueness for replay.'
        : failures.join('; '),
  };
}

function checkTrack2CommittedStructure(): CheckResult[] {
  const migrationStatements = readMigrationStatements();

  return [
    checkTrack2WorkflowEventMigration(migrationStatements),
    checkTrack2WorkflowEventRuntimeConvention(migrationStatements),
    checkTrack2WorkflowIdempotencyKeyMigration(migrationStatements),
    checkTrack2ExecutableIdempotencyMigration(migrationStatements),
    checkTrack2TaskArtifactObjectRefMigration(migrationStatements),
    checkTrack2BudgetScopeTypesMigration(migrationStatements),
    checkTrack2WorkflowLeaseActiveUniquenessMigration(migrationStatements),
    checkTrack2BudgetReservationMigration(migrationStatements),
  ];
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

    const migrationStatements = readMigrationStatements();

    for (const statement of migrationStatements) {
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

    if (findCreateTableStatement(migrationStatements, 'workflow_event') !== undefined) {
      if (!migrationDefinesAppendOnlyTrigger(migrationStatements, 'workflow_event')) {
        results.push({
          ok: true,
          label: 'workflow-event-append-only-enforcement',
          detail:
            'TODO: workflow_event migration has no committed UPDATE/DELETE/TRUNCATE trigger or role enforcement; skipped runtime mutation validation because Track 2 only requires append-only convention at this phase.',
        });
      } else {
        const workflowEventRejectedOperations = [
          ['workflow_event update', () => client`update workflow_event set event_type = event_type where false`],
          ['workflow_event delete', () => client`delete from workflow_event where false`],
          ['workflow_event truncate', () => client`truncate workflow_event`],
        ] as const;
        const workflowEventUnexpectedAllows: string[] = [];

        for (const [operation, execute] of workflowEventRejectedOperations) {
          try {
            await execute();
            workflowEventUnexpectedAllows.push(operation);
          } catch {
            // Expected: append-only trigger rejects the mutation.
          }
        }

        results.push({
          ok: workflowEventUnexpectedAllows.length === 0,
          label: 'workflow-event-append-only-enforcement',
          detail:
            workflowEventUnexpectedAllows.length === 0
              ? 'workflow_event rejects UPDATE, DELETE, and TRUNCATE in the disposable database.'
              : `workflow_event append-only enforcement allowed: ${workflowEventUnexpectedAllows.join(', ')}`,
        });
      }
    }
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
  const results = [
    ...checkCommittedStructure(),
    checkSeedsDoNotContainObviousSecrets(),
    checkMigrationOrdering(),
    ...checkTrack2CommittedStructure(),
  ];

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
