export type ToolEffect = 'read';
export type ToolErrorCode =
  | 'ADAPTER_NOT_READ_ONLY'
  | 'MALFORMED_ARGS'
  | 'NOT_FOUND'
  | 'POLICY_DENIED'
  | 'UNKNOWN_TOOL'
  | 'WRITE_TOOL_DENIED';

export type SanitizedMetadataValue = string | number | boolean | readonly string[];
export type SanitizedToolMetadata = Readonly<Record<string, SanitizedMetadataValue>>;

export interface JsonSchemaProperty {
  readonly type: 'array' | 'boolean' | 'integer' | 'number' | 'object' | 'string';
  readonly description?: string;
  readonly enum?: readonly string[];
  readonly items?: JsonSchemaProperty;
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface ToolArgumentSchema {
  readonly type: 'object';
  readonly additionalProperties: false;
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
}

export interface ArtifactRef {
  readonly kind: 'eval-artifact';
  readonly namespace: string;
  readonly artifactId: string;
  readonly opaqueRef: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly metadata: SanitizedToolMetadata;
}

export interface ToolPolicyContext {
  readonly actorId?: string;
  readonly tenantId?: string;
  readonly requestId?: string;
  readonly allowedToolIds?: readonly string[];
  readonly approvedDocumentCollections?: readonly ApprovedDocumentationCollection[];
  readonly allowedArtifactNamespaces?: readonly string[];
  readonly maxResultItems?: number;
}

export interface ReadOnlyToolDefinition<TArgs = unknown, TResult = unknown> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly effect: ToolEffect;
  readonly readOnly: true;
  readonly externalNetworkAccess: false;
  readonly outputContainsRawContent: false;
  readonly argsSchema: ToolArgumentSchema;
  readonly resultShape: string;
  readonly __args?: TArgs;
  readonly __result?: TResult;
}

export interface ToolCallRequest {
  readonly toolId: string;
  readonly args?: unknown;
}

export interface ToolCallError {
  readonly code: ToolErrorCode;
  readonly message: string;
  readonly retryable: false;
  readonly toolId?: string;
  readonly field?: string;
}

export interface ToolCallSuccess<TResult = unknown> {
  readonly ok: true;
  readonly toolId: string;
  readonly data: TResult;
  readonly artifacts: readonly ArtifactRef[];
  readonly metadata: SanitizedToolMetadata;
}

export interface ToolCallFailure {
  readonly ok: false;
  readonly toolId?: string;
  readonly error: ToolCallError;
  readonly metadata: SanitizedToolMetadata;
}

export type ToolCallResult<TResult = unknown> = ToolCallSuccess<TResult> | ToolCallFailure;

export type ValidationResult<TArgs> =
  | { readonly ok: true; readonly value: TArgs }
  | { readonly ok: false; readonly error: ToolCallError };

export interface ReadOnlyToolAdapter<TArgs = unknown, TResult = unknown> {
  readonly definition: ReadOnlyToolDefinition<TArgs, TResult>;
  validateArgs(args: unknown): ValidationResult<TArgs>;
  execute(args: TArgs, context: ToolPolicyContext): ToolCallResult<TResult> | Promise<ToolCallResult<TResult>>;
}

export interface RegistryExclusion {
  readonly toolId: string;
  readonly reason: 'duplicate' | 'not-read-only' | 'write-denied';
}

export interface ReadOnlyAdapterRegistry {
  readonly definitions: readonly ReadOnlyToolDefinition[];
  readonly deniedToolIds: ReadonlySet<string>;
  readonly excludedDefinitions: readonly RegistryExclusion[];
  has(toolId: string): boolean;
  getDefinition(toolId: string): ReadOnlyToolDefinition | undefined;
  execute<TResult = unknown>(request: ToolCallRequest, context?: ToolPolicyContext): Promise<ToolCallResult<TResult>>;
}

export type RepositoryMetadataSection = 'dependencies' | 'files' | 'map';

export interface RepositoryMetadataArgs {
  readonly repositoryId?: string;
  readonly sections?: readonly RepositoryMetadataSection[];
  readonly limit?: number;
}

export interface RepositoryMetadataResult {
  readonly repository: {
    readonly repositoryId: string;
    readonly owner: string;
    readonly name: string;
    readonly defaultBranch: string;
    readonly visibility: 'private' | 'public';
  };
  readonly map?: readonly RepositoryAreaSummary[];
  readonly files?: readonly RepositoryFileSummary[];
  readonly dependencies?: readonly RepositoryDependencySummary[];
}

export interface RepositoryAreaSummary {
  readonly area: string;
  readonly purpose: string;
  readonly paths: readonly string[];
}

export interface RepositoryFileSummary {
  readonly path: string;
  readonly kind: string;
  readonly language: string;
}

export interface RepositoryDependencySummary {
  readonly packageName: string;
  readonly relation: 'external' | 'workspace';
  readonly usedBy: readonly string[];
}

export type ApprovedDocumentationCollection = 'architecture' | 'operations' | 'policy';

export interface DocumentationLookupArgs {
  readonly query: string;
  readonly collection?: ApprovedDocumentationCollection;
  readonly limit?: number;
}

export interface DocumentationLookupResult {
  readonly items: readonly ApprovedDocumentationRef[];
  readonly resultCount: number;
  readonly collectionScope: readonly ApprovedDocumentationCollection[];
}

export interface ApprovedDocumentationRef {
  readonly docId: string;
  readonly title: string;
  readonly collection: ApprovedDocumentationCollection;
  readonly approvedAt: string;
  readonly opaqueRef: string;
  readonly summary: string;
  readonly tags: readonly string[];
}

export type EvalArtifactKind = 'audit-report' | 'gate-result' | 'trace-summary';

export interface EvalArtifactListArgs {
  readonly evalRunId?: string;
  readonly kind?: EvalArtifactKind;
  readonly limit?: number;
}

export interface EvalArtifactReadArgs {
  readonly artifactId: string;
}

export interface EvalArtifactListResult {
  readonly artifacts: readonly ArtifactRef[];
  readonly resultCount: number;
}

export interface EvalArtifactReadResult {
  readonly artifact: ArtifactRef;
  readonly summary: string;
  readonly metadata: SanitizedToolMetadata;
}

interface RepositoryFixture {
  readonly repositoryId: string;
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly visibility: 'private' | 'public';
  readonly map: readonly RepositoryAreaSummary[];
  readonly files: readonly RepositoryFileSummary[];
  readonly dependencies: readonly RepositoryDependencySummary[];
}

interface ApprovedDocumentationFixture extends ApprovedDocumentationRef {
  readonly searchableText: string;
}

interface EvalArtifactFixture {
  readonly artifactId: string;
  readonly evalRunId: string;
  readonly kind: EvalArtifactKind;
  readonly namespace: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly summary: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

const TOOL_IDS = {
  repositoryMetadataRead: 'repository.metadata.read',
  documentationLookupApproved: 'documentation.lookup.approved',
  evalArtifactList: 'eval.artifact.list',
  evalArtifactRead: 'eval.artifact.read',
} as const;

const WRITE_TOOL_DENY_LIST = Object.freeze([
  'documentation.write',
  'eval.artifact.delete',
  'eval.artifact.write',
  'repository.file.write',
  'repository.write_file',
  'repo.write',
  'repo.write_file',
  'tool.side_effect',
] as const);

export const readOnlyToolIds = Object.freeze(Object.values(TOOL_IDS));
export const writeToolDenyList: ReadonlySet<string> = new Set(WRITE_TOOL_DENY_LIST);

const FIXTURE_REPOSITORIES: Readonly<Record<string, RepositoryFixture>> = Object.freeze({
  'devgateway-fixture': Object.freeze({
    repositoryId: 'devgateway-fixture',
    owner: 'devgateway',
    name: 'fixture-repository',
    defaultBranch: 'main',
    visibility: 'private',
    map: Object.freeze([
      Object.freeze({
        area: 'applications',
        purpose: 'User-facing and broker services represented as sanitized path metadata only.',
        paths: Object.freeze(['apps/admin-portal', 'apps/control-api', 'apps/tool-broker']),
      }),
      Object.freeze({
        area: 'packages',
        purpose: 'Shared policy, schemas, configuration, registry, database, and observability packages.',
        paths: Object.freeze(['packages/config', 'packages/policy', 'packages/registry', 'packages/schemas']),
      }),
      Object.freeze({
        area: 'workers',
        purpose: 'Fixture-mode background workers for agent runtime, eval runner, and read-only tool integration contracts.',
        paths: Object.freeze(['workers/agent-runtime', 'workers/eval-runner', 'workers/tool-integrations']),
      }),
    ]),
    files: Object.freeze([
      Object.freeze({ path: 'apps/tool-broker/src/server.ts', kind: 'service-entry', language: 'TypeScript' }),
      Object.freeze({ path: 'packages/policy/src/index.ts', kind: 'policy-contract', language: 'TypeScript' }),
      Object.freeze({ path: 'packages/registry/src/index.ts', kind: 'registry-contract', language: 'TypeScript' }),
      Object.freeze({ path: 'workers/eval-runner/package.json', kind: 'worker-manifest', language: 'JSON' }),
      Object.freeze({ path: 'workers/tool-integrations/src/index.ts', kind: 'tool-contracts', language: 'TypeScript' }),
    ]),
    dependencies: Object.freeze([
      Object.freeze({
        packageName: '@devgateway/config',
        relation: 'workspace',
        usedBy: Object.freeze(['apps/control-api', 'apps/tool-broker']),
      }),
      Object.freeze({
        packageName: '@devgateway/policy',
        relation: 'workspace',
        usedBy: Object.freeze(['apps/tool-broker', 'workers/tool-integrations']),
      }),
      Object.freeze({
        packageName: 'typescript',
        relation: 'external',
        usedBy: Object.freeze(['packages/*', 'workers/tool-integrations']),
      }),
    ]),
  }),
});

const APPROVED_DOCUMENTATION: readonly ApprovedDocumentationFixture[] = Object.freeze([
  Object.freeze({
    docId: 'arch-readonly-tools',
    title: 'Read-only tool adapter architecture',
    collection: 'architecture',
    approvedAt: '2026-01-15T00:00:00.000Z',
    opaqueRef: 'opaque://docs/architecture/arch-readonly-tools',
    summary: 'Adapters expose deterministic metadata-only reads through typed contracts and local fixtures.',
    tags: Object.freeze(['tools', 'adapters', 'read-only']),
    searchableText: 'read only tool adapter architecture deterministic metadata fixtures contracts',
  }),
  Object.freeze({
    docId: 'ops-eval-artifacts',
    title: 'Evaluation artifact access',
    collection: 'operations',
    approvedAt: '2026-01-20T00:00:00.000Z',
    opaqueRef: 'opaque://docs/operations/ops-eval-artifacts',
    summary: 'Evaluation artifacts are addressed by opaque references and expose summaries instead of raw payloads.',
    tags: Object.freeze(['evals', 'artifacts', 'opaque-ref']),
    searchableText: 'evaluation artifacts opaque references summary payload gate result audit report',
  }),
  Object.freeze({
    docId: 'policy-tool-safety',
    title: 'Tool safety policy',
    collection: 'policy',
    approvedAt: '2026-01-22T00:00:00.000Z',
    opaqueRef: 'opaque://docs/policy/policy-tool-safety',
    summary: 'Tool integrations deny side-effecting capabilities and return typed errors for invalid requests.',
    tags: Object.freeze(['policy', 'deny-list', 'validation']),
    searchableText: 'tool safety policy deny side effect validation typed errors',
  }),
]);

const EVAL_ARTIFACT_NAMESPACE = 'fixture-evals';
const EVAL_ARTIFACTS: readonly EvalArtifactFixture[] = Object.freeze([
  Object.freeze({
    artifactId: 'eval-run-001-gate',
    evalRunId: 'eval-run-001',
    kind: 'gate-result',
    namespace: EVAL_ARTIFACT_NAMESPACE,
    mediaType: 'application/vnd.devgateway.eval-gate+json',
    sizeBytes: 640,
    createdAt: '2026-01-25T12:00:00.000Z',
    summary: 'Fixture gate result metadata for a passing read-only integration check.',
    metadata: Object.freeze({
      decision: 'allow',
      strategy: 'fixture',
      rawContent: 'internal fixture payload omitted by sanitizer',
      providerKey: 'redacted fixture value',
    }),
  }),
  Object.freeze({
    artifactId: 'eval-run-001-audit',
    evalRunId: 'eval-run-001',
    kind: 'audit-report',
    namespace: EVAL_ARTIFACT_NAMESPACE,
    mediaType: 'application/vnd.devgateway.audit-summary+json',
    sizeBytes: 920,
    createdAt: '2026-01-25T12:01:00.000Z',
    summary: 'Fixture audit summary showing no write-capable adapter registrations.',
    metadata: Object.freeze({
      writeAdaptersRegistered: false,
      inspectedAdapters: 4,
    }),
  }),
  Object.freeze({
    artifactId: 'eval-run-002-trace',
    evalRunId: 'eval-run-002',
    kind: 'trace-summary',
    namespace: EVAL_ARTIFACT_NAMESPACE,
    mediaType: 'application/vnd.devgateway.trace-summary+json',
    sizeBytes: 704,
    createdAt: '2026-01-26T12:00:00.000Z',
    summary: 'Fixture trace metadata with request and span identifiers omitted from public metadata.',
    metadata: Object.freeze({
      spans: 7,
      sampled: true,
    }),
  }),
]);

const SECRET_KEY_PATTERN = /(authorization|cookie|credential|key|password|provider|secret|token)/iu;
const RAW_CONTENT_KEY_PATTERN = /(body|content|payload|prompt|source|text)/iu;
const SECRET_VALUE_PATTERN = /(?:bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,}|ghp_[a-z0-9_]{8,}|github_pat_[a-z0-9_]{8,}|dg_vk_[a-z0-9_-]{8,})/iu;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,80}$/u;
const SAFE_TOOL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,120}$/u;
const DEFAULT_REPOSITORY_SECTIONS = Object.freeze(['map', 'files', 'dependencies'] as const);
const REPOSITORY_SECTIONS = new Set<RepositoryMetadataSection>(DEFAULT_REPOSITORY_SECTIONS);
const DOCUMENTATION_COLLECTIONS = new Set<ApprovedDocumentationCollection>(['architecture', 'operations', 'policy']);
const EVAL_ARTIFACT_KINDS = new Set<EvalArtifactKind>(['audit-report', 'gate-result', 'trace-summary']);

export const repositoryMetadataAdapter: ReadOnlyToolAdapter<RepositoryMetadataArgs, RepositoryMetadataResult> = Object.freeze({
  definition: Object.freeze({
    id: TOOL_IDS.repositoryMetadataRead,
    name: 'Repository metadata read',
    description: 'Returns a synthetic repository map, sanitized file list, and dependency summary.',
    effect: 'read',
    readOnly: true,
    externalNetworkAccess: false,
    outputContainsRawContent: false,
    argsSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: Object.freeze([]),
      properties: Object.freeze({
        repositoryId: Object.freeze({ type: 'string', description: 'Synthetic repository fixture id.' }),
        sections: Object.freeze({
          type: 'array',
          description: 'Optional repository metadata sections to include.',
          items: Object.freeze({ type: 'string', enum: Object.freeze([...REPOSITORY_SECTIONS]) }),
        }),
        limit: Object.freeze({ type: 'integer', minimum: 1, maximum: 100 }),
      }),
    }),
    resultShape: 'RepositoryMetadataResult',
  }),
  validateArgs: validateRepositoryMetadataArgs,
  execute(args: RepositoryMetadataArgs, context: ToolPolicyContext) {
    const policyFailure = enforceReadPolicy(TOOL_IDS.repositoryMetadataRead, context);
    if (policyFailure) return policyFailure;

    const repositoryId = args.repositoryId ?? 'devgateway-fixture';
    const repository = FIXTURE_REPOSITORIES[repositoryId];
    if (!repository) {
      return toolFailure(TOOL_IDS.repositoryMetadataRead, 'NOT_FOUND', `Unknown repository fixture '${repositoryId}'.`);
    }

    const sections = args.sections ?? DEFAULT_REPOSITORY_SECTIONS;
    const limit = boundedLimit(args.limit, context.maxResultItems, 100);
    const data: RepositoryMetadataResult = {
      repository: {
        repositoryId: repository.repositoryId,
        owner: repository.owner,
        name: repository.name,
        defaultBranch: repository.defaultBranch,
        visibility: repository.visibility,
      },
      ...(sections.includes('map') ? { map: repository.map } : {}),
      ...(sections.includes('files') ? { files: repository.files.slice(0, limit) } : {}),
      ...(sections.includes('dependencies') ? { dependencies: repository.dependencies.slice(0, limit) } : {}),
    };

    return toolSuccess(TOOL_IDS.repositoryMetadataRead, data, [], {
      fixture: true,
      resultCount: countRepositoryItems(data),
    });
  },
});

export const approvedDocumentationLookupAdapter: ReadOnlyToolAdapter<DocumentationLookupArgs, DocumentationLookupResult> = Object.freeze({
  definition: Object.freeze({
    id: TOOL_IDS.documentationLookupApproved,
    name: 'Approved documentation lookup',
    description: 'Looks up approved documentation fixtures and returns sanitized references only.',
    effect: 'read',
    readOnly: true,
    externalNetworkAccess: false,
    outputContainsRawContent: false,
    argsSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: Object.freeze(['query']),
      properties: Object.freeze({
        query: Object.freeze({ type: 'string', description: 'Lookup text; never echoed in the result.' }),
        collection: Object.freeze({ type: 'string', enum: Object.freeze([...DOCUMENTATION_COLLECTIONS]) }),
        limit: Object.freeze({ type: 'integer', minimum: 1, maximum: 10 }),
      }),
    }),
    resultShape: 'DocumentationLookupResult',
  }),
  validateArgs: validateDocumentationLookupArgs,
  execute(args: DocumentationLookupArgs, context: ToolPolicyContext) {
    const policyFailure = enforceReadPolicy(TOOL_IDS.documentationLookupApproved, context);
    if (policyFailure) return policyFailure;

    const collectionScope = resolveApprovedCollections(args.collection, context);
    if (collectionScope.length === 0) {
      return toolFailure(
        TOOL_IDS.documentationLookupApproved,
        'POLICY_DENIED',
        'Requested documentation collection is not approved for this policy context.',
      );
    }

    const normalizedQuery = normalizeSearchText(args.query);
    const limit = boundedLimit(args.limit, context.maxResultItems, 10);
    const items = APPROVED_DOCUMENTATION
      .filter((document) => collectionScope.includes(document.collection))
      .filter((document) => document.searchableText.includes(normalizedQuery))
      .slice(0, limit)
      .map(toApprovedDocumentationRef);

    return toolSuccess(
      TOOL_IDS.documentationLookupApproved,
      {
        items,
        resultCount: items.length,
        collectionScope,
      },
      [],
      {
        fixture: true,
        queryLength: args.query.length,
      },
    );
  },
});

export const evalArtifactListAdapter: ReadOnlyToolAdapter<EvalArtifactListArgs, EvalArtifactListResult> = Object.freeze({
  definition: Object.freeze({
    id: TOOL_IDS.evalArtifactList,
    name: 'Evaluation artifact list',
    description: 'Lists fixture evaluation artifacts as opaque references without payload contents.',
    effect: 'read',
    readOnly: true,
    externalNetworkAccess: false,
    outputContainsRawContent: false,
    argsSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: Object.freeze([]),
      properties: Object.freeze({
        evalRunId: Object.freeze({ type: 'string' }),
        kind: Object.freeze({ type: 'string', enum: Object.freeze([...EVAL_ARTIFACT_KINDS]) }),
        limit: Object.freeze({ type: 'integer', minimum: 1, maximum: 20 }),
      }),
    }),
    resultShape: 'EvalArtifactListResult',
  }),
  validateArgs: validateEvalArtifactListArgs,
  execute(args: EvalArtifactListArgs, context: ToolPolicyContext) {
    const policyFailure = enforceReadPolicy(TOOL_IDS.evalArtifactList, context);
    if (policyFailure) return policyFailure;
    const artifactPolicyFailure = enforceArtifactPolicy(TOOL_IDS.evalArtifactList, context);
    if (artifactPolicyFailure) return artifactPolicyFailure;

    const limit = boundedLimit(args.limit, context.maxResultItems, 20);
    const artifacts = EVAL_ARTIFACTS
      .filter((artifact) => args.evalRunId === undefined || artifact.evalRunId === args.evalRunId)
      .filter((artifact) => args.kind === undefined || artifact.kind === args.kind)
      .slice(0, limit)
      .map(toArtifactRef);

    return toolSuccess(
      TOOL_IDS.evalArtifactList,
      {
        artifacts,
        resultCount: artifacts.length,
      },
      artifacts,
      {
        fixture: true,
        resultCount: artifacts.length,
      },
    );
  },
});

export const evalArtifactReadAdapter: ReadOnlyToolAdapter<EvalArtifactReadArgs, EvalArtifactReadResult> = Object.freeze({
  definition: Object.freeze({
    id: TOOL_IDS.evalArtifactRead,
    name: 'Evaluation artifact read',
    description: 'Reads sanitized fixture evaluation artifact metadata by opaque artifact id.',
    effect: 'read',
    readOnly: true,
    externalNetworkAccess: false,
    outputContainsRawContent: false,
    argsSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: Object.freeze(['artifactId']),
      properties: Object.freeze({
        artifactId: Object.freeze({ type: 'string' }),
      }),
    }),
    resultShape: 'EvalArtifactReadResult',
  }),
  validateArgs: validateEvalArtifactReadArgs,
  execute(args: EvalArtifactReadArgs, context: ToolPolicyContext) {
    const policyFailure = enforceReadPolicy(TOOL_IDS.evalArtifactRead, context);
    if (policyFailure) return policyFailure;
    const artifactPolicyFailure = enforceArtifactPolicy(TOOL_IDS.evalArtifactRead, context);
    if (artifactPolicyFailure) return artifactPolicyFailure;

    const fixture = EVAL_ARTIFACTS.find((artifact) => artifact.artifactId === args.artifactId);
    if (!fixture) {
      return toolFailure(TOOL_IDS.evalArtifactRead, 'NOT_FOUND', `Unknown eval artifact '${args.artifactId}'.`);
    }

    const artifact = toArtifactRef(fixture);
    return toolSuccess(
      TOOL_IDS.evalArtifactRead,
      {
        artifact,
        summary: sanitizeSummary(fixture.summary),
        metadata: sanitizeToolMetadata(fixture.metadata),
      },
      [artifact],
      {
        fixture: true,
        artifactKind: fixture.kind,
      },
    );
  },
});

export const fixtureReadOnlyAdapters = Object.freeze([
  repositoryMetadataAdapter,
  approvedDocumentationLookupAdapter,
  evalArtifactListAdapter,
  evalArtifactReadAdapter,
] as const);

export function createReadOnlyAdapterRegistry(
  adapters: readonly ReadOnlyToolAdapter[] = fixtureReadOnlyAdapters,
  deniedToolIds: ReadonlySet<string> = writeToolDenyList,
): ReadOnlyAdapterRegistry {
  const adapterMap = new Map<string, ReadOnlyToolAdapter>();
  const definitions: ReadOnlyToolDefinition[] = [];
  const excludedDefinitions: RegistryExclusion[] = [];

  for (const adapter of adapters) {
    const definition = adapter.definition as ReadOnlyToolDefinition & { readonly readOnly?: boolean; readonly effect?: string };
    if (deniedToolIds.has(definition.id)) {
      excludedDefinitions.push({ toolId: definition.id, reason: 'write-denied' });
      continue;
    }
    if (definition.readOnly !== true || definition.effect !== 'read') {
      excludedDefinitions.push({ toolId: definition.id, reason: 'not-read-only' });
      continue;
    }
    if (adapterMap.has(definition.id)) {
      excludedDefinitions.push({ toolId: definition.id, reason: 'duplicate' });
      continue;
    }
    adapterMap.set(definition.id, adapter);
    definitions.push(definition);
  }

  return Object.freeze({
    definitions: Object.freeze(definitions),
    deniedToolIds,
    excludedDefinitions: Object.freeze(excludedDefinitions),
    has(toolId: string): boolean {
      return adapterMap.has(toolId);
    },
    getDefinition(toolId: string): ReadOnlyToolDefinition | undefined {
      return adapterMap.get(toolId)?.definition;
    },
    execute<TResult = unknown>(request: ToolCallRequest, context: ToolPolicyContext = {}): Promise<ToolCallResult<TResult>> {
      return executeReadOnlyTool<TResult>(adapterMap, deniedToolIds, request, context);
    },
  });
}

export const adapterRegistry = createReadOnlyAdapterRegistry();
export const defaultAdapterRegistry = adapterRegistry;

export async function executeToolCall<TResult = unknown>(
  request: ToolCallRequest,
  context: ToolPolicyContext = {},
  registry: ReadOnlyAdapterRegistry = adapterRegistry,
): Promise<ToolCallResult<TResult>> {
  return registry.execute<TResult>(request, context);
}

export function isWriteToolDenied(toolId: string, deniedToolIds: ReadonlySet<string> = writeToolDenyList): boolean {
  return deniedToolIds.has(toolId);
}

export function createToolCallRequest(toolId: string, args: unknown = {}): ToolCallRequest {
  return { toolId, args };
}

export function sanitizeToolMetadata(metadata: Readonly<Record<string, unknown>> = {}): SanitizedToolMetadata {
  const sanitized: Record<string, SanitizedMetadataValue> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const normalizedKey = sanitizeMetadataKey(key);
    if (!normalizedKey) continue;
    const normalizedValue = sanitizeMetadataValue(value);
    if (normalizedValue !== undefined) {
      sanitized[normalizedKey] = normalizedValue;
    }
  }
  return Object.freeze(sanitized);
}

export const tool_integrationsPackage = {
  name: '@devgateway/tool-integrations',
  status: 'read-only-fixture-adapters',
  readOnlyToolIds,
} as const;

async function executeReadOnlyTool<TResult>(
  adapterMap: ReadonlyMap<string, ReadOnlyToolAdapter>,
  deniedToolIds: ReadonlySet<string>,
  request: ToolCallRequest,
  context: ToolPolicyContext,
): Promise<ToolCallResult<TResult>> {
  const toolIdValidation = validateToolId(request.toolId);
  if (!toolIdValidation.ok) {
    return {
      ok: false,
      error: toolIdValidation.error,
      metadata: sanitizeToolMetadata({ source: 'registry' }),
    };
  }

  const toolId = toolIdValidation.value;
  if (deniedToolIds.has(toolId)) {
    return toolFailure(toolId, 'WRITE_TOOL_DENIED', `Tool '${toolId}' is denied because write or side-effecting adapters are not registered.`);
  }

  const policyFailure = enforceReadPolicy(toolId, context);
  if (policyFailure) return policyFailure as ToolCallFailure;

  const adapter = adapterMap.get(toolId);
  if (!adapter) {
    return toolFailure(toolId, 'UNKNOWN_TOOL', `Unknown read-only tool '${toolId}'.`);
  }

  const validation = adapter.validateArgs(request.args ?? {});
  if (!validation.ok) {
    return {
      ok: false,
      toolId,
      error: validation.error,
      metadata: sanitizeToolMetadata({ source: 'validator' }),
    };
  }

  return adapter.execute(validation.value, context) as ToolCallResult<TResult> | Promise<ToolCallResult<TResult>>;
}

function validateRepositoryMetadataArgs(args: unknown): ValidationResult<RepositoryMetadataArgs> {
  const object = validateObjectArgs(TOOL_IDS.repositoryMetadataRead, args, ['repositoryId', 'sections', 'limit']);
  if (!object.ok) return object;

  const repositoryId = optionalSafeId(object.value.repositoryId, TOOL_IDS.repositoryMetadataRead, 'repositoryId');
  if (!repositoryId.ok) return repositoryId;

  const sections = optionalEnumArray(
    object.value.sections,
    TOOL_IDS.repositoryMetadataRead,
    'sections',
    REPOSITORY_SECTIONS,
  );
  if (!sections.ok) return sections;

  const limit = optionalInteger(object.value.limit, TOOL_IDS.repositoryMetadataRead, 'limit', 1, 100);
  if (!limit.ok) return limit;

  return {
    ok: true,
    value: {
      ...(repositoryId.value === undefined ? {} : { repositoryId: repositoryId.value }),
      ...(sections.value === undefined ? {} : { sections: sections.value }),
      ...(limit.value === undefined ? {} : { limit: limit.value }),
    },
  };
}

function validateDocumentationLookupArgs(args: unknown): ValidationResult<DocumentationLookupArgs> {
  const object = validateObjectArgs(TOOL_IDS.documentationLookupApproved, args, ['query', 'collection', 'limit']);
  if (!object.ok) return object;

  const query = requiredString(object.value.query, TOOL_IDS.documentationLookupApproved, 'query', 1, 120);
  if (!query.ok) return query;

  const collection = optionalEnum(
    object.value.collection,
    TOOL_IDS.documentationLookupApproved,
    'collection',
    DOCUMENTATION_COLLECTIONS,
  );
  if (!collection.ok) return collection;

  const limit = optionalInteger(object.value.limit, TOOL_IDS.documentationLookupApproved, 'limit', 1, 10);
  if (!limit.ok) return limit;

  return {
    ok: true,
    value: {
      query: query.value,
      ...(collection.value === undefined ? {} : { collection: collection.value }),
      ...(limit.value === undefined ? {} : { limit: limit.value }),
    },
  };
}

function validateEvalArtifactListArgs(args: unknown): ValidationResult<EvalArtifactListArgs> {
  const object = validateObjectArgs(TOOL_IDS.evalArtifactList, args, ['evalRunId', 'kind', 'limit']);
  if (!object.ok) return object;

  const evalRunId = optionalSafeId(object.value.evalRunId, TOOL_IDS.evalArtifactList, 'evalRunId');
  if (!evalRunId.ok) return evalRunId;

  const kind = optionalEnum(object.value.kind, TOOL_IDS.evalArtifactList, 'kind', EVAL_ARTIFACT_KINDS);
  if (!kind.ok) return kind;

  const limit = optionalInteger(object.value.limit, TOOL_IDS.evalArtifactList, 'limit', 1, 20);
  if (!limit.ok) return limit;

  return {
    ok: true,
    value: {
      ...(evalRunId.value === undefined ? {} : { evalRunId: evalRunId.value }),
      ...(kind.value === undefined ? {} : { kind: kind.value }),
      ...(limit.value === undefined ? {} : { limit: limit.value }),
    },
  };
}

function validateEvalArtifactReadArgs(args: unknown): ValidationResult<EvalArtifactReadArgs> {
  const object = validateObjectArgs(TOOL_IDS.evalArtifactRead, args, ['artifactId']);
  if (!object.ok) return object;

  const artifactId = requiredSafeId(object.value.artifactId, TOOL_IDS.evalArtifactRead, 'artifactId');
  if (!artifactId.ok) return artifactId;

  return { ok: true, value: { artifactId: artifactId.value } };
}

function validateToolId(toolId: unknown): ValidationResult<string> {
  if (typeof toolId !== 'string' || !SAFE_TOOL_ID_PATTERN.test(toolId)) {
    return {
      ok: false,
      error: createToolError('MALFORMED_ARGS', 'toolId must be a safe tool identifier.', { field: 'toolId' }),
    };
  }
  return { ok: true, value: toolId };
}

function validateObjectArgs(
  toolId: string,
  args: unknown,
  allowedKeys: readonly string[],
): ValidationResult<Record<string, unknown>> {
  if (!isRecord(args)) {
    return malformed(toolId, 'args', 'Tool arguments must be an object.');
  }
  const allowed = new Set(allowedKeys);
  const unknownKeys = Object.keys(args).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    return malformed(toolId, unknownKeys[0] ?? 'args', `Unsupported argument '${unknownKeys[0] ?? 'unknown'}'.`);
  }
  return { ok: true, value: args };
}

function requiredString(
  value: unknown,
  toolId: string,
  field: string,
  minLength: number,
  maxLength: number,
): ValidationResult<string> {
  if (typeof value !== 'string') {
    return malformed(toolId, field, `${field} is required and must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < minLength || trimmed.length > maxLength) {
    return malformed(toolId, field, `${field} must be between ${minLength} and ${maxLength} characters.`);
  }
  return { ok: true, value: trimmed };
}

function requiredSafeId(value: unknown, toolId: string, field: string): ValidationResult<string> {
  const stringValue = requiredString(value, toolId, field, 2, 80);
  if (!stringValue.ok) return stringValue;
  if (!SAFE_ID_PATTERN.test(stringValue.value)) {
    return malformed(toolId, field, `${field} must be a safe fixture identifier.`);
  }
  return stringValue;
}

function optionalSafeId(value: unknown, toolId: string, field: string): ValidationResult<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  return requiredSafeId(value, toolId, field);
}

function optionalInteger(
  value: unknown,
  toolId: string,
  field: string,
  minimum: number,
  maximum: number,
): ValidationResult<number | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return malformed(toolId, field, `${field} must be an integer.`);
  }
  if (value < minimum || value > maximum) {
    return malformed(toolId, field, `${field} must be between ${minimum} and ${maximum}.`);
  }
  return { ok: true, value };
}

function optionalEnum<TValue extends string>(
  value: unknown,
  toolId: string,
  field: string,
  allowed: ReadonlySet<TValue>,
): ValidationResult<TValue | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'string' || !allowed.has(value as TValue)) {
    return malformed(toolId, field, `${field} must be one of: ${[...allowed].join(', ')}.`);
  }
  return { ok: true, value: value as TValue };
}

function optionalEnumArray<TValue extends string>(
  value: unknown,
  toolId: string,
  field: string,
  allowed: ReadonlySet<TValue>,
): ValidationResult<readonly TValue[] | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value) || value.length === 0) {
    return malformed(toolId, field, `${field} must be a non-empty array.`);
  }
  const result: TValue[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.has(item as TValue)) {
      return malformed(toolId, field, `${field} contains an unsupported value.`);
    }
    if (!result.includes(item as TValue)) {
      result.push(item as TValue);
    }
  }
  return { ok: true, value: Object.freeze(result) };
}

function enforceReadPolicy(toolId: string, context: ToolPolicyContext): ToolCallFailure | undefined {
  if (context.allowedToolIds !== undefined && !context.allowedToolIds.includes(toolId)) {
    return toolFailure(toolId, 'POLICY_DENIED', `Tool '${toolId}' is not allowed by the policy context.`);
  }
  return undefined;
}

function enforceArtifactPolicy(toolId: string, context: ToolPolicyContext): ToolCallFailure | undefined {
  if (
    context.allowedArtifactNamespaces !== undefined
    && !context.allowedArtifactNamespaces.includes(EVAL_ARTIFACT_NAMESPACE)
  ) {
    return toolFailure(toolId, 'POLICY_DENIED', 'Eval artifact namespace is not allowed by the policy context.');
  }
  return undefined;
}

function resolveApprovedCollections(
  requestedCollection: ApprovedDocumentationCollection | undefined,
  context: ToolPolicyContext,
): readonly ApprovedDocumentationCollection[] {
  const requested = requestedCollection === undefined ? [...DOCUMENTATION_COLLECTIONS] : [requestedCollection];
  const approved = context.approvedDocumentCollections;
  if (approved === undefined) return Object.freeze(requested);
  return Object.freeze(requested.filter((collection) => approved.includes(collection)));
}

function toApprovedDocumentationRef(document: ApprovedDocumentationFixture): ApprovedDocumentationRef {
  return {
    docId: document.docId,
    title: sanitizeSummary(document.title),
    collection: document.collection,
    approvedAt: document.approvedAt,
    opaqueRef: document.opaqueRef,
    summary: sanitizeSummary(document.summary),
    tags: document.tags.map(sanitizeSummary),
  };
}

function toArtifactRef(fixture: EvalArtifactFixture): ArtifactRef {
  return {
    kind: 'eval-artifact',
    namespace: fixture.namespace,
    artifactId: fixture.artifactId,
    opaqueRef: `opaque://eval-artifacts/${fixture.namespace}/${fixture.artifactId}`,
    mediaType: fixture.mediaType,
    sizeBytes: fixture.sizeBytes,
    createdAt: fixture.createdAt,
    metadata: sanitizeToolMetadata({
      evalRunId: fixture.evalRunId,
      artifactKind: fixture.kind,
      ...fixture.metadata,
    }),
  };
}

function toolSuccess<TResult>(
  toolId: string,
  data: TResult,
  artifacts: readonly ArtifactRef[] = [],
  metadata: Readonly<Record<string, unknown>> = {},
): ToolCallSuccess<TResult> {
  return {
    ok: true,
    toolId,
    data,
    artifacts,
    metadata: sanitizeToolMetadata(metadata),
  };
}

function toolFailure(
  toolId: string,
  code: ToolErrorCode,
  message: string,
  metadata: Readonly<Record<string, unknown>> = {},
): ToolCallFailure {
  return {
    ok: false,
    toolId,
    error: createToolError(code, message, { toolId }),
    metadata: sanitizeToolMetadata(metadata),
  };
}

function createToolError(
  code: ToolErrorCode,
  message: string,
  options: { readonly toolId?: string; readonly field?: string } = {},
): ToolCallError {
  return {
    code,
    message: sanitizeSummary(message),
    retryable: false,
    ...(options.toolId === undefined ? {} : { toolId: options.toolId }),
    ...(options.field === undefined ? {} : { field: options.field }),
  };
}

function malformed(toolId: string, field: string, message: string): ValidationResult<never> {
  return {
    ok: false,
    error: createToolError('MALFORMED_ARGS', message, { toolId, field }),
  };
}

function boundedLimit(limit: number | undefined, policyLimit: number | undefined, defaultMaximum: number): number {
  const requested = limit ?? defaultMaximum;
  const boundedPolicyLimit = policyLimit === undefined ? defaultMaximum : Math.max(1, Math.min(policyLimit, defaultMaximum));
  return Math.max(1, Math.min(requested, boundedPolicyLimit, defaultMaximum));
}

function countRepositoryItems(data: RepositoryMetadataResult): number {
  return (data.map?.length ?? 0) + (data.files?.length ?? 0) + (data.dependencies?.length ?? 0);
}

function normalizeSearchText(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/gu, ' ');
}

function sanitizeSummary(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (SECRET_VALUE_PATTERN.test(normalized)) return '[redacted]';
  return normalized.length > 240 ? normalized.slice(0, 240) : normalized;
}

function sanitizeMetadataKey(key: string): string | undefined {
  const normalized = key.trim();
  if (normalized.length === 0) return undefined;
  if (SECRET_KEY_PATTERN.test(normalized) || RAW_CONTENT_KEY_PATTERN.test(normalized)) return undefined;
  return normalized.length > 80 ? normalized.slice(0, 80) : normalized;
}

function sanitizeMetadataValue(value: unknown): SanitizedMetadataValue | undefined {
  if (typeof value === 'string') return sanitizeSummary(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const values = value.flatMap((item) => (typeof item === 'string' ? [sanitizeSummary(item)] : []));
    return Object.freeze(values.slice(0, 20));
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
