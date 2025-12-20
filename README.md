# Coolify Infrastructure

Ferramenta para gerenciar infraestrutura Coolify: criar e gerenciar droplets no Digital Ocean, configurar servidores com Docker/Tailscale/iptables, provisionar databases e gerenciar DNS.

## Funcionalidades

- **Digital Ocean**: Criar/deletar droplets, gerenciar SSH keys, billing, DNS
- **Servidores**: Setup automatizado de servidores para cluster Coolify (Docker, Tailscale, iptables)
- **Databases**: Criar databases e users no Postgres central
- **DNS**: Gerenciar domínios e records (A, AAAA, CNAME, MX, TXT, NS, SRV, CAA)
- **Tailscale**: Visualizar peers e status da rede
- **SSH Config**: Gerenciar arquivo `~/.ssh/config` local

## Requisitos

- [Bun](https://bun.sh) >= 1.0
- Conta no [Digital Ocean](https://digitalocean.com) com API token
- SSH configurado para acessar servidores remotos (opcional)
- [Tailscale](https://tailscale.com) instalado localmente (opcional, para página Tailscale)

## Instalacao

```bash
# Clonar repositorio
git clone <repo-url>
cd coolify-infra

# Instalar dependencias
bun install

# Configurar variaveis de ambiente
cp .env.example .env
# Editar .env com suas credenciais
```

## Variaveis de Ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
# [OBRIGATORIO] Token da API Digital Ocean
# Obter em: https://cloud.digitalocean.com/account/api/tokens
DIGITALOCEAN_TOKEN=dop_v1_xxxxxxxxxxxxxxxxxxxxxxxx

# [OPCIONAL] URLs de conexao Postgres (separadas por virgula)
# Usado para listar/criar databases na pagina Databases
POSTGRES_URLS=postgresql://user:pass@host:5432/postgres

# Alternativa para token DO
DO_TOKEN=dop_v1_xxxxxxxxxxxxxxxxxxxxxxxx
```

### Onde obter o token Digital Ocean

1. Acesse [Digital Ocean API Tokens](https://cloud.digitalocean.com/account/api/tokens)
2. Clique em "Generate New Token"
3. De um nome (ex: "coolify-infra")
4. Selecione "Read" e "Write" scopes
5. Copie o token gerado

## Uso

### CLI Interativa

```bash
bun src/cli.ts
# ou
bun run run
```

Menu principal:
- **Digital Ocean**: Droplets, DNS, SSH Keys, Billing
- **Servers**: Status, Setup Master/Adjacent, Containers
- **Databases**: Provisionar databases no Postgres central
- **Services**: Catalogo de servicos disponiveis
- **Web Dashboard**: Abrir interface web

### Web Dashboard

```bash
bun run web
# ou
bun src/web/server.ts
```

Acesse: http://localhost:3456

Paginas disponiveis:
- **Overview**: Resumo de billing e droplets
- **Droplets**: Criar, deletar, reboot droplets
- **DNS**: Gerenciar dominios e records
- **Setup**: Configurar novos servidores para cluster
- **Tailscale**: Ver peers online e IPs
- **Databases**: Listar e criar databases
- **SSH Config**: Gerenciar ~/.ssh/config
- **Services**: Catalogo de servicos

## Scripts de Setup

### Setup Master (servidor principal Coolify)

```bash
bun setup-coolify-master.ts
```

Configura:
- Docker
- Tailscale
- iptables (bloqueia acesso direto, permite apenas via Tailscale)
- Coolify

### Setup Adjacent (servidor adicional)

```bash
bun setup-coolify-adjacent.ts
```

Configura servidor child para cluster Coolify.

### Setup Databases

```bash
bun setup-databases.ts
```

Cria databases e users no Postgres central.

## Apps Disponiveis

Cada pasta contem um `docker-compose.yml` pronto para deploy no Coolify.

### Produtividade

| App | Descricao | Porta | Docs |
|-----|-----------|-------|------|
| **outline/** | Wiki colaborativa para times | 3000 | [docs](https://docs.getoutline.com/) |
| **n8n/** | Automacao de workflows (Zapier alternativo) | 5678 | [docs](https://docs.n8n.io/) |
| **typebot/** | Construtor de chatbots | 3000, 3001 | [docs](https://docs.typebot.io/) |
| **hoppscotch/** | API testing (Postman alternativo) | 3000, 3100, 3170 | [docs](https://docs.hoppscotch.io/) |

### Analytics & Monitoring

| App | Descricao | Porta | Docs |
|-----|-----------|-------|------|
| **plausible/** | Analytics privacy-friendly | 8000 | [docs](https://plausible.io/docs) |
| **umami/** | Analytics simples e leve | 3000 | [docs](https://umami.is/docs) |
| **glitchtip/** | Error tracking (Sentry alternativo) | 8000 | [docs](https://glitchtip.com/documentation) |
| **uptime-kuma/** | Monitoramento de uptime | 3001 | [docs](https://github.com/louislam/uptime-kuma) |

### Infraestrutura

| App | Descricao | Porta | Docs |
|-----|-----------|-------|------|
| **soketi/** | WebSocket server (Pusher compativel) | 6001 | [docs](https://docs.soketi.app/) |
| **redis/** | Redis compartilhado | 6379 | [docs](https://redis.io/) |
| **registry/** | Docker registry privado | 5000 | [docs](https://docs.docker.com/registry/) |

### Database Admin

| App | Descricao | Porta | Docs |
|-----|-----------|-------|------|
| **cloudbeaver/** | Admin de databases (pgAdmin alternativo) | 8978 | [docs](https://github.com/dbeaver/cloudbeaver) |
| **redis-insight/** | GUI para Redis | 5540 | [docs](https://redis.io/docs/connect/insight/) |

### Backup

| App | Descricao | Porta | Docs |
|-----|-----------|-------|------|
| **backrest/** | UI para backups com Restic | 9898 | [docs](https://github.com/garethgeorge/backrest) |
| **backups/** | Backup automatico para S3 | - | [docs](https://github.com/offen/docker-volume-backup) |

### CMS

| App | Descricao | Porta | Docs |
|-----|-----------|-------|------|
| **nitropage/** | CMS simples para landing pages | 3000 | [docs](https://nitropage.com/docs) |

---

### Variantes de Configuracao

Alguns apps tem multiplos arquivos:

- `docker-compose.yml` - Standalone (Postgres/Redis proprios)
- `docker-compose.adjacent.yml` - Usa bancos centrais compartilhados
- `.env.child-1` - Env para rodar em servidor secundario (via Tailscale)

### Deploy no Coolify

1. No Coolify, crie um novo servico "Docker Compose"
2. Cole o conteudo do `docker-compose.yml` desejado
3. Configure as variaveis de ambiente
4. Deploy!

### Variaveis de Ambiente por App

<details>
<summary><strong>outline/</strong></summary>

```env
SECRET_KEY=           # openssl rand -hex 32
UTILS_SECRET=         # openssl rand -hex 32
POSTGRES_PASSWORD=    # senha do postgres
OUTLINE_URL=          # https://wiki.example.com
```
</details>

<details>
<summary><strong>n8n/</strong></summary>

```env
POSTGRES_PASSWORD=    # senha do postgres
N8N_ENCRYPTION_KEY=   # openssl rand -hex 32
N8N_HOST=             # n8n.example.com
WEBHOOK_URL=          # https://n8n.example.com
```
</details>

<details>
<summary><strong>glitchtip/</strong></summary>

```env
POSTGRES_PASSWORD=    # senha do postgres
SECRET_KEY=           # openssl rand -hex 32
GLITCHTIP_DOMAIN=     # https://errors.example.com
EMAIL_URL=            # smtp://user:pass@smtp.example.com:587 (opcional)
```
</details>

<details>
<summary><strong>hoppscotch/</strong></summary>

```env
POSTGRES_PASSWORD=    # senha do postgres
JWT_SECRET=           # openssl rand -hex 32
SESSION_SECRET=       # openssl rand -hex 32
APP_URL=              # https://api.example.com
ADMIN_URL=            # https://api-admin.example.com
BACKEND_URL=          # https://api-backend.example.com
BACKEND_WS_URL=       # wss://api-backend.example.com
```
</details>

<details>
<summary><strong>plausible/</strong></summary>

```env
POSTGRES_PASSWORD=    # senha do postgres
SECRET_KEY_BASE=      # openssl rand -hex 64
TOTP_VAULT_KEY=       # openssl rand -base64 32
BASE_URL=             # https://analytics.example.com
```
</details>

<details>
<summary><strong>umami/</strong></summary>

```env
POSTGRES_PASSWORD=    # senha do postgres
APP_SECRET=           # openssl rand -hex 32
```
</details>

<details>
<summary><strong>typebot/</strong></summary>

```env
POSTGRES_PASSWORD=    # senha do postgres
ENCRYPTION_SECRET=    # openssl rand -hex 32
NEXTAUTH_URL=         # https://typebot.example.com
NEXT_PUBLIC_VIEWER_URL= # https://bot.example.com
```
</details>

<details>
<summary><strong>soketi/</strong></summary>

```env
SOKETI_APP_ID=        # app-id
SOKETI_APP_KEY=       # app-key
SOKETI_APP_SECRET=    # app-secret (openssl rand -hex 16)
```
</details>

<details>
<summary><strong>backups/</strong></summary>

```env
# DigitalOcean Spaces
BACKUP_S3_BUCKET=     # nome do space
AWS_ACCESS_KEY_ID=    # access key do Spaces
AWS_SECRET_ACCESS_KEY= # secret key do Spaces
AWS_ENDPOINT=         # https://nyc3.digitaloceanspaces.com

# PostgreSQL
POSTGRES_HOSTS=       # postgres,other-postgres
POSTGRES_PASSWORD=    # senha do postgres
```
</details>

<details>
<summary><strong>cloudbeaver/</strong></summary>

```env
CB_ADMIN_NAME=admin
CB_ADMIN_PASSWORD=    # senha do admin
```
</details>

<details>
<summary><strong>nitropage/</strong></summary>

```env
NP_AUTH_SALT=         # openssl rand -hex 16
NP_AUTH_PASSWORD=     # senha do admin
```
</details>

## Estrutura do Projeto

```
src/
├── cli.ts              # CLI interativa
├── lib/
│   ├── digitalocean.ts # Cliente API Digital Ocean
│   ├── ssh.ts          # Utilitarios SSH
│   ├── services.ts     # Catalogo de servicos
│   └── log.ts          # Logging colorido
└── web/
    ├── server.ts       # API REST (Bun.serve)
    ├── frontend.tsx    # Dashboard React
    ├── index.html      # Entry point
    └── styles.css      # Estilos

setup-coolify-master.ts   # Setup servidor master
setup-coolify-adjacent.ts # Setup servidor child
setup-databases.ts        # Criar databases
```

## API Endpoints

O web server expoe os seguintes endpoints:

```
# Digital Ocean
GET    /api/do/droplets
POST   /api/do/droplets
DELETE /api/do/droplets/:id
GET    /api/do/ssh-keys
GET    /api/do/balance

# DNS
GET    /api/do/domains
POST   /api/do/domains
DELETE /api/do/domains/:domain
GET    /api/do/domains/:domain/records
POST   /api/do/domains/:domain/records
PATCH  /api/do/domains/:domain/records/:id
DELETE /api/do/domains/:domain/records/:id

# Servers (via SSH)
GET    /api/servers/:host/status
GET    /api/servers/:host/containers

# Databases
GET    /api/databases
POST   /api/databases/create

# Tailscale
GET    /api/tailscale/status

# SSH Config
GET    /api/local/ssh-config
POST   /api/local/ssh-config
DELETE /api/local/ssh-config/:name
```

## Desenvolvimento

```bash
# Rodar web com hot reload
bun --watch src/web/server.ts

# Rodar CLI
bun src/cli.ts
```

## License

MIT
