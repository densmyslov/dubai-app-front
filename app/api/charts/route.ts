import { NextRequest, NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { KVNamespace } from '@cloudflare/workers-types';
import { chartQueue, type ChartConfig } from '../../lib/chartQueue';
import { appendChartToKV } from '../../lib/chartStorage';

export const runtime = 'edge';

// ============================================================================
// Chart Webhook API Endpoint
// ============================================================================
// Receives external POST requests with chart configurations and adds them
// to the queue for delivery to dashboard clients via SSE.
//
// This endpoint is separate from the chat webhook to avoid cluttering
// the chat interface with chart data.
//
// Usage:
//   POST /api/charts
//   Headers:
//     Content-Type: application/json
//     X-Webhook-Secret: <your-secret> (optional, for security)
//   Body:
//     {
//       "action": "add" | "update" | "remove",
//       "chartId": "unique-chart-id",
//       "sessionId": "optional-session-id",
//       "config": {
//         "title": "Chart Title",
//         "chartType": "line",
//         "categories": ["Jan", "Feb", "Mar"],
//         "series": [
//           {
//             "name": "Series 1",
//             "data": [100, 200, 150]
//           }
//         ]
//       }
//     }
// ============================================================================

// Handle CORS preflight
export async function OPTIONS() {
	return new NextResponse(null, {
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, X-Webhook-Secret',
		},
	});
}

export async function POST(request: NextRequest) {
	try {
		// Optional: Check webhook secret for security
		// Supports separate CHART_WEBHOOK_SECRET or falls back to WEBHOOK_SECRET
		const webhookSecret = (
			process.env.CHART_WEBHOOK_SECRET?.trim() ||
			process.env.WEBHOOK_SECRET?.trim()
		);
		if (webhookSecret) {
			const providedSecret = request.headers.get('X-Webhook-Secret')?.trim();
			if (!providedSecret || providedSecret !== webhookSecret) {
				return NextResponse.json(
					{ error: 'Unauthorized' },
					{
						status: 401,
						headers: {
							'Access-Control-Allow-Origin': '*',
						},
					}
				);
			}
		}

		// Read request body
		const text = await request.text();

		let body: {
			action?: unknown;
			chartId?: unknown;
			sessionId?: unknown;
			session_id?: unknown; // Accept snake_case from backend
			config?: unknown;
		};
		try {
			body = JSON.parse(text);
		} catch (parseError) {
			console.error('JSON parse error:', parseError);
			console.error('Received body:', text);
			return NextResponse.json(
				{ error: 'Invalid JSON' },
				{
					status: 400,
					headers: {
						'Access-Control-Allow-Origin': '*',
					},
				}
			);
		}

		// Accept both sessionId (camelCase) and session_id (snake_case)
		const { action, chartId, config } = body;
		const sessionId = body.sessionId || body.session_id;

		console.log('[charts/route] Received request:', {
			action,
			chartId,
			sessionId,
			hasSessionId: !!body.sessionId,
			hasSession_id: !!body.session_id,
		});

		// Validate action
		if (
			typeof action !== 'string' ||
			!['add', 'update', 'remove'].includes(action)
		) {
			return NextResponse.json(
				{
					error:
						'Action is required and must be one of: add, update, remove',
				},
				{
					status: 400,
					headers: {
						'Access-Control-Allow-Origin': '*',
					},
				}
			);
		}

		// Validate chartId
		if (typeof chartId !== 'string' || chartId.trim().length === 0) {
			return NextResponse.json(
				{ error: 'chartId is required and must be a non-empty string' },
				{
					status: 400,
					headers: {
						'Access-Control-Allow-Origin': '*',
					},
				}
			);
		}

		// Validate config for add/update actions
		if (action !== 'remove') {
			if (!config || typeof config !== 'object') {
				return NextResponse.json(
					{ error: 'config is required for add/update actions' },
					{
						status: 400,
						headers: {
							'Access-Control-Allow-Origin': '*',
						},
					}
				);
			}

			const chartConfig = config as Record<string, unknown>;
			if (
				typeof chartConfig.title !== 'string' ||
				typeof chartConfig.chartType !== 'string' ||
				!Array.isArray(chartConfig.series)
			) {
				return NextResponse.json(
					{
						error:
							'config must include title (string), chartType (string), and series (array)',
					},
					{
						status: 400,
						headers: {
							'Access-Control-Allow-Origin': '*',
						},
					}
				);
			}
		}

		const resolvedSessionId =
			typeof sessionId === 'string' && sessionId.trim().length > 0
				? sessionId
				: undefined;

		// Add to queue based on action
		let chartMessage;
		switch (action) {
			case 'add':
				chartMessage = chartQueue.addChart(
					chartId.trim(),
					config as ChartConfig,
					resolvedSessionId
				);
				break;
			case 'update':
				chartMessage = chartQueue.updateChart(
					chartId.trim(),
					config as ChartConfig,
					resolvedSessionId
				);
				break;
			case 'remove':
				chartMessage = chartQueue.removeChart(
					chartId.trim(),
					resolvedSessionId
				);
				break;
			default:
				return NextResponse.json(
					{ error: 'Invalid action' },
					{
						status: 400,
						headers: {
							'Access-Control-Allow-Origin': '*',
						},
					}
				);
		}

		// Persist to KV storage for Cloudflare edge runtime
		const env = getRequestContext().env as Record<string, unknown>;
		const kv = env.CHART_KV as KVNamespace | undefined;
		if (kv) {
			try {
				await appendChartToKV(kv, chartMessage);
				console.log('[charts/route] Chart persisted to KV:', chartMessage.chartId);
			} catch (kvError) {
				console.error('[charts/route] Failed to persist chart to KV:', kvError);
			}
		} else {
			console.warn('[charts/route] CHART_KV not available, chart will only exist in memory');
		}

		return NextResponse.json(
			{
				success: true,
				messageId: chartMessage.id,
				chartId: chartMessage.chartId,
				action,
				timestamp: chartMessage.timestamp,
			},
			{
				headers: {
					'Access-Control-Allow-Origin': '*',
				},
			}
		);
	} catch (error) {
		console.error('Chart webhook error:', error);
		return NextResponse.json(
			{ error: 'Internal server error' },
			{
				status: 500,
				headers: {
					'Access-Control-Allow-Origin': '*',
				},
			}
		);
	}
}

// Health check endpoint
export async function GET() {
	return NextResponse.json(
		{
			status: 'ok',
			activeConnections: chartQueue.getListenerCount(),
		},
		{
			headers: {
				'Access-Control-Allow-Origin': '*',
			},
		}
	);
}
