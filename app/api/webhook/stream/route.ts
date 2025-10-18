import { NextRequest } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { KVNamespace } from '@cloudflare/workers-types';
import { messageQueue, type WebhookMessage } from '../../../lib/messageQueue';
import { getRecentMessagesFromKV } from '../../../lib/webhookStorage';

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
	const env = getRequestContext().env as Record<string, unknown>;
	const kv = env.WEBHOOK_KV as KVNamespace | undefined;
	const recentFromKV = kv ? await getRecentMessagesFromKV(kv, 20, sessionId) : [];

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();

			// Immediately confirm connection
			controller.enqueue(
				encoder.encode(
					`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`
				)
			);

			let lastTimestamp = recentFromKV.length
				? recentFromKV[recentFromKV.length - 1]?.timestamp ?? 0
				: 0;

			// Deliver new messages as they arrive
			const unsubscribe = messageQueue.subscribe((message) => {
				console.log('[webhook/stream] Message received:', {
					messageSessionId: message.sessionId,
					streamSessionId: sessionId,
					willDeliver: !(sessionId && message.sessionId && message.sessionId !== sessionId)
				});

				if (sessionId && message.sessionId && message.sessionId !== sessionId) {
					console.log('[webhook/stream] Filtering out message due to sessionId mismatch');
					return;
				}

				lastTimestamp = Math.max(lastTimestamp, message.timestamp);

				const payload = {
					type: 'webhook_message',
					id: message.id,
					content: message.content,
					timestamp: message.timestamp,
				};

				console.log('[webhook/stream] Delivering message to client:', payload.id);
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
			});

			const history: WebhookMessage[] = [...recentFromKV];
			const existingIds = new Set(history.map((item) => item.id));
			const localRecent = messageQueue.getRecentMessages(20, sessionId);
			for (const message of localRecent) {
				if (!existingIds.has(message.id)) {
					history.push(message);
				}
			}
			history.sort((a, b) => a.timestamp - b.timestamp);

			for (const message of history.slice(-20)) {
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

			const poller = kv
				? setInterval(async () => {
					try {
						const latest = await getRecentMessagesFromKV(kv, 20, sessionId);
						const newMessages = latest.filter((message) => message.timestamp > lastTimestamp);

						if (newMessages.length === 0) {
							return;
						}

						newMessages.sort((a, b) => a.timestamp - b.timestamp);
						for (const message of newMessages) {
							lastTimestamp = Math.max(lastTimestamp, message.timestamp);
							controller.enqueue(
								encoder.encode(
									`data: ${JSON.stringify({
										type: 'webhook_message',
										id: message.id,
										content: message.content,
										timestamp: message.timestamp,
									})}\n\n`
								)
							);
						}
					} catch (error) {
						console.error('KV poll failed:', error);
					}
				}, 5_000)
				: null;

			request.signal.addEventListener('abort', () => {
				clearInterval(heartbeat);
				unsubscribe();
				if (poller) {
					clearInterval(poller);
				}
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
