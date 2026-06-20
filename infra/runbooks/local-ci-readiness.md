# Local and CI readiness command conventions

Phase 0.2 defines command expectations only; it does not provision production.

## Local development matrix

| Command | Local purpose | Required before |
|---|---|---|
| `pnpm workspace:validate` | Validate root workspace tooling and locked schema catalog wiring. | Pull request. |
| `pnpm lint` | Check formatting/lint rules once tooling exists. | Pull request. |
| `pnpm typecheck` | Validate TypeScript service/package contracts. | Pull request. |
| `pnpm test` | Run unit and contract tests. | Pull request. |
| `pnpm build` | Build deployable app/package artifacts. | Railway deployment. |
| `pnpm eval:smoke` | Run fixture-mode eval smoke checks. | Registry/provider route changes. |
| `pnpm db:check` | Validate migration/schema compatibility. | DB-dependent service deployment. |
| `pnpm registry:validate` | Validate model/provider registry and production route gates. | Bifrost/provider changes. |
| `pnpm policy:validate` | Validate data-class matrix, denial taxonomy, and gate references. | Policy or gateway changes. |

## CI/readiness order

CI should run a single readiness lane in this order:

1. `pnpm workspace:validate`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test`
5. `pnpm build`
6. `pnpm db:check`
7. `pnpm registry:validate`
8. `pnpm policy:validate`
9. `pnpm eval:smoke`

`workspace:validate` runs the root tooling validator and the schema catalog sanity check so the readiness lane cannot pass without validating the Phase 0.2 contracts. `registry:validate` and `policy:validate` must pass before any production route or provider alias is enabled. `eval:smoke` runs in fixture/provider-fixture mode until live-provider eval approval exists.

## CI environment conventions

- Use `.env.example` and `infra/railway/variables.example.env` as the variable contract.
- CI secrets must be injected by the CI platform or Railway, never committed.
- Better Auth secret, database URLs, Redis URL, provider keys, GitHub App private key/webhook secret, object storage keys, OTel headers, encryption key, and audit salt are secret-classified.
- Production provisioning is gated by `PRODUCTION_PROVISIONING_ENABLED=false` and `PRODUCTION_DEPLOY_APPROVAL_REQUIRED=true`.
- CI may validate production configuration shape, but must not create production Railway services or stores.
