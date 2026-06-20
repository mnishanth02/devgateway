import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildHealthPayload } from './server.ts';

describe('tool-broker health payload', () => {
    it('reports the service name, status, and configured port', () => {
        assert.deepEqual(buildHealthPayload({ port: 43102 }), {
            service: '@devgateway/tool-broker',
            status: 'ok',
            port: 43102,
        });
    });
});
