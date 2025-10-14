import { NextResponse } from 'next/server';
import { chartQueue } from '../../../lib/chartQueue';

export const runtime = 'edge';

// ============================================================================
// Clear Chart Queue - Debug Endpoint
// ============================================================================
// Clears the in-memory chart queue. Useful for debugging session isolation.
//
// Usage:
//   POST /api/charts/clear
// ============================================================================

export async function POST() {
	try {
		const countBefore = chartQueue.getRecentMessages(100).length;
		chartQueue.clear();
		const countAfter = chartQueue.getRecentMessages(100).length;

		console.log('[charts/clear] Cleared in-memory queue. Charts removed:', countBefore);

		return NextResponse.json({
			success: true,
			message: 'In-memory chart queue cleared',
			chartsRemoved: countBefore,
			chartsRemaining: countAfter,
		});
	} catch (error) {
		console.error('[charts/clear] Error clearing queue:', error);
		return NextResponse.json(
			{ error: 'Failed to clear queue' },
			{ status: 500 }
		);
	}
}

// Health check
export async function GET() {
	const count = chartQueue.getRecentMessages(100).length;
	return NextResponse.json({
		inMemoryCharts: count,
		message: 'Use POST to clear the queue',
	});
}
