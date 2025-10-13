# Dubai Real Estate Dashboard - Development Instructions

## Project Overview
This is a Next.js 14 application that displays Dubai real estate investment analytics with **dynamic, runtime-configurable widgets**. The dashboard content is controlled by a manifest that can be updated by Claude AI without requiring a rebuild or redeploy.

## Tech Stack
- **Framework**: Next.js 14 (App Router, Edge Runtime)
- **Styling**: Tailwind CSS with dark mode support
- **Charts**: ECharts
- **AI Chat**: Claude API via AWS Lambda
- **Storage**: Cloudflare KV (for manifest + webhook messages)
- **Deployment**: Cloudflare Pages

## Key Features
1. **Dynamic manifest-driven dashboard** - No build/deploy needed for content updates
2. Real-time Claude AI chat with SSE streaming
3. Webhook system for external message delivery
4. Interactive charts (line, bar), KPIs, markdown, and tables
5. Dark/light theme toggle
6. Edge-rendered with no-store caching for instant updates

## Project Structure
```
/app
  /api
    /chat           # Chat API route (proxies to Lambda)
    /charts         # POST endpoint for chart webhooks (separate from chat)
    /charts/stream  # SSE stream for real-time chart updates
    /manifest       # GET/POST manifest (dashboard content)
    /webhook        # POST endpoint for external messages
    /webhook/stream # SSE stream for real-time messages
  /components
    WidgetRenderer.tsx   # Dynamic widget renderer
    KPICard.tsx          # KPI widget
    ChartCard.tsx        # Chart widget (ECharts)
    MarkdownWidget.tsx   # Markdown content widget
    TableWidget.tsx      # Table widget
    ChatWindow.tsx       # Chat interface
    DynamicCharts.tsx    # Dynamic chart renderer (receives charts via webhook)
  /lib
    manifest.ts     # Manifest types and defaults
    config.ts       # App configuration
    chartQueue.ts   # Chart message queue (separate from chat)
    messageQueue.ts # Chat message queue
  /types
    chart.ts        # Chart type definitions
  page.tsx          # Main page (fetches manifest + renders widgets)
MANIFEST.md         # Documentation for manifest system
CHART_WEBHOOK.md    # Documentation for chart webhook system
```

## Environment Variables

### Required (.env.local)
```
KEY=<your-api-key>                          # API key for Lambda authentication
LAMBDA_FUNCTION_URL=<lambda-url>            # AWS Lambda function URL
```

### Optional
```
CLAUDE_MODEL=claude-3-5-sonnet-20241022     # Claude model to use
CHAT_FETCH_TIMEOUT_MS=30000                 # Overall timeout for Lambda requests
CHAT_IDLE_TIMEOUT_MS=20000                  # Idle timeout for streaming
NEXT_PUBLIC_WS_URL=<websocket-url>          # WebSocket URL for real-time updates
WEBHOOK_SECRET=<secret>                     # Secret for webhook/manifest authentication
CHART_WEBHOOK_SECRET=<secret>               # Optional: separate secret for chart webhooks (falls back to WEBHOOK_SECRET)
```

### Cloudflare KV Bindings (in wrangler.toml or dashboard)
```toml
[[kv_namespaces]]
binding = "MANIFEST_KV"      # For storing dashboard manifest
id = "your-manifest-kv-id"

[[kv_namespaces]]
binding = "WEBHOOK_KV"       # For storing webhook message history
id = "your-webhook-kv-id"
```

## Development Commands

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Build for Cloudflare Pages
npm run build:cf

# Lint
npm run lint
```

## Architecture

### Dynamic Manifest System

The dashboard is **fully dynamic** and requires no rebuild to update:

1. **Page Load**: [page.tsx](app/page.tsx) fetches `/api/manifest` with `cache: 'no-store'`
2. **Manifest Retrieval**: [/api/manifest](app/api/manifest/route.ts) reads from Cloudflare KV (or returns default)
3. **Widget Rendering**: [WidgetRenderer](app/components/WidgetRenderer.tsx) dynamically renders each widget
4. **LLM Updates**: Lambda/Claude POSTs new manifest to `/api/manifest` to update dashboard
5. **Instant Update**: Next page load shows new content (no build, no deploy)

See [MANIFEST.md](MANIFEST.md) for detailed manifest schema and LLM integration guide.

### Chat Flow
1. User sends message from ChatWindow component
2. Request goes to `/api/chat` route
3. Route forwards to AWS Lambda with authentication (includes `sessionId` and `chatUrl`)
4. Lambda calls Claude API and returns SSE stream
5. Route parses Lambda response and streams to client
6. ChatWindow displays streaming response

### Lambda Response Format
Lambda returns:
```json
{
  "statusCode": 200,
  "headers": {"Content-Type": "text/event-stream"},
  "body": "data: {\"type\": \"chunk\", \"text\": \"...\"}\n\n..."
}
```

The chat route parses this and streams SSE events to the client.

### Webhook System

The app includes a **real-time webhook system** for delivering messages from external sources (e.g., Lambda) directly to connected chat clients:

1. **POST to `/api/webhook`**: External services send messages with `{message: "...", sessionId: "..."}`
2. **Message Queue**: Messages are added to an in-memory queue and persisted to WEBHOOK_KV
3. **SSE Stream `/api/webhook/stream`**: Connected clients receive messages in real-time
4. **Session Targeting**: Messages with a `sessionId` are delivered only to matching chat sessions
5. **ChatWindow Integration**: The chat automatically subscribes to the webhook stream when open

**Use Case**: Lambda can post analysis results, notifications, or updates directly to the chat without waiting for the user to send another message.

### Dark Mode
- Uses Tailwind's `dark:` classes
- Theme state managed by ThemeProvider context
- Preference saved to localStorage
- Respects system preferences on first visit
- Charts adapt colors based on theme

## Key Components

### WidgetRenderer.tsx
- Dynamically renders widgets based on manifest type
- Supports: KPI, Chart, Markdown, Table
- Handles grid layout via `gridColumn` property

### ChatWindow.tsx
- Client-side chat interface
- Handles SSE streaming from `/api/chat` (for user messages)
- Subscribes to `/api/webhook/stream` (for external notifications)
- Manages session ID persistence

### Widget Components
- **KPICard.tsx**: Simple label/value display
- **ChartCard.tsx**: ECharts wrapper with dark mode support
- **MarkdownWidget.tsx**: Renders markdown content
- **TableWidget.tsx**: Tabular data display

### /api/manifest/route.ts
- **GET**: Returns current manifest from MANIFEST_KV
- **POST**: Updates manifest (requires WEBHOOK_SECRET if set)
- Uses `cache: 'no-store'` for instant updates

### /api/chat/route.ts
- Proxies chat requests to Lambda
- Injects `sessionId` and `chatUrl` metadata
- Streams SSE responses to client

### /api/webhook/route.ts & /api/webhook/stream/route.ts
- **POST /api/webhook**: Receives messages from Lambda
- **GET /api/webhook/stream**: SSE stream for real-time message delivery
- Session-based routing for targeted messages

## Data Flow

### Dashboard Rendering (New Architecture)
1. **Page load**: [page.tsx](app/page.tsx) calls `fetch('/api/manifest', { cache: 'no-store' })`
2. **Manifest API**: Reads manifest from MANIFEST_KV (or returns default)
3. **Widget rendering**: WidgetRenderer dynamically creates widgets
4. **Edge-rendered**: Runs on Cloudflare Edge, no server needed
5. **Instant updates**: Refresh page to see new manifest (no rebuild)

## Important Notes

### Authentication
- API key stored in `.env.local` as `KEY`
- Never commit `.env.local` or `config/.secrets.json`
- Both are in `.gitignore`

### Lambda Integration
- Lambda must return SSE events in the body wrapped in AWS Lambda response format
- Events use format: `{type: 'chunk'|'done'|'error', text?: string, usage?: object}`
- Chat route unwraps and forwards to client

### Deployment
1. **Frontend (Cloudflare Pages)**:
   - Build command: `npm run build:cf`
   - Node version: 18+
   - Set environment variable: `NEXT_PUBLIC_API_BASE`

2. **Worker (API)**:
   ```bash
   cd worker
   npm install
   npm run deploy
   ```

### Adding New Metrics
1. Add JSON file to `/public/data/`
2. Update Worker to cache endpoint (optional)
3. Fetch in `page.tsx` using `fetchJSON()`
4. Display using existing or new components

### Styling Guidelines
- Use Tailwind utility classes
- **Always include dark mode variants for every frontend feature**: `dark:bg-slate-800`, `dark:text-slate-100`, etc.
- Use slate color palette for consistency
- Maintain responsive design: `md:`, `lg:` breakpoints

## Common Tasks

### Update Claude Model
Change `CLAUDE_MODEL` in `.env.local`

### Adjust Timeouts
Modify `CHAT_FETCH_TIMEOUT_MS` and `CHAT_IDLE_TIMEOUT_MS` in `.env.local`

### Add New Chart
1. Create data structure in JSON
2. Add to `page.tsx` using `ChartCard` component
3. Pass `title`, `categories`, and `series` props

### Customize Theme Colors
1. Extend Tailwind config in `tailwind.config.cjs`
2. Update components with new color classes
3. Update ECharts colors in `ChartCard.tsx`

## Troubleshooting

### Chat not working
- Check `LAMBDA_FUNCTION_URL` is set correctly
- Verify `KEY` environment variable exists
- Check Lambda returns correct response format
- Look for errors in browser console and server logs

### Dark mode not applying
- Ensure `darkMode: 'class'` is in `tailwind.config.cjs`
- Check ThemeProvider wraps the entire app
- Verify `dark:` classes are present on elements

### Charts not displaying
- Check data format matches expected structure
- Verify ECharts is installed: `npm list echarts`
- Check browser console for errors

### Build fails
- Run `npm install` to update dependencies
- Check Node version (requires 18+)
- Clear `.next` folder and rebuild

## Git Workflow

### Before Committing
1. Review changes: `git status` and `git diff`
2. Ensure no secrets in files
3. Test locally: `npm run dev`

### Commit Format
```
Brief description of changes

- Detailed point 1
- Detailed point 2
```

**Note**: Do NOT add authorship info, "Generated with Claude Code", or "Co-Authored-By" lines to commit messages.

## Resources
- [Next.js Docs](https://nextjs.org/docs)
- [Tailwind CSS Docs](https://tailwindcss.com/docs)
- [ECharts Documentation](https://echarts.apache.org/en/index.html)
- [Cloudflare Pages](https://developers.cloudflare.com/pages/)
- [Claude API Docs](https://docs.anthropic.com/)
