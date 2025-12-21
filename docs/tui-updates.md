# TUI Updates - Pending Features

## Dashboard - Resumo Inicial

Ao abrir o TUI, mostrar resumo na tela inicial:

```
Ruilify Dashboard

Servers:    2 online / 2 total
Projects:   5 deployed / 6 total
Last deploy: cloudbeaver (2h ago)

Alerts:
  ⚠ app-server-2 not responding
  ⚠ SSL expiring in 7 days: api.example.com
```

---

## Server Status - Health Check Melhorado

Mostrar status detalhado de todos os servers:

```
Servers

● gateway-server    Online   Docker ✓  Caddy ✓   CPU 12%  Mem 45%  Disk 23%
● app-server-1      Online   Docker ✓  GitHub ✓  CPU 8%   Mem 62%  Disk 31%
○ app-server-2      Offline  Last seen: 2h ago
```

---

## Server Details - Feature Installation

When viewing server details, show installed features and allow installing new ones.

```
Servers → worker-1 → Features

Installed Features:
  ● Docker           24.0.7    Core container runtime
  ● Tailscale        1.56.0    Mesh VPN

Available Features:
  ○ Backup Service   -         Automated backups to S3
  ○ Log Collector    -         Centralized logging
  ○ Metrics Agent    -         Prometheus metrics

[Enter] Install selected    [Esc] Back
```

When viewing server details, show installed features and allow installing new ones.

```
Servers → worker-1 → Features

Installed Features:
  ● Docker           24.0.7    Core container runtime
  ● Tailscale        1.56.0    Mesh VPN

Available Features:
  ○ Backup Service   -         Automated backups to S3
  ○ Log Collector    -         Centralized logging
  ○ Metrics Agent    -         Prometheus metrics

[Enter] Install selected    [Esc] Back
```

---

## Port Management

### Port Overview Screen

New screen or section showing all ports in use across worker servers.

```
Servers → worker-1 → Ports

Used Ports on worker-1:

Port   Project      Service         Container
────────────────────────────────────────────────
3000   outline      app             outline-app-1
5432   outline      db              outline-db-1
5678   n8n          n8n             n8n-app-1
5432   n8n          postgres        n8n-db-1      ⚠️ Conflict!
6379   redis        redis           redis-1

⚠️  Port 5432 is used by multiple projects!
    Consider using different external ports.

[Enter] Edit port mapping    [Esc] Back
```

### Port Override in Project

When adding/editing a project, detect and resolve port conflicts.

---

## Projects - Enhanced Actions

```
Projects → outline (Enter)

outline - Wiki
Status: ● Running
URL: https://wiki.example.com
Commit: abc1234 (deployed 2h ago)

Containers:
  ● outline-app-1    Up 2 hours    3000:3000
  ● outline-db-1     Up 2 hours    5432:5432

[D] Deploy/Update  [R] Restart  [s] Stop  [l] Logs  [e] Edit
```

---

## Settings - Global Configuration

```
Settings

Backup Storage:
  Provider:   DigitalOcean Spaces
  Endpoint:   nyc3.digitaloceanspaces.com
  Bucket:     ruilify-backups
  Status:     ● Connected

ACME Email:
  Email: admin@example.com

Default Ports:
  Base port for new projects: 3000
  Port range: 3000-4000
```

---

## Projects - Container Logs em Tempo Real

```
Projects → cloudbeaver → Logs

Showing logs for: cloudbeaver (cloudbeaver-1)

[2025-12-20 15:32:01] Starting CloudBeaver...
[2025-12-20 15:32:02] Database connection established
[2025-12-20 15:32:03] Server listening on port 8978
[2025-12-20 15:32:15] New connection from 100.114.58.48

[Ctrl+C] Stop  [f] Filter  [c] Clear  [Esc] Back
```

---

## Projects - Health Check Status

```
Projects → Health Status

Health Check Results:

✓ db.ruivalim.com.br      200 OK         45ms
✓ api.example.com         200 OK         120ms
⚠ app.example.com         200 OK         2.3s (slow)
✗ staging.example.com     502 Bad Gateway
○ internal-service        No domain configured

[r] Refresh  [Enter] View details  [Esc] Back
```

---

## Gateway - SSL/Certificates Status

```
Gateway → SSL Status

Domain                    Status    Expires      Issuer
─────────────────────────────────────────────────────────
db.ruivalim.com.br        ● Valid   2026-03-20   Let's Encrypt
api.example.com           ● Valid   2026-03-15   Let's Encrypt
staging.example.com       ⚠ Soon    2025-12-27   Let's Encrypt
old.example.com           ✗ Expired 2025-12-01   Let's Encrypt

[r] Refresh  [R] Force renew  [Esc] Back
```

---

## Settings - Backup/Export Config

```
Settings → Export/Import

Export Configuration:
  Exports servers, projects, and settings to JSON file.
  Note: Sensitive env vars are encrypted.

  [e] Export to ~/ruilify-backup.json

Import Configuration:
  Import from a previously exported backup.

  [i] Import from file

Last export: 2025-12-15 10:30:00
```

---

## Settings - Notifications (Webhooks)

```
Settings → Notifications

Discord Webhook:
  URL: https://discord.com/api/webhooks/...
  Status: ● Connected
  Events: Deploy success, Deploy failed

Slack Webhook:
  URL: (not configured)

Per-project overrides:
  cloudbeaver: Discord only
  api-server: Slack + Discord

[d] Configure Discord  [s] Configure Slack  [Esc] Back
```

---

## Maintenance - Cleanup

```
Maintenance → Cleanup

Cleanup Tasks:

[ ] Remove unused Docker images
    Found: 12 images (2.3 GB)

[ ] Remove stopped containers
    Found: 5 containers

[ ] Clean old build artifacts
    Found: 8 builds (1.1 GB)

[ ] Prune Docker system
    Estimated space: 3.4 GB

[Space] Toggle  [Enter] Run cleanup  [Esc] Cancel
```

---

## Projects - Multi-ambiente (Staging/Prod)

```
Projects → api-server → Environments

Environments:

● Production
  Domain: api.example.com
  Server: app-server-1
  Branch: main
  Status: Running (commit abc123)

○ Staging
  Domain: staging-api.example.com
  Server: app-server-2
  Branch: develop
  Status: Running (commit def456)

[a] Add environment  [d] Deploy  [Esc] Back
```

---

## Tailscale - Gerenciamento via API

Usar a Tailscale API para gerenciar devices na rede.

### Configuração

```
# .env
TAILSCALE_API_KEY=tskey-api-xxxxxxxx
TAILSCALE_TAILNET=your-tailnet.ts.net
```

### Listar Devices

```
Servers → Tailscale Devices

Devices na rede Tailscale:

● gateway-server     100.83.119.41    Online    Linux    2h ago
● app-server-1       100.114.58.48    Online    Linux    5m ago
○ old-server         100.99.88.77     Offline   Linux    5d ago
○ test-machine       100.100.100.1    Offline   macOS    30d ago

[d] Remove device  [r] Refresh  [Esc] Back
```

### Auto-remove ao deletar servidor

Quando deletar um servidor no Ruilify, opção de também remover do Tailscale:

```
Delete Server: app-server-1

Select what to delete (Space to toggle):

▸ [x] Delete droplet from Digital Ocean
  [x] Delete DNS records from Cloudflare
  [x] Delete GitHub SSH key
  [x] Remove from Tailscale network    <-- NOVO

[Space] Toggle  [Enter] Delete  [Esc] Cancel
```

### Sincronizar Servers com Tailscale

Detectar devices no Tailscale que não estão registrados no Ruilify:

```
Servers → Sync with Tailscale

Found 2 devices not registered in Ruilify:

○ new-server-1    100.88.77.66    Online
○ test-vm         100.55.44.33    Offline

[a] Add to Ruilify  [i] Ignore  [Esc] Back
```

### API Endpoints usados

```typescript
// GET https://api.tailscale.com/api/v2/tailnet/{tailnet}/devices
// DELETE https://api.tailscale.com/api/v2/device/{deviceId}
```

---

## Known Bugs

### Footer showing wrong server count

**Bug:** Footer shows "Servers: 0/2 online" when 2 servers are actually online.

**Location:** Likely in sidebar or footer component where online count is calculated.

**Expected:** Should show "Servers: 2/2 online" when all servers respond to SSH check.
