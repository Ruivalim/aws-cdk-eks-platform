# Outline

Team wiki and knowledge base. Beautiful, fast, collaborative.

## Access

- **Type:** Public (with domain)
- **Port:** 3000
- **URL:** Your domain (e.g., `docs.yourcompany.com`)

## Environment Variables (Coolify)

**Required:**
```bash
# Generate with: openssl rand -hex 32
SECRET_KEY=your-64-char-hex-secret
UTILS_SECRET=your-64-char-hex-secret

# Database password
POSTGRES_PASSWORD=secure-password

# Your public URL
OUTLINE_URL=https://docs.yourcompany.com
```

**Authentication (choose one):**

Google OAuth:
```bash
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
```

Slack:
```bash
SLACK_CLIENT_ID=xxx
SLACK_CLIENT_SECRET=xxx
```

OIDC (Logto, Auth0, etc.):
```bash
OIDC_CLIENT_ID=xxx
OIDC_CLIENT_SECRET=xxx
OIDC_AUTH_URI=https://your-auth.com/authorize
OIDC_TOKEN_URI=https://your-auth.com/token
OIDC_USERINFO_URI=https://your-auth.com/userinfo
OIDC_DISPLAY_NAME=Login with SSO
```

**Optional - S3 Storage:**
```bash
FILE_STORAGE=s3
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-bucket
AWS_S3_BUCKET_URL=https://your-bucket.s3.amazonaws.com
```

## Coolify Setup

1. Add as Docker Compose from Git
2. Base directory: `/outline`
3. Add environment variables
4. Set domain: `docs.yourcompany.com`
5. Enable SSL (Let's Encrypt)

## Generate Secrets

```bash
# Run locally
openssl rand -hex 32
```

## Notes

- First user to sign in becomes admin
- Requires OAuth provider (no email/password by default)
- Includes its own PostgreSQL and Redis (self-contained)
