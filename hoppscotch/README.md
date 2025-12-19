# Hoppscotch

Open-source API development platform. Alternative to Postman.

## Access

- **Type:** Public (with domains)
- **Ports:**
  - App: 3000
  - Admin: 3100
  - Backend: 3170

## Environment Variables (Coolify)

```bash
# Generate secrets with: openssl rand -hex 32
JWT_SECRET=your-64-char-hex-secret
SESSION_SECRET=your-64-char-hex-secret

# Database
POSTGRES_PASSWORD=secure-password

# URLs (adjust to your domains)
APP_URL=https://api.yourcompany.com
ADMIN_URL=https://api-admin.yourcompany.com
BACKEND_URL=https://api-backend.yourcompany.com
BACKEND_WS_URL=wss://api-backend.yourcompany.com

# Optional: Email
MAILER_SMTP_ENABLE=true
MAILER_USE_CUSTOM_CONFIGS=true
MAILER_SMTP_HOST=smtp.example.com
MAILER_SMTP_PORT=587
MAILER_SMTP_USER=user
MAILER_SMTP_PASSWORD=password
MAILER_ADDRESS_FROM=noreply@example.com
```

## Coolify Setup

You need 3 domains for full setup:

1. **App** (main interface): `api.yourcompany.com` → port 3000
2. **Admin** (user management): `api-admin.yourcompany.com` → port 3100
3. **Backend** (API): `api-backend.yourcompany.com` → port 3170

Or simpler with subpaths (needs Traefik config).

## Features

- REST, GraphQL, WebSocket testing
- Collections and environments
- Team collaboration
- History and sync
- Pre-request scripts
