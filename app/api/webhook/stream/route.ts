// app/api/webhook/stream/route.ts
import { NextRequest } from 'next/server';

// If you're on next-on-pages, KV is usually on globalThis.
// You can also set this via a simple shim in _worker.ts if needed.
function getKV(): KVNamespace | undefined {
  // @ts-expect-error runtime binding provided by Cloudflare
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

      // Optional: keep-alive comments
      const heartbeat = () => controller.enqueue(enc.encode(`: heartbeat\n\n`));

      send('connected', { message: 'Connection established with KV store' });

      let lastKey = ''; // track the highest (lexicographically) key we've sent
      const prefix = `session:${sessionId}:`;

      const tick = async () => {
        try {
          // Note: KV list is paginated; if you expect bursts > limit, loop with cursors.
          const list = await kv.list({ prefix, limit: 100 });

          if (list.keys.length > 0) {
            // If your keys include a sortable suffix (e.g., ISO timestamp), this works.
            // Otherwise, persist a "last processed" pointer in KV instead of local memory.
            for (const key of list.keys) {
              if (lastKey && key.name <= lastKey) continue;

              const value = await kv.get(key.name, 'json'); // typed JSON
              if (value !== null) {
                send('webhook_message', value);
              }
            }
            lastKey = list.keys[list.keys.length - 1].name;
          }

          heartbeat();
        } catch (err) {
          send('error', { message: (err as Error).message ?? 'unknown error' });
        }
      };

      const interval = setInterval(tick, 2000);
      // kick immediately so the client doesn't wait 2s for first batch
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
      // Helps on some proxies/CDNs
      'X-Accel-Buffering': 'no',
    },
  });
}
