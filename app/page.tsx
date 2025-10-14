// app/page.tsx
import React from 'react';
import ChatWindow from './components/ChatWindow';
import ManifestProvider from './components/ManifestProvider';
import DynamicCharts from './components/DynamicCharts';

export const runtime = 'edge';

export default function Page() {
  return (
    <main className="space-y-6">
      <ChatWindow />

      {/* Dynamic widget grid with auto-refresh */}
      <ManifestProvider />

      {/* Dynamic charts from backend */}
      <DynamicCharts />
    </main>
  );
}
