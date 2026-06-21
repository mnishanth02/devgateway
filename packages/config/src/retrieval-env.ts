import type { RuntimeEnvironment } from './auth-env.js';

export type RetrievalStrategyId = 'hybrid' | 'hybrid_graph' | 'hybrid_graph_shadow';

export type RetrievalEnvValidationDecision = 'allow' | 'deny';

export interface RetrievalNeo4jConfig {
  readonly enabled: boolean;
  readonly uri: string;
  readonly username: string;
  readonly passwordIsSet: boolean;
  readonly database: string;
}

export interface RetrievalContextBudgetConfig {
  readonly budgeterEnabled: boolean;
  readonly compressorEnabled: boolean;
  readonly maxContextTokens: number;
  readonly maxSnippetTokens: number;
}

export interface RetrievalEnvConfig {
  readonly runtimeEnvironment: RuntimeEnvironment;
  readonly productionEnabled: boolean;
  readonly lexicalEnabled: boolean;
  readonly embeddingsEnabled: boolean;
  readonly rerankerEnabled: boolean;
  readonly graphRagEnabled: boolean;
  readonly neo4j: RetrievalNeo4jConfig;
  readonly contextBudget: RetrievalContextBudgetConfig;
  readonly codeEmbeddingsEnabled: boolean;
  readonly evalStrategies: readonly RetrievalStrategyId[];
}

export type RetrievalEnvInput = Readonly<Record<string, string | undefined>>;

export interface RetrievalEnvValidationScenario {
  readonly id: string;
  readonly title: string;
  readonly input: RetrievalEnvInput;
  readonly expected: {
    readonly decision: RetrievalEnvValidationDecision;
    readonly evalStrategies?: readonly RetrievalStrategyId[];
    readonly errorIncludes?: string;
  };
}

const runtimeEnvironments = new Set<RuntimeEnvironment>(['development', 'test', 'production']);
const retrievalStrategies = new Set<RetrievalStrategyId>(['hybrid', 'hybrid_graph', 'hybrid_graph_shadow']);

export const retrievalEnvValidationScenarios = [
  {
    id: 'development-day-one-graph-defaults',
    title: 'Development defaults keep GraphRAG, Neo4j, context budgeting, and compression enabled for day-one validation.',
    input: {
      NODE_ENV: 'development',
    },
    expected: {
      decision: 'allow',
      evalStrategies: ['hybrid', 'hybrid_graph'],
    },
  },
  {
    id: 'development-hybrid-only-comparison',
    title: 'Development can disable GraphRAG and Neo4j together for hybrid-only comparison.',
    input: {
      NODE_ENV: 'development',
      RETRIEVAL_GRAPH_RAG_ENABLED: 'false',
      RETRIEVAL_NEO4J_ENABLED: 'false',
      RETRIEVAL_EVAL_STRATEGIES: 'hybrid',
    },
    expected: {
      decision: 'allow',
      evalStrategies: ['hybrid'],
    },
  },
  {
    id: 'graphrag-without-neo4j-denied',
    title: 'GraphRAG enabled while Neo4j is disabled fails closed.',
    input: {
      NODE_ENV: 'development',
      RETRIEVAL_GRAPH_RAG_ENABLED: 'true',
      RETRIEVAL_NEO4J_ENABLED: 'false',
    },
    expected: {
      decision: 'deny',
      errorIncludes: 'RETRIEVAL_GRAPH_RAG_ENABLED=true requires RETRIEVAL_NEO4J_ENABLED=true',
    },
  },
  {
    id: 'production-enable-requires-production-node-env',
    title: 'Production retrieval cannot be enabled outside NODE_ENV=production.',
    input: {
      NODE_ENV: 'development',
      RETRIEVAL_PRODUCTION_ENABLED: 'true',
    },
    expected: {
      decision: 'deny',
      errorIncludes: 'RETRIEVAL_PRODUCTION_ENABLED=true requires NODE_ENV=production',
    },
  },
  {
    id: 'production-enable-denies-code-embeddings',
    title: 'Production retrieval keeps code-specific embeddings disabled until eval evidence approves them.',
    input: {
      NODE_ENV: 'production',
      RETRIEVAL_PRODUCTION_ENABLED: 'true',
      RETRIEVAL_CODE_EMBEDDINGS_ENABLED: 'true',
    },
    expected: {
      decision: 'deny',
      errorIncludes: 'RETRIEVAL_CODE_EMBEDDINGS_ENABLED=true is not allowed for first production release',
    },
  },
] as const satisfies readonly RetrievalEnvValidationScenario[];

export function loadRetrievalEnv(input: RetrievalEnvInput): RetrievalEnvConfig {
  const runtimeEnvironment = parseRuntimeEnvironment(input.NODE_ENV);
  const productionEnabled = parseBoolean(input.RETRIEVAL_PRODUCTION_ENABLED, false, 'RETRIEVAL_PRODUCTION_ENABLED');
  const lexicalEnabled = parseBoolean(input.RETRIEVAL_LEXICAL_ENABLED, true, 'RETRIEVAL_LEXICAL_ENABLED');
  const embeddingsEnabled = parseBoolean(input.RETRIEVAL_EMBEDDINGS_ENABLED, true, 'RETRIEVAL_EMBEDDINGS_ENABLED');
  const rerankerEnabled = parseBoolean(input.RETRIEVAL_RERANKER_ENABLED, true, 'RETRIEVAL_RERANKER_ENABLED');
  const graphRagEnabled = parseBoolean(input.RETRIEVAL_GRAPH_RAG_ENABLED, true, 'RETRIEVAL_GRAPH_RAG_ENABLED');
  const neo4jEnabled = parseBoolean(input.RETRIEVAL_NEO4J_ENABLED, true, 'RETRIEVAL_NEO4J_ENABLED');
  const codeEmbeddingsEnabled = parseBoolean(
    input.RETRIEVAL_CODE_EMBEDDINGS_ENABLED,
    false,
    'RETRIEVAL_CODE_EMBEDDINGS_ENABLED',
  );
  const contextBudgeterEnabled = parseBoolean(
    input.RETRIEVAL_CONTEXT_BUDGETER_ENABLED,
    true,
    'RETRIEVAL_CONTEXT_BUDGETER_ENABLED',
  );
  const contextCompressorEnabled = parseBoolean(
    input.RETRIEVAL_CONTEXT_COMPRESSOR_ENABLED,
    true,
    'RETRIEVAL_CONTEXT_COMPRESSOR_ENABLED',
  );
  const maxContextTokens = parsePositiveInteger(input.RETRIEVAL_MAX_CONTEXT_TOKENS, 24_000, 'RETRIEVAL_MAX_CONTEXT_TOKENS');
  const maxSnippetTokens = parsePositiveInteger(input.RETRIEVAL_MAX_SNIPPET_TOKENS, 1_200, 'RETRIEVAL_MAX_SNIPPET_TOKENS');
  const evalStrategies = parseEvalStrategies(input.RETRIEVAL_EVAL_STRATEGIES);

  if (productionEnabled && runtimeEnvironment !== 'production') {
    throw new Error('RETRIEVAL_PRODUCTION_ENABLED=true requires NODE_ENV=production');
  }
  if (graphRagEnabled && !neo4jEnabled) {
    throw new Error('RETRIEVAL_GRAPH_RAG_ENABLED=true requires RETRIEVAL_NEO4J_ENABLED=true');
  }
  if (maxSnippetTokens > maxContextTokens) {
    throw new Error('RETRIEVAL_MAX_SNIPPET_TOKENS must be less than or equal to RETRIEVAL_MAX_CONTEXT_TOKENS');
  }

  if (productionEnabled) {
    assertProductionRetrievalGuardrails({
      lexicalEnabled,
      embeddingsEnabled,
      rerankerEnabled,
      graphRagEnabled,
      neo4jEnabled,
      contextBudgeterEnabled,
      contextCompressorEnabled,
      codeEmbeddingsEnabled,
    });
  }

  return {
    runtimeEnvironment,
    productionEnabled,
    lexicalEnabled,
    embeddingsEnabled,
    rerankerEnabled,
    graphRagEnabled,
    neo4j: {
      enabled: neo4jEnabled,
      uri: parseNonEmptyString(input.NEO4J_URI, 'bolt://localhost:47687', 'NEO4J_URI'),
      username: parseNonEmptyString(input.NEO4J_USERNAME, 'neo4j', 'NEO4J_USERNAME'),
      passwordIsSet: Boolean(input.NEO4J_PASSWORD?.trim()),
      database: parseNonEmptyString(input.NEO4J_DATABASE, 'neo4j', 'NEO4J_DATABASE'),
    },
    contextBudget: {
      budgeterEnabled: contextBudgeterEnabled,
      compressorEnabled: contextCompressorEnabled,
      maxContextTokens,
      maxSnippetTokens,
    },
    codeEmbeddingsEnabled,
    evalStrategies,
  };
}

function assertProductionRetrievalGuardrails(input: {
  readonly lexicalEnabled: boolean;
  readonly embeddingsEnabled: boolean;
  readonly rerankerEnabled: boolean;
  readonly graphRagEnabled: boolean;
  readonly neo4jEnabled: boolean;
  readonly contextBudgeterEnabled: boolean;
  readonly contextCompressorEnabled: boolean;
  readonly codeEmbeddingsEnabled: boolean;
}): void {
  if (!input.lexicalEnabled) throw new Error('RETRIEVAL_LEXICAL_ENABLED=false is not allowed for production retrieval');
  if (!input.embeddingsEnabled) throw new Error('RETRIEVAL_EMBEDDINGS_ENABLED=false is not allowed for production retrieval');
  if (!input.rerankerEnabled) throw new Error('RETRIEVAL_RERANKER_ENABLED=false is not allowed for production retrieval');
  if (!input.graphRagEnabled) throw new Error('RETRIEVAL_GRAPH_RAG_ENABLED=false is not allowed for production retrieval');
  if (!input.neo4jEnabled) throw new Error('RETRIEVAL_NEO4J_ENABLED=false is not allowed for production retrieval');
  if (!input.contextBudgeterEnabled) {
    throw new Error('RETRIEVAL_CONTEXT_BUDGETER_ENABLED=false is not allowed for production retrieval');
  }
  if (!input.contextCompressorEnabled) {
    throw new Error('RETRIEVAL_CONTEXT_COMPRESSOR_ENABLED=false is not allowed for production retrieval');
  }
  if (input.codeEmbeddingsEnabled) {
    throw new Error('RETRIEVAL_CODE_EMBEDDINGS_ENABLED=true is not allowed for first production release');
  }
}

function parseRuntimeEnvironment(raw: string | undefined): RuntimeEnvironment {
  const value = raw ?? 'development';
  if (!runtimeEnvironments.has(value as RuntimeEnvironment)) {
    throw new Error(`NODE_ENV must be one of: ${[...runtimeEnvironments].join(', ')}`);
  }
  return value as RuntimeEnvironment;
}

function parseBoolean(raw: string | undefined, fallback: boolean, name: string): boolean {
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be "true" or "false"`);
}

function parsePositiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/u.test(raw)) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number.parseInt(raw, 10);
}

function parseNonEmptyString(raw: string | undefined, fallback: string, name: string): string {
  const value = raw?.trim() || fallback;
  if (value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function parseEvalStrategies(raw: string | undefined): readonly RetrievalStrategyId[] {
  if (!raw?.trim()) return ['hybrid', 'hybrid_graph'];

  const strategies = new Set<RetrievalStrategyId>();
  for (const part of raw.split(',')) {
    const strategy = part.trim();
    if (!strategy) continue;
    if (!retrievalStrategies.has(strategy as RetrievalStrategyId)) {
      throw new Error(`RETRIEVAL_EVAL_STRATEGIES contains unsupported strategy: ${strategy}`);
    }
    strategies.add(strategy as RetrievalStrategyId);
  }

  if (strategies.size === 0) {
    throw new Error('RETRIEVAL_EVAL_STRATEGIES must contain at least one strategy');
  }
  return [...strategies];
}
