# Redis Insight

Official Redis GUI. Browse keys, run commands, monitor performance.

## Access

- **Type:** Private (Tailscale only)
- **Port:** 5540
- **URL:** `http://<tailscale-ip>:5540`

## Environment Variables (Coolify)

```
RITRUSTEDORIGINS=http://<tailscale-ip>:5540
```

## Connecting to Redis

After first access, add your Redis database:

**Redis on same Coolify:**
- Host: `<redis-container-name>` or `<tailscale-ip>`
- Port: `6379`
- Password: (if set)

**Coolify's Redis:**
- Host: `coolify-redis`
- Port: `6379`

## Features

- Key browser with filtering
- CLI console
- Slow log analysis
- Memory analysis
- Pub/Sub monitoring
- Streams viewer
