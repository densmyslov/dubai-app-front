// app/components/ChatWindow.tsx
"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export default function ChatWindow() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    let isMounted = true;

    const scheduleReconnect = () => {
      if (!isMounted) return;
      const attempt = attemptRef.current + 1;
      attemptRef.current = attempt;
      const delay = Math.min(1500 * attempt, 15000); // linear backoff up to 15s
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = setTimeout(() => {
        retryTimeoutRef.current = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (!isMounted) return;
      const es = new EventSource("/api/webhook/stream?sessionId=global");
      sourceRef.current = es;

      es.onopen = () => {
        attemptRef.current = 0;
      };

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data); // { id, text, ... } from your DO
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: data.text ?? JSON.stringify(data) },
          ]);
        } catch (error) {
          console.error("Failed to parse SSE message", error);
        }
      };

      es.onerror = () => {
        es.close();
        sourceRef.current = null;
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      isMounted = false;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <section className="rounded-2xl bg-white dark:bg-slate-800 p-4 shadow">
      <h2 className="text-lg font-semibold mb-3">Chat</h2>
      <div className="space-y-2 max-h-80 overflow-auto">
        {messages.map((m, i) => (
          <div
            key={i}
            className={m.role === "user" ? "text-right" : "text-left"}
          >
            <span className="inline-block px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-700">
              {m.content}
            </span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </section>
  );
}
