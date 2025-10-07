# Webhook Integration Guide

## Overview

The chat window can receive real-time messages from external services via webhook. Messages are delivered instantly through Server-Sent Events (SSE).

## Architecture

```
External Service → POST /api/webhook → Message Queue → SSE Stream → Chat Window
```

## Setup

### 1. Environment Variables (Optional)

Add to `.env.local` for webhook authentication:

```bash
WEBHOOK_SECRET=your-secret-key-here
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
  "messageId": "1234567890-abc123",
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

### 4. Example: JavaScript/Node.js

```javascript
async function sendWebhookMessage(message) {
  const response = await fetch('https://your-app.com/api/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': 'your-secret-key-here',
    },
    body: JSON.stringify({ message }),
  });

  return response.json();
}

// Usage
await sendWebhookMessage('Alert: New property listed in Dubai Marina!');
```

### 5. Example: Python

```python
import requests

def send_webhook_message(message, session_id=None):
    url = "https://your-app.com/api/webhook"
    headers = {
        "Content-Type": "application/json",
        "X-Webhook-Secret": "your-secret-key-here"
    }
    data = {"message": message}

    if session_id:
        data["sessionId"] = session_id

    response = requests.post(url, json=data, headers=headers)
    return response.json()

# Usage
send_webhook_message("Price alert: Marina apartments -5%!")
```

## Message Display

Webhook messages appear in the chat window with:
- **Purple background** (light/dark mode support)
- **"Webhook" badge** with envelope icon
- **Left-aligned** (distinguishable from user/assistant messages)

## Health Check

Check webhook service status:

```bash
GET https://your-app.com/api/webhook
```

Response:
```json
{
  "status": "ok",
  "activeConnections": 3
}
```

## Session Targeting (Advanced)

To send messages to specific chat sessions:

1. Generate a unique session ID in your frontend
2. Pass it when connecting to the SSE stream: `/api/webhook/stream?sessionId=abc123`
3. Include the same `sessionId` in webhook requests

This prevents messages from appearing in all open chats.

## Use Cases

- **Real Estate Alerts**: Price drops, new listings, market updates
- **Notifications**: System alerts, important updates
- **Third-Party Integrations**: Zapier, IFTTT, custom automations
- **Admin Broadcasts**: Send messages to all active users
- **Bot Responses**: External AI/bot services sending responses

## Security Considerations

1. **Always use WEBHOOK_SECRET** in production
2. **Validate message content** before sending
3. **Rate limiting**: Consider implementing rate limits for webhook endpoint
4. **HTTPS only**: Never use HTTP for webhook endpoints
5. **Log webhook activity**: Monitor for abuse/debugging

## Troubleshooting

### Messages not appearing

1. Check chat window is open (SSE connection only active when open)
2. Verify webhook secret matches (if using authentication)
3. Check browser console for SSE errors
4. Verify webhook endpoint returns `success: true`

### Connection drops

- SSE has 30-second heartbeat to keep connection alive
- Browser will auto-reconnect on network issues
- Recent messages (last 5) are replayed on reconnection

### Testing locally

```bash
# Terminal 1: Start dev server
npm run dev

# Terminal 2: Send test webhook
curl -X POST http://localhost:3000/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"message": "Test message!"}'
```

## Production Deployment

### Cloudflare Pages/Workers

- Works out-of-the-box with Cloudflare Pages
- In-memory queue resets on worker restarts (consider Durable Objects for persistence)
- Set `WEBHOOK_SECRET` in Cloudflare Pages environment variables

### Scaling Considerations

For high-traffic production:
1. Replace in-memory queue with Redis or Cloudflare KV
2. Implement webhook request rate limiting
3. Use Cloudflare Durable Objects for distributed state
4. Add message persistence for reliability

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
- `activeConnections` (number): Number of active SSE connections

### GET /api/webhook/stream

**Query Parameters:**
- `sessionId` (optional): Filter messages by session

**Response:**
Server-Sent Events stream with:
- `type: 'connected'`: Initial connection confirmation
- `type: 'webhook_message'`: New webhook message
- Heartbeat comments every 30 seconds

## Example Integration: Zapier

1. Create a Zapier webhook trigger
2. Add a "POST" action to your app's webhook endpoint
3. Set headers and body as shown in examples above
4. Test the connection
5. Messages will appear in real-time in the chat window
