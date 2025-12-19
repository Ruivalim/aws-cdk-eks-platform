# Glitchtip

Error tracking and performance monitoring. Sentry-compatible, lighter.

## Access

- **Type:** Private (Tailscale) or Public
- **Port:** 8000
- **URL:** `http://<tailscale-ip>:8000` or `errors.yourcompany.com`

## Environment Variables (Coolify)

```bash
# Generate with: openssl rand -hex 32
SECRET_KEY=your-64-char-hex-secret

# Database
POSTGRES_PASSWORD=secure-password

# Domain (for emails and links)
GLITCHTIP_DOMAIN=https://errors.yourcompany.com

# Email (optional)
EMAIL_URL=smtp://user:password@smtp.example.com:587
DEFAULT_FROM_EMAIL=errors@yourcompany.com

# Registration
ENABLE_REGISTRATION=false
```

## Coolify Setup

1. Add as Docker Compose from Git
2. Base directory: `/glitchtip`
3. Add environment variables
4. Set domain (optional): `errors.yourcompany.com`
5. Enable SSL if public

## Create First User

```bash
# SSH into server
docker exec -it glitchtip ./manage.py createsuperuser
```

## Integration

Use Sentry SDK, just change DSN host:

**JavaScript:**
```javascript
import * as Sentry from '@sentry/browser';

Sentry.init({
    dsn: 'https://key@errors.yourcompany.com/1',
});
```

**Python:**
```python
import sentry_sdk

sentry_sdk.init(
    dsn="https://key@errors.yourcompany.com/1",
)
```

**Node.js:**
```javascript
const Sentry = require('@sentry/node');

Sentry.init({
    dsn: 'https://key@errors.yourcompany.com/1',
});
```

## Features

- Sentry SDK compatible
- Error grouping
- Release tracking
- Performance monitoring
- Uptime monitoring
- Team/project management
- Much lighter than Sentry
