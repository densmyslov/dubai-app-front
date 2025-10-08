'use client';

import React, { useState, useEffect, useRef } from 'react';

// ============================================================================
// Types
// ============================================================================
interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// ============================================================================
// Component
// ============================================================================
export default function ChatWindow() {
  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<'disconnected' | 'connecting' | 'connected'>('disconnected');

  // --------------------------------------------------------------------------
  // Refs
  // --------------------------------------------------------------------------
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // --------------------------------------------------------------------------
  // Effects
  // --------------------------------------------------------------------------

  // Client-side mounting guard for hydration
  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${scrollHeight}px`;
    }
  }, [input]);

  // Subscribe to webhook messages via SSE when chat is open
  useEffect(() => {
    if (!isOpen) {
      setConnectionStatus('disconnected');
      esRef.current?.close();
      esRef.current = null;
      return;
    }

    setConnectionStatus('connecting');

    // Adjust this endpoint to your actual SSE URL (e.g. /api/webhook/stream?sessionId=global)
    const es = new EventSource('/api/webhook/stream?sessionId=global');
    esRef.current = es;

    es.onopen = () => setConnectionStatus('connected');

    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        // Extract text from the webhook payload.
        const messageText = payload?.text ?? payload?.message ?? JSON.stringify(payload);

        // Add the message with the 'assistant' role to match Claude's responses.
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Webhook: ${messageText}` },
        ]);
      } catch {
        // Fallback for non-JSON data
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Webhook: ${event.data}` },
        ]);
      }
    };

    es.onerror = (err) => {
      console.error('EventSource error:', err);
      setConnectionStatus('disconnected');
      es.close();
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [isOpen]);

  // --------------------------------------------------------------------------
  // Early Returns
  // --------------------------------------------------------------------------
  if (!mounted) return null;

  // --------------------------------------------------------------------------
  // Handlers
  // --------------------------------------------------------------------------
  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Create and store abort controller for this request
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // include the latest message list (include the just-added user message)
        body: JSON.stringify({ messages: [...messages, userMessage] }),
        signal: ac.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const trimmed = errorText.trim();
        const message = trimmed || `Request failed with status ${response.status}`;
        throw new Error(message);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error('No response body');

      let assistantMessage = '';
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

      const { signal } = ac;

      let buffer = '';
      while (true) {
        if (signal.aborted) {
          reader.cancel();
          return;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by blank line
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const ev of events) {
          if (signal.aborted) {
            reader.cancel();
            return;
          }

          const dataLines = ev
            .split('\n')
            .filter((l) => l.startsWith('data: '))
            .map((l) => l.slice(6));

          if (dataLines.length === 0) continue;
          const data = dataLines.join('');

          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);

            // Log metadata if present
            if (parsed?.metadata) {
              console.log('Received metadata:', parsed.metadata);
            }

            if (parsed.type === 'chunk' && parsed.text) {
              // Append chunk to the assistant message
              assistantMessage += parsed.text;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: 'assistant',
                  content: assistantMessage,
                };
                return updated;
              });
            } else if (parsed.type === 'done') {
              console.log('Conversation complete. Final metadata:', parsed.metadata);
            } else if (parsed.type === 'error') {
              console.error('Lambda error:', parsed.error);
              throw new Error(parsed.error);
            }
          } catch {
            // non-JSON: ignore/passthrough
          }
        }
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Request cancelled by user');
        return;
      }
      console.error('Chat error:', error);
      const friendlyMessage =
        error instanceof Error ? error.message : 'Unexpected error occurred.';
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Sorry, I ran into a problem: ${friendlyMessage}`,
        },
      ]);
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  };

  // --------------------------------------------------------------------------
  // Render: Closed State (Floating Button)
  // --------------------------------------------------------------------------
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 bg-blue-600 text-white rounded-full p-4 shadow-lg hover:bg-blue-700 transition-colors"
        aria-label="Open chat"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
          />
        </svg>
      </button>
    );
  }

  // --------------------------------------------------------------------------
  // Render: Open State (Chat Window)
  // --------------------------------------------------------------------------
  return (
    <div className="fixed bottom-6 right-6 w-96 h-[600px] bg-white dark:bg-slate-800 rounded-2xl shadow-2xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">Chat with Claude</h3>
          {/* Connection Status Indicator */}
          <div className="flex items-center gap-1">
            <div
              className={`w-2 h-2 rounded-full ${
                connectionStatus === 'connected'
                  ? 'bg-green-400 animate-pulse'
                  : connectionStatus === 'connecting'
                  ? 'bg-yellow-400 animate-pulse'
                  : 'bg-red-400'
              }`}
              title={`Webhook stream: ${connectionStatus}`}
            />
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {connectionStatus === 'connected'
                ? 'Live'
                : connectionStatus === 'connecting'
                ? 'Connecting...'
                : 'Offline'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMessages([])}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
            aria-label="Clear chat history"
            title="Clear chat history"
          >
            {/* trash icon */}
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
            aria-label="Close chat"
          >
            {/* close icon */}
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-slate-400 dark:text-slate-500 mt-8">
            <p>Start a conversation with Claude</p>
          </div>
        )}
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-slate-200 dark:border-slate-700">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e as any);
              }
            }}
            placeholder="Type a message..."
            disabled={isLoading}
            rows={1}
            className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 dark:disabled:bg-slate-800 resize-none overflow-y-auto"
            style={{ maxHeight: '120px' }}
          />
          <button
            type={isLoading ? 'button' : 'submit'}
            onClick={isLoading ? handleStop : undefined}
            disabled={!isLoading && !input.trim()}
            className="bg-blue-600 text-white rounded-full px-4 py-2 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            title={isLoading ? 'Stop generating' : 'Send message'}
          >
            {isLoading ? (
              // spinner
              <svg className="animate-spin h-5 w-5 cursor-pointer" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              // send icon
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
