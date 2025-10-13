import React from 'react';
import type { TableWidget as TableWidgetType } from '../lib/manifest';

export default function TableWidget({ widget }: { widget: TableWidgetType }) {
  return (
    <section className="rounded-2xl bg-white dark:bg-slate-800 p-4 shadow">
      <h2 className="text-lg font-semibold mb-3 text-slate-900 dark:text-slate-100">
        {widget.title}
      </h2>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-slate-600 dark:text-slate-400">
            <tr>
              {widget.headers.map((header, idx) => (
                <th key={idx} className="py-2 pr-4">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {widget.rows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className="border-t border-slate-200 dark:border-slate-700"
              >
                {row.map((cell, cellIdx) => (
                  <td key={cellIdx} className="py-2 pr-4 text-slate-700 dark:text-slate-300">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
