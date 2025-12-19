# Interface - TODO

## Estrutura
- `src/lib/` - Libs compartilhadas (DO API, SSH, services) ✅
- `src/cli.ts` - CLI interativa ✅
- `src/web/` - Web dashboard ✅

## O que falta fazer

### CLI (src/cli.ts) ✅
- [x] Menu principal
- [x] Digital Ocean (listar, criar, deletar droplets, SSH keys, billing)
- [x] Servers (status, setup master/adjacent, containers)
- [x] Databases (provisionar, listar)
- [x] Services (listar disponíveis)

### Web Dashboard (src/web/) ✅
- [x] server.ts - Bun.serve() com rotas API
- [x] index.html - Dashboard principal
- [x] Páginas: DO droplets, servers, services, SSH keys

### Automação ao criar Droplet ✅
1. [x] Criar droplet no DO via API
2. [x] Aguardar IP disponível (polling)
3. [x] Endpoint para rodar setup via SSH (básico)
4. [ ] Adicionar servidor no Coolify via API (opcional, requer Coolify API token)

### Variáveis necessárias (.env)
```
DIGITALOCEAN_TOKEN=xxx
COOLIFY_API_URL=http://100.77.201.55:8000
COOLIFY_API_TOKEN=xxx (opcional, para integrar com Coolify API)
```

## Comandos
```bash
bun src/cli.ts           # CLI interativa
bun src/web/server.ts    # Web dashboard em localhost:3456
```
