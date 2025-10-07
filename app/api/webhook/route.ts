import { NextRequest, NextResponse } from 'next/server';
import { messageQueue } from '../../lib/messageQueue';

// ============================================================================
// Webhook API Endpoint
// ============================================================================
// Receives external POST requests and adds messages to the queue for
// delivery to chat clients via SSE.
//
// Usage:
//   POST /api/webhook
//   Headers:
//     Content-Type: application/json
//     X-Webhook-Secret: <your-secret> (optional, for security)
//   Body:
//     {
//       "message": "Your message here",
//       "sessionId": "optional-session-id"
//     }
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Optional: Check webhook secret for security
    const webhookSecret = process.env.WEBHOOK_SECRET;
    if (webhookSecret) {
      const providedSecret = request.headers.get('X-Webhook-Secret');
      if (providedSecret !== webhookSecret) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
    }

    // Read request body as text first for better error handling
    const text = await request.text();

    let body;
    try {
      body = JSON.parse(text);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.error('Received body:', text);
      return NextResponse.json(
        { error: 'Invalid JSON' },
        { status: 400 }
      );
    }

    const { message, sessionId } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required and must be a string' },
        { status: 400 }
      );
    }

    // Add message to queue
    const webhookMessage = messageQueue.addMessage(message.trim(), sessionId);

    return NextResponse.json({
      success: true,
      messageId: webhookMessage.id,
      timestamp: webhookMessage.timestamp,
    });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    activeConnections: messageQueue.getListenerCount(),
  });
}
