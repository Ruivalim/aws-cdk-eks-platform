# Ruilify

Ferramenta para gerenciar infraestrutura de deploy: criar droplets no Digital Ocean, configurar servidores com Docker/Tailscale/Caddy, e fazer deploy de aplicacoes.

## Requisitos

- [Bun](https://bun.sh) >= 1.0
- [Tailscale](https://tailscale.com) instalado localmente
- Conta no [Digital Ocean](https://digitalocean.com) com API token
- Conta no [Cloudflare](https://cloudflare.com) com API token (opcional, para DNS)

## Instalacao

```bash
git clone <repo-url>
cd ruilify
bun install

# Configurar variaveis de ambiente
cp .env.example .env
# Editar .env com suas credenciais
```

## Uso

```bash
# TUI (interface principal)
bun run tui

# CLI legada
bun run cli
```

## Arquitetura

```
Seu Mac (Controller)
    |
    ├── TUI (React/Ink)
    ├── SQLite local (data/deployments.db)
    |
    └── Controla via SSH/Tailscale:
        |
        ├── Gateway Server - Caddy (reverse proxy publico)
        ├── Build Server - Docker + Registry + Git
        └── Worker Servers - Docker (apps)
```

## Tipos de Servidor

| Tipo        | Descricao             | Componentes                      |
| ----------- | --------------------- | -------------------------------- |
| **Gateway** | Reverse proxy publico | Caddy, Tailscale                 |
| **Build**   | Builds e registry     | Docker, Registry, Git, Tailscale |
| **Worker**  | Roda aplicacoes       | Docker, Tailscale                |

## TUI

Interface principal. Telas disponiveis:

- **Servers**: Gerenciar servidores (setup automatico ou manual)
- **Projects**: Gerenciar projetos e fazer deploy
- **Deployments**: Historico de deploys
- **Cloudflare**: DNS records
- **DigitalOcean**: Droplets e SSH keys
- **Logs**: Logs do sistema
- **Settings**: Configuracoes

### Atalhos

| Tecla | Acao                  |
| ----- | --------------------- |
| Tab   | Navegar entre paineis |
| j/k   | Navegar na lista      |
| Enter | Selecionar/Confirmar  |
| a     | Add                   |
| e     | Edit                  |
| d     | Delete                |
| S     | Setup (Servers)       |
| Esc   | Voltar                |
| q     | Sair                  |

## Deploy

### Com Build (aplicacoes custom)

1. Build Server: clone → build → docker push
2. Worker Server: docker pull → container (blue/green)
3. Gateway Server: atualiza Caddy

### Sem Build (docker-compose)

1. Worker Server: docker-compose up
2. Gateway Server: atualiza Caddy

## Templates de Servicos

O projeto inclui docker-compose.yml prontos para varios servicos:

| Categoria      | Servicos                          |
| -------------- | --------------------------------- |
| Produtividade  | Outline, n8n, Typebot, Hoppscotch |
| Analytics      | Plausible, Umami, Glitchtip       |
| Infra          | Soketi, Redis, Registry           |
| Database Admin | Cloudbeaver, Redis Insight        |
| Backup         | Backrest                          |

## License

MIT
