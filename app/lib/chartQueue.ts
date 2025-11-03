// ============================================================================
// In-Memory Chart Queue for Dynamic Chart Updates
// ============================================================================
// Maintains a singleton queue for chart configuration messages that get
// delivered to the dashboard via SSE. This allows the backend to dynamically
// inject charts into the frontend without cluttering the chat interface.
// ============================================================================

export interface ChartMessage {
  id: string;
  type: 'chart' | 'chart_update' | 'chart_remove';
  chartId: string;
  timestamp: number;
  sessionId?: string;
  config?: ChartConfig;
}

export interface ChartDataSource {
  type: 'csv' | 'json';
  url: string;  // Full R2 URL: https://pub-xyz.r2.dev/{userId}/{sessionId}/{requestId}/{taskId}/charts/{filename}.csv

  // Metadata for tracking and debugging
  userId?: string;      // User who generated this chart
  requestId?: string;   // Chat request ID
  taskId?: string;      // Task ID that generated this data

  // CSV-specific options
  xColumn?: string;     // Column name for X-axis (categories)
  yColumns?: string[];  // Column names for Y-axis (series)
  parseOptions?: {
    delimiter?: string;
    skipRows?: number;
    headers?: boolean;
  };
}

export interface ChartConfig {
  title: string;
  chartType: 'line' | 'bar' | 'pie' | 'scatter' | 'area';

  // Option 1: Inline data (current approach, for small datasets)
  categories?: string[];
  series?: Array<{
    name: string;
    data: (number | null)[] | Array<{ value: number; name: string }>;
    type?: string;
  }>;

  // Option 2: External data source (new approach, for large datasets)
  dataSource?: ChartDataSource;

  options?: {
    legend?: boolean;
    grid?: Record<string, unknown>;
    tooltip?: Record<string, unknown>;
    xAxis?: Record<string, unknown>;
    yAxis?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

class ChartQueue {
  private messages: ChartMessage[] = [];
  private listeners: Set<(message: ChartMessage) => void> = new Set();
  private readonly MAX_MESSAGES = 50;

  addChart(chartId: string, config: ChartConfig, sessionId?: string): ChartMessage {
    const message: ChartMessage = {
      id: `chart-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      type: 'chart',
      chartId,
      timestamp: Date.now(),
      sessionId,
      config,
    };

    this.messages.push(message);

    if (this.messages.length > this.MAX_MESSAGES) {
      this.messages.shift();
    }

    this.listeners.forEach((listener) => listener(message));
    return message;
  }

  updateChart(chartId: string, config: ChartConfig, sessionId?: string): ChartMessage {
    const message: ChartMessage = {
      id: `chart-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      type: 'chart_update',
      chartId,
      timestamp: Date.now(),
      sessionId,
      config,
    };

    this.messages.push(message);

    if (this.messages.length > this.MAX_MESSAGES) {
      this.messages.shift();
    }

    this.listeners.forEach((listener) => listener(message));
    return message;
  }

  removeChart(chartId: string, sessionId?: string): ChartMessage {
    const message: ChartMessage = {
      id: `chart-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      type: 'chart_remove',
      chartId,
      timestamp: Date.now(),
      sessionId,
    };

    this.messages.push(message);

    if (this.messages.length > this.MAX_MESSAGES) {
      this.messages.shift();
    }

    this.listeners.forEach((listener) => listener(message));
    return message;
  }

  subscribe(callback: (message: ChartMessage) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  getRecentMessages(limit: number = 10, sessionId?: string): ChartMessage[] {
    let messages = [...this.messages];

    if (sessionId) {
      // Only return messages that exactly match the sessionId
      // Do NOT return messages with no sessionId (those go to global storage)
      messages = messages.filter(
        (message) => message.sessionId === sessionId
      );
    } else {
      // If no sessionId specified, only return messages without sessionId (global)
      messages = messages.filter(
        (message) => !message.sessionId
      );
    }

    return messages.slice(-limit);
  }

  clear(): void {
    this.messages = [];
  }

  getListenerCount(): number {
    return this.listeners.size;
  }
}

const globalForChartQueue = globalThis as typeof globalThis & {
  __CHART_QUEUE__?: ChartQueue;
};

export const chartQueue =
  globalForChartQueue.__CHART_QUEUE__ ?? new ChartQueue();

if (!globalForChartQueue.__CHART_QUEUE__) {
  globalForChartQueue.__CHART_QUEUE__ = chartQueue;
}
