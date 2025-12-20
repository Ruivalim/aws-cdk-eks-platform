# Deploy System

## Overview

Ruilify supports two types of deployments:

1. **Compose Only** - Pre-built images (postgres, redis, etc)
2. **Compose + Build** - Custom apps with build step

## Architecture

```
                                    ┌─────────────────────┐
                                    │    Build Server     │
                                    │  (se tem build.sh)  │
                                    ├─────────────────────┤
                                    │ - git clone/pull    │
                                    │ - ./build.sh        │
                                    │ - docker build      │
                                    │ - push → registry   │
                                    └──────────┬──────────┘
                                               │
GitHub Repo                                    │ pull image
    │                                          │
    │                              ┌───────────▼───────────┐
    │ git clone                    │    Worker Server      │
    └─────────────────────────────►├───────────────────────┤
                                   │ /opt/ruilify/apps/    │
                                   │   └── {projeto}/      │
                                   │       ├── compose.yml │
                                   │       ├── .env        │
                                   │       └── data/       │
                                   │                       │
                                   │ docker compose up -d  │
                                   └───────────┬───────────┘
                                               │
                                               │ tailscale_ip:port
                                               │
                                   ┌───────────▼───────────┐
                                   │   Gateway Server      │
                                   ├───────────────────────┤
                                   │ Caddy:                │
                                   │ domain → worker:port  │
                                   └───────────────────────┘
```

## Directory Structure

### Worker Server

```
/opt/ruilify/
├── apps/
│   ├── postgres/
│   │   ├── docker-compose.yml
│   │   ├── .env
│   │   └── data/
│   │       └── pgdata/
│   │
│   ├── outline/
│   │   ├── docker-compose.yml
│   │   ├── .env
│   │   └── data/
│   │       └── uploads/
│   │
│   └── my-custom-app/
│       ├── docker-compose.yml
│       ├── .env
│       └── data/
│
└── backup-service/
    ├── docker-compose.yml
    ├── config.yml
    └── logs/
```

### Build Server

```
/opt/ruilify/
├── repos/
│   └── {projeto}/          # git repos clonados
│       ├── build.sh
│       ├── Dockerfile
│       └── src/
│
└── registry/
    └── data/               # registry storage
```

---

## Flow: Compose Only

For pre-built images like postgres, redis, etc.

### Steps

1. **Clone repo on worker**

   ```bash
   git clone {repo_url} /opt/ruilify/apps/{project}
   # or git pull if exists
   ```

2. **Write .env file**

   ```bash
   # From project config in ruilify DB
   cat > /opt/ruilify/apps/{project}/.env << EOF
   POSTGRES_PASSWORD=xxx
   POSTGRES_DB=mydb
   EOF
   ```

3. **Normalize volumes**
   - Parse docker-compose.yml
   - Rewrite named volumes to `./data/{volume_name}`
   - This ensures data persists in a known location

4. **Deploy**

   ```bash
   cd /opt/ruilify/apps/{project}
   docker compose up -d
   ```

5. **Configure Caddy** (if domain configured)

   ```bash
   # Add route to Caddyfile on gateway server
   # domain.com → {worker_tailscale_ip}:{port}
   ```

6. **Update backup config**
   - Add project to backup service config.yml

---

## Flow: Compose + Build

For custom apps with build.sh and Dockerfile.

### Prerequisites

- Build server configured with:
  - Docker
  - Registry running on :5000
  - Git + deploy keys

### Steps

1. **Clone repo on build server**

   ```bash
   git clone {repo_url} /opt/ruilify/repos/{project}
   # or git pull if exists
   ```

2. **Run build script**

   ```bash
   cd /opt/ruilify/repos/{project}
   chmod +x build.sh
   ./build.sh
   ```

   The build.sh can:
   - Install dependencies
   - Compile assets
   - Run tests
   - Any pre-build steps

3. **Build Docker image**

   ```bash
   docker build -t {registry}:5000/{project}:{commit_sha} .
   docker push {registry}:5000/{project}:{commit_sha}
   ```

4. **Prepare compose on worker**

   ```bash
   # Clone or copy docker-compose.yml to worker
   git clone {repo_url} /opt/ruilify/apps/{project}
   ```

5. **Update image reference**
   - Parse docker-compose.yml
   - Replace `image: app` with `image: {registry}:5000/{project}:{commit_sha}`
   - Or use x-ruilify extension to know which service to update

6. **Write .env and deploy**

   ```bash
   cd /opt/ruilify/apps/{project}
   docker compose pull
   docker compose up -d
   ```

7. **Configure Caddy + Backup**
   - Same as compose-only flow

---

## Docker Compose Conventions

### x-ruilify Extension

Projects can include ruilify-specific config:

```yaml
x-ruilify:
  # Which service gets the built image
  build_service: app

  # Port exposed to gateway
  port: 3000

  # Volumes to backup
  backup:
    volumes:
      - uploads
      - attachments
    postgres:
      service: db
      database: myapp

services:
  app:
    image: app # Will be replaced with registry image
    ports:
      - "3000:3000"
    volumes:
      - uploads:/app/uploads

  db:
    image: postgres:17
    volumes:
      - pgdata:/var/lib/postgresql/data
```

### Volume Normalization

Ruilify rewrites volumes for consistent data location:

```yaml
# Original
volumes:
  pgdata:
  uploads:

services:
  db:
    volumes:
      - pgdata:/var/lib/postgresql/data

# Rewritten by ruilify
services:
  db:
    volumes:
      - ./data/pgdata:/var/lib/postgresql/data
```

---

## Project Schema

```typescript
interface Project {
  id: string;
  name: string;

  // Git
  repo_url: string;
  branch: string;
  compose_path: string; // relative path to docker-compose.yml

  // Build (optional)
  has_build: boolean;
  build_script: string; // relative path, usually "build.sh"
  dockerfile_path: string; // relative path, usually "Dockerfile"
  build_service: string; // which service in compose gets the built image

  // Deploy target
  worker_server_id: string;

  // Routing (optional)
  domain: string | null;
  port: number;

  // Config
  env_vars: Record<string, string>;

  // State
  current_commit: string | null;
  last_deployed_at: Date | null;
  status: "pending" | "deploying" | "running" | "failed" | "stopped";
}
```

---

## Caddy Integration

When a project has a domain configured:

1. Generate route entry:

   ```
   {domain} {
     reverse_proxy {worker_tailscale_ip}:{port}
   }
   ```

2. Add to Caddyfile on gateway server

3. Reload Caddy:
   ```bash
   caddy reload --config /etc/caddy/Caddyfile
   ```

---

## TUI Actions

### Projects Screen

| Action  | Key | Description                        |
| ------- | --- | ---------------------------------- |
| Add     | a   | Create new project                 |
| Deploy  | D   | Deploy/redeploy project            |
| Restart | R   | Restart containers (apply new env) |
| Logs    | l   | View container logs                |
| Stop    | s   | Stop containers                    |
| Delete  | d   | Remove project                     |

### Deploy Action

```
Projects → my-app → Deploy

Deploying my-app...

[1/4] Pulling latest from git...
[2/4] Building image... (if has_build)
[3/4] Starting containers...
[4/4] Configuring gateway...

✓ Deployed successfully!
  URL: https://my-app.example.com
  Commit: abc1234
```

---

## Environment Variables

Stored in DB, written to .env on deploy:

```typescript
// In DB
project.env_vars = {
  "POSTGRES_PASSWORD": "secret123",
  "DATABASE_URL": "postgres://...",
  "SECRET_KEY": "xxx"
}

// Written to /opt/ruilify/apps/{project}/.env
POSTGRES_PASSWORD=secret123
DATABASE_URL=postgres://...
SECRET_KEY=xxx
```

### Special Variables

Ruilify injects some variables automatically:

```env
RUILIFY_PROJECT_NAME=my-app
RUILIFY_WORKER_IP=100.x.x.x
RUILIFY_REGISTRY=100.x.x.x:5000
```

---

## Error Handling

1. **Git clone fails** → Show error, abort deploy
2. **Build fails** → Show build.sh output, abort
3. **Docker build fails** → Show docker output, abort
4. **Containers fail to start** → Show logs, mark as failed
5. **Health check fails** → (future: blue-green rollback)

All errors are logged to:

- TUI logs screen
- `/opt/ruilify/apps/{project}/deploy.log` on worker
