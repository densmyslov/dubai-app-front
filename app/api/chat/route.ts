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

    // Lambda Function URLs always return JSON-wrapped responses
    // Try to parse as JSON first, fall back to text if that fails
    let sseBody: string;
    const responseText = await upstream.text();

    try {
      // Try parsing as AWS Lambda JSON response format
      const lambdaResponse = JSON.parse(responseText) as { statusCode?: number; body?: string; headers?: Record<string, string> };

      if (lambdaResponse.statusCode && lambdaResponse.body !== undefined) {
        // This is AWS Lambda JSON format
        if (lambdaResponse.statusCode !== 200) {
          console.error('Lambda error response:', lambdaResponse);
          return new Response(lambdaResponse.body || 'Lambda error', { status: lambdaResponse.statusCode });
        }

        sseBody = lambdaResponse.body;
        console.log('Unwrapped Lambda JSON response, SSE body length:', sseBody.length);
        console.log('First 500 chars:', sseBody.substring(0, 500));
      } else {
        // JSON but not Lambda format, treat as SSE body
        sseBody = responseText;
        console.log('Direct response (JSON but not Lambda format), body length:', sseBody.length);
      }
    } catch (parseError) {
      // Not JSON, use as-is (direct SSE stream)
      sseBody = responseText;
      console.log('Direct Lambda stream, body length:', sseBody.length);
      console.log('First 500 chars:', sseBody.substring(0, 500));
    }

    // Transform the SSE stream to inject metadata
    const encoder = new TextEncoder();

    const transformedStream = new ReadableStream({
      async start(controller) {
        try {
          // Process complete SSE events delimited by blank line
          const events = sseBody.split('\n\n');
          console.log(`[chat] Processing ${events.length} SSE events from Lambda`);

          for (const event of events) {
            if (!event.trim()) {
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
              if (parsed.type === 'chunk') {
                const textValue = typeof parsed.text === 'string' ? parsed.text : '';
                console.log('Chunk forwarded:', {
                  query_id: queryId,
                  text_length: textValue.length,
                  text_preview: textValue.substring(0, 50),
                });
              } else {
                console.log('Event forwarded:', {
                  query_id: queryId,
                  type: parsed.type,
                });
              }
            } catch (parseError) {
              console.error('[chat] Failed to parse SSE event:', parseError, 'payload:', dataPayload.substring(0, 100));
              controller.enqueue(encoder.encode('data: ' + dataPayload + '\n\n'));
            }

            // Add small delay between events to ensure proper streaming
            await new Promise(resolve => setTimeout(resolve, 10));
          }

          console.log(`[chat] Finished processing all SSE events`);
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