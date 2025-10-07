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
1. Create a new Pages project → **Connect to Git** (this repo).
2. Set build command: `npm run build:cf`
3. Set Node version 18+.
4. Add env var (optional): `NEXT_PUBLIC_API_BASE` pointing to your Worker URL.

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

The chat window can receive real-time messages from external services (e.g., AWS Lambda, price alerts, notifications) via webhook.

### Setup

1. **Set webhook secret** (optional but recommended):
   ```bash
   # .env.local
   WEBHOOK_SECRET=your-random-secret-key
   ```

2. **Send messages from external services**:

   **From AWS Lambda (Python):**
   ```python
   import json
   import urllib3

   def lambda_handler(event, context):
       http = urllib3.PoolManager()
       response = http.request(
           'POST',
           'https://your-app.com/api/webhook',
           body=json.dumps({"message": "Price alert: Dubai Marina -5%!"}),
           headers={
               'Content-Type': 'application/json',
               'X-Webhook-Secret': 'your-secret-key'
           }
       )
       return {'statusCode': 200}
   ```

   **From AWS Lambda (Node.js):**
   ```javascript
   export const handler = async (event) => {
       const response = await fetch('https://your-app.com/api/webhook', {
           method: 'POST',
           headers: {
               'Content-Type': 'application/json',
               'X-Webhook-Secret': process.env.WEBHOOK_SECRET
           },
           body: JSON.stringify({
               message: 'New property listed in Dubai Marina!'
           })
       });
       return { statusCode: 200 };
   };
   ```

3. **Messages appear instantly** in the chat window with a purple "Webhook" badge

### API Reference

**Endpoint:** `POST /api/webhook`

**Headers:**
- `Content-Type: application/json`
- `X-Webhook-Secret: <your-secret>` (if `WEBHOOK_SECRET` is set)

**Body:**
```json
{
  "message": "Your message text",
  "sessionId": "optional-session-id"
}
```

**Response:**
```json
{
  "success": true,
  "messageId": "1234567890-abc123",
  "timestamp": 1234567890000
}
```

**Health Check:** `GET /api/webhook`

See [WEBHOOK.md](WEBHOOK.md) for detailed integration guide with examples for Python, Node.js, cURL, and more.

## Notes
- Keep heavy compute in ETL. The site only fetches pre-aggregated JSON.
- Add auth/lead capture later (Turnstile + a Worker POST to HubSpot/Airtable).
