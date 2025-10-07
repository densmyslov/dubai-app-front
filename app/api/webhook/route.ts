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

// Handle CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Webhook-Secret',
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    // Optional: Check webhook secret for security
    const webhookSecret = process.env.WEBHOOK_SECRET;
    if (webhookSecret) {
      const providedSecret = request.headers.get('X-Webhook-Secret');
      console.log('Expected secret:', webhookSecret);
      console.log('Provided secret:', providedSecret);
      console.log('Match:', providedSecret === webhookSecret);
      if (providedSecret !== webhookSecret) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          {
            status: 401,
            headers: {
              'Access-Control-Allow-Origin': '*',
            },
          }
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
        {
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const { message, sessionId } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required and must be a string' },
        {
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // Add message to queue
    const webhookMessage = messageQueue.addMessage(message.trim(), sessionId);

    return NextResponse.json(
      {
        success: true,
        messageId: webhookMessage.id,
        timestamp: webhookMessage.timestamp,
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      {
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

// Health check endpoint
export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      activeConnections: messageQueue.getListenerCount(),
    },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}
