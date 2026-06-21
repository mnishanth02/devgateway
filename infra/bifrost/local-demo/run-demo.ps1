# DevGateway local gateway live-traffic demo (LOCAL ONLY).
#
# Proves the gateway data-plane end-to-end (route -> provider/key selection ->
# upstream -> usage/cost telemetry) using a SYNTHETIC local mock upstream and
# NO real provider keys. It is fully isolated: it does NOT touch the committed
# fail-closed config, the `pnpm local:*` launcher, registry/policy production
# flags, break-glass, or production provisioning. It runs on port 43181 so it is
# never confused with the gated Bifrost service port (43180).
#
# Usage:
#   pwsh infra/bifrost/local-demo/run-demo.ps1            # start + send a demo request
#   pwsh infra/bifrost/local-demo/run-demo.ps1 -Down      # tear everything down
[CmdletBinding()]
param(
  [switch]$Down,
  [int]$Port = 43181
)

$ErrorActionPreference = 'Continue'
$image = 'maximhq/bifrost:v1.5.15-ubi9@sha256:39c757944a55f4a15d27a4851c482084472fb4bc1e2f450f2d0fe2075d0905d2'
$network = 'dg-demo-net'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$mock = Join-Path $here 'mock-openai-server.mjs'
$config = Join-Path $here 'config.local-demo.json'

function Remove-DemoContainers {
  docker rm -f dg-bifrost mock-openai 2>&1 | Out-Null
}

function Initialize-DemoNetwork {
  $exists = (docker network ls --filter "name=^$network$" --format '{{.Name}}' 2>&1) -join ''
  if ($exists -ne $network) { docker network create $network 2>&1 | Out-Null }
}

if ($Down) {
  Remove-DemoContainers
  docker network rm $network 2>&1 | Out-Null
  Write-Host 'Demo torn down.'
  return
}

Remove-DemoContainers
Initialize-DemoNetwork

Write-Host 'Starting synthetic mock upstream (mock-openai:8081)...'
docker run -d --name mock-openai --network $network `
  -e MOCK_OPENAI_PORT=8081 -e MOCK_OPENAI_HOST=0.0.0.0 `
  -v "${mock}:/app/m.mjs:ro" node:22-alpine node /app/m.mjs | Out-Null

Write-Host "Starting local Bifrost gateway (port $Port)..."
docker run -d --name dg-bifrost --network $network -p "${Port}:8080" `
  -e BIFROST_ENCRYPTION_KEY=devgateway-local-demo-encryption-key-32b `
  -e MOCK_OPENAI_API_KEY=local-mock-not-a-secret `
  -v "${config}:/app/data/config.json:ro" $image | Out-Null

Write-Host 'Waiting for Bifrost to finish startup (model catalog + stores)...'
$deadline = (Get-Date).AddSeconds(120)
$ready = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep 5
  try {
    $h = Invoke-WebRequest "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 4
    if ($h.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
}
if (-not $ready) {
  Write-Warning 'Bifrost did not become healthy in time. Check: docker logs dg-bifrost'
  return
}
Write-Host 'Bifrost is serving. Sending a demo chat completion through the gateway...' -ForegroundColor Green

$reqPath = Join-Path $env:TEMP 'dg-demo-req.json'
Set-Content -Path $reqPath -Encoding ascii -NoNewline `
  -Value '{"model":"local-mock/gpt-4o-mini","messages":[{"role":"user","content":"Hello through the DevGateway gateway!"}]}'

curl.exe -s -S -X POST "http://127.0.0.1:$Port/v1/chat/completions" `
  -H 'Content-Type: application/json' --data-binary "@$reqPath"

Write-Host ''
Write-Host "Done. Gateway is live at http://127.0.0.1:$Port  (tear down: run-demo.ps1 -Down)"
