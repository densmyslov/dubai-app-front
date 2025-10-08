// app/api/webhook/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const CACHE_KEY = 'webhook-message-cache-key';

// SSE connection handler (client polls for messages)
export async function GET(request: NextRequest) {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // Function to check cache and send message
      const checkCache = async () => {
        try {
          const cache = caches.default;
          const response = await cache.match(CACHE_KEY);

          if (response) {
            const message = await response.json();
            // Send the message to the client
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
            // Delete the message from the cache so it's not sent again
            await cache.delete(CACHE_KEY);
            console.log('Message sent to client and cache cleared.');
          }
        } catch (e) {
          console.error('Error in cache check:', e);
        }
      };

      // Poll the cache every 2 seconds
      const intervalId = setInterval(checkCache, 2000);

      // Clean up when the client disconnects
      request.signal.addEventListener('abort', () => {
        clearInterval(intervalId);
        controller.close();
        console.log('Client disconnected, polling stopped.');
      });
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

// Webhook POST handler (writes message to cache)
export async function POST(request: NextRequest) {
  try {
    const body: any = await request.json();
    console.log('Webhook received, writing to cache:', body);

    const message = {
      id: new Date().toISOString(),
      text: body.message || 'No message content',
    };

    // Create a response object to store in the cache
    const cacheResponse = new Response(JSON.stringify(message), {
      headers: { 'Content-Type': 'application/json' },
    });

    // Put the response in the default cache
    const cache = caches.default;
    await cache.put(CACHE_KEY, cacheResponse);

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook POST error:', error);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

