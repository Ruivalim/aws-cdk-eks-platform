# Ruilify

Ferramenta de infraestrutura para deploy de aplicações via TUI. Controla servidores remotos via SSH/Tailscale.

## Comandos

```bash
bun run tui          # Interface principal
cd src/tui && bun index.tsx  # Alternativo
```

## Arquitetura

```
Mac (Controller) ─── SSH/Tailscale ───┬── Gateway Server (Caddy, IP público)
       │                              ├── Worker Servers (Docker, apps)
       │                              └── Build Server (Docker, Registry)
       │
       ├── TUI (src/tui/) - React/Ink
       ├── SQLite (data/deployments.db)
       └── Logs (logs/tui.log)
```

## Estrutura

```
src/
├── lib/                    # Core libraries
│   ├── db.ts               # SQLite - servers, projects, deployments
│   ├── ssh.ts              # SSH commands via Bun.spawn
│   ├── setup.ts            # Server setup (Docker, Tailscale, Caddy)
│   ├── compose.ts          # Deploy docker-compose projects
│   ├── caddy.ts            # Caddy management + domain setup
│   ├── github.ts           # GitHub API (SSH keys, repos)
│   ├── cloudflare.ts       # Cloudflare API (DNS)
│   ├── digitalocean.ts     # DO API (droplets, SSH keys)
│   ├── server-info.ts      # Server details via SSH
│   └── log.ts              # Console logging
│
└── tui/
    ├── index.tsx           # Entry point
    ├── App.tsx             # Layout (sidebar + content)
    ├── components/         # UI components
    │   ├── List.tsx        # Generic list with selection
    │   ├── Modal.tsx       # Confirm dialogs (Y/N)
    │   ├── ActionBar.tsx   # Bottom action hints
    │   └── Spinner.tsx     # Loading indicator
    ├── screens/            # Main screens
    │   ├── Servers.tsx     # Server management + setup + GitHub keys
    │   ├── Projects.tsx    # Project management + deploy
    │   ├── Cloudflare.tsx  # DNS management
    │   ├── DigitalOcean.tsx # Droplet management
    │   └── Logs.tsx        # View logs
    ├── hooks/              # React hooks for data
    │   ├── useServers.ts
    │   └── useProjects.ts
    └── utils/
        ├── logger.ts       # File logger (logs/tui.log)
        └── theme.ts        # Colors

scripts/                    # Setup scripts (used by TUI)
├── setup-gateway-server.ts
├── setup-build-server.ts
└── setup-target-server.ts

# Docker compose templates
cloudbeaver/
postgres/
n8n/
outline/
...
```

## Tipos de Servidor

| Tipo | Setup Instala | Função |
|------|---------------|--------|
| Gateway | Docker, Tailscale, Caddy | Reverse proxy, SSL, IP público |
| Worker | Docker, Tailscale | Roda containers, IP privado |
| Build | Docker, Registry, Git, Tailscale | Build images (opcional) |

## Deploy Flow

### Compose Deploy (src/lib/compose.ts)

```
1. SSH para worker server
2. mkdir /opt/ruilify/apps/{project}
3. git clone (SSH URL) ou git pull
4. Escreve .env com variáveis
5. Copia docker-compose.yml do repo
6. docker compose up -d
7. Verifica containers running
8. Se tem domain:
   - Cloudflare: cria/atualiza A record → gateway IP
   - Caddy: atualiza Caddyfile no gateway
   - Reload Caddy
```

### Domain Setup (src/lib/caddy.ts)

```typescript
setupProjectDomain(projectId)
  1. Pega project do DB
  2. Pega gateway server do DB
  3. Cloudflare: cria A record (domain → gateway public IP)
  4. Caddy: syncRoutes() - gera Caddyfile de todos os projects
  5. SSH gateway: escreve /etc/caddy/Caddyfile
  6. SSH gateway: systemctl reload caddy
```

## GitHub SSH Keys

```typescript
// Conectar servidor ao GitHub
connectServerToGitHub(host, serverName)
  1. Gera SSH key no servidor (ssh-keygen)
  2. Remove key antiga do GitHub se existir
  3. Adiciona nova key via GitHub API
  4. Testa conexão (ssh -T git@github.com)

// Key naming: ruilify-{server-name}
```

## Delete Server Flow

```typescript
executeDelete()
  1. Delete GitHub SSH key (se marcado)
  2. Delete DNS records no Cloudflare (se marcado)
  3. Delete todos os projects do servidor
  4. Delete droplet no DO (se marcado)
  5. Delete server do DB local
```

## Database Schema (src/lib/db.ts)

```typescript
Server {
  id, name, tailscale_ip, public_ip, role, status
}

Project {
  id, name, repo_url, repo_branch, compose_path,
  target_server, domain, port, env_vars, status
}

Deployment {
  id, project_id, commit, status, started_at, finished_at
}
```

## Bun

Use Bun APIs, não Node.js:

```typescript
// SSH
Bun.spawn(["ssh", host, command])

// SQLite
import { Database } from "bun:sqlite"

// File I/O
Bun.file(path).text()
Bun.write(path, content)

// HTTP
fetch() // já builtin

// .env
process.env.VAR // Bun carrega .env automaticamente
```

## Worker Server Structure

```
/opt/ruilify/
├── apps/
│   └── {project}/
│       ├── docker-compose.yml
│       ├── .env
│       └── data/  # volumes
```

## Caddyfile (Gateway)

```caddyfile
{
  email admin@example.com
}

db.ruivalim.com.br {
  reverse_proxy 100.114.58.48:8978
}

api.example.com {
  reverse_proxy 100.114.58.48:3000
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/compose.ts` | Deploy docker-compose projects |
| `src/lib/caddy.ts` | Caddy + Cloudflare domain setup |
| `src/lib/github.ts` | GitHub API (SSH keys, repos) |
| `src/lib/setup.ts` | Server setup scripts |
| `src/tui/screens/Servers.tsx` | Server management UI |
| `src/tui/screens/Projects.tsx` | Project management UI |
| `docs/tui-updates.md` | Pending features |
