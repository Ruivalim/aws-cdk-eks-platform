# Soketi

WebSocket server, Pusher protocol compatible. Self-hosted real-time.

## Access

- **Type:** Public (WebSocket needs public access)
- **Port:** 6001 (WebSocket)
- **Metrics:** 9601 (optional, keep private)

## Environment Variables (Coolify)

```bash
# App credentials (use in your app)
SOKETI_APP_ID=your-app-id
SOKETI_APP_KEY=your-app-key
SOKETI_APP_SECRET=your-app-secret

# Limits
SOKETI_MAX_CONNS=1000
SOKETI_MAX_EVENTS=1000

# Debug
SOKETI_DEBUG=0

# Metrics
SOKETI_METRICS_ENABLED=false
```

## Coolify Setup

1. Add as Docker Compose from Git
2. Base directory: `/soketi`
3. Add environment variables
4. Set domain for WebSocket: `ws.yourcompany.com`
5. Enable SSL (wss://)

## Usage in Apps

**Laravel:**
```php
// config/broadcasting.php
'pusher' => [
    'driver' => 'pusher',
    'key' => env('PUSHER_APP_KEY'),
    'secret' => env('PUSHER_APP_SECRET'),
    'app_id' => env('PUSHER_APP_ID'),
    'options' => [
        'host' => 'ws.yourcompany.com',
        'port' => 443,
        'scheme' => 'https',
        'useTLS' => true,
    ],
],
```

**JavaScript:**
```javascript
import Pusher from 'pusher-js';

const pusher = new Pusher('your-app-key', {
    wsHost: 'ws.yourcompany.com',
    wsPort: 443,
    wssPort: 443,
    forceTLS: true,
    disableStats: true,
    enabledTransports: ['ws', 'wss'],
});
```

## Features

- Pusher protocol compatible
- Horizontal scaling with Redis
- Webhooks support
- Prometheus metrics
- Low memory footprint
