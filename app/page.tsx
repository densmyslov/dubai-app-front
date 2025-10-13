// app/page.tsx
import React from 'react';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { KVNamespace } from '@cloudflare/workers-types';
import ChatWindow from './components/ChatWindow';
import WidgetRenderer from './components/WidgetRenderer';
import DynamicCharts from './components/DynamicCharts';
import { DEFAULT_MANIFEST, type Manifest } from './lib/manifest';

export const runtime = 'edge';

const MANIFEST_KEY = 'dashboard:manifest';

async function fetchManifest(): Promise<Manifest> {
  try {
    const env = getRequestContext().env as Record<string, unknown>;
    const kv = env.MANIFEST_KV as KVNamespace | undefined;

    if (!kv) {
      console.warn('[page] MANIFEST_KV not available, using default manifest');
      return DEFAULT_MANIFEST;
    }

    const stored = await kv.get(MANIFEST_KEY, 'text');
    const manifest: Manifest = stored ? JSON.parse(stored) : DEFAULT_MANIFEST;

    return manifest;
  } catch (error) {
    console.error('[page] Error fetching manifest:', error);
    return DEFAULT_MANIFEST;
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

      {/* Dynamic charts from backend */}
      <DynamicCharts />

      {/* Debug info (optional - remove in production) */}
      <div className="text-xs text-slate-400 dark:text-slate-600 text-right">
        Last updated: {new Date(manifest.updatedAt).toLocaleString()} | Version: {manifest.version}
      </div>
    </main>
  );
}
