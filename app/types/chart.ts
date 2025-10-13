// ============================================================================
// Chart Type Definitions
// ============================================================================
// Type definitions for chart configurations and payloads used throughout
// the dynamic chart system.
// ============================================================================

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

export interface ChartMessage {
  id: string;
  type: 'chart' | 'chart_update' | 'chart_remove';
  chartId: string;
  timestamp: number;
  sessionId?: string;
  config?: ChartConfig;
}

export interface ChartWebhookPayload {
  action: 'add' | 'update' | 'remove';
  chartId: string;
  sessionId?: string;
  config?: ChartConfig;
}

export interface ChartWebhookResponse {
  success: boolean;
  messageId: string;
  chartId: string;
  action: string;
  timestamp: number;
}

export interface ChartStreamEvent {
  type: 'connected' | 'chart' | 'chart_update' | 'chart_remove' | 'ping';
  chartId?: string;
  config?: ChartConfig;
  timestamp: number;
  isHistory?: boolean;
}
