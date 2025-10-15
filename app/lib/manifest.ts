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
  chartType?: 'line' | 'bar' | 'pie' | 'scatter' | 'area';
  categories: string[];
  series: Array<{ name: string; data: (number | null)[] }>;
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
      title: 'Welcome to Dubai Real Estate Dashboard',
      content: `# 🏢 Dynamic Dashboard

This dashboard displays **real-time analytics** powered by Claude AI.

## Getting Started

1. **Open the chat** (bottom right corner)
2. **Ask Claude** to analyze Dubai real estate data
3. **Watch the dashboard update** automatically

### Example Questions

- "Show me the top 5 communities by net yield"
- "Create a chart of median rents over time"
- "Compare price-to-rent ratios across property types"

The dashboard will update instantly with charts, KPIs, and insights!`,
      gridColumn: 'span 4',
    },
    {
      id: 'placeholder-kpi-1',
      type: 'kpi',
      label: 'Awaiting Data',
      value: '—',
      suffix: '',
    },
    {
      id: 'placeholder-kpi-2',
      type: 'kpi',
      label: 'Ask Claude',
      value: '💬',
      suffix: '',
    },
    {
      id: 'placeholder-info',
      type: 'markdown',
      content: '## 📊 Charts Coming Soon\n\nAsk Claude to analyze your data and this area will fill with interactive visualizations.',
      gridColumn: 'span 2',
    },
  ],
};
