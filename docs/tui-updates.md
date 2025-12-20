# TUI Updates

## Server Details - Feature Installation

When viewing server details, show installed features and allow installing new ones.

### Current Server Details

```
Servers → worker-1 (Enter)

worker-1 - Worker Server

Network                         Services
  Tailscale IP: 100.83.119.41     ● Docker 24.0.7 (5 containers)
  Public IP: 164.90.x.x           ● Tailscale 1.56.0
  Magic DNS: worker-1.tail...     ○ Backup Service (not installed)

System                          Resources
  Hostname: worker-1              Memory: 1.2G/4G [████████░░░░] 30%
  OS: Ubuntu 24.04                Disk: 12G/80G  [██░░░░░░░░░░] 15%
  Kernel: 6.5.0
  Uptime: 5 days

[r] Refresh  [u] Check updates  [U] Apply updates  [f] Features  [Esc] Back
```

### Features Screen

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

### Installing Feature

```
Servers → worker-1 → Features → Backup Service

Installing Backup Service...

  ✓ Creating directory /opt/ruilify/backup-service
  ✓ Writing docker-compose.yml
  → Pulling ruilify/backup:latest...
  ○ Starting container
  ○ Verifying health

[Logs shown in real-time]
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

When adding/editing a project:

```
Projects → Add Project

...

6. Configure Ports

Detected services and ports:
  app      3000 → 3000 (external)
  db       5432 → 5432 (external)

⚠️  Port 5432 is already in use by: outline/db

Override external ports:
  app: [3000]
  db:  [5433]    ◄── Changed to avoid conflict

[Enter] Continue    [Esc] Back
```

### Project Schema Update

```typescript
interface Project {
  // ... existing fields

  // Port mappings
  port_mappings: {
    [service: string]: {
      internal: number; // Port inside container
      external: number; // Port exposed on host
    };
  };

  // Example:
  // port_mappings: {
  //   "app": { internal: 3000, external: 3000 },
  //   "db": { internal: 5432, external: 5433 }
  // }
}
```

### Caddy Integration

When configuring Caddy, use the external port:

```
outline.example.com {
  reverse_proxy 100.83.119.41:3000  # Uses external port from mapping
}
```

### Auto Port Assignment

When port conflict detected:

```typescript
function findAvailablePort(basePort: number, usedPorts: Set<number>): number {
  let port = basePort;
  while (usedPorts.has(port)) {
    port++;
  }
  return port;
}

// Example: 5432 in use → suggest 5433
```

---

## Projects - Deploy Actions

Enhanced project actions:

```
Projects → outline (Enter)

outline - Wiki
Status: ● Running
URL: https://wiki.example.com
Commit: abc1234 (deployed 2h ago)

Containers:
  ● outline-app-1    Up 2 hours    3000:3000
  ● outline-db-1     Up 2 hours    5432:5432

Environment Variables: 12 configured
Backup: ● Enabled (last: 2h ago)

[D] Deploy/Update  [R] Restart  [s] Stop  [l] Logs  [e] Edit  [b] Backups
```

### Deploy Action

```
Projects → outline → Deploy

Deploying outline...

Source: github.com/outline/outline
Branch: main
Worker: worker-1 (100.83.119.41)

[1/5] Checking for updates...
      Current: abc1234
      Latest:  def5678

[2/5] Pulling latest code...
      ✓ Pulled def5678

[3/5] Building... (if has_build)
      → Running build.sh
      → Building Docker image
      → Pushing to registry

[4/5] Deploying containers...
      ✓ Pulled images
      ✓ Started containers
      ✓ Health check passed

[5/5] Updating gateway...
      ✓ Caddy reloaded

✓ Deployed successfully!

Commit: def5678
URL: https://wiki.example.com

[Enter] Done    [l] View logs
```

### Restart Action

For applying new env vars without full redeploy:

```
Projects → outline → Restart

Restarting outline...

  ✓ Stopping containers
  ✓ Writing new .env file
  ✓ Starting containers
  ✓ Health check passed

✓ Restarted successfully!

[Enter] Done
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

  [c] Configure S3

ACME Email:
  Email: admin@example.com
  (Used for Let's Encrypt certificates)

  [e] Edit email

Default Ports:
  Base port for new projects: 3000
  Port range: 3000-4000

  [p] Edit ports
```

---

## Global Port View

Optional: global view of all ports across all workers.

```
Ports (all servers)

worker-1 (100.83.119.41):
  3000  outline/app
  5432  outline/db
  5678  n8n/app
  6379  redis/redis

worker-2 (100.83.120.15):
  3000  my-app/app
  5432  postgres/db

gateway (100.83.119.40):
  80    caddy (HTTP)
  443   caddy (HTTPS)

[Enter] View details    [Esc] Back
```

---

## Implementation Priority

1. **Port tracking in DB** - Track used ports per server
2. **Port conflict detection** - Warn when adding project
3. **Port override UI** - Allow changing external ports
4. **Features screen** - Install backup service, etc
5. **Ports overview screen** - See all ports in use

---

## Known Bugs

### Footer showing wrong server count

**Bug:** Footer shows "Servers: 0/2 online" when 2 servers are actually online.

**Location:** Likely in sidebar or footer component where online count is calculated.

**Expected:** Should show "Servers: 2/2 online" when all servers respond to SSH check.
