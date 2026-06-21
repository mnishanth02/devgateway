import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface HealthPayloadOptions {
    readonly port: number;
}

export interface HealthPayload {
    readonly service: '@devgateway/admin-portal';
    readonly status: 'ok';
    readonly port: number;
}

export function buildHealthPayload(options: HealthPayloadOptions): HealthPayload {
    return {
        service: '@devgateway/admin-portal',
        status: 'ok',
        port: options.port,
    };
}

export function createRequestHandler(port: number) {
    return (request: IncomingMessage, response: ServerResponse) => {
        void handleRequest(request, response, port).catch((error: unknown) => {
            writeJson(response, 500, {
                error: 'admin_portal_error',
                message: error instanceof Error ? error.message : 'Unknown admin portal error.',
            });
        });
    };
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, port: number): Promise<void> {
        const path = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname;

        if (path === '/healthz' || path === '/readyz') {
            writeJson(response, 200, buildHealthPayload({ port }));
            return;
        }

        if (path === '/' || path === '/operations' || path === '/operations.json') {
            writeJson(response, 503, {
                error: 'admin_portal_server_disabled',
                message:
                    'The legacy Node operations server is disabled; use the Vite admin portal behind Better Auth session validation.',
            });
            return;
        }

        writeJson(response, 404, {
            error: 'not_found',
            message: 'DevGateway Admin Portal exposes /healthz and /readyz from this server entrypoint.',
        });
}

export function startServer(port = parsePort(process.env.PORT, 43101)) {
    const server = createServer(createRequestHandler(port));
    server.listen(port, '127.0.0.1', () => {
        console.log(`@devgateway/admin-portal listening at http://127.0.0.1:${port}`);
    });
    return server;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
    response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
    response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function parsePort(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback;
    const port = Number.parseInt(raw, 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`PORT must be an integer between 1 and 65535. Received: ${raw}`);
    }
    return port;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    startServer();
}
