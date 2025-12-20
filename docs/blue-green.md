# Blue-Green Deployment

> Future feature - high level design

## Concept

Run two instances of the app (blue and green). Only one receives traffic at a time. Deploy to inactive slot, verify health, then switch traffic.

```
                    ┌─────────────┐
                    │   Caddy     │
                    │  (Gateway)  │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            │            ▼
       ┌─────────────┐     │     ┌─────────────┐
       │    Blue     │◄────┘     │   Green     │
       │  (active)   │           │ (inactive)  │
       │  :3000      │           │  :3001      │
       └─────────────┘           └─────────────┘
```

## Deploy Flow

1. Identify inactive slot (e.g., green on :3001)
2. Pull new image to inactive slot
3. Start containers on inactive slot
4. Health check inactive slot
5. If healthy: switch Caddy to point to new slot
6. If unhealthy: rollback (keep old slot active)
7. Stop old slot after successful switch

## Container Naming

```
{project}-blue-{service}
{project}-green-{service}

# Example
outline-blue-app
outline-blue-db
outline-green-app
outline-green-db
```

## Caddy Config

```
outline.example.com {
  @blue {
    header X-Slot blue
  }
  @green {
    header X-Slot green
  }

  # Active slot (managed by ruilify)
  reverse_proxy 100.x.x.x:3000  # blue
  # reverse_proxy 100.x.x.x:3001  # green (inactive)
}
```

## State Tracking

```typescript
interface DeploymentSlot {
  project_id: string;
  slot: "blue" | "green";
  active: boolean;
  image: string;
  commit: string;
  started_at: Date;
  health_status: "healthy" | "unhealthy" | "unknown";
}
```

## Rollback

If new deployment fails:

1. Stop failed slot
2. Keep old slot active
3. Mark deployment as failed
4. No Caddy changes needed

## Considerations

- Database migrations: run before switching traffic
- Shared volumes: both slots need access
- Port management: blue=base_port, green=base_port+1
- Health checks: configurable endpoint and timeout
