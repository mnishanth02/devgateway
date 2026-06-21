import type fastifySwagger from '@fastify/swagger';
import { controlApiServiceName } from './schemas.ts';

export type RuntimeEnvironment = 'development' | 'test' | 'production';

export function shouldExposeOpenApiDocs(runtimeEnvironment: RuntimeEnvironment, requested = true): boolean {
  return runtimeEnvironment !== 'production' && requested;
}

export function createOpenApiDocumentOptions(
  runtimeEnvironment: RuntimeEnvironment,
): NonNullable<fastifySwagger.FastifyDynamicSwaggerOptions['openapi']> {
  const document = {
    openapi: '3.1.0',
    info: {
      title: 'DevGateway Control API',
      version: '0.1.0',
      description:
        'Track 1 control-plane foundation for health, readiness, OpenAPI, and Better Auth route mounting. Production auth, provider keys, and break-glass routes remain disabled.',
    },
    servers: [
      {
        url: 'http://127.0.0.1:43100',
        description: 'Local development',
      },
    ],
    tags: [
      { name: 'Health', description: 'Service liveness and readiness probes.' },
      { name: 'Auth', description: 'Better Auth foundation routes and mount point.' },
      { name: 'Documentation', description: 'Non-production API documentation.' },
      { name: 'virtual-keys', description: 'Non-production virtual key lifecycle foundation.' },
      { name: 'Budgets', description: 'Budget policy and spend inspection foundation.' },
      { name: 'Cost Events', description: 'Cost event inspection foundation.' },
      { name: 'Registry', description: 'Model/provider registry snapshot foundation.' },
      { name: 'Policy', description: 'Provider data-class policy snapshot foundation.' },
      { name: 'Bifrost', description: 'Bifrost config validation foundation.' },
    ],
    components: {
      securitySchemes: {
        betterAuthCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description: 'Future Better Auth browser session cookie. Full DB-backed sessions are not enabled in Phase 1.2.',
        },
      },
    },
  };
  return document as NonNullable<fastifySwagger.FastifyDynamicSwaggerOptions['openapi']>;
}

export function normalizeRuntimeEnvironment(raw: string | undefined): RuntimeEnvironment {
  if (raw === 'production') return 'production';
  if (raw === 'test') return 'test';
  return 'development';
}
