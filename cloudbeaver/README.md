# CloudBeaver

Web-based database management tool. Supports PostgreSQL, MySQL, SQLite, and more.
Better UI than pgAdmin, DBeaver-based.

## Access

- **Type:** Private (Tailscale only)
- **Port:** 8978
- **URL:** `http://<tailscale-ip>:8978`

## Environment Variables (Coolify)

```
CB_ADMIN_NAME=admin
CB_ADMIN_PASSWORD=your-secure-password
```

If `CB_ADMIN_PASSWORD` is empty, you'll set it on first access.

## First Access

1. Open `http://<tailscale-ip>:8978`
2. Complete initial setup wizard
3. Create admin account (if not set via env)

## Connecting to Databases

Use Tailscale IPs or Docker network names:

**PostgreSQL on same Coolify:**
- Host: `<postgres-container-name>` or `<tailscale-ip>`
- Port: `5432`
- Database: `your_db`
- User/Password: your credentials

**External Database:**
- Host: `<tailscale-ip-of-db-server>`
- Port: `5432`

## Features

- Multi-database support (PostgreSQL, MySQL, SQLite, etc.)
- SQL editor with autocomplete
- ER diagrams
- Data export/import
- Query history
- User management (team access)
