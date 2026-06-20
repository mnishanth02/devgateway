import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface HealthPayloadOptions {
    readonly port: number;
}

export interface HealthPayload {
    readonly service: '@devgateway/control-api';
    readonly status: 'ok';
    readonly port: number;
}

export function buildHealthPayload(options: HealthPayloadOptions): HealthPayload {
    return {
        service: '@devgateway/control-api',
        status: 'ok',
        port: options.port,
    };
}

export function createRequestHandler(port: number) {
    return (request: IncomingMessage, response: ServerResponse) => {
        const path = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname;

        if (path === '/healthz') {
            writeJson(response, 200, buildHealthPayload({ port }));
            return;
        }

        if (path === '/readyz') {
            writeJson(response, 200, {
                service: '@devgateway/control-api',
                status: 'ready',
                checks: {
                    configuration: 'ok',
                    operationalDatabase: 'not-connected-in-local-skeleton',
                    redis: 'not-connected-in-local-skeleton',
                    bifrost: 'not-connected-in-local-skeleton',
                },
            });
            return;
        }

        writeJson(response, 404, {
            error: 'not_found',
            message: 'DevGateway Control API local skeleton exposes /healthz and /readyz.',
        });
    };
}

export function startServer(port = parsePort(process.env.PORT, 43100)) {
    const server = createServer(createRequestHandler(port));
    server.listen(port, '127.0.0.1', () => {
        console.log(`@devgateway/control-api listening at http://127.0.0.1:${port}`);
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
