// ============================================================================
// In-Memory Message Queue for Webhook Messages
// ============================================================================
// This manages a simple in-memory queue for webhook messages that need to be
// delivered to connected chat clients via SSE.
//
// Note: In production, consider using Redis or Cloudflare KV for persistence
// across multiple instances/deployments.
// ============================================================================

export interface WebhookMessage {
  id: string;
  content: string;
  timestamp: number;
  sessionId?: string; // Optional: target specific chat session
}

class MessageQueue {
  private messages: WebhookMessage[] = [];
  private listeners: Set<(message: WebhookMessage) => void> = new Set();
  private readonly MAX_MESSAGES = 100; // Prevent memory leaks

  /**
   * Add a message to the queue and notify all listeners
   */
  addMessage(content: string, sessionId?: string): WebhookMessage {
    const message: WebhookMessage = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      content,
      timestamp: Date.now(),
      sessionId,
    };

    this.messages.push(message);

    // Keep queue size manageable
    if (this.messages.length > this.MAX_MESSAGES) {
      this.messages.shift();
    }

    // Notify all active listeners
    this.listeners.forEach((listener) => listener(message));

    return message;
  }

  /**
   * Subscribe to new messages
   * Returns unsubscribe function
   */
  subscribe(callback: (message: WebhookMessage) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Get recent messages (for reconnection/history)
   */
  getRecentMessages(limit: number = 10, sessionId?: string): WebhookMessage[] {
    let messages = [...this.messages];

    if (sessionId) {
      messages = messages.filter(
        (m) => !m.sessionId || m.sessionId === sessionId
      );
    }

    return messages.slice(-limit);
  }

  /**
   * Clear all messages (for testing/cleanup)
   */
  clear(): void {
    this.messages = [];
  }

  /**
   * Get active listener count (for monitoring)
   */
  getListenerCount(): number {
    return this.listeners.size;
  }
}

// Singleton instance
export const messageQueue = new MessageQueue();
