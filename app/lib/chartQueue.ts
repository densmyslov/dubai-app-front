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

export interface ChartConfig {
  title: string;
  chartType: 'line' | 'bar' | 'pie' | 'scatter' | 'area';
  categories?: string[];
  series: Array<{
    name: string;
    data: number[] | Array<{ value: number; name: string }>;
    type?: string;
  }>;
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
      messages = messages.filter(
        (message) => !message.sessionId || message.sessionId === sessionId
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
