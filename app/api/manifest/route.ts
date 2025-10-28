import { NextRequest, NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { KVNamespace } from '@cloudflare/workers-types';
import { DEFAULT_MANIFEST, type Manifest } from '../../lib/manifest';

export const runtime = 'edge';

const MANIFEST_KEY = 'dashboard:manifest';

// ============================================================================
// GET /api/manifest - Retrieve current dashboard manifest
// ============================================================================
export async function GET() {
	try {
		// Try to get Cloudflare KV (only available in production/Cloudflare Pages)
		let kv: KVNamespace | undefined;
		try {
			const env = getRequestContext().env as Record<string, unknown>;
			kv = env.MANIFEST_KV as KVNamespace | undefined;
		} catch (error) {
			// Local dev: Cloudflare context not available, return default manifest
			console.log('[manifest] Running in local dev mode (no KV), returning default');
		}

		if (!kv) {
			console.warn('[manifest] MANIFEST_KV not available, returning default manifest');
			return NextResponse.json(DEFAULT_MANIFEST, {
				headers: {
					'Cache-Control': 'no-store, no-cache, must-revalidate',
				},
			});
		}

		const stored = await kv.get(MANIFEST_KEY, 'text');
		const manifest: Manifest = stored ? JSON.parse(stored) : DEFAULT_MANIFEST;

		return NextResponse.json(manifest, {
			headers: {
				'Cache-Control': 'no-store, no-cache, must-revalidate',
			},
		});
	} catch (error) {
		console.error('[manifest] GET error:', error);
		return NextResponse.json(DEFAULT_MANIFEST, {
			headers: {
				'Cache-Control': 'no-store, no-cache, must-revalidate',
			},
		});
	}
}

// ============================================================================
// POST /api/manifest - Update dashboard manifest (for LLM webhook)
// ============================================================================
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

		const body = await request.json();
		const { manifest } = body as { manifest?: Manifest };

		if (!manifest || typeof manifest !== 'object') {
			return NextResponse.json(
				{ error: 'Invalid manifest: must provide a manifest object' },
				{ status: 400 }
			);
		}

		// Validate manifest structure
		if (!manifest.version || !Array.isArray(manifest.widgets)) {
			return NextResponse.json(
				{ error: 'Invalid manifest: must have version and widgets array' },
				{ status: 400 }
			);
		}

		// Add updatedAt timestamp
		manifest.updatedAt = new Date().toISOString();

		const env = getRequestContext().env as Record<string, unknown>;
		const kv = env.MANIFEST_KV as KVNamespace | undefined;

		if (!kv) {
			return NextResponse.json(
				{ error: 'MANIFEST_KV not configured' },
				{ status: 500 }
			);
		}

		await kv.put(MANIFEST_KEY, JSON.stringify(manifest));

		console.log('[manifest] Updated manifest with', manifest.widgets.length, 'widgets');

		return NextResponse.json(
			{
				success: true,
				timestamp: manifest.updatedAt,
				widgetCount: manifest.widgets.length,
			},
			{
				headers: {
					'Access-Control-Allow-Origin': '*',
				},
			}
		);
	} catch (error) {
		console.error('[manifest] POST error:', error);
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

// Handle CORS preflight
export async function OPTIONS() {
	return new NextResponse(null, {
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, X-Webhook-Secret',
		},
	});
}
