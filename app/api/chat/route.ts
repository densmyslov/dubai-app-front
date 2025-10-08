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

    // Extract conversation history and current message
    let messageText: string;
    let conversationHistory: Message[] = [];

    if (Array.isArray(body.messages) && body.messages.length > 0) {
      // Messages array provided - extract history and current message
      const lastMessage = body.messages[body.messages.length - 1];
      if (!lastMessage || lastMessage.role !== 'user') {
        return new Response('Last message must be from user', { status: 400 });
      }
      messageText = lastMessage.content;

      // All messages except the last one become conversation history
      if (body.messages.length > 1) {
        conversationHistory = body.messages.slice(0, -1);
      }
    } else if (typeof body.message === 'string' && body.message.length > 0) {
      // Single message provided - no history
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
    const clientAuth   = request.headers.get('authorization');
    const serverApiKey = await getApiAuthToken();
    const apiKey = clientApiKey || clientAuth || serverApiKey;
    if (apiKey) {
      headers['x-api-key'] = apiKey;
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
          conversation_history: conversationHistory,
          stream: body.stream !== false, // default true
          model: body.model || process.env.CLAUDE_MODEL || null,
          max_tokens: body.max_tokens || 4096,
          metadata: {
            query_id: queryId,
            user_id: userId,
          },
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

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data === '[DONE]') {
                  controller.enqueue(encoder.encode(line + '\n'));
                  continue;
                }

                try {
                  const parsed = JSON.parse(data);

                  // Inject metadata into every event
                  if (!parsed.metadata) {
                    parsed.metadata = {};
                  }
                  parsed.metadata.query_id = queryId;
                  parsed.metadata.user_id = userId;

                  const modifiedLine = 'data: ' + JSON.stringify(parsed) + '\n';
                  controller.enqueue(encoder.encode(modifiedLine));

                  // Log for debugging
                  console.log('Injected metadata:', { query_id: queryId, user_id: userId, type: parsed.type });
                } catch (parseError) {
                  // If not valid JSON, pass through as-is
                  console.log('Failed to parse SSE data, passing through:', data.substring(0, 50));
                  controller.enqueue(encoder.encode(line + '\n'));
                }
              } else if (line) {
                // Pass through other lines (like empty lines)
                controller.enqueue(encoder.encode(line + '\n'));
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
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(`Internal server error: ${error}`, { status: 500 });
  }
}
