# Webhook Integration Guide

## Overview

The chat window can receive real-time messages from external services via webhook. Messages are delivered instantly through Server-Sent Events (SSE).

## Architecture

The architecture uses Cloudflare's native infrastructure for resilience and scale.

```
External Service → POST /api/webhook (CF Function) → Cloudflare Queue → Queue Consumer (CF Function) → Cloudflare KV → SSE Stream → Chat Window
```

## Setup

### 1. Environment Variables (Optional)

Set your webhook secret in your Cloudflare project's secrets. This is more secure than a file.

For Pages projects, use:
```bash
npx wrangler pages secret put WEBHOOK_SECRET
```

If set, all webhook requests must include this secret in the `X-Webhook-Secret` header.

### 2. Sending Webhook Messages

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

- SSE has a heartbeat to keep the connection alive.
- The browser will automatically attempt to reconnect on network issues.
- Messages are stored temporarily in Cloudflare KV and will be picked up by the client upon reconnection.

### Testing locally

```bash
# Terminal 1: Start dev server
npm run dev

# Terminal 2: Send test webhook
curl -X POST http://localhost:3000/api/webhook \
  -H "Content-Type": "application/json" \
  -d '{"message": "Test message!"}'
```

## Production Deployment

### Cloudflare Pages/Workers

- The previous in-memory queue has been replaced with **Cloudflare Queues** and **Cloudflare KV** for persistent, reliable message delivery. This architecture is production-ready.
- Set `WEBHOOK_SECRET` in your project's secrets using `npx wrangler pages secret put WEBHOOK_SECRET`.
- Bindings for the queue and KV store are managed in `wrangler.toml`.

### Scaling Considerations

The current implementation using Cloudflare Queues and KV is designed for high-traffic production and already addresses previous scaling concerns.

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