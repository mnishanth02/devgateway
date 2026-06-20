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
        const path = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname;

        if (path === '/healthz' || path === '/readyz') {
            writeJson(response, 200, buildHealthPayload({ port }));
            return;
        }

        if (path === '/') {
            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>DevGateway Admin Portal</title>
  </head>
  <body>
    <main>
      <h1>DevGateway Admin Portal</h1>
      <p>Local frontend skeleton is running on port ${port}.</p>
    </main>
  </body>
</html>
`);
            return;
        }

        writeJson(response, 404, {
            error: 'not_found',
            message: 'DevGateway Admin Portal local skeleton exposes / and /healthz.',
        });
    };
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
