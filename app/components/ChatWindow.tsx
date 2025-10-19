// app/components/ChatWindow.tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { FormEvent } from "react";
import { useSession } from "../contexts/SessionContext";

// ============================================================================
// Types
// ============================================================================

interface Message {
  role: "user" | "assistant";
  content: string;
}

// ============================================================================
// Component
// ============================================================================

export default function ChatWindow() {
  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  const { sessionId, resetSession } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");

  // --------------------------------------------------------------------------
  // Refs
  // --------------------------------------------------------------------------

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const webhookMessageIdsRef = useRef<Set<string>>(new Set());
  const webhookMessageIdQueueRef = useRef<string[]>([]);
  const lastWebhookContentRef = useRef<string | null>(null);

  // --------------------------------------------------------------------------
  // Effects
  // --------------------------------------------------------------------------

  // Client-side mounting guard for hydration
  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea based on input content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  // Subscribe to webhook messages via SSE when chat is open
  useEffect(() => {
    if (!isOpen) {
      setConnectionStatus("disconnected");
      attemptRef.current = 0;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      sourceRef.current?.close();
      sourceRef.current = null;
      return;
    }

    let isActive = true;
    setConnectionStatus("connecting");

    const scheduleReconnect = () => {
      if (!isActive) return;
      const attempt = attemptRef.current + 1;
      attemptRef.current = attempt;
      const delay = Math.min(1500 * attempt, 15000); // linear backoff up to 15s
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = setTimeout(() => {
        retryTimeoutRef.current = null;
        connect();
      }, delay);
    };

    const appendToAssistant = (delta: string) => {
      if (!delta) return;
      setMessages(prev => {
        if (prev.length === 0 || prev[prev.length - 1].role !== "assistant") {
          return [...prev, { role: "assistant", content: delta }];
        }
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: updated[updated.length - 1].content + delta,
        };
        return updated;
      });
    };

    const pushAssistantMessage = (text: string) => {
      if (!text) return;
      setMessages(prev => {
        if (
          prev.length > 0 &&
          prev[prev.length - 1].role === "assistant" &&
          prev[prev.length - 1].content === text
        ) {
          console.log("[ChatWindow] Skipping message because last assistant entry matches");
          return prev;
        }
        return [...prev, { role: "assistant", content: text }];
      });
    };

    const connect = () => {
      if (!isActive) return;
      sourceRef.current?.close();
      const streamUrl = `/api/webhook/stream?sessionId=${encodeURIComponent(sessionId)}`;
      console.log("[ChatWindow] Connecting to SSE stream:", streamUrl);
      const es = new EventSource(streamUrl);
      sourceRef.current = es;

      es.onopen = () => {
        console.log("[ChatWindow] SSE connection opened");
        attemptRef.current = 0;
        setConnectionStatus("connected");
      };

      es.onmessage = (event) => {
        try {
          console.log("[ChatWindow] SSE message received:", event.data);
          const payload = JSON.parse(event.data);
          console.log("[ChatWindow] Parsed payload:", payload);

          // Ignore keepalives
          if (payload?.type === "connected" || payload?.type === "ping") {
            console.log("[ChatWindow] Ignoring keepalive:", payload.type);
            return;
          }

          // Streaming chunks: append delta to the current assistant bubble
          if (payload?.type === "chunk") {
            console.log("[ChatWindow] Processing chunk:", payload);
            const delta: string =
              typeof payload.delta === "string"
                ? payload.delta
                : typeof payload.text === "string"
                ? payload.text
                : typeof payload.message === "string"
                ? payload.message
                : "";
            if (delta) {
              console.log("[ChatWindow] Appending delta:", delta);
              appendToAssistant(delta);
            }
            return;
          }

          // Stream finished
          if (payload?.type === "done") {
            console.log("[ChatWindow] Stream done");
            return; // bubble already contains final text
          }

          // Non-stream, full message from webhook
          if (payload?.type === "webhook_message") {
            const isHistory = Boolean(payload?.isHistory);
            const identifierSource =
              payload?.id !== undefined && payload?.id !== null
                ? payload.id
                : payload?.timestamp !== undefined && payload?.timestamp !== null
                ? payload.timestamp
                : undefined;
            const identifier =
              identifierSource !== undefined
                ? String(identifierSource)
                : undefined;

            if (identifier) {
              if (webhookMessageIdsRef.current.has(identifier)) {
                if (!isHistory) {
                  console.log("[ChatWindow] Duplicate live webhook id detected, skipping:", identifier);
                } else {
                  console.log("[ChatWindow] Skipping historical webhook id already seen:", identifier);
                }
                console.log("[ChatWindow] Skipping duplicate webhook message:", identifier);
                return;
              }

              webhookMessageIdsRef.current.add(identifier);
              webhookMessageIdQueueRef.current.push(identifier);
              if (webhookMessageIdQueueRef.current.length > 200) {
                const oldest = webhookMessageIdQueueRef.current.shift();
                if (oldest) {
                  webhookMessageIdsRef.current.delete(oldest);
                }
              }
            } else if (isHistory && lastWebhookContentRef.current === payload?.content) {
              console.log("[ChatWindow] Skipping duplicate historical webhook content without id");
              return;
            }

            console.log("[ChatWindow] Processing webhook_message:", payload);
            const content: string =
              typeof payload.content === "string"
                ? payload.content
                : typeof payload.message === "string"
                ? payload.message
                : JSON.stringify(payload);
            console.log("[ChatWindow] Pushing assistant message:", content);
            pushAssistantMessage(content);
            lastWebhookContentRef.current = content;
            return;
          }

          // Fallbacks: accept plain strings or common fields
          console.log("[ChatWindow] Using fallback handler for payload:", payload);
          const maybeText: string =
            typeof payload === "string"
              ? payload
              : payload?.text ?? payload?.message ?? JSON.stringify(payload);

          console.log("[ChatWindow] Fallback text:", maybeText);
          const text = String(maybeText);
          const isHistoryMessage = Boolean(payload?.isHistory);
          if (!(isHistoryMessage && lastWebhookContentRef.current === text)) {
            pushAssistantMessage(text);
            lastWebhookContentRef.current = text;
          } else {
            console.log("[ChatWindow] Skipping duplicate historical fallback content");
          }
        } catch (err) {
          console.error("[ChatWindow] Failed to parse SSE message", err, "raw data:", event.data);
          pushAssistantMessage(event.data);
        }
      };

      es.onerror = (err) => {
        console.error("EventSource error:", err);
        setConnectionStatus("disconnected");
        es.close();
        sourceRef.current = null;
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      isActive = false;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, [isOpen, sessionId]);

  // --------------------------------------------------------------------------
  // Handlers
  // --------------------------------------------------------------------------

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
  };

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMessage: Message = { role: "user", content: trimmed };
    const conversation = [...messages, userMessage];
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const chatUrl = (() => {
        if (typeof window === "undefined") return undefined;
        const url = new URL(window.location.href);
        url.searchParams.set("sessionId", sessionId);
        return url.toString();
      })();

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: conversation, sessionId, chatUrl }),
        signal: ac.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        const trimmedError = errorText.trim();
        const message = trimmedError || `Request failed with status ${response.status}`;
        throw new Error(message);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No response body");

      let assistantMessage = "";
      setMessages(prev => [...prev, { role: "assistant", content: "" }]);

      const { signal } = ac;
      let buffer = "";

      while (true) {
        if (signal.aborted) {
          reader.cancel();
          return;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
          if (signal.aborted) {
            reader.cancel();
            return;
          }

          const dataLines = event
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6));

          if (dataLines.length === 0) continue;
          const data = dataLines.join("");
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);

            if (parsed?.metadata) {
              console.log("Received metadata:", parsed.metadata);
            }

            if (parsed.type === "chunk" && parsed.text) {
              const text: string = parsed.text;
              for (let i = 0; i < text.length; i++) {
                if (signal.aborted) {
                  reader.cancel();
                  return;
                }

                assistantMessage += text[i];
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    role: "assistant",
                    content: assistantMessage,
                  };
                  return updated;
                });

                await new Promise<void>((resolve, reject) => {
                  if (signal.aborted) {
                    reject(new DOMException("Aborted", "AbortError"));
                    return;
                  }
                  const timeout = setTimeout(() => {
                    if (signal.aborted) {
                      reject(new DOMException("Aborted", "AbortError"));
                    } else {
                      resolve();
                    }
                  }, 20);
                  signal.addEventListener(
                    "abort",
                    () => {
                      clearTimeout(timeout);
                      reject(new DOMException("Aborted", "AbortError"));
                    },
                    { once: true }
                  );
                });
              }
            } else if (parsed.type === "done") {
              console.log("Conversation complete. Final metadata:", parsed.metadata);
            } else if (parsed.type === "error") {
              console.error("Lambda error:", parsed.error);
              throw new Error(parsed.error);
            }
          } catch (parseError) {
            console.error("Failed to parse stream event", parseError);
          }
        }
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        console.log("Request cancelled by user");
        return;
      }

      console.error("Chat error:", error);
      const friendlyMessage = error instanceof Error ? error.message : "Unexpected error occurred.";
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: `Sorry, I ran into a problem: ${friendlyMessage}` },
      ]);
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  };

  const handleClear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setMessages([]);
    setInput("");
    setConnectionStatus("disconnected");
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    sourceRef.current?.close();
    sourceRef.current = null;
    attemptRef.current = 0;
    webhookMessageIdsRef.current.clear();
    webhookMessageIdQueueRef.current = [];
    lastWebhookContentRef.current = null;
    resetSession();
  }, [resetSession]);

  if (!mounted) return null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage();
  };

  // --------------------------------------------------------------------------
  // Render: Closed State (Floating Button)
  // --------------------------------------------------------------------------

  if (!isOpen) {
    return (
      <button
        onClick={() => {
          // IMPORTANT: do NOT regenerate the sessionId on open; keep continuity
          setIsOpen(true);
        }}
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
      <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">Chat with Claude</h3>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Session: {sessionId}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (typeof navigator !== "undefined" && navigator.clipboard) {
                    void navigator.clipboard.writeText(sessionId).catch((error) => {
                      console.error("Failed to copy session ID", error);
                    });
                  }
                }}
                className="text-[10px] font-semibold text-blue-500 hover:text-blue-600 focus:outline-none"
                title="Copy session ID"
              >
                Copy
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <div
              className={`w-2 h-2 rounded-full ${
                connectionStatus === "connected"
                  ? "bg-green-400 animate-pulse"
                  : connectionStatus === "connecting"
                  ? "bg-yellow-400 animate-pulse"
                  : "bg-red-400"
              }`}
              title={`Webhook stream: ${connectionStatus}`}
            />
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {connectionStatus === "connected"
                ? "Live"
                : connectionStatus === "connecting"
                ? "Connecting..."
                : "Offline"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
            aria-label="Clear chat history"
            title="Clear chat history"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
            aria-label="Close chat"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-slate-400 dark:text-slate-500 mt-8">
            <p>Start a conversation with Claude</p>
          </div>
        )}
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100"
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t border-slate-200 dark:border-slate-700">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            placeholder="Type a message..."
            disabled={isLoading}
            rows={1}
            className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 dark:disabled:bg-slate-800 resize-none overflow-y-auto"
            style={{ maxHeight: "120px" }}
          />
          <button
            type={isLoading ? "button" : "submit"}
            onClick={isLoading ? handleStop : undefined}
            disabled={!isLoading && !input.trim()}
            className="bg-blue-600 text-white rounded-full px-4 py-2 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            title={isLoading ? "Stop generating" : "Send message"}
          >
            {isLoading ? (
              <svg className="animate-spin h-5 w-5 cursor-pointer" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
