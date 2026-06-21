# DevGateway

DevGateway is an internal AI gateway/platform workspace. This repository is organized as a pnpm/Turborepo monorepo with app services, shared packages, worker skeletons, local validation scripts, and Railway-oriented infrastructure artifacts.

## First-clone local setup

Prerequisites:

- Node.js 22 or newer
- pnpm 11 or newer, preferably through Corepack
- Docker Desktop or a compatible Docker Compose runtime for local dependency containers

From the repository root:

```bash
pnpm local:setup
pnpm local:dev deps
pnpm local:status
```

`pnpm local:setup` installs dependencies with the lockfile, creates `.env.local` from `.env.local.example` if it does not already exist, and runs the workspace contract validation.

`pnpm local:dev deps` starts local dependency containers under the Compose project `devgateway-local`.

## Local app profiles

The local launcher supports profile-based commands:

```bash
pnpm local:dev backend
pnpm local:dev frontend
pnpm local:dev all
pnpm local:stop all
pnpm local:reset --yes
```

- `backend` starts dependency containers and host hot reload for Control API and Tool Broker.
- `frontend` starts dependency containers and host hot reload for Admin Portal.
- `all` starts dependencies plus all app profiles.
- `deps` starts only dependency containers.

Hot reload runs on the host. Docker Compose is used for dependencies only.

## Local ports

DevGateway uses high local ports to avoid common conflicts:

| Component | Port |
|---|---:|
| Control API | 43100 |
| Admin Portal | 43101 |
| Tool Broker | 43102 |
| Bifrost placeholder URL | 43180 |
| Operational Postgres | 45432 |
| Knowledge Postgres | 45433 |
| Redis | 46379 |
| MinIO API | 49000 |
| MinIO Console | 49001 |
| Neo4j HTTP | 47474 |
| Neo4j Bolt | 47687 |
| OTel gRPC | 44317 |
| OTel HTTP | 44318 |
| OTel health | 43133 |
| Prometheus | 49090 |
| Grafana | 43030 |

The launcher tracks DevGateway-owned local processes in `.devgateway/runtime.json`. If a second run sees a port owned by a previous tracked DevGateway process, it stops that process and starts fresh. If the port belongs to an unknown process, the launcher refuses to kill it and reports the conflict.

## Validation

Run the standard local gate before handing off changes:

```bash
pnpm workspace:validate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:check
pnpm registry:validate
pnpm policy:validate
pnpm eval:smoke
```
