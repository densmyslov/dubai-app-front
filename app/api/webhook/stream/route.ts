import { NextRequest } from 'next/server';

// The Cloudflare runtime provides the KV binding on process.env in Pages Functions.
const getKV = () => {
  // @ts-expect-error - WEBHOOK_KV is injected by the Cloudflare runtime and is not visible to TypeScript during the build process.
  return process.env.WEBHOOK_KV as KVNamespace | undefined;
};

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId') || 'global';
  const kv = getKV();

  if (!kv) {
    const errorResponse = JSON.stringify({ error: "KV store not configured." });
    return new Response(errorResponse, { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let lastKey = ''; // Keep track of the last key sent to avoid duplicates

      const send = (type: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${type}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      send('connected', { message: 'Connection established with KV store' });

      const interval = setInterval(async () => {
        const prefix = `session:${sessionId}:`;
        // Poll for new keys
        const list = await kv.list({ prefix, limit: 20 });

        if (list.keys.length > 0) {
          for (const key of list.keys) {
            // Only process keys that are newer than the last one we sent
            if (key.name > lastKey) {
                const value = await kv.get(key.name);
                if (value) {
                  send('webhook_message', JSON.parse(value));
                }
            }
          }
          // Update our position to the last key we've seen in this batch
          lastKey = list.keys[list.keys.length - 1].name;
        }
        
        // Send a comment as a heartbeat to keep the connection alive
        controller.enqueue(encoder.encode(': heartbeat\n\n'));
      }, 2000); // Poll every 2 seconds

      // Clean up the interval when the client disconnects
      request.signal.onabort = () => {
        clearInterval(interval);
        controller.close();
      };
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
