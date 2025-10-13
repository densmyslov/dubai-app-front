// app/page.tsx
import React from 'react';
import ChatWindow from './components/ChatWindow';
import WidgetRenderer from './components/WidgetRenderer';
import type { Manifest } from './lib/manifest';

export const runtime = 'edge';

async function fetchManifest(): Promise<Manifest> {
  try {
    const res = await fetch('/api/manifest', { cache: 'no-store' });
    if (!res.ok) {
      console.error('[page] Failed to fetch manifest:', res.status);
      throw new Error('Failed to fetch manifest');
    }
    return await res.json();
  } catch (error) {
    console.error('[page] Error fetching manifest:', error);
    // Return default manifest on error
    return {
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
      widgets: [
        {
          id: 'error',
          type: 'markdown',
          title: 'Error Loading Dashboard',
          content: '# Unable to load dashboard\n\nPlease try refreshing the page or contact support.',
        },
      ],
    };
  }
}

export default async function Page() {
  const manifest = await fetchManifest();

  return (
    <main className="space-y-6">
      <ChatWindow />

      {/* Dynamic widget grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-auto">
        {manifest.widgets.map((widget) => (
          <WidgetRenderer key={widget.id} widget={widget} />
        ))}
      </div>

      {/* Debug info (optional - remove in production) */}
      <div className="text-xs text-slate-400 dark:text-slate-600 text-right">
        Last updated: {new Date(manifest.updatedAt).toLocaleString()} | Version: {manifest.version}
      </div>
    </main>
  );
}
