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

    // ---- tolerant streaming: handle SSE and non-SSE upstreams
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const upstreamCT = upstream.headers.get('content-type') || '';
    const isUpstreamSSE = upstreamCT.includes('text/event-stream');

    // If caller asked for non-streaming, just pass upstream through verbatim
    if (body.stream === false) {
      const text = await upstream.text();
      return new Response(text, {
        status: 200,
        headers: { 'Content-Type': upstreamCT || 'application/json' },
      });
    }

    // Otherwise, stream to the client as SSE. If upstream isn't SSE, wrap chunks.
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const readerAbort = new AbortController();
        const reader = upstream.body?.getReader({ signal: readerAbort.signal });
        if (!reader) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', error: 'No upstream body' })}\n\n`)
          );
          controller.close();
          return;
        }

        let idleTimer: NodeJS.Timeout | null = null;
        const resetIdleTimer = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            try {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'error', error: 'Upstream idle timeout' })}\n\n`)
              );
            } catch {}
            try { reader.cancel('idle timeout'); } catch {}
            try { readerAbort.abort(); } catch {}
            controller.close();
          }, IDLE_TIMEOUT_MS);
        };

        const flushSSE = (event: string) => {
          if (!event.trim()) return;
          if (event.startsWith('data: ')) {
            try {
              const data = JSON.parse(event.substring(6));
              if (data.type === 'chunk') {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: 'chunk', text: data.text ?? '' })}\n\n`)
                );
              } else if (data.type === 'done') {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: 'done', usage: data.usage })}\n\n`)
                );
              } else if (data.type === 'error') {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: 'error', error: data.error })}\n\n`)
                );
              } else {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
              }
            } catch {
              const raw = event.substring(6);
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'chunk', text: raw })}\n\n`)
              );
            }
          } else {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'chunk', text: event })}\n\n`)
            );
          }
        };

        try {
          let buffer = '';
          resetIdleTimer();

          while (true) {
            const { done, value } = await reader.read();
            resetIdleTimer();
            if (done) break;
            if (!value) continue;

            const text = decoder.decode(value, { stream: true });

            if (isUpstreamSSE) {
              buffer += text;
              const events = buffer.split('\n\n');
              buffer = events.pop() || '';
              for (const evt of events) flushSSE(evt);
            } else {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`)
              );
            }
          }

          if (isUpstreamSSE && buffer.trim()) flushSSE(buffer);

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
        } catch (error: any) {
          const msg = error?.name === 'AbortError' ? 'Stream aborted' : (error?.message || 'Stream failure');
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`));
        } finally {
          if (idleTimer) clearTimeout(idleTimer);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });
    // ---- end tolerant streaming
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
