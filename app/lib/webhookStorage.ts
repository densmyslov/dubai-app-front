import type { KVNamespace } from '@cloudflare/workers-types';
import type { WebhookMessage } from './messageQueue';
import { normalizeWebhookContent } from './messageQueue';

const STORAGE_KEY = 'webhook:messages';
const MAX_STORED_MESSAGES = 100;

type StoredMessages = WebhookMessage[];

export async function appendMessageToKV(
	kv: KVNamespace,
	message: WebhookMessage
): Promise<void> {
	let messages = await kv.get<StoredMessages>(STORAGE_KEY, { type: 'json' });

	if (!messages) {
		messages = [];
	}

	messages.push(message);

	if (messages.length > MAX_STORED_MESSAGES) {
		messages = messages.slice(-MAX_STORED_MESSAGES);
	}

	await kv.put(STORAGE_KEY, JSON.stringify(messages));
}

export async function getRecentMessagesFromKV(
	kv: KVNamespace,
	limit: number,
	sessionId?: string
): Promise<WebhookMessage[]> {
	const messages = (await kv.get<StoredMessages>(STORAGE_KEY, { type: 'json' })) ?? [];

	const filtered = sessionId
		? messages.filter((message) => !message.sessionId || message.sessionId === sessionId)
		: messages;

	if (filtered.length <= limit) {
		return filtered.map((message) => ({
			...message,
			content: normalizeWebhookContent(message.content),
		}));
	}

	return filtered.slice(-limit).map((message) => ({
		...message,
		content: normalizeWebhookContent(message.content),
	}));
}
