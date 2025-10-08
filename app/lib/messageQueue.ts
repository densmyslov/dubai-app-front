// ============================================================================
// In-Memory Message Queue for Webhook Messages
// ============================================================================
// Maintains a simple singleton queue that buffers incoming webhook messages and
// notifies active SSE subscribers. In production workloads you should replace
// this with a shared data store (Redis, Cloudflare KV/Queues, etc.) to persist
// across multiple instances, but the in-memory approach works for single-region
// hobby deployments and local development.
// ============================================================================

export interface WebhookMessage {
  id: string;
  content: string;
  timestamp: number;
  sessionId?: string;
}

class MessageQueue {
  private messages: WebhookMessage[] = [];
  private listeners: Set<(message: WebhookMessage) => void> = new Set();
  private readonly MAX_MESSAGES = 100;

  addMessage(content: string, sessionId?: string): WebhookMessage {
    const message: WebhookMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      content,
      timestamp: Date.now(),
      sessionId,
    };

    this.messages.push(message);

    if (this.messages.length > this.MAX_MESSAGES) {
      this.messages.shift();
    }

    this.listeners.forEach((listener) => listener(message));
    return message;
  }

  subscribe(callback: (message: WebhookMessage) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  getRecentMessages(limit: number = 10, sessionId?: string): WebhookMessage[] {
    let messages = [...this.messages];

    if (sessionId) {
      messages = messages.filter(
        (message) => !message.sessionId || message.sessionId === sessionId
      );
    }

    return messages.slice(-limit);
  }

  clear(): void {
    this.messages = [];
  }

  getListenerCount(): number {
    return this.listeners.size;
  }
}

const globalForMessageQueue = globalThis as typeof globalThis & {
  __WEBHOOK_MESSAGE_QUEUE__?: MessageQueue;
};

export const messageQueue =
  globalForMessageQueue.__WEBHOOK_MESSAGE_QUEUE__ ?? new MessageQueue();

if (!globalForMessageQueue.__WEBHOOK_MESSAGE_QUEUE__) {
  globalForMessageQueue.__WEBHOOK_MESSAGE_QUEUE__ = messageQueue;
}
