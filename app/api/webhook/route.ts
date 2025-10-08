import { NextRequest } from 'next/server';

export const runtime = 'nodejs'; // or 'edge' if you intend to run at the edge

type Listener = (payload: unknown) => void;

declare global {
  // Optional global registry; if you already define these elsewhere, keep those.
  // eslint-disable-next-line no-var
  var __webhookListeners: Map<string, Set<Listener>> | undefined;
  // eslint-disable-next-line no-var
  var addWebhookListener:
    | ((sessionId: string, fn: Listener) => void)
    | undefined;
  // eslint-disable-next-line no-var
  var removeWebhookListener:
    | ((sessionId: string, fn: Listener) => void)
    | undefined;
  // eslint-disable-next-line no-var
  var broadcastWebhookMessage:
    | ((sessionId: string, payload: unknown) => void)
    | undefined;
}

// Minimal global registry (safe if already defined)
if (!(global as any).__webhookListeners) {
  (global as any).__webhookListeners = new Map<string, Set<Listener>>();

  (global as any).addWebhookListener = (sessionId: string, fn: Listener) => {
    const m = (global as any).__webhookListeners as Map<string, Set<Listener>>;
    if (!m.has(sessionId)) m.set(sessionId, new Set());
    m.get(sessionId)!.add(fn);
  };

  (global as any).removeWebhookListener = (sessionId: string, fn: Listener) => {
    const m = (global as any).__webhookListeners as Map<string, Set<Listener>>;
    m.get(sessionId)?.delete(fn);
  };

  (global as any).broadcastWebhookMessage = (
    sessionId: string,
    payload: unknown
  ) => {
    const m = (global as any).__webhookListeners as Map<string, Set<Listener>>;
    m.get(sessionId)?.forEach((fn) => {
      try {
        fn(payload);
      } catch {
        // no-op
      }
    });
  };
}

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        const chunk = `data: ${JSON.stringify(payload)}\n\n`;
        controller.enqueue(encoder.encode(chunk));
      };

      // Subscribe this client to the "global" session.
      (global as any).addWebhookListener?.('global', send);

      const abort = () => {
        try {
          controller.close();
        } catch {}
        (global as any).removeWebhookListener?.('global', send);
        request.signal.removeEventListener('abort', abort);
      };

      // Clean up if the client disconnects
      request.signal.addEventListener('abort', abort);

      // Optional: send an initial ping so client knows it’s connected
      send({ ok: true, connected: true, ts: new Date().toISOString() });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

