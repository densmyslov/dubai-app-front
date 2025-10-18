import { NextRequest, NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { KVNamespace } from '@cloudflare/workers-types';
import { messageQueue, type WebhookMessage } from '../../lib/messageQueue';
import { appendMessageToKV, getRecentMessagesFromKV } from '../../lib/webhookStorage';

export const runtime = 'edge';

// ============================================================================
// Webhook API Endpoint
// ============================================================================
// Receives external POST requests and adds messages to the queue for
// retrieval by chat clients via periodic polling.
//
// Usage:
//   POST /api/webhook
//   Headers:
//     Content-Type: application/json
//     X-Webhook-Secret: <your-secret> (optional, for security)
//   Body:
//     {
//       "message": "Your message here",
//       "sessionId": "optional-session-id"
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
		const webhookSecret = process.env.WEBHOOK_SECRET?.trim();
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

		// Read request body as text first for better error handling
		const text = await request.text();

		let body: { message?: unknown; sessionId?: unknown };
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

		const { message, sessionId } = body;

		if (typeof message !== 'string' || message.trim().length === 0) {
			return NextResponse.json(
				{ error: 'Message is required and must be a non-empty string' },
				{
					status: 400,
					headers: {
						'Access-Control-Allow-Origin': '*',
					},
				}
			);
		}

		// Add message to queue
		const webhookMessage = messageQueue.addMessage(
			message.trim(),
			typeof sessionId === 'string' && sessionId.trim().length > 0
				? sessionId
				: undefined
		);

		const env = getRequestContext().env as Record<string, unknown>;
		const kv = env.WEBHOOK_KV as KVNamespace | undefined;
		if (kv) {
			try {
				await appendMessageToKV(kv, webhookMessage);
			} catch (kvError) {
				console.error('Failed to persist webhook message to KV:', kvError);
			}
		}

		return NextResponse.json(
			{
				success: true,
				messageId: webhookMessage.id,
				timestamp: webhookMessage.timestamp,
			},
			{
				headers: {
					'Access-Control-Allow-Origin': '*',
				},
			}
		);
	} catch (error) {
		console.error('Webhook error:', error);
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

// Retrieve webhook messages for the client poller
export async function GET(request: NextRequest) {
	const { searchParams } = request.nextUrl;
	const sessionId = searchParams.get('sessionId') || undefined;
	const sinceParam = searchParams.get('since');
	const limitParam = searchParams.get('limit');

	const limit = limitParam
		? Math.min(Math.max(Number.parseInt(limitParam, 10) || 0, 1), 100)
		: 50;
	const since =
		sinceParam !== null ? Number.parseInt(sinceParam, 10) || undefined : undefined;
	const fetchWindow = Math.max(limit, 100);

	const env = getRequestContext().env as Record<string, unknown>;
	const kv = env.WEBHOOK_KV as KVNamespace | undefined;

	const kvMessages = kv
		? await getRecentMessagesFromKV(kv, fetchWindow, sessionId)
		: [];
	const queueMessages = messageQueue.getRecentMessages(fetchWindow, sessionId);

	const deduped = new Map<string, WebhookMessage>();
	for (const message of [...kvMessages, ...queueMessages]) {
		deduped.set(message.id, message);
	}

	let messages = Array.from(deduped.values()).sort(
		(a, b) => a.timestamp - b.timestamp
	);

	if (since !== undefined) {
		messages = messages.filter((message) => message.timestamp > since);
	}

	if (messages.length > limit) {
		messages = messages.slice(-limit);
	}

	return NextResponse.json(
		{ messages },
		{
			headers: {
				'Access-Control-Allow-Origin': '*',
			},
		}
	);
}
