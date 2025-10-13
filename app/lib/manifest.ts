// ============================================================================
// Manifest Types for Dynamic Dashboard
// ============================================================================
// Defines the schema for the dashboard manifest that can be updated at runtime
// via the LLM webhook endpoint.
// ============================================================================

export interface Manifest {
  version: string;
  updatedAt: string;
  widgets: Widget[];
}

export type Widget = KPIWidget | ChartWidget | MarkdownWidget | TableWidget;

interface BaseWidget {
  id: string;
  type: 'kpi' | 'chart' | 'markdown' | 'table';
  gridColumn?: string; // e.g., "1 / 2", "span 2"
  gridRow?: string;
}

export interface KPIWidget extends BaseWidget {
  type: 'kpi';
  label: string;
  value: string;
  suffix?: string;
}

export interface ChartWidget extends BaseWidget {
  type: 'chart';
  title: string;
  categories: string[];
  series: Array<{ name: string; data: number[] }>;
}

export interface MarkdownWidget extends BaseWidget {
  type: 'markdown';
  content: string;
  title?: string;
}

export interface TableWidget extends BaseWidget {
  type: 'table';
  title: string;
  headers: string[];
  rows: string[][];
}

// Default manifest for initial state
export const DEFAULT_MANIFEST: Manifest = {
  version: '1.0.0',
  updatedAt: new Date().toISOString(),
  widgets: [
    {
      id: 'welcome',
      type: 'markdown',
      title: 'Welcome',
      content: '# Welcome to Dubai Real Estate Dashboard\n\nThis dashboard displays dynamic content. Use the chat to ask Claude to update the widgets.',
    },
  ],
};
