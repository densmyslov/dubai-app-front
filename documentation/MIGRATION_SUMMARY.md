# Migration Summary: Dynamic Manifest System

## ✅ What Was Accomplished

Successfully refactored the Dubai Real Estate Dashboard from a **static, hardcoded layout** to a **fully dynamic, manifest-driven architecture** where Claude AI can update dashboard content at runtime without requiring rebuilds or deployments.

---

## 🎯 Key Changes

### Architecture Shift

**Before:**
- Dashboard widgets hardcoded in page.tsx
- Required rebuild + redeploy to change content
- Static JSON files served from /public/data

**After:**
- Dashboard reads manifest from Cloudflare KV at runtime
- LLM POSTs new manifests to update instantly
- Zero-downtime, zero-build content updates
- Edge-rendered with `cache: 'no-store'`

---

## 📦 New Files Created

### 1. Core Manifest System
- **[app/lib/manifest.ts](app/lib/manifest.ts)** - TypeScript types, schema, default manifest
- **[app/api/manifest/route.ts](app/api/manifest/route.ts)** - GET/POST endpoints for manifest CRUD
- **[MANIFEST.md](MANIFEST.md)** - Complete documentation for LLM integration

### 2. Widget Components
- **[app/components/WidgetRenderer.tsx](app/components/WidgetRenderer.tsx)** - Dynamic widget dispatcher
- **[app/components/MarkdownWidget.tsx](app/components/MarkdownWidget.tsx)** - Markdown content renderer
- **[app/components/TableWidget.tsx](app/components/TableWidget.tsx)** - Tabular data display

### 3. Enhanced Existing Components
- **Reused:** KPICard.tsx (label/value)
- **Reused:** ChartCard.tsx (ECharts)
- **Enhanced:** ChatWindow.tsx (debug logging for webhook troubleshooting)

---

## 🔄 Modified Files

### [app/page.tsx](app/page.tsx)
**Changed from:** Fetching static JSON endpoints and rendering hardcoded layout

**Changed to:**
```typescript
async function fetchManifest(): Promise<Manifest> {
  const kv = env.MANIFEST_KV;
  const stored = await kv.get('dashboard:manifest');
  return stored ? JSON.parse(stored) : DEFAULT_MANIFEST;
}
```

Dynamic widget rendering based on manifest.

### [CLAUDE.md](CLAUDE.md)
Updated with:
- New architecture overview
- Dynamic manifest system explanation
- Widget types documentation
- KV binding requirements
- Webhook system details

### [app/components/ChatWindow.tsx](app/components/ChatWindow.tsx)
Added debug logging:
- `[ChatWindow] SSE message received`
- `[ChatWindow] Processing webhook_message`
- Helps troubleshoot webhook delivery issues

### [app/api/webhook/stream/route.ts](app/api/webhook/stream/route.ts)
Added server-side logging:
- `[webhook/stream] Message received`
- `[webhook/stream] Filtering out message due to sessionId mismatch`
- Debug sessionId matching issues

---

## 🎨 Supported Widget Types

### 1. **KPI Widget**
Display key metrics with label, value, and optional suffix.

```json
{
  "id": "net-yield",
  "type": "kpi",
  "label": "Average Net Yield",
  "value": "7.2",
  "suffix": "%",
  "gridColumn": "span 1"
}
```

### 2. **Chart Widget**
Interactive ECharts visualizations (line, bar, etc.).

```json
{
  "id": "rent-trend",
  "type": "chart",
  "title": "Median Rent per m²",
  "categories": ["Jan", "Feb", "Mar"],
  "series": [
    { "name": "Dubai Marina", "data": [150, 155, 160] },
    { "name": "Downtown", "data": [180, 185, 190] }
  ],
  "gridColumn": "span 2"
}
```

### 3. **Markdown Widget**
Rich text content with formatting (headers, bold, links, etc.).

```json
{
  "id": "insights",
  "type": "markdown",
  "title": "Market Insights",
  "content": "# Q1 2025 Analysis\n\n**Key Findings:**\n- Rents increased 5%\n- Sales volume up 12%",
  "gridColumn": "span 2"
}
```

### 4. **Table Widget**
Structured tabular data.

```json
{
  "id": "league-table",
  "type": "table",
  "title": "Top Communities",
  "headers": ["Area", "Type", "Net Yield", "Price/Rent"],
  "rows": [
    ["Dubai Marina", "1BR", "7.2%", "13.9"],
    ["Downtown", "2BR", "6.8%", "14.7"]
  ],
  "gridColumn": "span 4"
}
```

---

## 🚀 How It Works

### End-to-End Flow

```
1. User asks Claude:
   "Show me top 5 communities by net yield"

2. Lambda receives message via /api/chat

3. Claude analyzes data (CSV, APIs, etc.)

4. Claude creates manifest:
   {
     "version": "1.0.0",
     "widgets": [
       { type: "kpi", label: "Top Yield", value: "8.5%", ... },
       { type: "chart", title: "Yields", categories: [...], ... },
       { type: "table", title: "League Table", rows: [...], ... }
     ]
   }

5. Lambda POSTs to /api/manifest
   POST https://your-app.pages.dev/api/manifest
   Body: { "manifest": {...} }

6. Manifest stored in Cloudflare KV

7. User refreshes page (or navigates)

8. page.tsx fetches from KV (cache: 'no-store')

9. Widgets render dynamically

10. Dashboard shows new content instantly!
```

---

## 🛠️ Setup Requirements

### 1. Cloudflare KV Namespaces

Create two KV namespaces in Cloudflare dashboard:

1. **MANIFEST_KV** - Stores dashboard manifests
2. **WEBHOOK_KV** - Stores webhook message history

### 2. Bind in wrangler.toml

```toml
[[kv_namespaces]]
binding = "MANIFEST_KV"
id = "abc123..."  # Your KV namespace ID
preview_id = "xyz789..."

[[kv_namespaces]]
binding = "WEBHOOK_KV"
id = "def456..."
preview_id = "uvw012..."
```

### 3. Environment Variables

**.env.local** (for local development):
```bash
KEY=your-lambda-api-key
LAMBDA_FUNCTION_URL=https://your-lambda.amazonaws.com/
WEBHOOK_SECRET=your-webhook-secret  # Optional but recommended
```

**Cloudflare Pages Settings** (production):
- `KEY` - Lambda API key
- `LAMBDA_FUNCTION_URL` - AWS Lambda endpoint
- `WEBHOOK_SECRET` - (optional) Secret for authenticating manifest/webhook updates

### 4. Lambda Integration

Your Lambda function should:

#### A. Include manifest update function

```python
import json
import http.client
from urllib.parse import urlparse

def update_dashboard_manifest(chat_url: str, manifest: dict, secret: str | None):
    parsed = urlparse(chat_url)
    host = parsed.netloc
    path = "/api/manifest"

    payload = {"manifest": manifest}
    body_bytes = json.dumps(payload).encode("utf-8")

    headers = {
        "Content-Type": "application/json",
        "Content-Length": str(len(body_bytes)),
    }
    if secret:
        headers["X-Webhook-Secret"] = secret

    conn = http.client.HTTPSConnection(host, timeout=15)
    try:
        conn.request("POST", path, body=body_bytes, headers=headers)
        resp = conn.getresponse()
        print(f"[manifest] status={resp.status}")
        return resp.status
    finally:
        conn.close()
```

#### B. Call after analysis

```python
# After Claude analyzes data and creates insights
manifest = {
    "version": "1.0.0",
    "widgets": [
        {
            "id": "top-yield",
            "type": "kpi",
            "label": "Top Net Yield",
            "value": "8.5",
            "suffix": "%"
        },
        {
            "id": "rent-chart",
            "type": "chart",
            "title": "Median Rent Trends",
            "categories": rent_periods,
            "series": [{"name": "Rent/m²", "data": rent_values}]
        }
    ]
}

update_dashboard_manifest(chat_url, manifest, webhook_secret)
```

---

## 🧪 Testing

### 1. Test Default Manifest (Local)

```bash
npm run dev
# Open http://localhost:3000
# Should see welcome message with placeholder widgets
```

### 2. Test Manifest Update (cURL)

```bash
curl -X POST http://localhost:3000/api/manifest \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: your-secret" \
  -d '{
    "manifest": {
      "version": "1.0.0",
      "widgets": [
        {
          "id": "test-kpi",
          "type": "kpi",
          "label": "Test Metric",
          "value": "123",
          "suffix": ""
        },
        {
          "id": "test-markdown",
          "type": "markdown",
          "content": "# Test Update\n\nThis is a test!",
          "gridColumn": "span 3"
        }
      ]
    }
  }'
```

**Note:** Without KV bindings locally, this will only work in-memory (not persisted).

### 3. Test on Cloudflare Pages

After deploying:

```bash
curl -X POST https://your-app.pages.dev/api/manifest \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: your-secret" \
  -d @manifest.json
```

Refresh the page to see changes!

---

## 📚 Documentation Files

| File | Purpose |
|------|---------|
| [MANIFEST.md](MANIFEST.md) | Complete manifest schema, widget types, API endpoints, Python examples for LLM |
| [CLAUDE.md](CLAUDE.md) | Development instructions, architecture overview, environment setup |
| [WEBHOOK.md](WEBHOOK.md) | Webhook system documentation (existing) |
| This file | Migration summary and setup guide |

---

## 🔧 Troubleshooting

### Issue: "Error Loading Dashboard"

**Cause:** Manifest fetch failed (likely local dev without KV)

**Solution:** This is expected locally. The DEFAULT_MANIFEST will display instead.

### Issue: Manifest updates not showing

**Cause:** Cache not disabled or KV not updating

**Solutions:**
- Hard refresh browser (Cmd+Shift+R / Ctrl+Shift+F5)
- Check KV binding is correct
- Verify manifest POST returned 200
- Check Cloudflare Pages logs

### Issue: Webhook messages not appearing in chat

**Cause:** sessionId mismatch between Lambda and chat

**Solution:**
- Copy sessionId from chat header (click "Copy")
- Ensure Lambda includes it in webhook POST:
  ```json
  {
    "message": "...",
    "sessionId": "paste-copied-id-here"
  }
  ```

### Issue: TypeScript errors

**Run:**
```bash
npm run build
```

Check for type mismatches in manifest structure.

---

## 🎉 Benefits of New Architecture

### For Users
- ✅ **Instant updates** - No waiting for deploys
- ✅ **AI-driven content** - Claude controls what's displayed
- ✅ **Personalized dashboards** - Each session can have different content
- ✅ **Real-time insights** - Fresh analysis on every request

### For Developers
- ✅ **Zero downtime** - Update content without rebuild
- ✅ **Flexible widgets** - Add new types easily
- ✅ **Type-safe** - Full TypeScript support
- ✅ **Edge-rendered** - Fast, global performance

### For Claude AI
- ✅ **Full control** - Decide what to show and how
- ✅ **Dynamic layouts** - Adjust grid based on content
- ✅ **Multi-format** - Charts, tables, markdown, KPIs
- ✅ **Stateful** - Updates persist across sessions

---

## 🚦 Next Steps

1. **Deploy to Cloudflare Pages**
   ```bash
   npm run build:cf
   # Push to GitHub → Auto-deploys via Cloudflare Pages
   ```

2. **Create KV namespaces** in Cloudflare dashboard

3. **Bind KV in Pages settings** (Environment Variables → KV Namespace Bindings)

4. **Update Lambda** to call `/api/manifest` after analysis

5. **Test end-to-end** with real data

6. **(Optional) Remove debug logs** from ChatWindow.tsx and webhook/stream/route.ts

---

## 📞 Support

- See [MANIFEST.md](MANIFEST.md) for API reference
- See [CLAUDE.md](CLAUDE.md) for development guide
- Check browser console for `[ChatWindow]` and `[webhook]` logs
- Inspect Cloudflare Pages logs for server-side issues

---

**Migration completed successfully!** 🎊

The dashboard is now fully dynamic and ready for Claude AI to take control.
