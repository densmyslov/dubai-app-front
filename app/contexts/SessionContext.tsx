"use client";
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface SessionContextType {
  sessionId: string;
  resetSession: () => void;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

function createSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [sessionId, setSessionId] = useState<string>(() => {
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

  const resetSession = useCallback(() => {
    setSessionId(createSessionId());
  }, [setSessionId]);

  return (
    <SessionContext.Provider value={{ sessionId, resetSession }}>
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
