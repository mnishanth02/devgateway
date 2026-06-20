import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildHealthPayload } from './server.ts';

describe('admin-portal health payload', () => {
    it('reports the service name, status, and configured port', () => {
        assert.deepEqual(buildHealthPayload({ port: 43101 }), {
            service: '@devgateway/admin-portal',
            status: 'ok',
            port: 43101,
        });
    });
});
