import { NextRequest } from 'next/server';
import { messageQueue } from '../../../lib/messageQueue';

export const runtime = 'edge';

// ============================================================================
// SSE Stream for Webhook Messages
// ============================================================================
// Provides a Server-Sent Events stream that delivers webhook messages
// in real-time to connected chat clients.
//
// Usage:
//   GET /api/webhook/stream?sessionId=optional-session-id
// ============================================================================

export async function GET(request: NextRequest) {
	const sessionId = request.nextUrl.searchParams.get('sessionId') || undefined;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();

			// Immediately confirm connection
			controller.enqueue(
				encoder.encode(
					`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`
				)
			);

			// Deliver new messages as they arrive
			const unsubscribe = messageQueue.subscribe((message) => {
				if (sessionId && message.sessionId && message.sessionId !== sessionId) {
					return;
				}

				const payload = {
					type: 'webhook_message',
					id: message.id,
					content: message.content,
					timestamp: message.timestamp,
				};

				controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
			});

			// Replay a small history on connect to smooth reconnects
			const recent = messageQueue.getRecentMessages(5, sessionId);
			for (const message of recent) {
				const payload = {
					type: 'webhook_message',
					id: message.id,
					content: message.content,
					timestamp: message.timestamp,
					isHistory: true,
				};

				controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
			}

			// Heartbeat keeps Cloudflare connection alive
			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(': heartbeat\n\n'));
				} catch {
					clearInterval(heartbeat);
				}
			}, 30_000);

			request.signal.addEventListener('abort', () => {
				clearInterval(heartbeat);
				unsubscribe();
				controller.close();
			});
		},
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
		},
	});
}
