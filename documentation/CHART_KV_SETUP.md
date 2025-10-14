# Chart KV Namespace Setup

The chart webhook system requires a Cloudflare KV namespace to persist charts between edge requests.

## Why KV is needed

Cloudflare Workers/Pages edge runtime creates isolated instances for each request. In-memory storage doesn't persist between:
- Different edge requests (POST webhook → SSE stream)
- Different edge locations
- Server restarts

KV storage solves this by providing persistent storage accessible across all edge instances.

## Setup Instructions

### Option 1: Using Wrangler CLI (Recommended)

1. **Create the KV namespace:**
   ```bash
   npx wrangler kv namespace create CHART_KV
   ```

   This will output something like:
   ```
   🌀 Creating namespace with title "dubai-app-front-CHART_KV"
   ✨ Success!
   Add the following to your configuration file in your kv_namespaces array:
   { binding = "CHART_KV", id = "abc123def456..." }
   ```

2. **Update wrangler.toml:**
   Replace `PLACEHOLDER_CHART_KV_ID` with the actual ID from step 1:
   ```toml
   [[kv_namespaces]]
   binding = "CHART_KV"
   id = "abc123def456..."  # Your actual KV namespace ID
   ```

3. **Deploy:**
   ```bash
   npm run build:cf
   npx @cloudflare/next-on-pages
   npx wrangler pages deploy .open-next/worker --project-name=dubai-app-front
   ```

### Option 2: Using Cloudflare Dashboard

1. **Create KV Namespace:**
   - Go to https://dash.cloudflare.com/
   - Navigate to Workers & Pages → KV
   - Click "Create a namespace"
   - Name it: `dubai-app-front-CHART_KV`
   - Copy the namespace ID

2. **Bind to Pages Project:**
   - Go to your Pages project: `dubai-app-front`
   - Settings → Functions → KV Namespace Bindings
   - Add binding:
     - Variable name: `CHART_KV`
     - KV namespace: Select the one you created
   - Save

3. **Update wrangler.toml (for local dev):**
   ```toml
   [[kv_namespaces]]
   binding = "CHART_KV"
   id = "your-kv-namespace-id"
   ```

## Testing Locally

For local development with wrangler:

```bash
# Create a preview/local KV namespace
npx wrangler kv namespace create CHART_KV --preview

# Use the preview ID in wrangler.toml for local testing
[[kv_namespaces]]
binding = "CHART_KV"
id = "production-id"
preview_id = "preview-id"  # For local dev

# Run local dev server with KV
npm run dev
```

## Verifying Setup

1. **Send a test chart (session-scoped):**
   ```bash
   ./test-chart-webhook.sh https://your-app.pages.dev your-secret YOUR_SESSION_ID
   ```
   > Charts must include the chat `sessionId`. Use the ID shown in the chat header (or generate a test one).

2. **Check KV data (optional):**
   ```bash
   # List all keys in the namespace
   npx wrangler kv key list --namespace-id=your-namespace-id

   # Get the charts data
   npx wrangler kv key get "charts:session:<SESSION_ID>" --namespace-id=your-namespace-id
   ```

3. **Check browser console:**
   - Open your dashboard
   - Open browser dev tools → Console
   - Look for logs like: `[charts/stream] Loaded from KV: N charts`

## Troubleshooting

### Charts not appearing

1. **Check KV binding exists:**
   - Cloudflare Dashboard → Pages Project → Settings → Functions → KV Namespace Bindings
   - Verify `CHART_KV` binding is present

2. **Check console logs:**
   - Look for: `[charts/route] CHART_KV not available`
   - If present, KV binding is missing

3. **Verify wrangler.toml:**
   - Ensure CHART_KV binding has a valid ID (not PLACEHOLDER)
   - ID should be a long hex string

### KV read/write errors

1. **Check permissions:**
   - Ensure your Cloudflare account has KV access
   - Verify KV namespace wasn't deleted

2. **Check limits:**
   - Free plan: 100,000 reads/day, 1,000 writes/day
   - Each chart webhook counts as 1 write + N reads (N = number of connected clients)

## KV Data Structure

The CHART_KV namespace stores:

**Key format:** `charts:session:<sessionId>`
**Value:** JSON array of chart messages for that session (max 50)

```json
[
  {
    "id": "chart-1234567890-abc123",
    "type": "chart",
    "chartId": "revenue-chart",
    "timestamp": 1234567890000,
    "sessionId": "user-session-id-123",
    "config": {
      "title": "Revenue",
      "chartType": "line",
      "categories": ["Jan", "Feb"],
      "series": [{"name": "Revenue", "data": [100, 150]}]
    }
  }
]
```

## Cost Considerations

- **Free tier:** 100,000 reads/day, 1,000 writes/day, 1 GB storage
- **Paid tier:** $0.50/million reads, $5/million writes after free tier

For typical usage:
- 100 chart updates/day = 100 writes (well within free tier)
- 1000 page views/day × 1 read = 1,000 reads (well within free tier)

## Alternative: Reuse WEBHOOK_KV

If you want to save on KV namespaces, you can reuse WEBHOOK_KV for charts:

1. In `app/api/charts/route.ts` and `app/api/charts/stream/route.ts`:
   ```typescript
   const kv = env.WEBHOOK_KV as KVNamespace | undefined;
   ```

2. Remove the CHART_KV binding from wrangler.toml

3. Charts and chat messages will share the same KV but use different keys:
   - Chats: `webhook:messages`
   - Charts: `charts:session:<SESSION_ID>`

This is fine for small-scale deployments but may hit KV operation limits faster.
