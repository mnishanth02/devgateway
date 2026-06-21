import { z } from 'zod';

export const controlApiServiceName = '@devgateway/control-api';

export const healthPayloadSchema = z.object({
  service: z.literal(controlApiServiceName),
  status: z.literal('ok'),
  port: z.number().int().min(1).max(65_535),
});

export const readinessPayloadSchema = z.object({
  service: z.literal(controlApiServiceName),
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    configuration: z.literal('ok'),
    operationalDatabase: z.literal('not-connected-in-local-skeleton'),
    redis: z.literal('not-connected-in-local-skeleton'),
    bifrost: z.literal('not-connected-in-local-skeleton'),
    fastify: z.literal('ok'),
    openapi: z.enum(['ok', 'disabled-in-production']),
    auth: z.enum(['mounted', 'mounted-without-db-adapter']),
    productionRoutes: z.literal('disabled'),
  }),
});

export const authOkBodySchema = z.object({
  status: z.literal('ok'),
});

export const typedErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
});

export const openApiDocumentSchema = z.record(z.string(), z.unknown());

export const healthPayloadJsonSchema = toFastifyJsonSchema(healthPayloadSchema);
export const readinessPayloadJsonSchema = toFastifyJsonSchema(readinessPayloadSchema);
export const authOkBodyJsonSchema = toFastifyJsonSchema(authOkBodySchema);
export const typedErrorResponseJsonSchema = toFastifyJsonSchema(typedErrorResponseSchema);
export const openApiDocumentJsonSchema = toFastifyJsonSchema(openApiDocumentSchema);

export type HealthPayload = z.infer<typeof healthPayloadSchema>;
export type ReadinessPayload = z.infer<typeof readinessPayloadSchema>;
export type TypedErrorResponse = z.infer<typeof typedErrorResponseSchema>;

function toFastifyJsonSchema(schema: z.ZodType): Readonly<Record<string, unknown>> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}
