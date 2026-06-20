import { AUTH_BASE_PATH, type ControlAuth } from '../auth/index.js';

export const AUTH_OK_PATH = `${AUTH_BASE_PATH}/ok`;
export const authOkBody = { status: 'ok' } as const;

export interface AuthRouteHandlerOptions {
  readonly auth?: Pick<ControlAuth, 'handler'>;
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

function jsonResponse(body: Readonly<Record<string, unknown>>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
