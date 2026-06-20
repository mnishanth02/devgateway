import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildHealthPayload } from './server.ts';

describe('control-api health payload', () => {
    it('reports the service name, status, and configured port', () => {
        assert.deepEqual(buildHealthPayload({ port: 43100 }), {
            service: '@devgateway/control-api',
            status: 'ok',
            port: 43100,
        });
    });
});
