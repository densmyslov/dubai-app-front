'use client';

import React from 'react';
import ChatWindow from './ChatWindow';
import ThemeToggle from './ThemeToggle';

export default function LayoutContent({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="mx-auto max-w-6xl p-6">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Dubai Investor Dashboard</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">Median rents, price-to-rent, league table</p>
          </div>
          <ThemeToggle />
        </header>
        {children}
      </div>
      <ChatWindow />
    </>
  );
}
