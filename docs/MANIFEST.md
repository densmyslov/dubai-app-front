# Dynamic Dashboard Manifest

## Overview

The Dubai Real Estate Dashboard uses a **dynamic manifest system** that allows the dashboard to be updated at runtime without rebuilding or redeploying the application.

## Architecture

1. **Page Rendering**: The dashboard page ([page.tsx](app/page.tsx)) fetches the manifest at runtime using `fetch('/api/manifest', { cache: 'no-store' })`
2. **Manifest Storage**: The manifest is stored in Cloudflare KV (or falls back to a default manifest)
3. **Widget Rendering**: The page dynamically renders widgets based on the manifest structure
4. **LLM Updates**: Claude (or any LLM) can update the manifest by POSTing to `/api/manifest`

## Manifest Schema

```typescript
interface Manifest {
  version: string;
  updatedAt: string;  // Auto-populated by server
  widgets: Widget[];
}

type Widget = KPIWidget | ChartWidget | MarkdownWidget | TableWidget;
```

## Widget Types

### 1. KPI Widget
Display a key performance indicator with a label and value.

```json
{
  "id": "net-yield",
  "type": "kpi",
  "label": "Top Net Yield",
  "value": "8.5",
  "suffix": "%",
  "gridColumn": "span 1"
}
```

### 2. Chart Widget
Display an ECharts line/bar chart.

```json
{
  "id": "rent-chart",
  "type": "chart",
  "title": "Rent per m² (AED)",
  "categories": ["2024-01", "2024-02", "2024-03"],
  "series": [
    {
      "name": "Rent/m²",
      "data": [150, 155, 160]
    }
  ],
  "gridColumn": "span 2"
}
```

### 3. Markdown Widget
Display formatted markdown content.

```json
{
  "id": "insights",
  "type": "markdown",
  "title": "Key Insights",
  "content": "# Market Overview\n\n**Q1 2025** shows strong growth:\n- Rent increased by 5%\n- Sales volume up 12%",
  "gridColumn": "span 2"
}
```

### 4. Table Widget
Display tabular data.

```json
{
  "id": "league-table",
  "type": "table",
  "title": "Community League Table",
  "headers": ["Area", "Type", "Net Yield", "Price-to-Rent"],
  "rows": [
    ["Dubai Marina", "1BR", "7.2%", "13.9"],
    ["Downtown", "2BR", "6.8%", "14.7"]
  ],
  "gridColumn": "span 4"
}
```

## Grid Layout

Use the `gridColumn` property to control widget width:
- `"span 1"` - 1/4 width (default for KPIs)
- `"span 2"` - 1/2 width (default for charts)
- `"span 3"` - 3/4 width
- `"span 4"` - Full width (default for tables)

The grid is responsive: `grid-cols-1 md:grid-cols-2 lg:grid-cols-4`

## Updating the Manifest via API

### Endpoint
```
POST /api/manifest
```

### Headers
```
Content-Type: application/json
X-Webhook-Secret: <your-secret>  (if WEBHOOK_SECRET env var is set)
```

### Request Body
```json
{
  "manifest": {
    "version": "1.0.0",
    "widgets": [
      {
        "id": "kpi-1",
        "type": "kpi",
        "label": "Average Yield",
        "value": "7.5",
        "suffix": "%"
      },
      {
        "id": "chart-1",
        "type": "chart",
        "title": "Rental Trends",
        "categories": ["Jan", "Feb", "Mar"],
        "series": [{"name": "Rent", "data": [100, 110, 105]}],
        "gridColumn": "span 2"
      }
    ]
  }
}
```

### Response (Success)
```json
{
  "success": true,
  "timestamp": "2025-01-15T10:30:00.000Z",
  "widgetCount": 2
}
```

### Response (Error)
```json
{
  "error": "Invalid manifest: must have version and widgets array"
}
```

## Python Example for LLM

```python
import json
import http.client
from urllib.parse import urlparse

def update_dashboard_manifest(chat_url: str, manifest: dict, secret: str | None):
    """
    Update the dashboard manifest via POST to {origin}/api/manifest
    """
    parsed = urlparse(chat_url)
    host = parsed.netloc
    is_tls = parsed.scheme == "https"
    path = "/api/manifest"

    payload = {"manifest": manifest}
    body_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": str(len(body_bytes)),
    }
    if secret:
        headers["X-Webhook-Secret"] = secret

    conn_cls = http.client.HTTPSConnection if is_tls else http.client.HTTPConnection
    conn = conn_cls(host, timeout=15)

    try:
        conn.request("POST", path, body=body_bytes, headers=headers)
        resp = conn.getresponse()
        resp_body = resp.read().decode("utf-8", errors="replace")

        print(f"[manifest] status={resp.status} body={resp_body}")

        if not (200 <= resp.status < 300):
            raise RuntimeError(f"Manifest update failed HTTP {resp.status}: {resp_body}")

        return resp.status
    finally:
        conn.close()

# Example usage
manifest = {
    "version": "1.0.0",
    "widgets": [
        {
            "id": "welcome",
            "type": "markdown",
            "title": "Welcome",
            "content": "# Dubai Real Estate Dashboard\\n\\nUpdated by Claude AI"
        },
        {
            "id": "yield",
            "type": "kpi",
            "label": "Average Net Yield",
            "value": "7.2",
            "suffix": "%"
        }
    ]
}

update_dashboard_manifest(
    chat_url="https://your-dashboard.pages.dev",
    manifest=manifest,
    secret="your-webhook-secret"
)
```

## LLM Workflow

When a user asks Claude to update the dashboard:

1. **Parse the request** - Understand what data/analysis the user wants displayed
2. **Analyze the data** - Process CSV files, run calculations, generate insights
3. **Create the manifest** - Build a manifest with appropriate widgets (KPIs, charts, tables, markdown)
4. **POST to `/api/manifest`** - Send the manifest to update the dashboard
5. **Optionally notify user** - Send a webhook message saying "Dashboard updated!"

## User Experience

After the LLM updates the manifest:

1. User refreshes the page (or navigates away and back)
2. Next.js Edge runtime fetches the updated manifest from KV
3. Page re-renders with new widgets
4. **No build, no deploy, instant update!**

## Environment Setup

### Required for Cloudflare Pages

In `wrangler.toml` or Cloudflare dashboard, bind a KV namespace:

```toml
[[kv_namespaces]]
binding = "MANIFEST_KV"
id = "your-kv-namespace-id"
preview_id = "your-preview-kv-id"
```

### Optional Security

Set `WEBHOOK_SECRET` environment variable to require authentication for manifest updates.

## Testing

### Manual Manifest Update

```bash
curl -X POST https://your-dashboard.pages.dev/api/manifest \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: your-secret" \
  -d '{
    "manifest": {
      "version": "1.0.0",
      "widgets": [
        {
          "id": "test",
          "type": "markdown",
          "content": "# Test Update\n\nThis is a test!"
        }
      ]
    }
  }'
```

### Fetch Current Manifest

```bash
curl https://your-dashboard.pages.dev/api/manifest
```

## Migration from Static Dashboard

The original static dashboard fetched from `/api/league`, `/api/rent_ppm2`, etc. Those endpoints are no longer used. Instead:

1. LLM fetches the raw data (CSV files, APIs, etc.)
2. LLM processes and analyzes the data
3. LLM creates a manifest with the processed results
4. LLM POSTs the manifest to update the dashboard

This gives Claude **full control** over what's displayed and how it's presented.
