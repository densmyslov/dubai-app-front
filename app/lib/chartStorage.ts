import type { KVNamespace } from '@cloudflare/workers-types';
import type { ChartMessage } from './chartQueue';

const STORAGE_KEY_PREFIX = 'charts:session:';
const GLOBAL_STORAGE_KEY = 'charts:global';
const MAX_STORED_MESSAGES = 50;

type StoredCharts = ChartMessage[];

/**
 * Generates a KV storage key for a session
 * If sessionId is provided, returns session-specific key
 * Otherwise, returns global key for backward compatibility
 */
function getStorageKey(sessionId?: string): string {
	return sessionId ? `${STORAGE_KEY_PREFIX}${sessionId}` : GLOBAL_STORAGE_KEY;
}

/**
 * Appends or updates a chart message in KV storage
 * Charts are now stored per-session to prevent conflicts
 */
export async function appendChartToKV(
	kv: KVNamespace,
	message: ChartMessage
): Promise<void> {
	const storageKey = getStorageKey(message.sessionId);
	console.log('[chartStorage] Storing chart with sessionId:', message.sessionId, 'in KV key:', storageKey);

	let messages = await kv.get<StoredCharts>(storageKey, { type: 'json' });

	if (!messages) {
		messages = [];
		console.log('[chartStorage] Creating new storage array for key:', storageKey);
	} else {
		console.log('[chartStorage] Existing storage has', messages.length, 'charts');
	}

	// If this is a remove action, filter out the chart
	if (message.type === 'chart_remove') {
		messages = messages.filter((m) => m.chartId !== message.chartId);
		console.log('[chartStorage] Removed chart:', message.chartId);
	} else {
		// For add/update, remove any existing chart with same ID first
		const existingCount = messages.length;
		messages = messages.filter((m) => m.chartId !== message.chartId);
		if (messages.length < existingCount) {
			console.log('[chartStorage] Replaced existing chart:', message.chartId);
		}
		// Then add the new/updated chart
		messages.push(message);
		console.log('[chartStorage] Added chart:', message.chartId, 'Total charts:', messages.length);
	}

	if (messages.length > MAX_STORED_MESSAGES) {
		messages = messages.slice(-MAX_STORED_MESSAGES);
	}

	// Store with TTL of 24 hours to auto-cleanup old sessions
	await kv.put(storageKey, JSON.stringify(messages), {
		expirationTtl: 86400, // 24 hours
	});
	console.log('[chartStorage] Saved to KV key:', storageKey);
}

/**
 * Retrieves recent charts from KV storage
 * Now reads from session-specific key instead of global key
 */
export async function getRecentChartsFromKV(
	kv: KVNamespace,
	limit: number,
	sessionId?: string
): Promise<ChartMessage[]> {
	const storageKey = getStorageKey(sessionId);
	console.log('[chartStorage] Reading from KV key:', storageKey, 'for sessionId:', sessionId);

	const messages = (await kv.get<StoredCharts>(storageKey, { type: 'json' })) ?? [];
	console.log('[chartStorage] Found', messages.length, 'messages in KV');

	if (messages.length > 0) {
		console.log('[chartStorage] Message sessionIds:', messages.map(m => m.sessionId));
	}

	if (messages.length <= limit) {
		return messages;
	}

	return messages.slice(-limit);
}

/**
 * Clears all charts for a specific session
 */
export async function clearSessionCharts(
	kv: KVNamespace,
	sessionId: string
): Promise<void> {
	const storageKey = getStorageKey(sessionId);
	await kv.delete(storageKey);
}
