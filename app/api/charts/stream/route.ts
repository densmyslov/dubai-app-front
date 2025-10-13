import { NextRequest } from 'next/server';
import { chartQueue, type ChartMessage } from '../../../lib/chartQueue';

export const runtime = 'edge';

// ============================================================================
// SSE Stream for Chart Messages
// ============================================================================
// Provides a Server-Sent Events stream that delivers chart configuration
// updates in real-time to the dashboard. This allows the backend to
// dynamically inject, update, or remove charts without cluttering the
// chat interface.
//
// Usage:
//   GET /api/charts/stream?sessionId=optional-session-id
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

			// Deliver recent chart messages as history
			const history = chartQueue.getRecentMessages(20, sessionId);
			for (const message of history) {
				const payload = {
					type: message.type,
					chartId: message.chartId,
					config: message.config,
					timestamp: message.timestamp,
					isHistory: true,
				};

				controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
			}

			// Subscribe to new chart messages
			const unsubscribe = chartQueue.subscribe((message: ChartMessage) => {
				console.log('[charts/stream] Message received:', {
					chartId: message.chartId,
					messageSessionId: message.sessionId,
					streamSessionId: sessionId,
					willDeliver: !(
						sessionId &&
						message.sessionId &&
						message.sessionId !== sessionId
					),
				});

				// Filter by session if specified
				if (sessionId && message.sessionId && message.sessionId !== sessionId) {
					console.log(
						'[charts/stream] Filtering out message due to sessionId mismatch'
					);
					return;
				}

				const payload = {
					type: message.type,
					chartId: message.chartId,
					config: message.config,
					timestamp: message.timestamp,
				};

				console.log('[charts/stream] Delivering chart message to client:', message.chartId);
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
			});

			// Heartbeat keeps connection alive
			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(': heartbeat\n\n'));
				} catch {
					clearInterval(heartbeat);
				}
			}, 30_000);

			// Cleanup on disconnect
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
