import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

// ============================================================================
// CSV Proxy Endpoint
// ============================================================================
// Proxies CSV requests from R2 to avoid CORS issues.
// R2 buckets may not have CORS headers configured properly, so we fetch
// the CSV server-side and return it to the client with proper CORS headers.
//
// Usage:
//   GET /api/charts/csv?url=https://pub-xxx.r2.dev/path/to/file.csv
// ============================================================================

export async function GET(request: NextRequest) {
	try {
		const { searchParams } = new URL(request.url);
		const csvUrl = searchParams.get('url');

		if (!csvUrl) {
			return NextResponse.json(
				{ error: 'Missing url parameter' },
				{ status: 400 }
			);
		}

		// Validate URL format
		if (!csvUrl.startsWith('http://') && !csvUrl.startsWith('https://')) {
			return NextResponse.json(
				{ error: 'Invalid URL format. Must be HTTP(S).' },
				{ status: 400 }
			);
		}

		// Security: Only allow R2 URLs to prevent abuse as an open proxy
		const isR2Url = csvUrl.includes('.r2.dev/') || csvUrl.includes('.r2.cloudflarestorage.com/');
		if (!isR2Url) {
			return NextResponse.json(
				{ error: 'Only R2 URLs are allowed through this proxy' },
				{ status: 403 }
			);
		}

		console.log('[csv proxy] Fetching CSV from R2:', csvUrl);

		// Fetch CSV from R2
		const response = await fetch(csvUrl, {
			method: 'GET',
			headers: {
				'Accept': 'text/csv, text/plain, */*',
			},
		});

		if (!response.ok) {
			console.error('[csv proxy] Failed to fetch CSV:', response.status, response.statusText);
			return NextResponse.json(
				{ error: `Failed to fetch CSV: ${response.status} ${response.statusText}` },
				{ status: response.status }
			);
		}

		const csvData = await response.text();

		console.log('[csv proxy] CSV fetched successfully, size:', csvData.length, 'bytes');

		// Return CSV with proper CORS headers
		return new NextResponse(csvData, {
			status: 200,
			headers: {
				'Content-Type': 'text/csv; charset=utf-8',
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
				'Cache-Control': 'public, max-age=18000', // Cache for 5 hours
			},
		});
	} catch (error) {
		console.error('[csv proxy] Error:', error);
		return NextResponse.json(
			{ error: 'Failed to proxy CSV request' },
			{ status: 500 }
		);
	}
}

// Handle CORS preflight
export async function OPTIONS() {
	return new NextResponse(null, {
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		},
	});
}
