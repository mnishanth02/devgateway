export const schemaCatalog = {
  version: '0.1.0',
  catalog: 'schemas/index.v0.1.json',
  external: {
    openai: 'schemas/external/openai.v0.1.schema.json',
    anthropic: 'schemas/external/anthropic.v0.1.schema.json',
    mcp: 'schemas/external/mcp.v0.1.schema.json',
  },
  shared: {
    gateResult: 'schemas/shared/gate-result.v0.1.schema.json',
    evalCase: 'schemas/eval/eval-case.v0.1.schema.json',
  },
} as const;

export type SchemaCatalog = typeof schemaCatalog;
