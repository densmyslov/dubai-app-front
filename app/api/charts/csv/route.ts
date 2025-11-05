import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

// ============================================================================
// CSV Proxy API Endpoint
// ============================================================================
// Proxies CSV requests from R2 to add CORS headers.
// This solves the issue where pub-*.r2.dev URLs don't respect CORS policies.
//
// Usage:
//   GET /api/charts/csv?url=https://pub-xxx.r2.dev/path/to/file.csv
// ============================================================================

export async function OPTIONS() {
	return new NextResponse(null, {
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		},
	});
}

export async function GET(request: NextRequest) {
	try {
		// Get CSV URL from query parameter
		const searchParams = request.nextUrl.searchParams;
		const csvUrl = searchParams.get('url');

		if (!csvUrl) {
			return NextResponse.json(
				{ error: 'Missing "url" query parameter' },
				{
					status: 400,
					headers: {
						'Access-Control-Allow-Origin': '*',
					},
				}
			);
		}

		// Validate URL format
		if (!csvUrl.startsWith('https://')) {
			return NextResponse.json(
				{ error: 'URL must use HTTPS protocol' },
				{
					status: 400,
					headers: {
						'Access-Control-Allow-Origin': '*',
					},
				}
			);
		}

		// Optionally restrict to R2 domains for security
		const isR2Url = csvUrl.includes('.r2.dev/') || csvUrl.includes('.r2.cloudflarestorage.com/');
		if (!isR2Url) {
			console.warn('[csv-proxy] Non-R2 URL requested:', csvUrl);
			// Uncomment to enforce R2-only URLs:
			// return NextResponse.json(
			// 	{ error: 'Only R2 URLs are allowed' },
			// 	{ status: 403, headers: { 'Access-Control-Allow-Origin': '*' } }
			// );
		}

		console.log('[csv-proxy] Fetching CSV from:', csvUrl);

		// Fetch CSV from R2
		const response = await fetch(csvUrl, {
			method: 'GET',
			headers: {
				'Accept': 'text/csv, text/plain, */*',
			},
		});

		if (!response.ok) {
			console.error('[csv-proxy] R2 fetch failed:', response.status, response.statusText);
			return NextResponse.json(
				{
					error: `Failed to fetch CSV: ${response.status} ${response.statusText}`,
				},
				{
					status: response.status,
					headers: {
						'Access-Control-Allow-Origin': '*',
					},
				}
			);
		}

		// Get CSV content
		const csvData = await response.text();

		console.log('[csv-proxy] Successfully fetched CSV:', csvData.length, 'bytes');

		// Return CSV with CORS headers
		return new NextResponse(csvData, {
			status: 200,
			headers: {
				'Content-Type': 'text/csv',
				'Access-Control-Allow-Origin': '*',
				'Cache-Control': 'public, max-age=3600', // 1 hour cache
			},
		});
	} catch (error) {
		console.error('[csv-proxy] Error:', error);
		return NextResponse.json(
			{
				error: 'Internal server error',
				details: error instanceof Error ? error.message : 'Unknown error',
			},
			{
				status: 500,
				headers: {
					'Access-Control-Allow-Origin': '*',
				},
			}
		);
	}
}
