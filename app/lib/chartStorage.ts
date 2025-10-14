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
	let messages = await kv.get<StoredCharts>(storageKey, { type: 'json' });

	if (!messages) {
		messages = [];
	}

	// If this is a remove action, filter out the chart
	if (message.type === 'chart_remove') {
		messages = messages.filter((m) => m.chartId !== message.chartId);
	} else {
		// For add/update, remove any existing chart with same ID first
		messages = messages.filter((m) => m.chartId !== message.chartId);
		// Then add the new/updated chart
		messages.push(message);
	}

	if (messages.length > MAX_STORED_MESSAGES) {
		messages = messages.slice(-MAX_STORED_MESSAGES);
	}

	// Store with TTL of 24 hours to auto-cleanup old sessions
	await kv.put(storageKey, JSON.stringify(messages), {
		expirationTtl: 86400, // 24 hours
	});
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
	const messages = (await kv.get<StoredCharts>(storageKey, { type: 'json' })) ?? [];

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
