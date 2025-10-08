// app/components/ChatWindow.tsx
"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export default function ChatWindow() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef(1000); // start at 1s, max 30s
  const closedRef = useRef(false);

  const connect = () => {
    if (closedRef.current) return;
    // avoid duplicate connections
    if (esRef.current) {
      try { esRef.current.close(); } catch {}
      esRef.current = null;
    }

    const es = new EventSource("/api/webhook/stream?sessionId=global");
    esRef.current = es;

    es.onmessage = (e) => {
      retryRef.current = 1000; // reset backoff on success
      const data = JSON.parse(e.data);
      setMessages((prev) => [...prev, { role: "assistant", content: data.text ?? JSON.stringify(data) }]);
    };

    es.onerror = () => {
      try { es.close(); } catch {}
      esRef.current = null;
      const wait = Math.min(retryRef.current, 30000);
      // try again without reloading the page
      setTimeout(connect, wait);
      retryRef.current = Math.min(wait * 2, 30000);
    };
  };

  useEffect(() => {
    connect();
    return () => {
      closedRef.current = true;
      try { esRef.current?.close(); } catch {}
      esRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (Optional) basic send handler if you want a writable chat box
  const sendLocal = () => {
    if (!draft.trim()) return;
    setMessages((m) => [...m, { role: "user", content: draft }]);
    setDraft("");
    // If you later want to POST to your own /api/chat, do it here.
  };

  return (
    <section className="rounded-2xl bg-white dark:bg-slate-800 p-4 shadow">
      <h2 className="text-lg font-semibold mb-3">Chat</h2>

      <div className="space-y-2 max-h-80 overflow-auto mb-3">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
            <span className="inline-block px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-700">
              {m.content}
            </span>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message…"
          className="flex-1 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2"
        />
        <button
          onClick={sendLocal}
          className="rounded-xl px-4 py-2 bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
        >
          Send
        </button>
      </div>
    </section>
  );
}
