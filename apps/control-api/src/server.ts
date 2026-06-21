import fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import fastifySwagger, { type SwaggerOptions } from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { z } from 'zod';
import type { ControlAuth } from './auth/index.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerBifrostConfigRoutes } from './routes/bifrost-config.ts';
import { registerBudgetRoutes } from './routes/budgets.ts';
import { registerCostEventRoutes } from './routes/cost-events.ts';
import { registerPolicyRoutes } from './routes/policy.ts';
import { registerRegistryRoutes } from './routes/registry.ts';
import type { SnapshotRoute } from './routes/snapshot-common.ts';
import { registerVirtualKeyRoutes, type ControlRouteDefinition } from './routes/virtual-keys.ts';
import { missingAuthControlError } from './policies/control-errors.ts';
import {
    controlApiServiceName,
    createOpenApiDocumentOptions,
    healthPayloadJsonSchema,
    normalizeRuntimeEnvironment,
    openApiDocumentJsonSchema,
    readinessPayloadJsonSchema,
    shouldExposeOpenApiDocs,
    typedErrorResponseJsonSchema,
    type HealthPayload,
    type ReadinessPayload,
    type RuntimeEnvironment,
} from './openapi/index.ts';

export interface HealthPayloadOptions {
    readonly port: number;
}

export interface ControlApiServerOptions {
    readonly port?: number;
    readonly host?: string;
    readonly runtimeEnvironment?: RuntimeEnvironment;
    readonly enableDocs?: boolean;
    readonly auth?: Pick<ControlAuth, 'handler'>;
    readonly registerControlPlaneRoutes?: boolean;
}

export function buildHealthPayload(options: HealthPayloadOptions): HealthPayload {
    return {
        service: controlApiServiceName,
        status: 'ok',
        port: options.port,
    };
}

export function buildReadinessPayload(options: Required<Pick<ControlApiServerOptions, 'runtimeEnvironment'>> & Pick<ControlApiServerOptions, 'auth' | 'enableDocs'>): ReadinessPayload {
    const docsEnabled = shouldExposeOpenApiDocs(options.runtimeEnvironment, options.enableDocs);
    const dependencyPlaceholders = {
        operationalDatabase: 'not-connected-in-local-skeleton',
        redis: 'not-connected-in-local-skeleton',
        bifrost: 'not-connected-in-local-skeleton',
    } as const;
    const status = options.runtimeEnvironment === 'production' ? 'not_ready' : 'ready';
    return {
        service: controlApiServiceName,
        status,
        checks: {
            configuration: 'ok',
            ...dependencyPlaceholders,
            fastify: 'ok',
            openapi: docsEnabled ? 'ok' : 'disabled-in-production',
            auth: options.auth === undefined ? 'mounted-without-db-adapter' : 'mounted',
            productionRoutes: 'disabled',
        },
    };
}

export function createControlApiServer(options: ControlApiServerOptions = {}): FastifyInstance {
    const port = options.port ?? parsePort(process.env.PORT, 43100);
    const runtimeEnvironment = options.runtimeEnvironment ?? normalizeRuntimeEnvironment(process.env.NODE_ENV);
    const enableDocs = options.enableDocs ?? true;
    const docsEnabled = shouldExposeOpenApiDocs(runtimeEnvironment, enableDocs);
    const server = fastify({ logger: false });
    server.setValidatorCompiler(() => () => true);
    server.setErrorHandler((error: Error & { validation?: unknown }, _request, reply) => {
        if (error.validation !== undefined) {
            reply.code(400).send({
                error: {
                    code: 'invalid_request',
                    message: error.message,
                },
            });
            return;
        }
        reply.send(error);
    });

    void server.register(async (instance) => {
        if (docsEnabled) {
            await instance.register(fastifySwagger, {
                openapi: createOpenApiDocumentOptions(runtimeEnvironment),
            } as SwaggerOptions);
        }

        registerHealthRoutes(
            instance,
            options.auth === undefined ? { port, runtimeEnvironment, enableDocs } : { port, runtimeEnvironment, enableDocs, auth: options.auth },
        );
        registerAuthRoutes(instance, options.auth === undefined ? {} : { auth: options.auth });
        if (runtimeEnvironment !== 'production' && (options.registerControlPlaneRoutes ?? true)) {
            registerTrackOneControlPlaneRoutes(instance, { runtimeEnvironment });
        }

        if (docsEnabled) {
            registerOpenApiRoutes(instance);
        } else {
            registerDisabledDocumentationRoutes(instance);
        }
    });

    return server;
}

export async function startServer(options: ControlApiServerOptions = {}): Promise<FastifyInstance> {
    const port = options.port ?? parsePort(process.env.PORT, 43100);
    const runtimeEnvironment = options.runtimeEnvironment ?? normalizeRuntimeEnvironment(process.env.NODE_ENV);
    const host = options.host ?? process.env.HOST ?? (runtimeEnvironment === 'production' || process.env.RAILWAY_ENVIRONMENT ? '0.0.0.0' : '127.0.0.1');
    const server = createControlApiServer({ ...options, port });
    await server.listen({ port, host });
    console.log(`${controlApiServiceName} listening at http://${host}:${port}`);
    return server;
}

function registerHealthRoutes(server: FastifyInstance, options: Required<Pick<ControlApiServerOptions, 'port' | 'runtimeEnvironment' | 'enableDocs'>> & Pick<ControlApiServerOptions, 'auth'>): void {
    server.get(
        '/healthz',
        {
            schema: {
                tags: ['Health'],
                operationId: 'getHealthz',
                summary: 'Liveness probe',
                response: {
                    200: healthPayloadJsonSchema,
                },
            },
        },
        async () => buildHealthPayload({ port: options.port }),
    );

    server.get(
        '/readyz',
        {
            schema: {
                tags: ['Health'],
                operationId: 'getReadyz',
                summary: 'Readiness probe',
                description: 'Preserves Track 0 dependency placeholders while reporting the non-production Track 1 Fastify/OpenAPI/auth foundation.',
                response: {
                    200: readinessPayloadJsonSchema,
                    503: readinessPayloadJsonSchema,
                },
            },
        },
        async (_request, reply) => {
            const payload = buildReadinessPayload(options);
            if (payload.status !== 'ready') {
                reply.code(503);
            }
            return payload;
        },
    );
}

function registerOpenApiRoutes(server: FastifyInstance): void {
    server.get(
        '/openapi.json',
        {
            schema: {
                tags: ['Documentation'],
                operationId: 'getOpenApiDocument',
                summary: 'OpenAPI 3.1 document',
                response: {
                    200: openApiDocumentJsonSchema,
                },
            },
        },
        async () => server.swagger(),
    );

    void server.register(fastifySwaggerUi, {
        routePrefix: '/docs',
        uiConfig: {
            docExpansion: 'list',
            deepLinking: false,
        },
    });
}

function registerTrackOneControlPlaneRoutes(
    server: FastifyInstance,
    options: Required<Pick<ControlApiServerOptions, 'runtimeEnvironment'>>,
): void {
    const controlRegistrar = {
        route(route: ControlRouteDefinition): void {
            server.route({
                method: route.method,
                url: route.url,
                schema: toFastifyControlRouteDocumentation(route),
                handler: async (request, reply) => route.handler(request, reply),
            });
        },
    };
    const snapshotRegistrar = (route: SnapshotRoute): void => {
        server.route({
            method: route.method,
            url: route.path,
            schema: toFastifySnapshotSchema(route),
            handler: async (request, reply) => {
                const response = await route.handler(new Request(`http://127.0.0.1${request.url}`, { method: request.method }));
                await sendWebResponse(reply, response);
            },
        });
    };

    const authenticate = async () => {
        throw missingAuthControlError({ auth: 'better_auth_admin_session_required' });
    };
    registerVirtualKeyRoutes(controlRegistrar, { runtimeEnvironment: options.runtimeEnvironment, authenticate });
    registerBudgetRoutes(controlRegistrar, { runtimeEnvironment: options.runtimeEnvironment, authenticate });
    registerCostEventRoutes(controlRegistrar, { runtimeEnvironment: options.runtimeEnvironment, authenticate });
    const snapshotOptions = { runtimeEnvironment: options.runtimeEnvironment } as const;
    registerRegistryRoutes(snapshotRegistrar, snapshotOptions);
    registerPolicyRoutes(snapshotRegistrar, snapshotOptions);
    registerBifrostConfigRoutes(snapshotRegistrar, snapshotOptions);
}

function toFastifySnapshotSchema(route: SnapshotRoute): Readonly<Record<string, unknown>> {
    return {
        operationId: route.schema.operationId,
        summary: route.schema.summary,
        tags: route.schema.tags,
        response: Object.fromEntries(
            Object.entries(route.schema.responses).map(([status]) => [status, zodToJsonSchema(z.record(z.string(), z.unknown()))]),
        ),
    };
}

function toFastifyControlRouteDocumentation(route: ControlRouteDefinition): Readonly<Record<string, unknown>> {
    const schema = convertZodSchemaObject(route.schema) as Readonly<Record<string, unknown>>;
    return {
        ...(schema.operationId === undefined ? {} : { operationId: schema.operationId }),
        ...(schema.summary === undefined ? {} : { summary: schema.summary }),
        ...(schema.description === undefined ? {} : { description: schema.description }),
        ...(schema.tags === undefined ? {} : { tags: schema.tags }),
        ...(schema.body === undefined ? {} : { body: schema.body }),
        ...(schema.querystring === undefined ? {} : { querystring: schema.querystring }),
        ...(schema.params === undefined ? {} : { params: schema.params }),
        ...(schema.response === undefined ? {} : { response: schema.response }),
    };
}

function convertZodSchemaObject(value: unknown): unknown {
    if (isZodSchema(value)) return zodToJsonSchema(value);
    if (Array.isArray(value)) return value.map((entry) => convertZodSchemaObject(entry));
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(value as Readonly<Record<string, unknown>>).map(([key, entry]) => [key, convertZodSchemaObject(entry)]),
    );
}

function isZodSchema(value: unknown): value is z.ZodType {
    return value instanceof z.ZodType;
}

function zodToJsonSchema(schema: z.ZodType): Readonly<Record<string, unknown>> {
    const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
    delete jsonSchema.$schema;
    return jsonSchema;
}

async function sendWebResponse(reply: FastifyReply, response: Response): Promise<void> {
    reply.code(response.status);
    response.headers.forEach((value, key) => {
        reply.header(key, value);
    });

    if (response.status === 204 || response.body === null) {
        reply.send();
        return;
    }

    reply.send(Buffer.from(await response.arrayBuffer()));
}

function registerDisabledDocumentationRoutes(server: FastifyInstance): void {
    const docsDisabled = {
        error: {
            code: 'NOT_FOUND',
            message: 'Documentation is disabled',
        },
    } as const;

    for (const path of ['/openapi.json', '/docs', '/docs/*'] as const) {
        server.get(
            path,
            {
                schema: {
                    hide: true,
                    response: {
                        404: typedErrorResponseJsonSchema,
                    },
                },
            },
            async (_request, reply) => reply.code(404).send(docsDisabled),
        );
    }
}

function parsePort(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback;
    const port = Number.parseInt(raw, 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`PORT must be an integer between 1 and 65535. Received: ${raw}`);
    }
    return port;
}
