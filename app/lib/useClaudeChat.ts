'use client';

import { useState, useCallback } from 'react';
import { ClaudeLLMClient, UsageStats, ClientOptions } from './claudeClient';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  usage?: UsageStats;
  timestamp: Date;
}

export interface UseChatOptions extends ClientOptions {
  onError?: (error: Error) => void;
}

export function useClaudeChat(apiUrl: string, options: UseChatOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [client] = useState(() => new ClaudeLLMClient(apiUrl, options));

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      setIsLoading(true);
      setError(null);

      // Add user message
      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMessage]);

      // Prepare assistant message
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      try {
        await client.streamMessage(content, {
          onChunk: (text) => {
            setMessages((prev) => {
              const updated = [...prev];
              const lastMsg = updated[updated.length - 1];
              if (lastMsg.role === 'assistant') {
                lastMsg.content += text;
              }
              return updated;
            });
          },
          onComplete: (usage) => {
            setMessages((prev) => {
              const updated = [...prev];
              const lastMsg = updated[updated.length - 1];
              if (lastMsg.role === 'assistant') {
                lastMsg.usage = usage;
              }
              return updated;
            });
            setIsLoading(false);
          },
          onError: (err) => {
            setError(err);
            setIsLoading(false);
            if (options.onError) {
              options.onError(err);
            }
          },
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        setIsLoading(false);
        if (options.onError) {
          options.onError(error);
        }
      }
    },
    [client, isLoading, options]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,
    sendMessage,
    isLoading,
    error,
    clearMessages,
  };
}
