// app/api/chat/route.ts
import { NextRequest } from 'next/server';

export const runtime = 'edge';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

function dedupeConsecutiveMessages(messages: Message[]): Message[] {
  const result: Message[] = [];
  let lastKey: string | null = null;
  for (const msg of messages) {
    const key = `${msg.role}:${msg.content}`;
    if (key === lastKey) continue;
    result.push(msg);
    lastKey = key;
  }
  return result;
}

// Timeout for Lambda response (3 minutes to match Lambda timeout)
const FETCH_TIMEOUT_MS = Number(process.env.CHAT_FETCH_TIMEOUT_MS ?? 180_000);

async function getApiAuthToken(): Promise<string | null> {
  return process.env.KEY || null;
}

export async function GET() {
  return new Response('Chat API is running.', { status: 200 });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      messages?: Message[];
      message?: string;
      stream?: boolean;
      model?: string;
      max_tokens?: number;
  sessionId?: string;
  chatUrl?: string;
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

    conversationHistory = dedupeConsecutiveMessages(conversationHistory);
    console.log(`Processing: ${conversationHistory.length} history messages + 1 new message`);

    // Set user_id
    const userId = '0000';

    console.log(`User ID: ${userId}`);

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
        metadata: { user_id: userId },
      };
      const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : undefined;
      const chatUrl = typeof body.chatUrl === 'string' && body.chatUrl.trim() ? body.chatUrl.trim() : undefined;
      if (sessionId) {
        payload.session_id = sessionId;
        (payload.metadata as Record<string, unknown>).session_id = sessionId;
      }
      if (chatUrl) {
        payload.chat_url = chatUrl;
        (payload.metadata as Record<string, unknown>).chat_url = chatUrl;
      }
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

    // Lambda RESPONSE_STREAM mode streams directly - don't buffer!
    // Stream and transform chunks as they arrive
    console.log('[chat] Starting to stream Lambda response');

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const transformedStream = new ReadableStream({
      async start(controller) {
        if (!upstream.body) {
          console.error('[chat] No upstream body');
          controller.close();
          return;
        }

        const reader = upstream.body.getReader();
        let buffer = '';
        let eventCount = 0;

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              console.log(`[chat] Stream completed, processed ${eventCount} events`);
              break;
            }

            // Decode chunk and add to buffer
            buffer += decoder.decode(value, { stream: true });

            // Process complete SSE events (delimited by \n\n)
            let boundary = buffer.indexOf('\n\n');
            while (boundary !== -1) {
              const event = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);

              if (event.trim()) {
                eventCount++;

                // Extract data lines from event
                const dataLines = event
                  .split('\n')
                  .filter((l) => l.startsWith('data: '))
                  .map((l) => l.slice(6));

                if (dataLines.length === 0) {
                  // Pass through non-data lines (event:, id:, etc.)
                  controller.enqueue(encoder.encode(event + '\n\n'));
                } else {
                  const dataPayload = dataLines.join('');

                  if (dataPayload === '[DONE]') {
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                  } else {
                    try {
                      const parsed = JSON.parse(dataPayload) as {
                        type?: string;
                        metadata?: Record<string, unknown>;
                        [k: string]: unknown;
                      };

                      // Inject metadata
                      parsed.metadata = { ...(parsed.metadata ?? {}), user_id: userId };

                      const modified = 'data: ' + JSON.stringify(parsed) + '\n\n';
                      controller.enqueue(encoder.encode(modified));

                      // Debug log (only for non-chunk events to reduce noise)
                      if (parsed.type !== 'chunk') {
                        console.log('[chat] Event forwarded:', { type: parsed.type, user_id: userId });
                      }
                    } catch (parseError) {
                      console.error('[chat] Failed to parse SSE event:', dataPayload.substring(0, 100));
                      // Pass through unparseable data
                      controller.enqueue(encoder.encode('data: ' + dataPayload + '\n\n'));
                    }
                  }
                }
              }

              boundary = buffer.indexOf('\n\n');
            }
          }

          // Flush any remaining buffer
          if (buffer.trim()) {
            console.log('[chat] Flushing remaining buffer:', buffer.substring(0, 100));
            controller.enqueue(encoder.encode(buffer + '\n\n'));
          }
        } catch (error) {
          console.error('[chat] Stream processing error:', error);
          controller.error(error);
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
