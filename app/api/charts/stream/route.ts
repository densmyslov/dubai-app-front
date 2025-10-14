import { NextRequest } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { KVNamespace } from '@cloudflare/workers-types';
import { chartQueue, type ChartMessage } from '../../../lib/chartQueue';
import { getRecentChartsFromKV } from '../../../lib/chartStorage';

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
	const env = getRequestContext().env as Record<string, unknown>;
	const kv = env.CHART_KV as KVNamespace | undefined;

	// Load recent charts from KV storage (fallback to in-memory queue)
	const recentFromKV = kv ? await getRecentChartsFromKV(kv, 20, sessionId) : [];
	console.log('[charts/stream] Loaded from KV:', recentFromKV.length, 'charts');

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();

			// Immediately confirm connection
			controller.enqueue(
				encoder.encode(
					`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`
				)
			);

			// Deliver charts from KV as history
			for (const message of recentFromKV) {
				const payload = {
					type: message.type,
					chartId: message.chartId,
					config: message.config,
					timestamp: message.timestamp,
					isHistory: true,
				};

				console.log('[charts/stream] Delivering chart from KV:', message.chartId);
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
			}

			// Also check in-memory queue for recent charts (in case KV is not available)
			const localHistory = chartQueue.getRecentMessages(20, sessionId);
			const kvChartIds = new Set(recentFromKV.map(m => m.chartId));
			for (const message of localHistory) {
				if (!kvChartIds.has(message.chartId)) {
					const payload = {
						type: message.type,
						chartId: message.chartId,
						config: message.config,
						timestamp: message.timestamp,
						isHistory: true,
					};

					console.log('[charts/stream] Delivering chart from memory:', message.chartId);
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
				}
			}

			// Subscribe to new chart messages
			const unsubscribe = chartQueue.subscribe((message: ChartMessage) => {
				// Strict session filtering: only deliver if sessionId matches exactly
				const shouldDeliver = sessionId
					? message.sessionId === sessionId
					: !message.sessionId; // If no sessionId in stream, only show global charts

				console.log('[charts/stream] Message received:', {
					chartId: message.chartId,
					messageSessionId: message.sessionId,
					streamSessionId: sessionId,
					shouldDeliver,
				});

				if (!shouldDeliver) {
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
