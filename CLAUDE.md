# Ruilify

Ferramenta para gerenciar infraestrutura de deploy: criar droplets no Digital Ocean, configurar servidores com Docker/Tailscale/Caddy, e fazer deploy de aplicacoes.

## Uso

```bash
# TUI (interface principal)
bun run tui
# ou
cd src/tui && bun index.tsx

# CLI legada
bun src/cli.ts
```

## Arquitetura

```
Seu Mac (Controller)
    |
    ├── TUI (src/tui/) ou CLI (src/cli.ts)
    ├── SQLite local (data/deployments.db)
    |
    └── Controla via SSH/Tailscale:
        |
        ├── Build Server - Docker + Registry + Git
        ├── Gateway Server - Caddy (reverse proxy publico)
        └── Worker Servers - Docker (apps)
```

## Estrutura do Projeto

```
src/
├── cli.ts              # CLI interativa (inquirer) - legada
├── lib/
│   ├── digitalocean.ts # API DO (droplets, SSH keys, billing)
│   ├── cloudflare.ts   # API CF (DNS)
│   ├── ssh.ts          # Comandos SSH
│   ├── db.ts           # SQLite (projects, servers, deployments)
│   ├── setup.ts        # Setup de servidores (Docker, Tailscale, Caddy)
│   ├── server-info.ts  # Info detalhada do servidor via SSH
│   ├── caddy.ts        # Gerenciamento do Caddy (reverse proxy)
│   ├── deploy.ts       # Deploy blue-green
│   ├── build.ts        # Build no build server
│   ├── registry.ts     # Docker Registry privado
│   ├── github.ts       # Clone, pull, deploy keys
│   ├── services.ts     # Catalogo de servicos
│   └── log.ts          # Logging colorido
└── tui/
    ├── index.tsx       # Entry point
    ├── App.tsx         # Layout principal
    ├── components/     # Sidebar, List, ActionBar, Modal, Spinner
    ├── screens/        # Servers, Projects, Deployments, Cloudflare, DigitalOcean, Logs, Settings
    ├── hooks/          # useServers, useProjects, useDeployments
    └── utils/          # theme, format, logger

scripts/
├── setup-build-server.ts   # Configura build server
├── setup-gateway-server.ts # Configura gateway server
├── setup-target-server.ts  # Configura worker server

data/
└── deployments.db      # SQLite local

# Docker Composes por servico (templates)
outline/
glitchtip/
n8n/
plausible/
...
```

## TUI

Interface principal em React/Ink. Telas:

- **Servers**: Lista servidores, Setup (criar droplet DO ou SSH manual), Add, Edit, Delete, Detalhes
- **Projects**: Lista projetos, Add, Edit, Delete, Deploy, Rollback
- **Deployments**: Historico de deploys, View logs
- **Cloudflare**: Zones e DNS records
- **DigitalOcean**: Droplets, SSH Keys
- **Logs**: View/filter/clear logs (data/tui.log)
- **Settings**: Configuracoes

### Atalhos

| Tecla         | Acao                             |
| ------------- | -------------------------------- |
| Tab/Shift+Tab | Navegar entre sidebar e conteudo |
| j/k ou setas  | Navegar na lista                 |
| Enter         | Ver detalhes / Confirmar         |
| a             | Add                              |
| e             | Edit                             |
| d             | Delete                           |
| S             | Setup (em Servers)               |
| Esc           | Voltar                           |
| q             | Sair                             |

## Tipos de Servidor

| Tipo        | Descricao             | Componentes                      |
| ----------- | --------------------- | -------------------------------- |
| **Gateway** | Reverse proxy publico | Caddy, Tailscale                 |
| **Build**   | Builds e registry     | Docker, Registry, Git, Tailscale |
| **Worker**  | Roda aplicacoes       | Docker, Tailscale                |

## Deploy Pipeline

### Compose Only (postgres, redis, apps pre-built)

1. **Worker Server**: git clone → write .env → docker compose up
2. **Gateway Server**: Atualiza Caddy (se tiver domain)

### Compose + Build (apps custom)

1. **Build Server**: git clone → build.sh → docker build → push registry
2. **Worker Server**: git clone → update image ref → docker compose up
3. **Gateway Server**: Atualiza Caddy

## Worker Server Structure

```
/opt/ruilify/
├── apps/
│   └── {projeto}/
│       ├── docker-compose.yml
│       ├── .env
│       └── data/           # volumes
└── backup-service/
    ├── docker-compose.yml
    ├── config.yml
    └── logs/
```

## Project Schema

```typescript
interface Project {
  id: string;
  name: string;

  // Git
  repo_url: string;
  branch: string;
  compose_path: string; // path to docker-compose.yml in repo

  // Build (optional)
  has_build: boolean;
  build_script: string; // path to build.sh
  build_service: string; // which service gets built image

  // Deploy
  worker_server_id: string;

  // Routing
  domain: string | null;
  port: number;

  // Port mappings (override defaults)
  port_mappings: Record<string, { internal: number; external: number }>;

  // Config
  env_vars: Record<string, string>;

  // State
  status: "pending" | "deploying" | "running" | "failed" | "stopped";
  current_commit: string | null;
}
```

## src/lib/

### `digitalocean.ts`

- Listar/criar/deletar droplets
- Gerenciar SSH keys
- Billing e account info

### `cloudflare.ts`

- Listar zones (dominios)
- CRUD de DNS records

### `ssh.ts`

- `ssh(host, command)` - executa comando remoto
- `testConnection(host)` - testa conectividade
- `getServerInfo(host)` - info basica do servidor

### `db.ts`

SQLite local:

- **Servers**: nome, IP Tailscale, IP publico, role
- **Projects**: nome, repo, branch, server, domain, env vars
- **Deployments**: historico, status, logs

### `setup.ts`

Setup de servidores via SSH:

- `setupGatewayServer()` - Docker, Tailscale, Caddy
- `setupBuildServer()` - Docker, Registry, Git
- `setupWorkerServer()` - Docker, Tailscale

### `server-info.ts`

Info detalhada do servidor:

- `getServerDetails()` - hostname, OS, memory, disk, Docker, Tailscale, Caddy
- `checkUpdates()` - apt updates disponiveis
- `applyUpdates()` - instalar updates
- `checkConnectivity()` - teste rapido de SSH

### `caddy.ts`

Gerenciamento do Caddy:

- Adicionar/remover rotas
- Reload config

### `deploy.ts`

Deploy blue-green:

- `fullDeploy()` - build + deploy
- `runDeploy()` - apenas deploy
- `rollback()` - voltar versao

---

# Bun

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` for HTTP servers. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.spawn()` for subprocesses. Don't use `execa`.
- `Bun.file()` for file I/O. Prefer over `node:fs`.
