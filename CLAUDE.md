# Coolify Infrastructure

Este repositório contém configurações e scripts para gerenciar a infraestrutura Coolify.

## Servidor Principal (doserver)

- **SSH**: `ssh doserver`
- **Tailscale IP**: `100.77.201.55`
- **OS**: Ubuntu 25.04
- **Recursos**: 4GB RAM, 77GB disco

### Containers de Infraestrutura Coolify

| Container | Imagem | IP Interno |
|-----------|--------|------------|
| coolify | ghcr.io/coollabsio/coolify:4.0.0-beta.454 | 10.0.1.10 |
| coolify-db | postgres:15-alpine | 10.0.1.7 |
| coolify-redis | redis:7-alpine | 10.0.1.5 |
| coolify-proxy | traefik:v3.6 | 10.0.1.11 |
| coolify-realtime | ghcr.io/coollabsio/coolify-realtime:1.0.10 | 10.0.1.2 |
| coolify-sentinel | ghcr.io/coollabsio/sentinel:0.0.18 | - |

### Bancos Centrais (para apps)

| Serviço | Container | IP Interno | Porta |
|---------|-----------|------------|-------|
| **Postgres** | `hwcwo0ckc08k00g40socsc48` | 10.0.1.9 | 5432 |
| **Redis** | `sg8oc044koow0ckwkggwc844` | 10.0.1.3 | 6379 |
| pgAdmin | `pgadmin-k8cok4sww8c8oo4kwg0cwgwg` | 10.0.1.6 | - |

**Postgres Central:**
- User: `postgres`
- Databases existentes: `financas`, `finance`, `gestao_extraordinario`, `logto`

**Redis Central:**
- DB 0: em uso (115 keys)
- DBs 1-15: disponíveis para novos serviços

### IMPORTANTE: Expor Portas para Multi-Servidor

Por padrão, Postgres e Redis **não estão expostos** na porta do host (só acessíveis dentro da rede Docker).

Para permitir acesso de servidores child via Tailscale, você precisa expor as portas no Coolify:

1. **No Coolify Dashboard**: Vá em cada serviço (Postgres/Redis)
2. **Aba "Network"**: Adicione port mapping `5432:5432` (Postgres) ou `6379:6379` (Redis)
3. **Ou via docker-compose**: Adicione na seção `ports:`

```yaml
ports:
  - "5432:5432"  # Expõe para o host
```

Sem isso, conexões via `100.77.201.55:5432` não funcionarão!

### Rede Docker

Todos os containers estão na rede `coolify` (10.0.1.0/24). Serviços podem se conectar usando:
- Nome do container como hostname (ex: `hwcwo0ckc08k00g40socsc48`)
- IP interno (ex: `10.0.1.9`)

## Scripts de Setup

| Script | Descrição |
|--------|-----------|
| `bun setup-coolify-master.ts` | Configura servidor master Coolify com Docker, Tailscale, iptables |
| `bun setup-coolify-adjacent.ts` | Configura servidor adicional para cluster Coolify |
| `bun setup-databases.ts` | Cria databases/users no Postgres central para novos serviços |

## Docker Composes

Cada pasta contém:
- `docker-compose.yml` - versão standalone (com Postgres/Redis próprios)
- `docker-compose.adjacent.yml` - versão para usar bancos centrais

### Serviços Disponíveis

| Serviço | Usa Postgres | Usa Redis | Pasta |
|---------|-------------|-----------|-------|
| Outline (Wiki) | Sim | Sim (DB 0) | `outline/` |
| Hoppscotch (API Testing) | Sim | Não | `hoppscotch/` |
| Glitchtip (Error Tracking) | Sim | Sim (DB 1) | `glitchtip/` |
| Soketi (WebSocket) | Não | Sim (DB 2) | `soketi/` |
| n8n (Automation) | Sim | Sim (DB 3) | `n8n/` |
| Plausible (Analytics) | Sim | Não* | `plausible/` |
| Umami (Simple Analytics) | Sim | Não | `umami/` |
| Cal.com (Scheduling) | Sim | Não | `calcom/` |
| Typebot (Chatbot) | Sim | Não | `typebot/` |
| MinIO (S3 Storage) | Não | Não | `minio/` |
| Uptime Kuma (Monitoring) | Não | Não | `uptime-kuma/` |
| Backrest (Backup) | Não | Não | `backrest/` |
| CloudBeaver (DB Admin) | Não | Não | `cloudbeaver/` |
| Redis Insight | Não | Não | `redis-insight/` |
| Nitropage (CMS) | SQLite | Não | `nitropage/` |

*Plausible precisa de ClickHouse local para eventos

## Conexão aos Bancos Centrais

Para serviços na rede `coolify`:

```env
# Postgres
DATABASE_URL=postgres://USER:PASS@hwcwo0ckc08k00g40socsc48:5432/DATABASE

# Redis
REDIS_URL=redis://sg8oc044koow0ckwkggwc844:6379/DB_NUMBER
```

Para serviços em outros servidores (via Tailscale):

```env
# Postgres
DATABASE_URL=postgres://USER:PASS@100.77.201.55:5432/DATABASE

# Redis
REDIS_URL=redis://100.77.201.55:6379/DB_NUMBER
```

## Multi-Servidor (Cluster)

### Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                    Tailscale Network                        │
│                                                             │
│  ┌─────────────────────┐      ┌─────────────────────┐      │
│  │   doserver (master) │      │  doserver-child-1   │      │
│  │   100.77.201.55     │◄────►│   100.x.x.x         │      │
│  │                     │      │                     │      │
│  │  ┌───────────────┐  │      │  ┌───────────────┐  │      │
│  │  │ Postgres      │  │      │  │ App (ex:      │  │      │
│  │  │ Redis         │◄─┼──────┼──┤ Outline)      │  │      │
│  │  │ Coolify       │  │      │  │               │  │      │
│  │  └───────────────┘  │      │  └───────────────┘  │      │
│  └─────────────────────┘      └─────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### Diferença de Conexão

| Cenário | Hostname | Exemplo |
|---------|----------|---------|
| Mesmo servidor (doserver) | Nome do container | `hwcwo0ckc08k00g40socsc48:5432` |
| Outro servidor (child) | IP Tailscale | `100.77.201.55:5432` |

### Arquivos de Configuração

Cada serviço tem:
- `.env.child-1` - configuração para rodar em servidor secundário (usa IP Tailscale)
- `docker-compose.adjacent.yml` - compose que usa bancos centrais

### Setup de Servidor Child

```bash
# 1. Configurar o novo servidor
bun setup-coolify-adjacent.ts --ssh-host root@IP_NOVO_SERVIDOR

# 2. Criar databases necessários (roda no master)
bun setup-databases.ts --ssh-host doserver

# 3. No Coolify, adicionar o novo servidor usando IP Tailscale

# 4. Deploy do app no servidor child usando .env.child-1
```

### Redis DBs Reservados

| DB | Serviço |
|----|---------|
| 0 | Outline / Apps gerais |
| 1 | Glitchtip |
| 2 | Soketi |
| 3 | n8n |
| 4-15 | Disponíveis |

---

# Bun

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";

// import .css files directly and it works
import './index.css';

import { createRoot } from "react-dom/client";

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.md`.
