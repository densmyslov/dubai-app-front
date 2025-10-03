// app/api/chat/route.ts
import { NextRequest } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

export const runtime = 'nodejs';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const FETCH_TIMEOUT_MS = Number(process.env.CHAT_FETCH_TIMEOUT_MS ?? 30_000); // overall timeout
const IDLE_TIMEOUT_MS  = Number(process.env.CHAT_IDLE_TIMEOUT_MS  ?? 20_000); // stall timeout

async function getApiAuthToken(): Promise<string | null> {
  return process.env.KEY || null;
}

export async function GET() {
  return new Response('chat api ok', { status: 200 });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      messages?: Message[];
      message?: string;
      stream?: boolean;
      model?: string;
      max_tokens?: number;
    };

    const lambdaUrl = process.env.LAMBDA_FUNCTION_URL;
    if (!lambdaUrl) {
      return new Response('LAMBDA_FUNCTION_URL not configured', { status: 500 });
    }

    // normalise input
    let messageText: string;
    if (typeof body.message === 'string' && body.message.length > 0) {
      messageText = body.message;
    } else if (Array.isArray(body.messages) && body.messages.length > 0) {
      const lastMessage = body.messages[body.messages.length - 1];
      if (!lastMessage || lastMessage.role !== 'user') {
        return new Response('No user message found', { status: 400 });
      }
      messageText = lastMessage.content;
    } else {
      return new Response('Invalid request: message or messages required', { status: 400 });
    }

    // headers + auth
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    const clientApiKey = request.headers.get('x-api-key');
    const clientAuth   = request.headers.get('authorization');
    const serverApiKey = await getApiAuthToken();
    const apiKey = clientApiKey || clientAuth || serverApiKey;
    if (apiKey) {
      headers['x-api-key'] = apiKey;
      headers['authorization'] = apiKey; // Lambda reads this one in your setup
    }

    // upstream fetch with timeout
    const ac = new AbortController();
    const fetchTimeout = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

    let upstream: Response;
    try {
      upstream = await fetch(lambdaUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: messageText,
          stream: body.stream !== false, // default true
          model: body.model || process.env.CLAUDE_MODEL || null,
          max_tokens: body.max_tokens || 4096,
        }),
        signal: ac.signal,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        console.error('Lambda fetch timeout');
        return new Response('Upstream timeout', { status: 504 });
      }
      console.error('Lambda fetch failed:', err);
      return new Response('Failed to reach Lambda', { status: 502 });
    } finally {
      clearTimeout(fetchTimeout);
    }

    // forward upstream errors verbatim
    if (!upstream.ok) {
      const errorText = await upstream.text().catch(() => '');
      console.error('Lambda API error:', upstream.status, errorText);
      return new Response(errorText || `Upstream error ${upstream.status}`, {
        status: upstream.status,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // Parse Lambda response (it returns {statusCode, headers, body})
    const lambdaResponse = await upstream.json();
    const sseBody = lambdaResponse.body || '';

    // Stream the SSE body to client
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // Parse SSE events from the body string
        const events = sseBody.split('\n\n').filter((e: string) => e.trim());

        for (const event of events) {
          if (event.startsWith('data: ')) {
            try {
              const data = JSON.parse(event.substring(6));

              // Forward the event as-is (Lambda already sends {type: 'chunk', text: '...'})
              if (data.type === 'chunk' || data.type === 'done' || data.type === 'error') {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
                );
              }
            } catch (e) {
              console.error('Failed to parse SSE event:', e);
            }
          }
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
    // ---- end tolerant streaming
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
