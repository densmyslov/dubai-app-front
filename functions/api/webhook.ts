interface Env {
  MESSAGE_QUEUE: Queue;
  WEBHOOK_SECRET?: string;
}

interface WebhookBody {
  message: string;
  sessionId?: string;
}

// This handles POST requests to /api/webhook
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // 1. Authenticate
  if (env.WEBHOOK_SECRET) {
    const secret = request.headers.get('X-Webhook-Secret');
    if (secret !== env.WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  // 2. Validate Body
  let body: unknown;
  try {
    body = await request.json();
  } catch (e) {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Safely check if body is an object and has a 'message' property of type string
  if (
    !body ||
    typeof body !== 'object' ||
    !('message' in body) ||
    typeof (body as WebhookBody).message !== 'string'
  ) {
    return new Response('Bad Request: "message" property is required and must be a string.', { status: 400 });
  }

  // 3. Enqueue Message
  try {
    // At this point, TypeScript knows body is a valid WebhookBody
    await env.MESSAGE_QUEUE.send(body as WebhookBody);
    const responseBody = {
      success: true,
      messageId: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    return new Response(JSON.stringify(responseBody), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('Failed to enqueue message:', e);
    return new Response(`Failed to process webhook: ${e.message}`, { status: 500 });
  }
};

// This handles GET requests for the health check
export const onRequestGet: PagesFunction = async () => {
    return new Response(JSON.stringify({ status: "ok" }), {
        headers: { 'Content-Type': 'application/json' },
    });
};