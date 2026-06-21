import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildHealthPayload } from './server.ts';
import {
    buildOperationalViewModel,
    renderOperationalPortalHtml,
    sanitizeForDisplay,
    type ControlApiFetchResult,
    type OperationalControlApiSnapshot,
} from './features/operational-views.ts';

describe('admin-portal health payload', () => {
    it('reports the service name, status, and configured port', () => {
        assert.deepEqual(buildHealthPayload({ port: 43101 }), {
            service: '@devgateway/admin-portal',
            status: 'ok',
            port: 43101,
        });
    });
});

describe('operational portal view mapping', () => {
        it('maps Control API route shapes into operational sections with disabled actions', () => {
            const model = buildOperationalViewModel(controlSnapshotFixture(), {
                generatedAt: '2026-06-20T00:00:00.000Z',
                controlApiBaseUrl: 'http://127.0.0.1:43100',
            });

            assert.equal(model.health.status, 'ok');
            assert.equal(model.routing.aliases[0]?.alias, 'claude-fast');
            assert.equal(model.routing.aliases[0]?.candidates[0]?.provider, 'anthropic');
            assert.deepEqual(model.routing.gateErrors, ['route_disabled: Production route generation disabled.']);
            assert.equal(model.virtualKeys.records[0]?.rotation, 'scheduled');
            assert.equal(model.budgets.spend[0]?.decision, 'deny');
            assert.equal(model.budgets.costEvents[0]?.denialReason, 'budget');
            assert.equal(model.audit.denials.length, 1);
            assert.equal(model.virtualKeys.actionPolicy.allowed, false);
            assert.equal(model.breakGlass.status, 'disabled');
        });

        it('does not render or expose secret-bearing Control API fields', () => {
            const unsafe = {
                virtual_key: {
                    virtual_key_id: 'vk_1',
                    key_prefix: 'dg_live_xxxx',
                    one_time_secret: { value: 'dg_secret_should_not_render' },
                    provider_api_key: 'provider-secret',
                    nested: { raw_secret: 'raw-secret' },
                },
            };

            assert.deepEqual(sanitizeForDisplay(unsafe), {
                virtual_key: {
                    virtual_key_id: 'vk_1',
                    key_prefix: 'dg_live_xxxx',
                    nested: {},
                },
            });

            const html = renderOperationalPortalHtml(
                buildOperationalViewModel(
                    {
                        ...controlSnapshotFixture(),
                        virtualKeys: ok('/api/virtual-keys', {
                            virtual_keys: [
                                {
                                    ...virtualKeyFixture(),
                                    one_time_secret: { value: 'dg_secret_should_not_render' },
                                    provider_api_key: 'provider-secret',
                                },
                            ],
                        }) as OperationalControlApiSnapshot['virtualKeys'],
                    } as OperationalControlApiSnapshot,
                    {
                        generatedAt: '2026-06-20T00:00:00.000Z',
                        controlApiBaseUrl: 'http://127.0.0.1:43100',
                    },
                ),
            );

            assert.equal(html.includes('dg_secret_should_not_render'), false);
            assert.equal(html.includes('provider-secret'), false);
            assert.equal(html.includes('key_hash_ref'), false);
        });
    });

function controlSnapshotFixture(): OperationalControlApiSnapshot {
        return {
            health: ok('/healthz', { service: '@devgateway/control-api', status: 'ok', port: 43100 }),
            readiness: ok('/readyz', {
                service: '@devgateway/control-api',
                status: 'ready',
                checks: { configuration: 'ok', productionRoutes: 'disabled' },
            }),
            registry: ok('/registry/current', {
                registry_version: 'registry.v1',
                production_enabled: false,
                snapshot: {
                    production_posture: { production_enabled: false, production_route_allowed: false },
                    model_aliases: [
                        {
                            alias: 'claude-fast',
                            lifecycle_status: 'approved',
                            production_gate: { production_route_allowed: false },
                            eval_gate: { latest_gate_status: 'passing' },
                            candidates: [
                                {
                                    candidate_id: 'anthropic-claude',
                                    provider_id: 'anthropic',
                                    provider_region: 'us-east-1',
                                    model_id: 'claude-3-5-haiku',
                                    allowed_data_classes: ['public', 'internal'],
                                    manual_approval_gate: { status: 'pending' },
                                },
                            ],
                        },
                    ],
                },
            }),
            bifrostValidation: ok('/bifrost/config/validation', {
                route_config_version: 'bifrost.registry.v1.disabled',
                production_enabled: false,
                errors: [{ error: { code: 'route_disabled', message: 'Production route generation disabled.' } }],
            }),
            virtualKeys: ok('/api/virtual-keys', { virtual_keys: [virtualKeyFixture()] }),
            budgetSpend: ok('/api/budget-spend', { spend: [budgetSpendFixture()] }),
            costEvents: ok('/api/cost-events?trace_id=trace_1', { cost_events: [costEventFixture()] }),
            openapi: ok('/openapi.json', { paths: { '/api/virtual-keys': {}, '/api/budget-spend': {} } }),
        } as unknown as OperationalControlApiSnapshot;
    }

function virtualKeyFixture() {
        return {
            contract_version: '0.1.0',
            virtual_key_id: 'vk_1',
            external_key_id: 'ext_vk_1',
            key_prefix: 'dg_live_1234',
            status: 'active',
            production_posture: {
                production_enabled: false,
                success_fallback_allowed: false,
                fail_closed_without_policy: true,
            },
            principal_binding: { principal_id: 'svc-admin', principal_type: 'service_account', auth_subject_ref: 'svc-admin' },
            project_binding: {
                project_id: 'project-1',
                tenant_id: 'tenant-1',
                org_id: 'org-1',
                team_ids: ['team-1'],
                environment: 'development',
            },
            scope_constraints: {
                route_intents: ['chat'],
                data_classes: ['internal'],
                model_aliases: ['claude-fast'],
                provider_candidates: ['anthropic-claude'],
                max_expires_at: null,
            },
            budget_scope_ref: { budget_scope_id: 'bs_1', budget_scope_type: 'virtual_key' },
            policy_version: 'policy.v1',
            registry_version: 'registry.v1',
            issued_at: '2026-06-20T00:00:00.000Z',
            not_before: null,
            expires_at: '2026-07-20T00:00:00.000Z',
            rotation: {
                rotation_state: 'scheduled',
                rotated_from_virtual_key_id: null,
                rotated_to_virtual_key_id: null,
                rotation_due_at: '2026-07-01T00:00:00.000Z',
            },
            revocation: { revoked_at: null, revoked_by_principal_id: null, revocation_reason: null },
            created_at: '2026-06-20T00:00:00.000Z',
            updated_at: '2026-06-20T00:00:00.000Z',
        };
    }

function budgetSpendFixture() {
        return {
            budget_scope_id: 'bs_1',
            scope_type: 'virtual_key',
            owner_id: 'vk_1',
            status: 'active',
            currency: 'USD',
            limits: {
                hard_cap_amount: 10,
                soft_cap_amount: 8,
                input_token_limit: null,
                output_token_limit: null,
                request_limit: null,
            },
            spend_state: {
                actual_spend_amount: 12,
                actual_input_tokens: 100,
                actual_output_tokens: 50,
                actual_request_count: 7,
                last_cost_event_id: 'cost_1',
            },
            reservation_state: {
                reserved_amount: 0,
                reserved_input_tokens: 0,
                reserved_output_tokens: 0,
                reservation_count: 0,
            },
            period: {
                reset_period: 'monthly',
                period_started_at: '2026-06-01T00:00:00.000Z',
                period_ends_at: null,
                timezone: 'UTC',
            },
            policy_version: 'policy.v1',
            decision: 'deny',
            denial_reason: 'budget',
        };
    }

function costEventFixture() {
        return {
            contract_version: '0.1.0',
            cost_event_id: 'cost_1',
            event_type: 'actual',
            trace_id: 'trace_1',
            request_id: 'request_1',
            virtual_key_id: 'vk_1',
            budget_scope_id: 'bs_1',
            principal_id: 'svc-admin',
            project_id: 'project-1',
            environment: 'development',
            route_intent: 'chat',
            data_class: 'internal',
            model_alias: 'claude-fast',
            provider_id: 'anthropic',
            provider_model_id: 'claude-3-5-haiku',
            gateway_attempt: 1,
            fallback_attempt: 0,
            attempt_status: 'denied',
            currency: 'USD',
            usage_source: 'estimated_final',
            decision: 'deny',
            estimated: measurementFixture(0.42),
            actual: measurementFixture(0.41),
            denial_reason: 'budget',
            aggregation_targets: {
                tenant_id: 'tenant-1',
                org_id: 'org-1',
                team_id: 'team-1',
                project_id: 'project-1',
                principal_id: 'svc-admin',
                virtual_key_id: 'vk_1',
                budget_scope_id: 'bs_1',
                model_alias: 'claude-fast',
                provider_id: 'anthropic',
                environment: 'development',
                route_intent: 'chat',
                data_class: 'internal',
                reset_period_start: '2026-06-01T00:00:00.000Z',
                reset_period_end: '2026-07-01T00:00:00.000Z',
            },
            policy_version: 'policy.v1',
            registry_version: 'registry.v1',
            occurred_at: '2026-06-20T00:00:00.000Z',
            recorded_at: '2026-06-20T00:00:01.000Z',
        };
    }

function measurementFixture(costAmount: number) {
        return {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            reasoning_tokens: 0,
            cost_amount: costAmount,
            unit_cost_basis: 'per_million_tokens',
            source: 'estimated_final',
        };
    }

function ok<T>(path: string, body: T): ControlApiFetchResult<T> {
        return { ok: true, status: 200, path, body };
}
