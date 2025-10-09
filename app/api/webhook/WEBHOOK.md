# Webhook Integration Guide

## Overview

The chat window ingests external events through a webhook and relays them to connected clients over Server-Sent Events (SSE). Incoming payloads are persisted in Cloudflare KV so that any user who connects (or reconnects) can replay recent history instantly.

## Architecture

The architecture uses Cloudflare's native infrastructure for resilience and scale.

```
External Service → POST /api/webhook (Pages Function) → Webhook Handler (Edge Runtime)
        ↘ persists to Cloudflare KV (WEBHOOK_KV)
          ↘ in-memory queue for live fan-out → SSE Stream (/api/webhook/stream) → Chat Window
```

- **Webhook handler** runs on the Cloudflare Pages Edge runtime. It validates the shared secret (optional), stores each message in Cloudflare KV, and pushes it to an in-memory queue for connected streams.
- **KV storage** (`WEBHOOK_KV`) keeps the last 100 messages for replay across isolates and reconnects.
- **SSE stream** combines KV history with the live queue and polls KV every 5 seconds to ensure no messages are missed.

## Setup

### 1. Configure secrets (optional but recommended)

Create a shared secret so only trusted systems can POST to the webhook. In a Pages project you can set it with Wrangler:

```bash
npx wrangler pages secret put WEBHOOK_SECRET
```

If configured, every webhook request must send the same value in the `X-Webhook-Secret` header.

### 2. Bind the KV namespace

The webhook relies on a KV namespace bound as `WEBHOOK_KV` to persist recent messages. You can create and bind it either through the Cloudflare dashboard (Pages project → Settings → Functions → KV Namespace Bindings) or via Wrangler:

```bash
# Create the namespace once
npx wrangler kv namespace create WEBHOOK_KV

# For Pages deployments, bind the namespace to the project
npx wrangler pages project kv add WEBHOOK_KV --namespace WEBHOOK_KV
```

> Make sure the binding name is exactly `WEBHOOK_KV`; the runtime expects this name.

### 3. Deploy or redeploy the project

Deploying after the KV binding is in place ensures the new environment variables are available to the edge runtime. For example:

```bash
npm run deploy
```

### 4. Send a webhook message

#### Endpoint
```
POST https://your-app.com/api/webhook
```

#### Headers
```
Content-Type: application/json
X-Webhook-Secret: your-secret-key-here  # Optional, only if WEBHOOK_SECRET is set
```

#### Request Body
```json
{
  "message": "Your message text here",
  "sessionId": "optional-session-id"  // Optional: target specific chat session
}
```

#### Response
```json
{
  "success": true,
  "messageId": "a-random-uuid",
  "timestamp": 1234567890000
}
```

### 3. Example: cURL

```bash
curl -X POST https://your-app.com/api/webhook \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: your-secret-key-here" \
  -d '{"message": "Hello from external service!"}'
```

### 5. Verify the SSE stream

Open a stream connection and confirm you receive both historical and new messages:

```bash
curl -N https://your-app.com/api/webhook/stream
```

- On connect, you should see a `data: {"type":"connected"...}` event.
- Previously stored messages arrive with `"type":"webhook_message"`.
- Sending another webhook POST while the stream is open should show a new `webhook_message` event immediately.

## Health Check

Check webhook service status:

```bash
GET https://your-app.com/api/webhook
```

Response:
```json
{
  "status": "ok"
}
```

## Session Targeting (Advanced)

To send a message to a specific user's chat window, include their `sessionId` in the webhook payload. The `sessionId` is available in the chat client.

## Reliability

### Connection drops

- SSE emits heartbeat comments every 2 seconds to keep the connection warm.
- Browsers automatically reconnect and request missed events.
- Because each webhook is stored in Cloudflare KV, reconnecting clients replay the latest 100 messages.

### Testing locally

```bash
# Terminal 1: Start dev server
npm run dev

# Terminal 2: Send test webhook (secret header optional locally)
curl -X POST http://localhost:3000/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"message": "Test message!"}'

# Terminal 3: Observe the stream
curl -N http://localhost:3000/api/webhook/stream
```

## Production Deployment

### Cloudflare Pages/Workers

- Ensure `WEBHOOK_SECRET` (optional) and the `WEBHOOK_KV` binding are configured in the Pages project.
- Deploy normally—no additional Worker configuration is required because the functions live inside the Next.js app.

### Scaling Considerations

- The combination of KV persistence and periodic polling ensures webhook deliveries are durable across isolates.
- The SSE endpoint deduplicates messages by ID, so adding more webhook senders or clients scales linearly.

## API Reference

### POST /api/webhook

**Request:**
- `message` (string, required): Message content
- `sessionId` (string, optional): Target session ID

**Response:**
- `success` (boolean): Operation status
- `messageId` (string): Unique message identifier
- `timestamp` (number): Unix timestamp in milliseconds

**Error Codes:**
- `401 Unauthorized`: Invalid or missing webhook secret
- `400 Bad Request`: Missing or invalid message
- `500 Internal Server Error`: Server error

### GET /api/webhook

**Response:**
- `status` (string): Service status ("ok")

### GET /api/webhook/stream

**Query Parameters:**
- `sessionId` (optional): Filter messages by session

**Response:**
Server-Sent Events stream with:
- `type: 'connected'`: Initial connection confirmation
- `type: 'webhook_message'`: New webhook message
- Heartbeat comments every 2 seconds