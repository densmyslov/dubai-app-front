# Chart Webhook System Documentation

## Overview

The chart webhook system provides a separate channel for dynamically injecting charts into the dashboard without cluttering the chat interface. Charts sent through this system appear in a dedicated section on the main page and are completely independent of chat messages.

## Quick Setup

1. **Create Cloudflare KV namespace** (required for production):
   ```bash
   npx wrangler kv namespace create CHART_KV
   ```
   Then update `wrangler.toml` with the ID. See [CHART_KV_SETUP.md](CHART_KV_SETUP.md) for detailed instructions.

2. **Set environment variable** (optional but recommended for security):
   ```bash
   # In .env.local
   CHART_WEBHOOK_SECRET=your-secret-here
   ```

3. **Deploy your app** - The chart webhook is already integrated in the main page

4. **Send charts from your backend**:
   ```bash
   curl -X POST https://your-app.com/api/charts \
     -H "Content-Type: application/json" \
     -H "X-Webhook-Secret: your-secret-here" \
     -d '{
       "action": "add",
       "chartId": "my-chart",
       "config": {
         "title": "My Chart",
         "chartType": "line",
         "categories": ["A", "B", "C"],
         "series": [{"name": "Data", "data": [10, 20, 15]}]
       }
     }'
   ```

That's it! Charts will appear on your dashboard in real-time.

### Testing Locally

Use the included test script to verify your webhook is working:

```bash
# Make script executable (first time only)
chmod +x test-chart-webhook.sh

# Run tests
./test-chart-webhook.sh http://localhost:3000 your-secret

# Or test against production
./test-chart-webhook.sh https://your-app.pages.dev your-secret
```

The script will add sample charts (line, bar, pie), update one, and remove one to demonstrate all webhook actions.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Frontend                         │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ChatWindow              DynamicCharts             │
│  ↓                       ↓                         │
│  /api/webhook/stream     /api/charts/stream       │
│  (text messages)         (chart configs)          │
│                                                     │
└─────────────────────────────────────────────────────┘
         ↑                          ↑
         │                          │
    ┌────┴──────────────────────────┴─────┐
    │         Backend (Lambda)             │
    ├──────────────────────────────────────┤
    │  POST to:                            │
    │  • /api/webhook (chat messages)      │
    │  • /api/charts (chart configs)       │
    └──────────────────────────────────────┘
```

## Components

### Backend Components

1. **Chart Queue** ([app/lib/chartQueue.ts](app/lib/chartQueue.ts))
   - In-memory queue for chart messages
   - Manages chart lifecycle (add, update, remove)
   - Notifies SSE subscribers in real-time

2. **Chart Webhook Endpoint** ([app/api/charts/route.ts](app/api/charts/route.ts))
   - Receives POST requests with chart configurations
   - Validates payloads
   - Adds charts to the queue
   - Optional authentication via `X-Webhook-Secret` header

3. **Chart SSE Stream** ([app/api/charts/stream/route.ts](app/api/charts/stream/route.ts))
   - Server-Sent Events endpoint
   - Delivers chart updates to connected clients
   - Supports session filtering
   - Sends historical charts on connection

### Frontend Components

1. **DynamicCharts Component** ([app/components/DynamicCharts.tsx](app/components/DynamicCharts.tsx))
   - Connects to chart SSE stream
   - Renders charts in a grid layout
   - Handles chart lifecycle (add, update, remove)
   - Adapts to dark mode
   - Shows connection status indicator

2. **Type Definitions** ([app/types/chart.ts](app/types/chart.ts))
   - TypeScript interfaces for chart configurations
   - Type safety for chart payloads

## API Reference

### POST /api/charts

Webhook endpoint for sending chart configurations to the dashboard.

#### Request

**Headers:**
```
Content-Type: application/json
X-Webhook-Secret: <your-secret> (optional)
```

**Body:**
```json
{
  "action": "add",
  "chartId": "unique-chart-id",
  "sessionId": "optional-session-id",
  "config": {
    "title": "Monthly Revenue",
    "chartType": "line",
    "categories": ["Jan", "Feb", "Mar", "Apr"],
    "series": [
      {
        "name": "Revenue",
        "data": [1000, 1500, 1200, 1800]
      },
      {
        "name": "Expenses",
        "data": [800, 900, 850, 950]
      }
    ],
    "options": {
      "legend": true,
      "grid": {
        "left": "5%",
        "right": "5%"
      }
    }
  }
}
```

#### Parameters

- `action` (required): One of `"add"`, `"update"`, or `"remove"`
- `chartId` (required): Unique identifier for the chart
- `sessionId` or `session_id` (optional): Session ID for filtering (only deliver to specific user)
  - **Note**: Both camelCase (`sessionId`) and snake_case (`session_id`) are accepted for backend compatibility
- `config` (required for add/update): Chart configuration object

#### Chart Configuration

```typescript
{
  title: string;                    // Chart title
  chartType: 'line' | 'bar' | 'pie' | 'scatter' | 'area';
  categories?: string[];            // X-axis labels (for line/bar/area)
  series: Array<{
    name: string;                   // Series name
    data: number[] |                // Data points
          Array<{value: number, name: string}>;
    type?: string;                  // Override chart type for this series
  }>;
  options?: {                       // Optional ECharts configuration
    legend?: boolean;
    grid?: Record<string, unknown>;
    tooltip?: Record<string, unknown>;
    xAxis?: Record<string, unknown>;
    yAxis?: Record<string, unknown>;
    [key: string]: unknown;
  };
}
```

#### Response

**Success (200):**
```json
{
  "success": true,
  "messageId": "chart-1234567890-abc123",
  "chartId": "unique-chart-id",
  "action": "add",
  "timestamp": 1234567890000
}
```

**Error (400/401/500):**
```json
{
  "error": "Error message"
}
```

### GET /api/charts/stream

SSE endpoint for receiving real-time chart updates.

#### Query Parameters

- `sessionId` (optional): Filter charts by session ID

#### Response

Server-Sent Events stream with the following event types:

**Connection Confirmation:**
```json
{
  "type": "connected",
  "timestamp": 1234567890000
}
```

**Chart Added/Updated:**
```json
{
  "type": "chart",
  "chartId": "unique-chart-id",
  "config": { /* ChartConfig object */ },
  "timestamp": 1234567890000,
  "isHistory": false
}
```

**Chart Removed:**
```json
{
  "type": "chart_remove",
  "chartId": "unique-chart-id",
  "timestamp": 1234567890000
}
```

### GET /api/charts

Health check endpoint.

#### Response

```json
{
  "status": "ok",
  "activeConnections": 2
}
```

## Usage Examples

### Example 1: Add a Line Chart

```bash
curl -X POST https://your-app.com/api/charts \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: your-secret" \
  -d '{
    "action": "add",
    "chartId": "revenue-2024",
    "config": {
      "title": "2024 Revenue",
      "chartType": "line",
      "categories": ["Q1", "Q2", "Q3", "Q4"],
      "series": [
        {
          "name": "Revenue",
          "data": [50000, 75000, 80000, 95000]
        }
      ]
    }
  }'
```

### Example 2: Add a Bar Chart with Multiple Series

```bash
curl -X POST https://your-app.com/api/charts \
  -H "Content-Type: application/json" \
  -d '{
    "action": "add",
    "chartId": "sales-comparison",
    "config": {
      "title": "Sales Comparison",
      "chartType": "bar",
      "categories": ["Product A", "Product B", "Product C"],
      "series": [
        {
          "name": "2023",
          "data": [120, 200, 150]
        },
        {
          "name": "2024",
          "data": [180, 240, 190]
        }
      ]
    }
  }'
```

### Example 3: Add a Pie Chart

```bash
curl -X POST https://your-app.com/api/charts \
  -H "Content-Type: application/json" \
  -d '{
    "action": "add",
    "chartId": "market-share",
    "config": {
      "title": "Market Share",
      "chartType": "pie",
      "series": [
        {
          "name": "Market Share",
          "data": [
            {"value": 335, "name": "Product A"},
            {"value": 234, "name": "Product B"},
            {"value": 154, "name": "Product C"}
          ]
        }
      ]
    }
  }'
```

### Example 4: Update Existing Chart

```bash
curl -X POST https://your-app.com/api/charts \
  -H "Content-Type: application/json" \
  -d '{
    "action": "update",
    "chartId": "revenue-2024",
    "config": {
      "title": "2024 Revenue (Updated)",
      "chartType": "line",
      "categories": ["Q1", "Q2", "Q3", "Q4"],
      "series": [
        {
          "name": "Revenue",
          "data": [50000, 75000, 85000, 100000]
        }
      ]
    }
  }'
```

### Example 5: Remove a Chart

```bash
curl -X POST https://your-app.com/api/charts \
  -H "Content-Type: application/json" \
  -d '{
    "action": "remove",
    "chartId": "revenue-2024"
  }'
```

### Example 6: Session-Specific Chart

```bash
curl -X POST https://your-app.com/api/charts \
  -H "Content-Type: application/json" \
  -d '{
    "action": "add",
    "chartId": "user-metrics",
    "sessionId": "session-abc123",
    "config": {
      "title": "Your Metrics",
      "chartType": "bar",
      "categories": ["Week 1", "Week 2", "Week 3"],
      "series": [
        {
          "name": "Activity",
          "data": [45, 67, 89]
        }
      ]
    }
  }'
```

## Integration with Lambda

When integrating with AWS Lambda, your function should POST to the chart webhook endpoint:

```python
import json
import requests

def send_chart_to_frontend(chart_id, config, session_id=None):
    payload = {
        "action": "add",
        "chartId": chart_id,
        "config": config
    }

    if session_id:
        payload["sessionId"] = session_id

    response = requests.post(
        "https://your-app.com/api/charts",
        json=payload,
        headers={
            "Content-Type": "application/json",
            "X-Webhook-Secret": os.environ.get("WEBHOOK_SECRET")
        }
    )

    return response.json()

# Example usage in Lambda handler
def lambda_handler(event, context):
    # Process user query...

    # Generate chart data
    chart_config = {
        "title": "Query Results",
        "chartType": "line",
        "categories": ["Jan", "Feb", "Mar"],
        "series": [
            {
                "name": "Metric",
                "data": [100, 150, 120]
            }
        ]
    }

    # Send to frontend
    result = send_chart_to_frontend(
        chart_id=f"query-{event['query_id']}",
        config=chart_config,
        session_id=event.get('session_id')
    )

    return result
```

## Security

### Authentication

The chart webhook endpoint supports optional authentication via the `X-Webhook-Secret` header:

1. Set environment variable in your deployment (`.env.local` or Cloudflare environment):
   - `CHART_WEBHOOK_SECRET` - Dedicated secret for chart webhooks only
   - OR `WEBHOOK_SECRET` - Shared secret for both chat and chart webhooks
   - If `CHART_WEBHOOK_SECRET` is set, it takes precedence
   - If neither is set, authentication is disabled (not recommended for production)

2. Include the secret in all webhook requests via `X-Webhook-Secret` header

3. Requests without a valid secret will receive a 401 Unauthorized response

**Example configuration:**
```bash
# Option 1: Use same secret for both webhooks
WEBHOOK_SECRET=your-secret-here

# Option 2: Use separate secrets (more secure)
WEBHOOK_SECRET=chat-webhook-secret
CHART_WEBHOOK_SECRET=chart-webhook-secret
```

### CORS

The chart webhook endpoint includes CORS headers to allow cross-origin requests. In production, you may want to restrict this to specific origins by modifying [app/api/charts/route.ts](app/api/charts/route.ts).

## Session Filtering

Charts can be filtered by session ID to deliver charts only to specific users:

1. **Frontend**: The DynamicCharts component automatically uses the ChatWindow's session ID
2. **Backend**: Include `sessionId` in the webhook payload
3. **Behavior**:
   - Charts with no `sessionId` are delivered to all connected clients
   - Charts with a `sessionId` are only delivered to clients with matching session IDs

## Limitations

1. **In-Memory Queue**: The current implementation uses an in-memory queue, which means:
   - Charts are lost on server restart
   - Not suitable for multi-instance deployments
   - For production, consider using Redis or Cloudflare KV

2. **Chart Persistence**: Charts are kept in memory (max 50 messages). For longer persistence, integrate with a database.

3. **Real-Time Only**: Charts are delivered via SSE in real-time. Historical charts are limited to the most recent 20 messages.

## Troubleshooting

### Charts Not Appearing

1. Check browser console for connection errors
2. Verify the chart stream connection status indicator (top of Dynamic Charts section)
3. Check that the webhook POST request succeeded (200 response)
4. Verify session IDs match if using session filtering

### Chart Rendering Issues

1. Ensure chart configuration follows the ChartConfig schema
2. Check browser console for ECharts errors
3. Verify `chartType` is one of: `line`, `bar`, `pie`, `scatter`, `area`
4. For line/bar/area charts, ensure `categories` array length matches `data` array length

### Connection Drops

1. The stream includes a 30-second heartbeat to keep connections alive
2. If connection drops, the frontend will automatically reconnect
3. Check server logs for EventSource errors

## Future Enhancements

1. **Persistent Storage**: Integrate with KV/Redis for chart persistence
2. **Chart Interactions**: Add click handlers and drill-down capabilities
3. **Chart Export**: Add functionality to export charts as images
4. **Advanced Filtering**: Support more complex filtering beyond session ID
5. **Chart Templates**: Pre-defined chart templates for common use cases
6. **Animation**: Add chart transition animations when data updates

## Related Files

- [app/lib/chartQueue.ts](app/lib/chartQueue.ts) - Chart message queue
- [app/api/charts/route.ts](app/api/charts/route.ts) - Webhook endpoint
- [app/api/charts/stream/route.ts](app/api/charts/stream/route.ts) - SSE stream
- [app/components/DynamicCharts.tsx](app/components/DynamicCharts.tsx) - Frontend component
- [app/types/chart.ts](app/types/chart.ts) - TypeScript definitions
- [app/page.tsx](app/page.tsx) - Integration in main page
