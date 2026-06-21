import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildHealthPayload, createControlApiServer } from './server.ts';

describe('control-api Fastify foundation', () => {
  it('reports the service name, status, and configured port', () => {
    assert.deepEqual(buildHealthPayload({ port: 43100 }), {
      service: '@devgateway/control-api',
      status: 'ok',
      port: 43100,
    });
  });

  it('serves /healthz through Fastify injection', async () => {
    const app = createControlApiServer({ port: 43100, runtimeEnvironment: 'test' });
    try {
      const response = await app.inject({ method: 'GET', url: '/healthz' });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), {
        service: '@devgateway/control-api',
        status: 'ok',
        port: 43100,
      });
    } finally {
      await app.close();
    }
  });

  it('preserves readiness placeholders and reports Track 1 foundation checks', async () => {
    const app = createControlApiServer({ runtimeEnvironment: 'test' });
    try {
      const response = await app.inject({ method: 'GET', url: '/readyz' });
      assert.equal(response.statusCode, 200);

      const payload = response.json();
      assert.equal(payload.service, '@devgateway/control-api');
      assert.equal(payload.status, 'ready');
      assert.equal(payload.checks.configuration, 'ok');
      assert.equal(payload.checks.operationalDatabase, 'not-connected-in-local-skeleton');
      assert.equal(payload.checks.redis, 'not-connected-in-local-skeleton');
      assert.equal(payload.checks.bifrost, 'not-connected-in-local-skeleton');
      assert.equal(payload.checks.fastify, 'ok');
      assert.equal(payload.checks.openapi, 'ok');
      assert.equal(payload.checks.auth, 'mounted-without-db-adapter');
      assert.equal(payload.checks.productionRoutes, 'disabled');
    } finally {
      await app.close();
    }
  });

  it('fails closed for production readiness until dependencies are connected', async () => {
    const app = createControlApiServer({ runtimeEnvironment: 'production' });
    try {
      const response = await app.inject({ method: 'GET', url: '/readyz' });
      assert.equal(response.statusCode, 503);
      assert.equal(response.json().status, 'not_ready');
      assert.equal(response.json().checks.operationalDatabase, 'not-connected-in-local-skeleton');
      assert.equal(response.json().checks.bifrost, 'not-connected-in-local-skeleton');
    } finally {
      await app.close();
    }
  });

  it('serves /api/auth/ok through the real server', async () => {
    const app = createControlApiServer({ runtimeEnvironment: 'test' });
    try {
      const response = await app.inject({ method: 'GET', url: '/api/auth/ok' });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { status: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('fails closed for unconfigured Better Auth routes', async () => {
    const app = createControlApiServer({ runtimeEnvironment: 'test' });
    try {
      const response = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: {} });
      assert.equal(response.statusCode, 503);
      assert.equal(response.json().error.code, 'AUTH_NOT_CONFIGURED');
    } finally {
      await app.close();
    }
  });

  it('forwards configured Better Auth routes with original protocol', async () => {
    const app = createControlApiServer({
      runtimeEnvironment: 'test',
      auth: {
        handler: async (request) =>
          Response.json({
            method: request.method,
            url: request.url,
            body: await request.json(),
          }),
      },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: {
          host: 'api.example.com',
          'x-forwarded-proto': 'https, http',
        },
        payload: { email: 'admin@example.com' },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().url, 'https://api.example.com/api/auth/sign-in/email');
      assert.deepEqual(response.json().body, { email: 'admin@example.com' });
    } finally {
      await app.close();
    }
  });

  it('rejects malformed control route bodies through Fastify validation', async () => {
    const app = createControlApiServer({ runtimeEnvironment: 'test' });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/virtual-keys',
        headers: authHeaders(),
        payload: { providerKey: 'secret' },
      });
      assert.equal(response.statusCode, 401);
      assert.deepEqual(Object.keys(response.json()), ['error']);
      assert.equal(response.json().error.code, 'missing_auth');
    } finally {
      await app.close();
    }
  });

  it('fails auth before processing forbidden control-route fields on mounted routes', async () => {
    const app = createControlApiServer({ runtimeEnvironment: 'test' });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/virtual-keys',
        headers: authHeaders(),
        payload: {
          ...validVirtualKeyBody(),
          providerKey: 'secret',
        },
      });
      assert.equal(response.statusCode, 401);
      assert.equal(response.json().error.code, 'missing_auth');
    } finally {
      await app.close();
    }
  });

  it('does not trust caller-supplied principal headers for mounted control routes', async () => {
    const app = createControlApiServer({ runtimeEnvironment: 'test' });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/virtual-keys',
        headers: authHeaders(),
      });

      assert.equal(response.statusCode, 401);
      assert.equal(response.json().error.code, 'missing_auth');
    } finally {
      await app.close();
    }
  });

  it('exposes a non-production OpenAPI 3.1 document containing foundation routes', async () => {
    const app = createControlApiServer({ runtimeEnvironment: 'test' });
    try {
      const response = await app.inject({ method: 'GET', url: '/openapi.json' });
      assert.equal(response.statusCode, 200);

      const document = response.json();
      assert.equal(document.openapi, '3.1.0');
      assert.ok(document.paths['/healthz']);
      assert.ok(document.paths['/readyz']);
      assert.ok(document.paths['/api/auth/ok']);
      assert.ok(document.paths['/api/virtual-keys']);
      assert.ok(document.paths['/api/virtual-keys'].post.requestBody);
      assert.ok(document.paths['/api/virtual-keys/{virtual_key_id}/rotate'].post.parameters);
      assert.ok(document.paths['/api/budget-spend']);
      assert.ok(document.paths['/registry/current']);
      assert.ok(document.paths['/policy/current']);
    } finally {
      await app.close();
    }
  });

  function authHeaders(): Record<string, string> {
    return {
      'x-devgateway-principal-id': 'principal_test',
      'x-devgateway-auth-subject': 'subject_test',
    };
  }

  function validVirtualKeyBody(): Record<string, unknown> {
    return {
      principal_id: 'principal_test',
      principal_type: 'service_account',
      project_id: 'project_123',
      tenant_id: 'tenant_123',
      org_id: 'org_123',
      budget_scope_id: 'bs_test',
      budget_scope_type: 'virtual_key',
      environment: 'development',
      scope_constraints: {
        route_intents: ['chat'],
        data_classes: ['internal'],
        model_aliases: ['default-chat'],
        provider_candidates: ['provider-placeholder'],
        max_expires_at: '2099-01-01T00:00:00.000Z',
      },
      policy_version: 'policy-v1',
      registry_version: 'registry-v1',
      expires_at: '2099-01-01T00:00:00.000Z',
    };
  }

  it('enables Swagger UI outside production', async () => {
    const app = createControlApiServer({ runtimeEnvironment: 'test' });
    try {
      const response = await app.inject({ method: 'GET', url: '/docs/' });
      assert.notEqual(response.statusCode, 404);
    } finally {
      await app.close();
    }
  });

  it('fails closed for OpenAPI and Swagger UI in production', async () => {
    const app = createControlApiServer({ runtimeEnvironment: 'production' });
    try {
      const openApiResponse = await app.inject({ method: 'GET', url: '/openapi.json' });
      assert.equal(openApiResponse.statusCode, 404);

      const swaggerResponse = await app.inject({ method: 'GET', url: '/docs/' });
      assert.equal(swaggerResponse.statusCode, 404);
    } finally {
      await app.close();
    }
  });

  it('does not mount Track 1 control-plane routes in production', async () => {
    const app = createControlApiServer({ runtimeEnvironment: 'production' });
    try {
      const virtualKeyResponse = await app.inject({ method: 'GET', url: '/api/virtual-keys' });
      const registryResponse = await app.inject({ method: 'GET', url: '/registry/current' });

      assert.equal(virtualKeyResponse.statusCode, 404);
      assert.equal(registryResponse.statusCode, 404);
    } finally {
      await app.close();
    }
  });
});
