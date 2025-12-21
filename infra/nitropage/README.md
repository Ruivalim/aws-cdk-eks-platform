# Nitropage

Simple CMS for landing pages and static sites. SQLite-based, lightweight.

## Access

- **Type:** Public (with domain)
- **Port:** 3000
- **Admin:** `/admin`

## Environment Variables (Coolify)

```bash
# Generate with: openssl rand -hex 16
NP_AUTH_SALT=your-random-salt
NP_AUTH_PASSWORD=at-least-32-characters-password-here
```

## Generate Secrets

```bash
# Run locally
openssl rand -hex 16
openssl rand -hex 32
```

## Coolify Setup

1. Add as Docker Compose from Git
2. Base directory: `/nitropage`
3. Add environment variables
4. Set domain: `landing.yourcompany.com`
5. Enable SSL

## Features

- Visual page builder
- SQLite (no external DB needed)
- Lightweight and fast
- SEO friendly
