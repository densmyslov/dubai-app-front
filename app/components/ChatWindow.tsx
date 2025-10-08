// app/components/ChatWindow.tsx
"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export default function ChatWindow() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource("/api/webhook/stream?sessionId=global");

    es.onmessage = (e) => {
      const data = JSON.parse(e.data); // { id, text, ... } from your DO
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.text ?? JSON.stringify(data) },
      ]);
    };

    es.onerror = () => {
      es.close();
      // simple retry strategy
      setTimeout(() => {
        // reload to recreate EventSource; swap for smarter backoff if you want
        location.reload();
      }, 1500);
    };

    return () => es.close();
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
