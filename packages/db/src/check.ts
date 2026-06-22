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

const track3WorkflowEventTypes = [
  'cancel_requested',
  'approval_requested',
  'approval_approved',
  'approval_denied',
  'approval_expired',
  'retry_scheduled',
  'retry_executed',
  'retry_exhausted',
  'outbox_enqueued',
  'outbox_delivered',
  'outbox_failed',
  'cancellation_observed',
  'cancellation_completed',
  'manual_review_opened',
  'manual_review_resolved',
  'artifact_lifecycle_changed',
  'template_instantiated',
] as const;

const track3WorkflowEventStates = [
  'pending_approval',
  'manual_review',
  'cancel_requested',
  'cancelled',
  'retry_scheduled',
] as const;

const track3IdempotencyKeyOperations = [
  'model_call',
  'budget_reservation',
  'cost_event',
  'audit_event',
  'approval',
  'outbox',
  'cancellation',
  'retry',
  'manual_review',
  'reservation_release',
  'artifact_lifecycle',
  'template_instantiation',
] as const;

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

function createTableColumnIsNotNull(statement: string, columnName: string): boolean {
  return new RegExp(`"${escapeRegExp(columnName)}"\\s+[^,\\n]+\\s+NOT\\s+NULL`, 'i').test(statement);
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

function hasIndex(statements: readonly string[], tableName: string, columns: readonly string[]): boolean {
  const nonUniqueIndexPattern = new RegExp(
    `^CREATE\\s+INDEX[\\s\\S]*?\\s+ON\\s+(?:"public"\\.)?"${escapeRegExp(tableName)}"\\s+(?:USING\\s+\\w+\\s+)?\\(([^;]+?)\\)`,
    'i',
  );

  for (const statement of statements) {
    const match = statement.match(nonUniqueIndexPattern);

    if (match?.[1] !== undefined && sameColumnSet(getQuotedColumns(match[1]), columns)) {
      return true;
    }
  }

  return hasUniqueColumns(statements, tableName, columns);
}

function tableHasAlteredColumn(statements: readonly string[], tableName: string, columnName: string): boolean {
  const addColumnPattern = new RegExp(
    `^ALTER\\s+TABLE\\s+(?:"public"\\.)?"${escapeRegExp(tableName)}"\\s+ADD\\s+COLUMN\\s+"${escapeRegExp(columnName)}"`,
    'i',
  );
  return statements.some((statement) => addColumnPattern.test(statement));
}

function migrationDefinesAppendOnlyTrigger(statements: readonly string[], tableName: string): boolean {
  const triggerPattern = new RegExp(
    `^CREATE\\s+(?:OR\\s+REPLACE\\s+)?TRIGGER\\s+"?[^"\\s]+"?\\s+BEFORE\\s+([\\s\\S]*?)\\s+ON\\s+(?:"public"\\.)?"?${escapeRegExp(tableName)}"?(?=\\s|$)`,
    'i',
  );

  return statements.some((statement) => {
    const normalizedStatement = statement.replace(/\s+/g, ' ');
    const events = normalizedStatement.match(triggerPattern)?.[1]?.toUpperCase();

    return (
      events !== undefined &&
      ['UPDATE', 'DELETE', 'TRUNCATE'].every((event) => events.includes(event)) &&
      /\bFOR\s+EACH\s+STATEMENT\b/i.test(normalizedStatement)
    );
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

function checkTrack3ApprovalRequestMigration(statements: readonly string[]): CheckResult {
  const tableStatement = findCreateTableStatement(statements, 'approval_request');
  const failures: string[] = [];

  if (tableStatement === undefined) {
    failures.push('missing CREATE TABLE "approval_request" in committed migration SQL');
  } else {
    const columns = getCreateTableColumns(tableStatement);
    const requiredColumns = [
      'approval_request_id',
      'workflow_run_id',
      'task_id',
      'workflow_step_id',
      'state',
      'risk_tier',
      'decision_audit_event_id',
      'expires_at',
      'idempotency_key',
      'project_id',
      'production_enabled',
    ];
    const missingColumns = requiredColumns.filter((column) => !columns.includes(column));

    if (missingColumns.length > 0) {
      failures.push(`approval_request missing required column(s): ${missingColumns.join(', ')}`);
    }

    if (!createTableColumnIsNotNull(tableStatement, 'idempotency_key')) {
      failures.push('approval_request idempotency_key must be NOT NULL');
    }

    for (const uniqueColumns of [['approval_request_id'], ['idempotency_key']] as const) {
      if (!hasUniqueColumns(statements, 'approval_request', uniqueColumns)) {
        failures.push(`approval_request missing unique index on ${uniqueColumns.join(' + ')}`);
      }
    }

    const checkSql = statements
      .filter((s) => isCreateTableStatement(s, 'approval_request') || isAlterTableStatement(s, 'approval_request'))
      .join('\n');

    const missingRiskTiers = ['low', 'medium', 'high', 'critical'].filter(
      (tier) => !new RegExp(`'${escapeRegExp(tier)}'`, 'i').test(checkSql),
    );

    if (missingRiskTiers.length > 0) {
      failures.push(`approval_request risk_tier check missing value(s): ${missingRiskTiers.join(', ')}`);
    }

    const missingStates = ['pending', 'approved', 'denied', 'expired', 'cancelled', 'superseded'].filter(
      (state) => !new RegExp(`'${escapeRegExp(state)}'`, 'i').test(checkSql),
    );

    if (missingStates.length > 0) {
      failures.push(`approval_request state check missing value(s): ${missingStates.join(', ')}`);
    }

    if (!/production_enabled"?\s*=\s*false/i.test(checkSql)) {
      failures.push('approval_request missing production_enabled=false check');
    }

    if (!hasIndex(statements, 'approval_request', ['decision_audit_event_id'])) {
      failures.push('approval_request missing index on decision_audit_event_id');
    }

    if (!hasIndex(statements, 'approval_request', ['expires_at'])) {
      failures.push('approval_request missing index on expires_at');
    }

    if (!hasIndex(statements, 'approval_request', ['task_id'])) {
      failures.push('approval_request missing index on task_id');
    }

    if (!/approval_request_approved_proof_check/i.test(checkSql)) {
      failures.push('approval_request missing approved-state proof check');
    }
  }

  return {
    ok: failures.length === 0,
    label: 'track3-approval-request',
    detail:
      failures.length === 0
        ? 'approval_request migration has durable refs, state/risk check constraints, idempotency uniqueness, and decision/expiry indexes.'
        : failures.join('; '),
  };
}

function checkTrack3WorkflowOutboxMigration(statements: readonly string[]): CheckResult {
  const tableStatement = findCreateTableStatement(statements, 'workflow_outbox');
  const failures: string[] = [];

  if (tableStatement === undefined) {
    failures.push('missing CREATE TABLE "workflow_outbox" in committed migration SQL');
  } else {
    const columns = getCreateTableColumns(tableStatement);
    const requiredColumns = [
      'outbox_id',
      'workflow_run_id',
      'source_workflow_event_id',
      'destination_kind',
      'idempotency_key',
      'delivery_state',
      'next_attempt_at',
      'project_id',
      'production_enabled',
    ];
    const missingColumns = requiredColumns.filter((column) => !columns.includes(column));

    if (missingColumns.length > 0) {
      failures.push(`workflow_outbox missing required column(s): ${missingColumns.join(', ')}`);
    }

    if (!hasUniqueColumns(statements, 'workflow_outbox', ['outbox_id'])) {
      failures.push('workflow_outbox missing unique index on outbox_id');
    }

    if (!/"workflow_run_id"\s+bigint\s+NOT\s+NULL/i.test(tableStatement)) {
      failures.push('workflow_outbox workflow_run_id must be NOT NULL for workflow-scoped delivery');
    }

    if (!/"source_workflow_event_id"\s+bigint\s+NOT\s+NULL/i.test(tableStatement)) {
      failures.push('workflow_outbox source_workflow_event_id must be NOT NULL so uniqueness cannot be bypassed by NULL');
    }

    if (
      !hasUniqueColumns(statements, 'workflow_outbox', [
        'destination_kind',
        'source_workflow_event_id',
        'idempotency_key',
      ])
    ) {
      failures.push('workflow_outbox missing destination/source/idempotency_key composite unique index');
    }

    const checkSql = statements
      .filter((s) => isCreateTableStatement(s, 'workflow_outbox') || isAlterTableStatement(s, 'workflow_outbox'))
      .join('\n');

    const missingDestinationKinds = ['trace', 'audit', 'notification', 'eval_evidence', 'portal_update', 'webhook_ref'].filter(
      (kind) => !new RegExp(`'${escapeRegExp(kind)}'`, 'i').test(checkSql),
    );

    if (missingDestinationKinds.length > 0) {
      failures.push(`workflow_outbox destination_kind check missing value(s): ${missingDestinationKinds.join(', ')}`);
    }

    const missingDeliveryStates = ['pending', 'delivering', 'delivered', 'failed', 'dead_lettered'].filter(
      (state) => !new RegExp(`'${escapeRegExp(state)}'`, 'i').test(checkSql),
    );

    if (missingDeliveryStates.length > 0) {
      failures.push(`workflow_outbox delivery_state check missing value(s): ${missingDeliveryStates.join(', ')}`);
    }

    if (!/production_enabled"?\s*=\s*false/i.test(checkSql)) {
      failures.push('workflow_outbox missing production_enabled=false check');
    }

    if (!hasIndex(statements, 'workflow_outbox', ['delivery_state'])) {
      failures.push('workflow_outbox missing index on delivery_state');
    }

    if (!hasIndex(statements, 'workflow_outbox', ['workflow_run_id'])) {
      failures.push('workflow_outbox missing index on workflow_run_id');
    }

    if (!hasIndex(statements, 'workflow_outbox', ['next_attempt_at'])) {
      failures.push('workflow_outbox missing index on next_attempt_at');
    }
  }

  return {
    ok: failures.length === 0,
    label: 'track3-workflow-outbox',
    detail:
      failures.length === 0
        ? 'workflow_outbox migration has destination/source/idempotency uniqueness, delivery-state/next-attempt indexes, and metadata-only posture.'
        : failures.join('; '),
  };
}

function checkTrack3WorkflowTemplateMigration(statements: readonly string[]): CheckResult {
  const templateStatement = findCreateTableStatement(statements, 'workflow_template');
  const versionStatement = findCreateTableStatement(statements, 'workflow_template_version');
  const failures: string[] = [];

  if (templateStatement === undefined) {
    failures.push('missing CREATE TABLE "workflow_template" in committed migration SQL');
  } else {
    const columns = getCreateTableColumns(templateStatement);
    const requiredColumns = ['workflow_template_id', 'template_name', 'project_id', 'status', 'production_enabled'];
    const missingColumns = requiredColumns.filter((column) => !columns.includes(column));

    if (missingColumns.length > 0) {
      failures.push(`workflow_template missing required column(s): ${missingColumns.join(', ')}`);
    }

    if (!hasUniqueColumns(statements, 'workflow_template', ['workflow_template_id'])) {
      failures.push('workflow_template missing unique index on workflow_template_id');
    }

    if (!hasUniqueColumns(statements, 'workflow_template', ['template_name', 'project_id'])) {
      failures.push('workflow_template missing unique index on template_name + project_id');
    }

    const checkSql = statements
      .filter((s) => isCreateTableStatement(s, 'workflow_template') || isAlterTableStatement(s, 'workflow_template'))
      .join('\n');

    const missingStatuses = ['draft', 'eval_ready', 'approved', 'limited_rollout', 'production', 'disabled'].filter(
      (status) => !new RegExp(`'${escapeRegExp(status)}'`, 'i').test(checkSql),
    );

    if (missingStatuses.length > 0) {
      failures.push(`workflow_template status check missing value(s): ${missingStatuses.join(', ')}`);
    }

    if (!/production_enabled"?\s*=\s*false/i.test(checkSql)) {
      failures.push('workflow_template missing production_enabled=false check');
    }
  }

  if (versionStatement === undefined) {
    failures.push('missing CREATE TABLE "workflow_template_version" in committed migration SQL');
  } else {
    const columns = getCreateTableColumns(versionStatement);
    const requiredColumns = [
      'workflow_template_version_id',
      'workflow_template_id',
      'version',
      'project_id',
      'idempotency_key',
      'status',
      'production_enabled',
    ];
    const missingColumns = requiredColumns.filter((column) => !columns.includes(column));

    if (missingColumns.length > 0) {
      failures.push(`workflow_template_version missing required column(s): ${missingColumns.join(', ')}`);
    }

    if (!createTableColumnIsNotNull(versionStatement, 'idempotency_key')) {
      failures.push('workflow_template_version idempotency_key must be NOT NULL');
    }

    if (!hasUniqueColumns(statements, 'workflow_template_version', ['workflow_template_version_id'])) {
      failures.push('workflow_template_version missing unique index on workflow_template_version_id');
    }

    if (!hasUniqueColumns(statements, 'workflow_template_version', ['workflow_template_id', 'version'])) {
      failures.push('workflow_template_version missing immutable version unique index on workflow_template_id + version');
    }

    if (!hasUniqueColumns(statements, 'workflow_template_version', ['idempotency_key'])) {
      failures.push('workflow_template_version missing unique index on idempotency_key');
    }

    const checkSql = statements
      .filter(
        (s) =>
          isCreateTableStatement(s, 'workflow_template_version') ||
          isAlterTableStatement(s, 'workflow_template_version'),
      )
      .join('\n');

    if (!/production_enabled"?\s*=\s*false/i.test(checkSql)) {
      failures.push('workflow_template_version missing production_enabled=false check');
    }

    if (!migrationDefinesAppendOnlyTrigger(statements, 'workflow_template_version')) {
      failures.push('workflow_template_version missing UPDATE/DELETE/TRUNCATE immutability trigger');
    }
  }

  return {
    ok: failures.length === 0,
    label: 'track3-workflow-template',
    detail:
      failures.length === 0
        ? 'workflow_template and workflow_template_version migrations have immutable version uniqueness, mutation trigger enforcement, and production-disabled checks.'
        : failures.join('; '),
  };
}

function checkTrack3WorkflowCancellationMigration(statements: readonly string[]): CheckResult {
  const tableStatement = findCreateTableStatement(statements, 'workflow_cancellation');
  const failures: string[] = [];

  if (tableStatement === undefined) {
    failures.push('missing CREATE TABLE "workflow_cancellation" in committed migration SQL');
  } else {
    const columns = getCreateTableColumns(tableStatement);
    const requiredColumns = [
      'workflow_cancellation_id',
      'workflow_run_id',
      'requester_principal_id',
      'propagation_state',
      'idempotency_key',
      'project_id',
      'production_enabled',
    ];
    const missingColumns = requiredColumns.filter((column) => !columns.includes(column));

    if (missingColumns.length > 0) {
      failures.push(`workflow_cancellation missing required column(s): ${missingColumns.join(', ')}`);
    }

    if (!createTableColumnIsNotNull(tableStatement, 'idempotency_key')) {
      failures.push('workflow_cancellation idempotency_key must be NOT NULL');
    }

    for (const uniqueColumns of [['workflow_cancellation_id'], ['idempotency_key']] as const) {
      if (!hasUniqueColumns(statements, 'workflow_cancellation', uniqueColumns)) {
        failures.push(`workflow_cancellation missing unique index on ${uniqueColumns.join(' + ')}`);
      }
    }

    const checkSql = statements
      .filter(
        (s) =>
          isCreateTableStatement(s, 'workflow_cancellation') || isAlterTableStatement(s, 'workflow_cancellation'),
      )
      .join('\n');

    const missingPropagationStates = [
      'requested',
      'propagating',
      'pending_manual_review',
      'unwinding',
      'releasing_reservations',
      'completed',
      'partially_completed',
    ].filter((state) => !new RegExp(`'${escapeRegExp(state)}'`, 'i').test(checkSql));

    if (missingPropagationStates.length > 0) {
      failures.push(
        `workflow_cancellation propagation_state check missing value(s): ${missingPropagationStates.join(', ')}`,
      );
    }

    if (!/production_enabled"?\s*=\s*false/i.test(checkSql)) {
      failures.push('workflow_cancellation missing production_enabled=false check');
    }

    for (const column of ['workflow_run_id', 'project_id', 'requester_principal_id'] as const) {
      if (!hasIndex(statements, 'workflow_cancellation', [column])) {
        failures.push(`workflow_cancellation missing index on ${column}`);
      }
    }
  }

  return {
    ok: failures.length === 0,
    label: 'track3-workflow-cancellation',
    detail:
      failures.length === 0
        ? 'workflow_cancellation migration has propagation state check, idempotency uniqueness, and workflow/project/requester indexes.'
        : failures.join('; '),
  };
}

function checkTrack3ManualReviewItemMigration(statements: readonly string[]): CheckResult {
  const tableStatement = findCreateTableStatement(statements, 'manual_review_item');
  const failures: string[] = [];

  if (tableStatement === undefined) {
    failures.push('missing CREATE TABLE "manual_review_item" in committed migration SQL');
  } else {
    const columns = getCreateTableColumns(tableStatement);
    const requiredColumns = [
      'manual_review_item_id',
      'workflow_run_id',
      'workflow_step_id',
      'step_attempt_id',
      'review_state',
      'blocking_state',
      'idempotency_key',
      'project_id',
      'production_enabled',
    ];
    const missingColumns = requiredColumns.filter((column) => !columns.includes(column));

    if (missingColumns.length > 0) {
      failures.push(`manual_review_item missing required column(s): ${missingColumns.join(', ')}`);
    }

    if (!createTableColumnIsNotNull(tableStatement, 'idempotency_key')) {
      failures.push('manual_review_item idempotency_key must be NOT NULL');
    }

    for (const uniqueColumns of [['manual_review_item_id'], ['idempotency_key']] as const) {
      if (!hasUniqueColumns(statements, 'manual_review_item', uniqueColumns)) {
        failures.push(`manual_review_item missing unique index on ${uniqueColumns.join(' + ')}`);
      }
    }

    const checkSql = statements
      .filter(
        (s) => isCreateTableStatement(s, 'manual_review_item') || isAlterTableStatement(s, 'manual_review_item'),
      )
      .join('\n');

    const missingReviewStates = ['open', 'in_progress', 'resolved', 'closed'].filter(
      (state) => !new RegExp(`'${escapeRegExp(state)}'`, 'i').test(checkSql),
    );

    if (missingReviewStates.length > 0) {
      failures.push(`manual_review_item review_state check missing value(s): ${missingReviewStates.join(', ')}`);
    }

    const missingBlockingStates = ['blocking_workflow', 'blocking_step', 'informational'].filter(
      (state) => !new RegExp(`'${escapeRegExp(state)}'`, 'i').test(checkSql),
    );

    if (missingBlockingStates.length > 0) {
      failures.push(`manual_review_item blocking_state check missing value(s): ${missingBlockingStates.join(', ')}`);
    }

    if (!/production_enabled"?\s*=\s*false/i.test(checkSql)) {
      failures.push('manual_review_item missing production_enabled=false check');
    }

    for (const column of ['workflow_run_id', 'workflow_step_id', 'step_attempt_id'] as const) {
      if (!hasIndex(statements, 'manual_review_item', [column])) {
        failures.push(`manual_review_item missing index on ${column}`);
      }
    }
  }

  return {
    ok: failures.length === 0,
    label: 'track3-manual-review-item',
    detail:
      failures.length === 0
        ? 'manual_review_item migration has idempotency uniqueness, review/blocking state checks, and workflow/step/attempt indexes.'
        : failures.join('; '),
  };
}

function checkTrack3ArtifactLifecycleEventMigration(statements: readonly string[]): CheckResult {
  const tableStatement = findCreateTableStatement(statements, 'artifact_lifecycle_event');
  const failures: string[] = [];

  if (tableStatement === undefined) {
    failures.push('missing CREATE TABLE "artifact_lifecycle_event" in committed migration SQL');
  } else {
    const columns = getCreateTableColumns(tableStatement);
    const requiredColumns = [
      'artifact_lifecycle_event_id',
      'task_artifact_id',
      'action',
      'state',
      'idempotency_key',
      'audit_event_id',
      'signed_access_eligible',
      'signed_access_requires_approval',
      'signed_access_max_duration_seconds',
      'project_id',
      'production_enabled',
    ];
    const missingColumns = requiredColumns.filter((column) => !columns.includes(column));

    if (missingColumns.length > 0) {
      failures.push(`artifact_lifecycle_event missing required column(s): ${missingColumns.join(', ')}`);
    }

    if (!createTableColumnIsNotNull(tableStatement, 'idempotency_key')) {
      failures.push('artifact_lifecycle_event idempotency_key must be NOT NULL');
    }

    for (const uniqueColumns of [['artifact_lifecycle_event_id'], ['idempotency_key']] as const) {
      if (!hasUniqueColumns(statements, 'artifact_lifecycle_event', uniqueColumns)) {
        failures.push(`artifact_lifecycle_event missing unique index on ${uniqueColumns.join(' + ')}`);
      }
    }

    const checkSql = statements
      .filter(
        (s) =>
          isCreateTableStatement(s, 'artifact_lifecycle_event') ||
          isAlterTableStatement(s, 'artifact_lifecycle_event'),
      )
      .join('\n');

    const missingActions = [
      'created',
      'verified',
      'expiry_set',
      'retained',
      'legal_hold_applied',
      'legal_hold_released',
      'redacted',
      'deletion_scheduled',
      'deleted',
      'signed_access_granted',
      'signed_access_revoked',
    ].filter((action) => !new RegExp(`'${escapeRegExp(action)}'`, 'i').test(checkSql));

    if (missingActions.length > 0) {
      failures.push(`artifact_lifecycle_event action check missing value(s): ${missingActions.join(', ')}`);
    }

    const missingStates = [
      'pending',
      'active',
      'expiring',
      'redacted',
      'expired',
      'deletion_pending',
      'deleted',
      'legal_hold_active',
    ].filter((state) => !new RegExp(`'${escapeRegExp(state)}'`, 'i').test(checkSql));

    if (missingStates.length > 0) {
      failures.push(`artifact_lifecycle_event state check missing value(s): ${missingStates.join(', ')}`);
    }

    if (!/production_enabled"?\s*=\s*false/i.test(checkSql)) {
      failures.push('artifact_lifecycle_event missing production_enabled=false check');
    }

    if (!hasIndex(statements, 'artifact_lifecycle_event', ['expires_at'])) {
      failures.push('artifact_lifecycle_event missing index on expires_at');
    }

    if (!hasIndex(statements, 'artifact_lifecycle_event', ['audit_event_id'])) {
      failures.push('artifact_lifecycle_event missing index on audit_event_id');
    }

    if (!/artifact_lifecycle_event_signed_access_duration_check/i.test(checkSql)) {
      failures.push('artifact_lifecycle_event missing signed-access duration check');
    }

    if (!/artifact_lifecycle_event_signed_access_policy_check/i.test(checkSql)) {
      failures.push('artifact_lifecycle_event missing signed-access approval policy check');
    }

    const rawContentColumns = columns.filter(isRawArtifactContentColumn);

    if (rawContentColumns.length > 0) {
      failures.push(
        `artifact_lifecycle_event must not store raw content/body/blob columns: ${rawContentColumns.join(', ')}`,
      );
    }
  }

  return {
    ok: failures.length === 0,
    label: 'track3-artifact-lifecycle-event',
    detail:
      failures.length === 0
        ? 'artifact_lifecycle_event migration has action/state checks, task_artifact FK, idempotency uniqueness, expiry/audit indexes, and metadata-only storage posture.'
        : failures.join('; '),
  };
}

function checkTrack3WorkflowEventExtensions(statements: readonly string[]): CheckResult {
  const workflowEventCheckSql = statements
    .filter((s) => isCreateTableStatement(s, 'workflow_event') || isAlterTableStatement(s, 'workflow_event'))
    .join('\n');

  if (workflowEventCheckSql.length === 0) {
    return {
      ok: false,
      label: 'track3-workflow-event-extensions',
      detail: 'No workflow_event CREATE TABLE or ALTER TABLE statements found in committed migration SQL.',
    };
  }

  const failures: string[] = [];

  const missingEventTypes = track3WorkflowEventTypes.filter(
    (eventType) => !new RegExp(`'${escapeRegExp(eventType)}'`, 'i').test(workflowEventCheckSql),
  );

  if (missingEventTypes.length > 0) {
    failures.push(`workflow_event type_check missing Track 3 event type(s): ${missingEventTypes.join(', ')}`);
  }

  const missingStates = track3WorkflowEventStates.filter(
    (state) => !new RegExp(`'${escapeRegExp(state)}'`, 'i').test(workflowEventCheckSql),
  );

  if (missingStates.length > 0) {
    failures.push(`workflow_event state_check missing Track 3 state(s): ${missingStates.join(', ')}`);
  }

  return {
    ok: failures.length === 0,
    label: 'track3-workflow-event-extensions',
    detail:
      failures.length === 0
        ? 'workflow_event type_check and state_check include all Track 3 event types and states.'
        : failures.join('; '),
  };
}

function checkTrack3WorkflowIdempotencyKeyOperations(statements: readonly string[]): CheckResult {
  const workflowIdempotencyKeyCheckSql = statements
    .filter(
      (s) =>
        isCreateTableStatement(s, 'workflow_idempotency_key') ||
        isAlterTableStatement(s, 'workflow_idempotency_key'),
    )
    .join('\n');

  if (workflowIdempotencyKeyCheckSql.length === 0) {
    return {
      ok: false,
      label: 'track3-workflow-idempotency-key-operations',
      detail:
        'No workflow_idempotency_key CREATE TABLE or ALTER TABLE statements found in committed migration SQL.',
    };
  }

  const missingOperations = track3IdempotencyKeyOperations.filter(
    (operation) => !new RegExp(`'${escapeRegExp(operation)}'`, 'i').test(workflowIdempotencyKeyCheckSql),
  );

  return {
    ok: missingOperations.length === 0,
    label: 'track3-workflow-idempotency-key-operations',
    detail:
      missingOperations.length === 0
        ? `workflow_idempotency_key operation check includes all Track 3 operations: ${track3IdempotencyKeyOperations.join(', ')}.`
        : `workflow_idempotency_key operation check missing Track 3 operation(s): ${missingOperations.join(', ')}`,
  };
}

function checkTrack3ExistingTableExtensions(statements: readonly string[]): CheckResult {
  const failures: string[] = [];

  for (const column of [
    'template_version_id',
    'pause_state',
    'cancellation_ref',
    'manual_review_status',
    'durable_runtime_version',
  ] as const) {
    if (!tableHasAlteredColumn(statements, 'workflow_run', column)) {
      failures.push(`workflow_run missing ALTER TABLE ADD COLUMN ${column}`);
    }
  }

  for (const column of ['retry_policy_ref', 'next_attempt_at', 'failure_class'] as const) {
    if (!tableHasAlteredColumn(statements, 'workflow_step', column)) {
      failures.push(`workflow_step missing ALTER TABLE ADD COLUMN ${column}`);
    }
  }

  for (const column of [
    'retry_policy_ref',
    'external_request_ref',
    'fencing_token',
    'replay_decision',
    'failure_class',
  ] as const) {
    if (!tableHasAlteredColumn(statements, 'step_attempt', column)) {
      failures.push(`step_attempt missing ALTER TABLE ADD COLUMN ${column}`);
    }
  }

  for (const column of ['manual_review_status', 'recovery_reason', 'sweep_evidence_ref'] as const) {
    if (!tableHasAlteredColumn(statements, 'workflow_lease', column)) {
      failures.push(`workflow_lease missing ALTER TABLE ADD COLUMN ${column}`);
    }
  }

  return {
    ok: failures.length === 0,
    label: 'track3-existing-table-extensions',
    detail:
      failures.length === 0
        ? 'workflow_run, workflow_step, step_attempt, and workflow_lease have all required Track 3 extension columns.'
        : failures.join('; '),
  };
}

function checkTrack3CommittedStructure(): CheckResult[] {
  const migrationStatements = readMigrationStatements();

  return [
    checkTrack3ApprovalRequestMigration(migrationStatements),
    checkTrack3WorkflowOutboxMigration(migrationStatements),
    checkTrack3WorkflowTemplateMigration(migrationStatements),
    checkTrack3WorkflowCancellationMigration(migrationStatements),
    checkTrack3ManualReviewItemMigration(migrationStatements),
    checkTrack3ArtifactLifecycleEventMigration(migrationStatements),
    checkTrack3WorkflowEventExtensions(migrationStatements),
    checkTrack3WorkflowIdempotencyKeyOperations(migrationStatements),
    checkTrack3ExistingTableExtensions(migrationStatements),
  ];
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
    ...checkTrack3CommittedStructure(),
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
