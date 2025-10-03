import './globals.css';
import React from 'react';
import ChatWindow from './components/ChatWindow';

export const metadata = {
  title: 'Dubai RE Investor Dashboard',
  description: 'Investor KPIs for Dubai real estate'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <div className="mx-auto max-w-6xl p-6">
          <header className="mb-6">
            <h1 className="text-2xl font-semibold">Dubai Investor Dashboard</h1>
            <p className="text-sm text-slate-600">Median rents, price-to-rent, league table</p>
          </header>
          {children}
        </div>
        <ChatWindow />
      </body>
    </html>
  );
}
