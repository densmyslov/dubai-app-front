# Dubai Real Estate Dashboard - Development Instructions

## Project Overview
This is a Next.js 14 application that displays Dubai real estate investment analytics with interactive charts, KPIs, and an integrated Claude AI chat assistant.

## Tech Stack
- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS with dark mode support
- **Charts**: ECharts
- **AI Chat**: Claude API via AWS Lambda
- **Deployment**: Cloudflare Pages + Cloudflare Workers

## Key Features
1. Real estate analytics dashboard with interactive charts
2. Community league table with investor metrics
3. Claude AI chat integration
4. Dark/light theme toggle
5. Server-side rendering with edge caching

## Project Structure
```
/app
  /api/chat         # Chat API route (proxies to Lambda)
  /components       # React components
  /lib              # Utilities and config
  /page.tsx         # Main dashboard page
/public/data        # Sample JSON data
/worker             # Cloudflare Worker for API caching
```

## Environment Variables

### Required (.env.local)
```
KEY=<your-api-key>                          # API key for Lambda authentication
LAMBDA_FUNCTION_URL=<lambda-url>            # AWS Lambda function URL
CLAUDE_MODEL=claude-3-5-sonnet-20241022     # Claude model to use (optional)
NEXT_PUBLIC_API_BASE=<worker-url>           # Cloudflare Worker URL (optional)
```

### Optional
```
CHAT_FETCH_TIMEOUT_MS=30000    # Overall timeout for Lambda requests
CHAT_IDLE_TIMEOUT_MS=20000     # Idle timeout for streaming
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

### Chat Flow
1. User sends message from ChatWindow component
2. Request goes to `/api/chat` route
3. Route forwards to AWS Lambda with authentication
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

### Dark Mode
- Uses Tailwind's `dark:` classes
- Theme state managed by ThemeProvider context
- Preference saved to localStorage
- Respects system preferences on first visit
- Charts adapt colors based on theme

## Key Components

### ChatWindow.tsx
- Client-side chat interface
- Handles SSE streaming from `/api/chat`
- Expects events in format: `{type: 'chunk', text: '...'}`

### ChartCard.tsx
- ECharts wrapper component
- Observes DOM for dark mode changes
- Dynamically updates chart colors

### ThemeProvider.tsx & ThemeToggle.tsx
- Context-based theme management
- Handles SSR hydration properly
- Persists theme preference

### /api/chat/route.ts
- Proxies chat requests to Lambda
- Handles Lambda's wrapped SSE response format
- Adds authentication from environment variables
- Implements request timeouts

## Data Flow

### Dashboard Data
1. Server fetches from Cloudflare Worker API (if `NEXT_PUBLIC_API_BASE` set)
2. Falls back to local `/public/data/*.json` files
3. Data includes:
   - League table (net yield, price-to-rent, etc.)
   - Rent per m² time series
   - Price-to-rent time series

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
- Always include dark mode variants: `dark:bg-slate-800`
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
