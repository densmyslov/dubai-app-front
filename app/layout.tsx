import './globals.css';
import React from 'react';
import { ThemeProvider } from './components/ThemeProvider';
import { SessionProvider } from './contexts/SessionContext';
import LayoutContent from './components/LayoutContent';

export const metadata = {
  title: 'Dubai RE Investor Dashboard',
  description: 'Investor KPIs for Dubai real estate'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 transition-colors">
        <ThemeProvider>
          <SessionProvider>
            <LayoutContent>{children}</LayoutContent>
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
