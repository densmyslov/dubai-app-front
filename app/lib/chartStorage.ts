import type { KVNamespace } from '@cloudflare/workers-types';
import type { ChartMessage } from './chartQueue';

const STORAGE_KEY = 'charts:messages';
const MAX_STORED_MESSAGES = 50;

type StoredCharts = ChartMessage[];

export async function appendChartToKV(
	kv: KVNamespace,
	message: ChartMessage
): Promise<void> {
	let messages = await kv.get<StoredCharts>(STORAGE_KEY, { type: 'json' });

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

	await kv.put(STORAGE_KEY, JSON.stringify(messages));
}

export async function getRecentChartsFromKV(
	kv: KVNamespace,
	limit: number,
	sessionId?: string
): Promise<ChartMessage[]> {
	const messages = (await kv.get<StoredCharts>(STORAGE_KEY, { type: 'json' })) ?? [];

	const filtered = sessionId
		? messages.filter((message) => !message.sessionId || message.sessionId === sessionId)
		: messages;

	if (filtered.length <= limit) {
		return filtered;
	}

	return filtered.slice(-limit);
}
