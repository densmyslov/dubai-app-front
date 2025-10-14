"use client";
import React, { createContext, useContext, useState, useEffect } from 'react';

interface SessionContextType {
  sessionId: string;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

function createSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [sessionId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("chatSessionId");
      if (stored) return stored;
    }
    return createSessionId();
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("chatSessionId", sessionId);
  }, [sessionId]);

  return (
    <SessionContext.Provider value={{ sessionId }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
