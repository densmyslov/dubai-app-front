// app/api/chat/route.ts
import { NextRequest } from 'next/server';

export const runtime = 'edge';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const FETCH_TIMEOUT_MS = Number(process.env.CHAT_FETCH_TIMEOUT_MS ?? 30_000);

async function getApiAuthToken(): Promise<string | null> {
  return process.env.KEY || null;
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

    // Extract conversation history and current message
    let messageText: string;
    let conversationHistory: Message[] = [];

    if (Array.isArray(body.messages) && body.messages.length > 0) {
      const lastMessage = body.messages[body.messages.length - 1];
      if (!lastMessage || lastMessage.role !== 'user') {
        return new Response('Last message must be from user', { status: 400 });
      }
      messageText = lastMessage.content;
      if (body.messages.length > 1) {
        conversationHistory = body.messages.slice(0, -1);
      }
    } else if (typeof body.message === 'string' && body.message.length > 0) {
      messageText = body.message;
      conversationHistory = [];
    } else {
      return new Response('Invalid request: message or messages required', { status: 400 });
    }

    console.log(`Processing: ${conversationHistory.length} history messages + 1 new message`);

    // Generate query_id and set user_id
    const queryId = crypto.randomUUID();
    const userId = '0000';

    console.log(`Query ID: ${queryId}, User ID: ${userId}`);

    // headers + auth
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    const clientApiKey = request.headers.get('x-api-key');
    const clientAuth = request.headers.get('authorization');
    const serverApiKey = await getApiAuthToken();
    const apiKey = clientApiKey || clientAuth || serverApiKey;
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    const resolvedModel = (() => {
      const candidate = typeof body.model === 'string' ? body.model.trim() : '';
      if (candidate) return candidate;
      const envModel = typeof process.env.CLAUDE_MODEL === 'string'
        ? process.env.CLAUDE_MODEL.trim()
        : '';
      return envModel || undefined;
    })();

    const resolvedMaxTokens =
      typeof body.max_tokens === 'number' && Number.isFinite(body.max_tokens)
        ? body.max_tokens
        : 4096;

    // upstream fetch with timeout
    const ac = new AbortController();
    const fetchTimeout = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

    let upstream: Response;
    try {
      const payload: Record<string, unknown> = {
        message: messageText,
        conversation_history: conversationHistory,
        stream: body.stream !== false, // default true
        max_tokens: resolvedMaxTokens,
        metadata: {
          query_id: queryId,
          user_id: userId,
        },
      };
      if (resolvedModel) payload.model = resolvedModel;

      upstream = await fetch(lambdaUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
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

    if (!upstream.ok) {
      const errorText = await upstream.text().catch(() => '');
      console.error('Lambda API error:', upstream.status, errorText);
      return new Response(errorText || `Upstream error ${upstream.status}`, {
        status: upstream.status,
      });
    }

    // Transform the SSE stream to inject metadata
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const transformedStream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete SSE events delimited by blank line
            const events = buffer.split('\n\n');
            buffer = events.pop() || ''; // keep incomplete tail

            for (const event of events) {
              if (!event.trim()) {
                controller.enqueue(encoder.encode('\n\n'));
                continue;
              }

              // Collect all data lines (support multi-line data payloads)
              const dataLines = event
                .split('\n')
                .filter((l) => l.startsWith('data: '))
                .map((l) => l.slice(6));

              if (dataLines.length === 0) {
                // passthrough non-data lines (event:, id:, retry:, comments, etc.)
                controller.enqueue(encoder.encode(event + '\n\n'));
                continue;
              }

              const dataPayload = dataLines.join('');
              if (dataPayload === '[DONE]') {
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                continue;
              }

              try {
                const parsed = JSON.parse(dataPayload) as {
                  type?: string;
                  metadata?: Record<string, unknown>;
                  [k: string]: unknown;
                };

                // Inject metadata
                parsed.metadata = {
                  ...(parsed.metadata ?? {}),
                  query_id: queryId,
                  user_id: userId,
                };

                const modified = 'data: ' + JSON.stringify(parsed) + '\n\n';
                controller.enqueue(encoder.encode(modified));

                // Debug log
                console.log('Injected metadata:', {
                  query_id: queryId,
                  user_id: userId,
                  type: parsed.type,
                });
              } catch {
                        controller.enqueue(encoder.encode('data: ' + dataPayload + '\n\n'));
                      }

            }
          }
        } catch (error) {
          console.error('Stream transform error:', error);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(transformedStream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(`Internal server error: ${String(error)}`, { status: 500 });
  }
}

// This is a simplified in-memory store for demonstration.
// In a real-world serverless environment, you'd use a distributed pub/sub system.
const clients = new Set<ReadableStreamDefaultController>();

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

// This is a global function that the webhook can call.
(global as any).broadcastMessage = broadcast;

export async function GET(request: NextRequest) {
  const stream = new ReadableStream({
    start(controller) {
      clients.add(controller);
      console.log('Client connected. Total clients:', clients.size);
    },
    cancel(reason) {
      // 'this' is not available in arrow functions, so we need to find the controller to remove it.
      // This simple implementation can't do that without iterating, so we'll rely on the controller being closed.
      // For a robust solution, you'd map controllers to an ID.
      console.log('Client disconnected check. Total clients:', clients.size);
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