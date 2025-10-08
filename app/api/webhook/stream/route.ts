// app/api/webhook/stream/route.ts
import { NextRequest } from 'next/server';

function getKV(): KVNamespace | undefined {
  // Cloudflare injects the binding at runtime on globalThis in Pages/Workers
  return (globalThis as any).WEBHOOK_KV as KVNamespace | undefined;
}

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId') ?? 'global';
  const kv = getKV();

  if (!kv) {
    return new Response(JSON.stringify({ error: 'KV store not configured.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (type: string, data: unknown) => {
        controller.enqueue(enc.encode(`event: ${type}\n`));
        controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const heartbeat = () => controller.enqueue(enc.encode(`: heartbeat\n\n`));

      send('connected', { message: 'Connection established with KV store' });

      let lastKey = '';
      const prefix = `session:${sessionId}:`;

      const tick = async () => {
        try {
          const list = await kv.list({ prefix, limit: 100 });
          if (list.keys.length) {
            for (const key of list.keys) {
              if (lastKey && key.name <= lastKey) continue;
              const value = await kv.get(key.name, 'json');
              if (value !== null) send('webhook_message', value);
            }
            lastKey = list.keys[list.keys.length - 1].name;
          }
          heartbeat();
        } catch (e) {
          send('error', { message: (e as Error).message ?? 'unknown error' });
        }
      };

      const interval = setInterval(tick, 2000);
      tick();

      const abort = () => {
        clearInterval(interval);
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
