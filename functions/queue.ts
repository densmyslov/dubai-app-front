interface Env {
  WEBHOOK_KV: KVNamespace;
}

interface WebhookMessage {
    message: string;
    sessionId?: string;
}

// This function is triggered by messages on the queue.
// Note the function signature is different from a request handler.
export async function queue(
  batch: MessageBatch<WebhookMessage>,
  env: Env
): Promise<void> {
  const promises = batch.messages.map(msg => {
    // Use a timestamp and random suffix for a unique, sortable key
    const id = `${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    const sessionId = msg.body.sessionId || 'global';
    
    // Store message in KV, keyed by session and a unique ID.
    // It will expire after 5 minutes to automatically clean up old messages.
    return env.WEBHOOK_KV.put(`session:${sessionId}:${id}`, JSON.stringify(msg.body), { expirationTtl: 300 });
  });

  await Promise.all(promises);
};