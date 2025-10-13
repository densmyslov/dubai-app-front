import React from 'react';
import type { MarkdownWidget as MarkdownWidgetType } from '../lib/manifest';

export default function MarkdownWidget({ widget }: { widget: MarkdownWidgetType }) {
  // Simple markdown-to-HTML conversion (basic support)
  const renderMarkdown = (content: string) => {
    let html = content
      // Headers
      .replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mb-2 dark:text-slate-100">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 class="text-xl font-semibold mb-3 dark:text-slate-100">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mb-4 dark:text-slate-100">$1</h1>')
      // Bold
      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold">$1</strong>')
      // Italic
      .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">$1</a>')
      // Line breaks
      .replace(/\n\n/g, '</p><p class="mb-3 dark:text-slate-300">')
      .replace(/\n/g, '<br />');

    // Wrap in paragraph if not already wrapped
    if (!html.startsWith('<')) {
      html = `<p class="mb-3 dark:text-slate-300">${html}</p>`;
    }

    return html;
  };

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 p-6 shadow">
      {widget.title && (
        <h2 className="text-lg font-semibold mb-4 text-slate-900 dark:text-slate-100">
          {widget.title}
        </h2>
      )}
      <div
        className="prose dark:prose-invert max-w-none text-slate-700 dark:text-slate-300"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(widget.content) }}
      />
    </div>
  );
}
