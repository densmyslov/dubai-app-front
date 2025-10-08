# Dubai Real Estate Investor Dashboard (Cloudflare starter)

This is a minimal starter you can deploy on **Cloudflare Pages** (Next.js + Tailwind) with a small **Cloudflare Worker** that caches JSON metrics (e.g., league table, rent medians). The app renders example charts and tables for:
- Median annual rent
- Rent per m²
- Price-to-rent
- Community league table (investor KPIs)

## What’s included
- **Next.js 14 (App Router)** + Tailwind on Cloudflare Pages via `@cloudflare/next-on-pages`
- **ECharts** for charts, **AG Grid**-style simple table (native table for minimal deps)
- **Cloudflare Worker** with edge cache (1h) for `/api/league` (you can add more endpoints)
- Sample JSON in `public/data/` so it also works without the Worker during local dev

## Quick start

### 1) Local dev
```bash
npm i
npm run dev
# open http://localhost:3000
```

### 2) Deploy frontend to Cloudflare Pages

#### Option A — Git-connected build (recommended)
1. Create a new Pages project → **Connect to Git** (this repo).
2. Build command: `npm run build:cf` (produces `.open-next/` automatically)
3. Build output directory: `.open-next`
4. Node version: 18 or 20.
5. Add required env vars (e.g. `WEBHOOK_SECRET`, `LAMBDA_FUNCTION_URL`, `CLAUDE_MODEL`, `NEXT_PUBLIC_API_BASE`).

#### Option B — Manual deploy from your machine
```bash
npx wrangler login                      # once per machine
npm run deploy:cf -- --project-name YOUR_PAGES_PROJECT
# optional: add --branch main to target a non-default branch
```
The command runs `npm run build:cf` under the hood and publishes `.open-next/` as your Pages artifact using the settings from `wrangler.toml`.

### 3) Deploy the Worker (API)
```bash
cd worker
npm i
npm run deploy  # requires 'wrangler' auth: `npx wrangler login`
```
Copy the Worker URL → add to Pages as `NEXT_PUBLIC_API_BASE`. Update `LEAGUE_JSON_URL` etc. in `wrangler.toml` or secrets.

### 4) Wire your real data
Have your ETL write JSON snapshots to R2 (or any https). Point the Worker to those URLs. Add more endpoints by copying `league` handler.

## Structure
```
/app            # Next.js (App Router)
/public/data    # Sample JSON (used locally or as fallback)
/worker         # Cloudflare Worker (edge-cached API)
```

## Webhook Integration

The chat window can receive real-time messages from external services via webhook. Messages are delivered instantly through Server-Sent Events (SSE).

### Quick Setup

1. **Set webhook secret** (optional but recommended for production):
   ```bash
   # .env.local
   WEBHOOK_SECRET=your-random-secret-key
   ```

2. **Send messages** via POST request:
   ```bash
   curl -X POST https://your-app.com/api/webhook \
     -H "Content-Type: application/json" \
     -H "X-Webhook-Secret: your-secret-key" \
     -d '{"message": "Hello from external service!"}'
   ```

3. **Messages appear instantly** in the chat window with a purple "Webhook" badge

### Architecture

```
External Service → POST /api/webhook → Message Queue → SSE Stream → Chat Window
```

### API Endpoints

**POST /api/webhook** - Send a message
- Headers: `Content-Type: application/json`, `X-Webhook-Secret: <secret>`
- Body: `{"message": "text", "sessionId": "optional"}`
- Response: `{"success": true, "messageId": "...", "timestamp": ...}`

**GET /api/webhook** - Health check
- Response: `{"status": "ok", "activeConnections": 3}`

**GET /api/webhook/stream** - SSE stream (used internally by chat window)
- Query: `?sessionId=optional`
- Returns Server-Sent Events with webhook messages

### Use Cases

- **Real Estate Alerts**: Price drops, new listings, market updates
- **Notifications**: System alerts, important updates
- **Third-Party Integrations**: Zapier, IFTTT, custom automations
- **Admin Broadcasts**: Send messages to all active users

### Examples

**Python (AWS Lambda):**
```python
import requests

def send_webhook(message):
    return requests.post(
        "https://your-app.com/api/webhook",
        json={"message": message},
        headers={"X-Webhook-Secret": "your-secret"}
    ).json()
```

**Node.js (AWS Lambda):**
```javascript
export const handler = async () => {
    await fetch('https://your-app.com/api/webhook', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Secret': process.env.WEBHOOK_SECRET
        },
        body: JSON.stringify({message: 'New property listed!'})
    });
};
```

### Security & Production

- **Always use WEBHOOK_SECRET** in production
- **HTTPS only** for webhook endpoints
- **Rate limiting**: Consider implementing for high-traffic scenarios
- **Scaling**: For production, consider replacing in-memory queue with Redis or Cloudflare Durable Objects

See [app/api/webhook/WEBHOOK.md](app/api/webhook/WEBHOOK.md) for the complete integration guide with advanced features, session targeting, troubleshooting, and deployment considerations.

## Notes
- Keep heavy compute in ETL. The site only fetches pre-aggregated JSON.
- Add auth/lead capture later (Turnstile + a Worker POST to HubSpot/Airtable).
