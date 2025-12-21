# Ruilify

Ferramenta de infraestrutura para deploy de aplicações. Gerencia servidores, faz deploy de containers, configura DNS e SSL automaticamente.

## O que é

Ruilify é uma alternativa simples ao Coolify/Dokku/Heroku para quem quer controle total da infraestrutura. Roda no seu Mac e controla servidores remotos via SSH através de uma rede Tailscale privada.

**Características:**
- TUI (Terminal User Interface) em React/Ink
- Deploy de docker-compose com um comando
- SSL automático via Caddy + Let's Encrypt
- DNS automático via Cloudflare API
- Rede privada via Tailscale (servidores não precisam de IP público)
- GitHub SSH keys automáticas por servidor

## Requisitos

- [Bun](https://bun.sh) >= 1.0
- [Tailscale](https://tailscale.com) instalado no seu Mac
- Conta no [Digital Ocean](https://digitalocean.com) (ou qualquer VPS com SSH)
- Conta no [Cloudflare](https://cloudflare.com) (opcional, para DNS automático)
- Conta no [GitHub](https://github.com) com Personal Access Token

## Instalação

```bash
git clone <repo-url>
cd ruilify
bun install
cp .env.example .env
# Editar .env com suas credenciais
```

## Uso

```bash
# Interface principal (TUI)
bun run tui

# Ou diretamente
cd src/tui && bun index.tsx
```

## Arquitetura

```
Seu Mac (Controller)
    │
    ├── TUI (React/Ink)
    ├── SQLite local (data/deployments.db)
    │
    └── Controla via SSH + Tailscale:
        │
        ├── Gateway Server (1x)
        │   └── Caddy reverse proxy
        │   └── IP público (recebe tráfego HTTPS)
        │
        └── Worker Servers (N)
            └── Docker containers
            └── Apps rodando
            └── Acessíveis só via Tailscale
```

## Tipos de Servidor

### Gateway Server
- **Função**: Reverse proxy público, recebe tráfego HTTPS
- **Componentes**: Caddy, Tailscale
- **Setup instala**: Docker, Tailscale, Caddy
- **IP**: Precisa de IP público (é o único exposto à internet)

### Worker Server
- **Função**: Roda as aplicações (containers Docker)
- **Componentes**: Docker, Tailscale
- **Setup instala**: Docker, Tailscale, conecta ao GitHub
- **IP**: Só precisa de IP Tailscale (privado)

### Build Server (opcional)
- **Função**: Build de imagens Docker, registry privado
- **Componentes**: Docker, Registry, Git, Tailscale
- **Quando usar**: Apps que precisam de build (não usam imagens prontas)

## Fluxo de Deploy

### 1. Setup Inicial (uma vez)

```
TUI → Servers → Setup → Gateway Server
  1. Cria droplet no Digital Ocean (ou usa existente)
  2. Instala Docker + Tailscale + Caddy
  3. Registra no banco local

TUI → Servers → Setup → Worker Server
  1. Cria droplet no Digital Ocean (ou usa existente)
  2. Instala Docker + Tailscale
  3. Conecta ao GitHub (gera SSH key, registra no GitHub)
  4. Registra no banco local
```

### 2. Deploy de Projeto

```
TUI → Projects → Add
  1. Seleciona repo do GitHub
  2. Define branch, compose path, porta
  3. Define domínio (opcional)
  4. Define variáveis de ambiente

TUI → Projects → Deploy
  1. Git clone no worker server (via SSH)
  2. Escreve .env com variáveis
  3. docker compose up -d
  4. Se tem domínio:
     - Cria DNS A record no Cloudflare → IP do gateway
     - Atualiza Caddyfile no gateway → proxy para worker:porta
  5. SSL gerado automaticamente pelo Caddy
```

### 3. Resultado

```
Internet
    │
    ▼
Gateway (Caddy) ──HTTPS──► db.ruivalim.com.br
    │
    │ (Tailscale - rede privada)
    ▼
Worker Server
    │
    ▼
Container (porta 8978)
```

## TUI - Telas

| Tela | Função |
|------|--------|
| **Servers** | Listar, adicionar, setup, deletar servidores |
| **Projects** | Listar, adicionar, deploy, deletar projetos |
| **Deployments** | Histórico de deploys |
| **Cloudflare** | Gerenciar DNS records |
| **DigitalOcean** | Gerenciar droplets e SSH keys |
| **Logs** | Ver logs do sistema |
| **Settings** | Configurações |

### Atalhos

| Tecla | Ação |
|-------|------|
| `Tab` | Navegar entre painéis |
| `j/k` ou setas | Navegar na lista |
| `Enter` | Selecionar / Ver detalhes |
| `a` | Adicionar |
| `e` | Editar |
| `d` | Deletar |
| `S` | Setup (em Servers) |
| `G` | GitHub key (em Server details) |
| `Esc` | Voltar |
| `q` | Sair |

## Server Details

Ao selecionar um servidor e pressionar Enter:

```
app-server-1 - Worker Server

Network                         Services
  Tailscale IP: 100.114.58.48     ● Docker 24.0.7 (5 containers)
  Public IP: 147.182.235.164      ● Tailscale 1.56.0
  Magic DNS: app-server-1...      ● GitHub connected

System                          Resources
  Hostname: app-server-1          Memory: 1.2G/4G [████░░░░] 30%
  OS: Ubuntu 24.04                Disk: 12G/80G  [██░░░░░░] 15%

[r] Refresh  [u] Check updates  [U] Apply updates  [G] GitHub  [Esc] Back
```

## Delete Server

Ao deletar um servidor, opções disponíveis:

- **Delete droplet from Digital Ocean** - Remove a VM
- **Delete DNS records from Cloudflare** - Remove DNS dos projetos
- **Delete GitHub SSH key** - Remove a chave do GitHub
- **Delete projects** - Remove projetos associados (sempre)

## Estrutura no Worker Server

```
/opt/ruilify/
├── apps/
│   ├── cloudbeaver/
│   │   ├── docker-compose.yml
│   │   ├── .env
│   │   └── data/
│   └── postgres-test/
│       ├── docker-compose.yml
│       ├── .env
│       └── data/
```

## Templates Inclusos

Docker-compose prontos para deploy:

| Serviço | Porta | Descrição |
|---------|-------|-----------|
| Cloudbeaver | 8978 | Database admin UI |
| PostgreSQL | 5432 | Database |
| n8n | 5678 | Workflow automation |
| Outline | 3000 | Wiki |
| Plausible | 8000 | Analytics |
| Uptime Kuma | 3001 | Monitoring |
| Redis | 6379 | Cache |

## Variáveis de Ambiente

Ver `.env.example` para todas as variáveis necessárias:

- `DIGITALOCEAN_TOKEN` - API do Digital Ocean
- `CLOUDFLARE_API_TOKEN` - API do Cloudflare (DNS)
- `GITHUB_TOKEN` - Personal Access Token (SSH keys)
- `TAILSCALE_AUTH_KEY` - Para setup automático de servidores
- `TAILSCALE_API_KEY` - Para gerenciar devices (futuro)

## License

MIT
