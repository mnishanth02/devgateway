import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AUTH_BASE_PATH, type ControlAuth } from '../auth/index.ts';
import { authOkBodyJsonSchema, typedErrorResponseJsonSchema, type TypedErrorResponse } from '../openapi/index.ts';

export const AUTH_OK_PATH = `${AUTH_BASE_PATH}/ok`;
export const authOkBody = { status: 'ok' } as const;

export interface AuthRouteHandlerOptions {
  readonly auth?: Pick<ControlAuth, 'handler'>;
}

export function registerAuthRoutes(server: FastifyInstance, options: AuthRouteHandlerOptions = {}): void {
  server.get(
    AUTH_OK_PATH,
    {
      schema: {
        tags: ['Auth'],
        operationId: 'getAuthOk',
        summary: 'Check auth route mount health',
        description: 'Returns a minimal Better Auth smoke-test response through the real Fastify server.',
        response: {
          200: authOkBodyJsonSchema,
        },
      },
    },
    async () => authOkBody,
  );

  server.route({
    method: ['DELETE', 'GET', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
    url: `${AUTH_BASE_PATH}/*`,
    schema: {
      tags: ['Auth'],
      operationId: 'handleBetterAuthRoute',
      summary: 'Better Auth route mount',
      description:
        'Mount shape for future Better Auth handlers. Until the Drizzle adapter and migrated auth tables are wired, unconfigured auth requests fail closed with a typed generic error.',
      response: {
        200: { type: 'object', additionalProperties: true },
        400: typedErrorResponseJsonSchema,
        401: typedErrorResponseJsonSchema,
        403: typedErrorResponseJsonSchema,
        503: typedErrorResponseJsonSchema,
      },
    },
    handler: async (request, reply) => {
      if (options.auth === undefined) {
        return reply.code(503).send(createTypedAuthError('AUTH_NOT_CONFIGURED', 'Authentication is not configured'));
      }

      await forwardBetterAuthRequest(request, reply, options.auth);
      return undefined;
    },
  });
}

export async function handleAuthRoute(request: Request, options: AuthRouteHandlerOptions = {}): Promise<Response> {
  if (isAuthOkRequest(request)) {
    return jsonResponse(authOkBody, 200);
  }

  if (isBetterAuthRequest(request)) {
    if (options.auth === undefined) {
      return jsonResponse({ error: { code: 'AUTH_NOT_CONFIGURED', message: 'Authentication is not configured' } }, 503);
    }
    return options.auth.handler(request);
  }

  return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
}

export function isAuthOkRequest(request: Request): boolean {
  return request.method === 'GET' && getRequestPathname(request) === AUTH_OK_PATH;
}

export function isBetterAuthRequest(request: Request): boolean {
  const pathname = getRequestPathname(request);
  return pathname === AUTH_BASE_PATH || pathname.startsWith(`${AUTH_BASE_PATH}/`);
}

function getRequestPathname(request: Request): string {
  return new URL(request.url).pathname;
}

function createTypedAuthError(code: string, message: string): TypedErrorResponse {
  return { error: { code, message } };
}

function jsonResponse(body: Readonly<Record<string, unknown>>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function forwardBetterAuthRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: Pick<ControlAuth, 'handler'>,
): Promise<void> {
  const response = await auth.handler(toWebRequest(request));

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

function toWebRequest(request: FastifyRequest): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry);
      continue;
    }
    headers.set(key, String(value));
  }

  const init: RequestInit = {
    method: request.method,
    headers,
  };
  const body = createRequestBody(request);
  if (body !== undefined) {
    init.body = body;
  }

  return new Request(createAbsoluteRequestUrl(request), init);
}

function createAbsoluteRequestUrl(request: FastifyRequest): string {
  const host = request.headers.host ?? '127.0.0.1';
  const forwardedProtocol = request.headers['x-forwarded-proto'];
  const rawProtocol = Array.isArray(forwardedProtocol)
    ? forwardedProtocol[0]
    : forwardedProtocol;
  const protocol = rawProtocol?.split(',')[0]?.trim() || request.protocol;
  return `${protocol}://${host}${request.url}`;
}

function createRequestBody(request: FastifyRequest): BodyInit | undefined {
  if (request.method === 'GET' || request.method === 'HEAD' || request.body === undefined) {
    return undefined;
  }

  if (typeof request.body === 'string') {
    return request.body;
  }

  if (request.body instanceof Uint8Array) {
    return Buffer.from(request.body).toString('utf8');
  }

  return JSON.stringify(request.body);
}
