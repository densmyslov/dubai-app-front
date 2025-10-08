// app/api/webhook/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

// In-memory store for SSE clients.
const clients = new Set<ReadableStreamDefaultController>();
let keepAliveInterval: NodeJS.Timeout;

function broadcast(message: any) {
  const formattedMessage = `data: ${JSON.stringify(message)}\n\n`;
  clients.forEach(controller => {
    try {
      controller.enqueue(new TextEncoder().encode(formattedMessage));
    } catch (e) {
      console.error('Failed to send to a client, removing.', e);
      clients.delete(controller);
    }
  });
}

// SSE connection handler
export async function GET(request: NextRequest) {
  const stream = new ReadableStream({
    start(controller) {
      clients.add(controller);
      console.log(`Client connected. Total clients: ${clients.size}`);

      // Start keep-alive if this is the first client
      if (clients.size === 1) {
        keepAliveInterval = setInterval(() => {
          // Sending a comment to keep the connection alive
          controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
        }, 10000);
      }

      request.signal.addEventListener('abort', () => {
        clients.delete(controller);
        console.log(`Client disconnected. Total clients: ${clients.size}`);
        // Stop keep-alive if no clients are left
        if (clients.size === 0) {
          clearInterval(keepAliveInterval);
        }
      });
    },
    cancel() {
      // This is called when the client side closes the connection.
      // The abort listener above will handle cleanup.
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// Webhook POST handler
export async function POST(request: NextRequest) {
  try {
    const body: any = await request.json();
    console.log('Webhook received:', body);

    broadcast({
      id: new Date().toISOString(),
      text: body.message || 'No message content',
    });

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

