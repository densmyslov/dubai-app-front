// app/api/webhook/stream/route.ts
import { NextRequest } from 'next/server';

export const runtime = 'edge';

// This is a simplified in-memory store. In a real-world serverless environment,
// you would use a distributed pub/sub system like Cloudflare Pub/Sub, KV, or a third-party service.
const clients = new Map<string, Set<ReadableStreamDefaultController>>();

function getSessionClients(sessionId: string): Set<ReadableStreamDefaultController> {
  if (!clients.has(sessionId)) {
    clients.set(sessionId, new Set());
  }
  return clients.get(sessionId)!;
}

function broadcast(sessionId: string, message: any) {
  const sessionClients = getSessionClients(sessionId);
  const formattedMessage = `data: ${JSON.stringify(message)}\n\n`;
  
  sessionClients.forEach(controller => {
    try {
      controller.enqueue(new TextEncoder().encode(formattedMessage));
    } catch (e) {
      console.error('Failed to send to a client, removing.', e);
      sessionClients.delete(controller);
    }
  });
}

// Make the broadcast function globally accessible for the POST handler.
(global as any).broadcastWebhookMessage = broadcast;

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId') || 'global';
  const sessionClients = getSessionClients(sessionId);

  const stream = new ReadableStream({
    start(controller) {
      sessionClients.add(controller);
      console.log(`Client connected to session [${sessionId}]. Total clients: ${sessionClients.size}`);
    },
    cancel() {
      // This stream is now closed, but we need to find which controller to remove.
      // A robust solution would map controllers to a unique ID on connect.
      // For this simple case, we rely on the error handling in broadcast to clean up.
      console.log(`A client from session [${sessionId}] disconnected.`);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
        try { controller.close(); } catch {}
      };
      request.signal.addEventListener('abort', abort);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
