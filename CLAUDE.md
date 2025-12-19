# Coolify Infrastructure

Tooling para gerenciar infraestrutura Coolify: criar droplets no Digital Ocean, configurar servidores com Docker/Tailscale/iptables, provisionar databases e fazer deploy de serviços.

## Uso

```bash
# CLI interativa
bun src/cli.ts

# Web dashboard (http://localhost:3456)
bun run web
```

## Estrutura do Projeto

```
src/
├── cli.ts              # CLI interativa principal
├── lib/
│   ├── digitalocean.ts # Cliente API Digital Ocean (droplets, SSH keys, billing)
│   ├── ssh.ts          # Utilitários SSH (executar comandos, info do servidor, containers)
│   ├── services.ts     # Catálogo de serviços (Outline, n8n, Glitchtip, etc.)
│   └── log.ts          # Funções de logging colorido com chalk
└── web/
    ├── server.ts       # Servidor Bun com API REST completa
    ├── frontend.tsx    # Dashboard React (SPA com todas as páginas)
    ├── index.html      # Entry point HTML
    └── styles.css      # Estilos do dashboard

# Scripts standalone (rodam via CLI ou diretamente)
setup-coolify-master.ts    # Configura servidor master com Docker, Tailscale, iptables
setup-coolify-adjacent.ts  # Configura servidor child para cluster
setup-databases.ts         # Cria databases/users no Postgres central

# Docker Composes por serviço
outline/
hoppscotch/
glitchtip/
soketi/
n8n/
plausible/
umami/
calcom/
typebot/
minio/
uptime-kuma/
backrest/
cloudbeaver/
redis-insight/
nitropage/
```

## src/lib/

### `digitalocean.ts`
Cliente para API Digital Ocean. Funções para:
- Listar/criar/deletar droplets
- Gerenciar SSH keys
- Obter billing e account info
- Presets de regions, sizes e images
- **DNS**: listar/criar/deletar domínios e records (A, AAAA, CNAME, MX, TXT, NS, SRV, CAA)

### `ssh.ts`
Utilitários para executar comandos via SSH:
- `ssh(host, command)` - executa comando e retorna stdout/stderr/exitCode
- `getServerInfo(host)` - retorna info do servidor (OS, memory, disk, Docker, Tailscale)
- `getDockerContainers(host)` - lista containers rodando

### `services.ts`
Catálogo de serviços disponíveis com metadata:
- Quais precisam de Postgres/Redis
- Redis DB number reservado
- Portas expostas
- Links para docs

### `log.ts`
Funções de logging colorido: `log.info()`, `log.success()`, `log.error()`, etc.

## src/web/

### `server.ts`
Servidor Bun.serve() com API REST:
- `/api/do/*` - Digital Ocean (droplets, SSH keys, billing)
- `/api/do/domains/*` - DNS (domínios e records)
- `/api/servers/:host/*` - Status e containers via SSH
- `/api/databases` - Listar/criar databases no Postgres central
- `/api/tailscale/status` - Status da rede Tailscale
- `/api/local/ssh-config` - Gerenciar ~/.ssh/config local
- `/api/provision/full-setup-stream` - Setup completo com SSE

### `frontend.tsx`
Dashboard React com páginas:
- Overview (billing, droplets summary)
- Droplets (criar, deletar, reboot)
- DNS (domínios e records - A, CNAME, MX, TXT, etc.)
- Setup (configurar novo servidor para cluster)
- Tailscale (peers online, IPs)
- Databases (listar, criar, connection strings)
- SSH Config (gerenciar ~/.ssh/config)
- Services (catálogo disponível)

## Servidor Principal (coolify-master)

- **SSH**: `ssh coolify-master`
- **Tailscale IP**: `100.77.201.55`

### Bancos Centrais

| Serviço  | Container                  | Porta |
| -------- | -------------------------- | ----- |
| Postgres | `hwcwo0ckc08k00g40socsc48` | 5432  |
| Redis    | `sg8oc044koow0ckwkggwc844` | 6379  |

### Redis DBs Reservados

| DB   | Serviço   |
| ---- | --------- |
| 0    | Outline   |
| 1    | Glitchtip |
| 2    | Soketi    |
| 3    | n8n       |
| 4-15 | Livres    |

## Conexão aos Bancos

```env
# Mesmo servidor (rede Docker)
DATABASE_URL=postgres://USER:PASS@hwcwo0ckc08k00g40socsc48:5432/DATABASE
REDIS_URL=redis://sg8oc044koow0ckwkggwc844:6379/0

# Outro servidor (via Tailscale)
DATABASE_URL=postgres://USER:PASS@100.77.201.55:5432/DATABASE
REDIS_URL=redis://100.77.201.55:6379/0
```

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
