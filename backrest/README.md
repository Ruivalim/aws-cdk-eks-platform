# Backrest

Web UI for Restic backups. Incremental, encrypted, supports S3/B2/local.

## Access

- **Type:** Private (Tailscale only)
- **Port:** 9898
- **URL:** `http://<tailscale-ip>:9898`

## Environment Variables (Coolify)

```
TZ=America/Sao_Paulo
```

## S3/Backblaze Configuration

Configure in Backrest UI after first access:

1. Open `http://<tailscale-ip>:9898`
2. Add Repository:
   - **Backblaze B2:** `b2:<bucket-name>:/backups`
   - **AWS S3:** `s3:s3.amazonaws.com/<bucket>/backups`
   - **DO Spaces:** `s3:nyc3.digitaloceanspaces.com/<bucket>/backups`

3. Environment variables for repo (set in Backrest UI):
   ```
   B2_ACCOUNT_ID=xxx
   B2_ACCOUNT_KEY=xxx
   RESTIC_PASSWORD=your-encryption-password
   ```
   Or for S3:
   ```
   AWS_ACCESS_KEY_ID=xxx
   AWS_SECRET_ACCESS_KEY=xxx
   RESTIC_PASSWORD=your-encryption-password
   ```

## What to backup

Recommended backup paths:
- `/data/docker-volumes` - All Docker volumes
- `/data/pg-backups` - PostgreSQL dumps (run pg_dump separately)

## Retention Policy (suggested)

- Keep last 7 daily
- Keep last 4 weekly
- Keep last 6 monthly

## PostgreSQL Dumps

For consistent DB backups, create a cron job on host:

```bash
# /etc/cron.d/pg-backup
0 2 * * * root docker exec <postgres-container> pg_dumpall -U postgres | gzip > /backups/pg_$(date +\%Y\%m\%d).sql.gz
```

Then Backrest will pick up the dumps from `/data/pg-backups`.
