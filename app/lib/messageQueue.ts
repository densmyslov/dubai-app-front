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

interface BroadcastEnvelope {
  type: 'webhook_message';
  message: WebhookMessage;
}

class MessageQueue {
  private messages: WebhookMessage[] = [];
  private listeners: Set<(message: WebhookMessage) => void> = new Set();
  private readonly MAX_MESSAGES = 100;
  private channel?: BroadcastChannel;

  constructor(channel?: BroadcastChannel) {
    this.channel = channel;

    if (this.channel) {
      this.channel.addEventListener('message', (event) => {
        const data = event.data as BroadcastEnvelope | undefined;
        if (!data || data.type !== 'webhook_message') return;

        this.insertMessage(data.message, { broadcast: false });
      });
    }
  }

  addMessage(content: string, sessionId?: string): WebhookMessage {
    const message: WebhookMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      content,
      timestamp: Date.now(),
      sessionId,
    };

    return this.insertMessage(message, { broadcast: true });
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

  private insertMessage(
    message: WebhookMessage,
    { broadcast }: { broadcast: boolean }
  ): WebhookMessage {
    const exists = this.messages.some((m) => m.id === message.id);
    if (!exists) {
      this.messages.push(message);

      if (this.messages.length > this.MAX_MESSAGES) {
        this.messages.shift();
      }
    }

    this.listeners.forEach((listener) => listener(message));

    if (broadcast && this.channel) {
      const envelope: BroadcastEnvelope = {
        type: 'webhook_message',
        message,
      };

      try {
        this.channel.postMessage(envelope);
      } catch (error) {
        console.error('BroadcastChannel postMessage failed:', error);
      }
    }

    return message;
  }
}

const globalForMessageQueue = globalThis as typeof globalThis & {
  __WEBHOOK_MESSAGE_QUEUE__?: MessageQueue;
  __WEBHOOK_BROADCAST_CHANNEL__?: BroadcastChannel;
};

const hasBroadcast = typeof BroadcastChannel !== 'undefined';
const broadcastChannel = hasBroadcast
  ? globalForMessageQueue.__WEBHOOK_BROADCAST_CHANNEL__ ??
    new BroadcastChannel('webhook-message-channel')
  : undefined;

if (broadcastChannel && !globalForMessageQueue.__WEBHOOK_BROADCAST_CHANNEL__) {
  globalForMessageQueue.__WEBHOOK_BROADCAST_CHANNEL__ = broadcastChannel;
}

export const messageQueue =
  globalForMessageQueue.__WEBHOOK_MESSAGE_QUEUE__ ?? new MessageQueue(broadcastChannel);

if (!globalForMessageQueue.__WEBHOOK_MESSAGE_QUEUE__) {
  globalForMessageQueue.__WEBHOOK_MESSAGE_QUEUE__ = messageQueue;
}
