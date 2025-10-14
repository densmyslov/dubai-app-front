"use client";
import React from 'react';
import { useManifest } from '../hooks/useManifest';
import WidgetRenderer from './WidgetRenderer';

export default function ManifestProvider() {
  const { manifest, loading, error } = useManifest();

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-auto">
        <div className="col-span-full flex items-center justify-center p-8">
          <div className="text-slate-400 dark:text-slate-500">
            Loading dashboard...
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-auto">
        <div className="col-span-full p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-800 dark:text-red-300 text-sm">
            Failed to load dashboard: {error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
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
    </>
  );
}
