// app/api/webhook/stream/route.ts
import { NextRequest } from 'next/server';

export const runtime = 'edge';

type Listener = (payload: unknown) => void;

declare global {
  // eslint-disable-next-line no-var
  var __webhookListeners: Map<string, Set<Listener>> | undefined;
  // eslint-disable-next-line no-var
  var addWebhookListener: ((sessionId: string, fn: Listener) => void) | undefined;
  // eslint-disable-next-line no-var
  var removeWebhookListener: ((sessionId: string, fn: Listener) => void) | undefined;
  // eslint-disable-next-line no-var
  var broadcastWebhookMessage: ((sessionId: string, payload: unknown) => void) | undefined;
}

// Minimal global bus (idempotent)
if (!(global as any).__webhookListeners) {
  (global as any).__webhookListeners = new Map<string, Set<Listener>>();
  (global as any).addWebhookListener = (sid: string, fn: Listener) => {
    const m = (global as any).__webhookListeners as Map<string, Set<Listener>>;
    if (!m.has(sid)) m.set(sid, new Set());
    m.get(sid)!.add(fn);
  };
  (global as any).removeWebhookListener = (sid: string, fn: Listener) => {
    const m = (global as any).__webhookListeners as Map<string, Set<Listener>>;
    m.get(sid)?.delete(fn);
  };
  (global as any).broadcastWebhookMessage = (sid: string, payload: unknown) => {
    const m = (global as any).__webhookListeners as Map<string, Set<Listener>>;
    m.get(sid)?.forEach((fn) => { try { fn(payload); } catch {} });
  };
}

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      // subscribe this client
      (global as any).addWebhookListener?.('global', send);

      const abort = () => {
        try { controller.close(); } catch {}
        (global as any).removeWebhookListener?.('global', send);
        request.signal.removeEventListener('abort', abort);
      };

      // clean up on disconnect
      request.signal.addEventListener('abort', abort);

      // optional initial ping
      send({ ok: true, connected: true, ts: new Date().toISOString() });
    },
    cancel() {
      // extra safety: if cancel is called by the runtime
      // the abort handler above will already handle close & unsubscribe
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

