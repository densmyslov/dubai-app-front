import { NextRequest } from 'next/server';
import { messageQueue } from '../../../lib/messageQueue';

// ============================================================================
// SSE Stream for Webhook Messages
// ============================================================================
// Provides a Server-Sent Events stream that delivers webhook messages
// in real-time to connected chat clients.
//
// Usage:
//   GET /api/webhook/stream?sessionId=optional-session-id
// ============================================================================

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId') || undefined;

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial connection message
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`
        )
      );

      // Subscribe to new messages
      const unsubscribe = messageQueue.subscribe((message) => {
        // Filter by sessionId if provided
        if (sessionId && message.sessionId && message.sessionId !== sessionId) {
          return;
        }

        // Send message as SSE event
        const data = {
          type: 'webhook_message',
          id: message.id,
          content: message.content,
          timestamp: message.timestamp,
        };

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      });

      // Send recent messages on connection (optional, for message history)
      const recentMessages = messageQueue.getRecentMessages(5, sessionId);
      if (recentMessages.length > 0) {
        recentMessages.forEach((message) => {
          const data = {
            type: 'webhook_message',
            id: message.id,
            content: message.content,
            timestamp: message.timestamp,
            isHistory: true,
          };

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        });
      }

      // Heartbeat to keep connection alive (every 30 seconds)
      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch (error) {
          clearInterval(heartbeatInterval);
        }
      }, 30000);

      // Cleanup on disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeatInterval);
        unsubscribe();
        controller.close();
      });
    },
  });

  // Return SSE response
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
