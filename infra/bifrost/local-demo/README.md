# Local gateway live-traffic demo (LOCAL ONLY)

This demo proves the DevGateway **gateway data-plane** end-to-end — request
routing, provider/key selection, and usage/cost telemetry — using a **synthetic
local mock upstream** and **no real provider keys**.

> ⚠️ **This is a local development demonstration, not production enablement.**
> It is deliberately isolated and does **not**:
> - touch the committed fail-closed runtime config (`infra/bifrost/config.runtime.example.json`),
> - use the `pnpm local:*` launcher or its readiness gates,
> - flip registry/policy `production_enabled`, `routes_enabled`, break-glass, or
>   `PRODUCTION_PROVISIONING_ENABLED`,
> - use or require any real OpenAI/Anthropic API key.
>
> It runs on **port 43181** so it is never confused with the gated Bifrost
> service port (43180). The committed production fail-closed posture is unchanged.

## What it shows

A real round-trip through a local Bifrost gateway:

```
client ──POST /v1/chat/completions──▶ Bifrost (:43181)
        route: local-mock/gpt-4o-mini
        ──▶ provider "local-mock" (key "local-mock-key")
            ──▶ mock upstream (mock-openai:8081)  ◀── synthetic OpenAI-compatible reply + usage
        ◀── response with usage tokens + latency telemetry
```

Verified response (excerpt):

```json
{
  "model": "gpt-4o-mini",
  "choices": [{ "message": { "role": "assistant", "content": "Mock gateway reply: ... (no real model was called)." } }],
  "usage": { "prompt_tokens": 7, "completion_tokens": 26, "total_tokens": 33 },
  "extra_fields": { "routing_info": { "provider": "local-mock", "model": "gpt-4o-mini", "key": "local-mock-key" }, "latency": 10 }
}
```

## Run it

```powershell
pwsh infra/bifrost/local-demo/run-demo.ps1        # start gateway + mock, send a demo request
pwsh infra/bifrost/local-demo/run-demo.ps1 -Down  # tear everything down
```

Then send your own requests:

```powershell
curl.exe -s -X POST http://127.0.0.1:43181/v1/chat/completions `
  -H "Content-Type: application/json" `
  --data-binary '{"model":"local-mock/gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'
```

## Files

| File | Purpose |
|---|---|
| `mock-openai-server.mjs` | Synthetic OpenAI-compatible upstream (`/v1/models`, `/v1/chat/completions`, SSE, `usage`). Never reaches the internet. |
| `config.local-demo.json` | Bifrost runtime config: one custom provider (`base_provider_type: openai`) pointed at the mock via `base_url` + `allow_private_network: true`. Auth not enforced (demo). |
| `run-demo.ps1` | Verified runner (Docker network + mock + Bifrost on :43181). |
| `docker-compose.demo.yml` | Compose alternative. On some Docker Desktop/Windows setups the Bifrost container stays silent; `run-demo.ps1` (plain `docker run`) is the verified path. |

## Notes / gotchas (learned while building this)

- Bifrost needs **`config_store`/`logs_store` enabled** (SQLite here) to boot
  cleanly; with both disabled it can hang silently before serving.
- Bifrost blocks connecting to **private IPs** by default — set
  `network_config.allow_private_network: true` for a local/container upstream.
- Bifrost startup takes ~60–90s (DB migrations + model catalog). The model
  catalog resolves **offline** (bundled), so no internet egress is required.
- `BIFROST_ENCRYPTION_KEY` is required when key values use `env.` references.
  The value here is a synthetic, non-secret local-only string.

## Going from mock to real models (deliberate, gated)

To use real GPT/Claude models through this gateway you would, **as a reviewed
release action** (not autonomously):

1. Provide real provider keys via env (e.g. `OPENAI_API_KEY`) — never committed.
2. Point the provider at the real base URL (or use Bifrost's native `openai`/`anthropic` provider).
3. For the **production** DevGateway path (not this demo), satisfy the Track 1
   exit gates: passing eval-gate evidence, registry/policy `production_enabled`,
   Bifrost `routes_enabled`, `PRODUCTION_PROVISIONING_ENABLED`, owner-assignment
   and break-glass approvals — see `infra/bifrost/deployment-strategy.md` and the
   Track 1 plan's exit criteria.
