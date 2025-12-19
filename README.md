# Coolify Infrastructure

Docker Compose files for self-hosted services managed by Coolify.

## Services

| Service | Description | Access | Folder |
|---------|-------------|--------|--------|
| **Backrest** | Backup UI (Restic) | Private (Tailscale) | `/backrest` |
| **CloudBeaver** | Database admin (better pgAdmin) | Private (Tailscale) | `/cloudbeaver` |
| **Redis Insight** | Redis GUI | Private (Tailscale) | `/redis-insight` |
| **Outline** | Team wiki/docs | Public | `/outline` |
| **Hoppscotch** | API testing (Postman alternative) | Public | `/hoppscotch` |
| **Nitropage** | CMS/Landing pages | Public | `/nitropage` |
| **Soketi** | WebSocket server (Pusher compatible) | Public (WS) | `/soketi` |
| **Glitchtip** | Error tracking (Sentry alternative) | Private (Tailscale) | `/glitchtip` |

## How to deploy in Coolify

1. **Create a new project** in Coolify (e.g., "Infrastructure")

2. **Add resource** → Docker Compose → Git Repository

3. Configure:
   - Repository: `<your-repo-url>`
   - Branch: `main`
   - Base Directory: `/<service-folder>` (e.g., `/backrest`)
   - Docker Compose Location: `docker-compose.yml`

4. **Environment Variables**: Add in Coolify UI (see each service's README)

5. **Domain**:
   - Public services: Add your domain in Coolify
   - Private services: Use Tailscale IP + port, or set domain without public access

## Private vs Public

**Private (Tailscale only):**
- In Coolify: Don't assign a public domain
- Access via: `http://<tailscale-ip>:<port>`
- Or: Assign domain but don't expose port 80/443 to that domain

**Public:**
- In Coolify: Assign domain and enable SSL
- Coolify handles Let's Encrypt automatically

## Notes

- All compose files assume Coolify manages the reverse proxy (Traefik)
- No need for `https-portal` or custom Traefik configs
- Ports are exposed internally, Coolify routes traffic
- Use `expose` instead of `ports` for services behind Coolify proxy
