"use client";
import React, { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { useSession } from "../contexts/SessionContext";
import type { ChartConfig } from "../lib/chartQueue";
import { fetchAndParseCSV } from "../lib/csvParser";

// ============================================================================
// DynamicCharts Component
// ============================================================================
// Listens to the chart SSE stream and dynamically renders charts sent from
// the backend. Charts are displayed in a grid layout and can be added,
// updated, or removed in real-time without cluttering the chat interface.
//
// The component automatically uses the session ID from SessionContext to ensure
// that charts are isolated per user session.
// ============================================================================

interface ChartState {
  chartId: string;
  config: ChartConfig;
  timestamp: number;
}

const DynamicCharts: React.FC = () => {
  const { sessionId } = useSession();
  const [charts, setCharts] = useState<Map<string, ChartState>>(new Map());
  const [connectionStatus, setConnectionStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [mounted, setMounted] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);

  // Delete chart handler
  const handleDeleteChart = async (chartId: string) => {
    console.log('[DynamicCharts] Deleting chart:', chartId);

    try {
      // Call the delete API
      const response = await fetch('/api/charts', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chartId,
          sessionId, // Include sessionId for proper KV key
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to delete chart: ${response.status}`);
      }

      const result = await response.json();
      console.log('[DynamicCharts] Chart deleted successfully:', result);

      // Remove from local state immediately
      setCharts((prev) => {
        const updated = new Map(prev);
        updated.delete(chartId);
        console.log('[DynamicCharts] Removed from local state. Remaining:', updated.size);
        return updated;
      });
    } catch (error) {
      console.error('[DynamicCharts] Failed to delete chart:', error);
      throw error; // Re-throw to let the button handler show error UI
    }
  };

  // Client-side mounting guard
  useEffect(() => {
    setMounted(true);
  }, []);

  // Subscribe to chart stream
  useEffect(() => {
    if (!mounted) return;

    let isActive = true;

    const clearRetryTimer = () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (!isActive) return;
      const attempt = attemptRef.current + 1;
      attemptRef.current = attempt;
      const delay = Math.min(1500 * attempt, 15000); // linear backoff, cap at 15s
      console.warn("[DynamicCharts] Scheduling reconnect in", delay, "ms (attempt", attempt, ")");
      clearRetryTimer();
      retryTimeoutRef.current = setTimeout(() => {
        retryTimeoutRef.current = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (!isActive) return;
      clearRetryTimer();

      setConnectionStatus("connecting");

      const streamUrl = `/api/charts/stream${
        sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""
      }`;
      console.log("[DynamicCharts] Connecting to chart stream:", streamUrl);

      sourceRef.current?.close();
      const es = new EventSource(streamUrl);
      sourceRef.current = es;

      es.onopen = () => {
        console.log("[DynamicCharts] Chart stream connection opened");
        attemptRef.current = 0;
        setConnectionStatus("connected");
      };

      es.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          console.log("[DynamicCharts] Received payload:", payload);

          // Ignore keepalives and connection confirmations
          if (payload?.type === "connected" || payload?.type === "ping") {
            return;
          }

          // Handle chart messages
          if (payload?.type === "chart" || payload?.type === "chart_update") {
            const { chartId, config, isHistory } = payload;

            if (!chartId || !config) {
              console.warn("[DynamicCharts] Invalid chart payload:", payload);
              return;
            }

            console.log(
              `[DynamicCharts] ${isHistory ? "Loading" : "Adding/updating"} chart:`,
              chartId
            );

            setCharts((prev) => {
              const existing = prev.get(chartId);

              // Check if chart data actually changed (deep comparison)
              if (existing && JSON.stringify(existing.config) === JSON.stringify(config)) {
                console.log("[DynamicCharts] Chart", chartId, "unchanged, skipping update");
                return prev; // Return same reference to prevent re-render
              }

              const updated = new Map(prev);
              updated.set(chartId, {
                chartId,
                config,
                timestamp: payload.timestamp || Date.now(),
              });
              console.log("[DynamicCharts] Charts state updated. Total charts:", updated.size);
              console.log("[DynamicCharts] Chart IDs:", Array.from(updated.keys()));
              if (isHistory) {
                console.log("[DynamicCharts] Chart", chartId, "loaded from history (likely KV)");
              } else {
                console.log("[DynamicCharts] Chart", chartId, "received live from SSE");
              }
              return updated;
            });
          } else if (payload?.type === "chart_remove") {
            const { chartId } = payload;

            if (!chartId) {
              console.warn("[DynamicCharts] Invalid chart removal payload:", payload);
              return;
            }

            console.log("[DynamicCharts] Removing chart:", chartId);

            setCharts((prev) => {
              const updated = new Map(prev);
              updated.delete(chartId);
              return updated;
            });
          } else {
            // Log unhandled types for debugging
            console.warn("[DynamicCharts] Unhandled payload type:", payload?.type, "Full payload:", payload);
          }
        } catch (err) {
          console.error("[DynamicCharts] Failed to parse SSE message", err, event.data);
        }
      };

      es.onerror = (err) => {
        console.error("[DynamicCharts] EventSource error:", err);
        setConnectionStatus("disconnected");
        es.close();
        sourceRef.current = null;
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      isActive = false;
      clearRetryTimer();
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, [mounted, sessionId]);

  if (!mounted) return null;

  const chartArray = Array.from(charts.values()).sort(
    (a, b) => b.timestamp - a.timestamp
  );
  const rows: ChartState[][] = [];
  const columnsPerRow = 2;
  for (let i = 0; i < chartArray.length; i += columnsPerRow) {
    rows.push(chartArray.slice(i, i + columnsPerRow));
  }

  console.log("[DynamicCharts] Render - mounted:", mounted, "charts:", chartArray.length);

  if (chartArray.length === 0) {
    console.log("[DynamicCharts] No charts to display, returning null");
    return null; // Don't render anything if no charts
  }

  console.log("[DynamicCharts] Rendering", chartArray.length, "charts");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          Dynamic Charts
        </h2>
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              connectionStatus === "connected"
                ? "bg-green-400"
                : connectionStatus === "connecting"
                ? "bg-yellow-400 animate-pulse"
                : "bg-red-400"
            }`}
            title={`Chart stream: ${connectionStatus}`}
          />
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {connectionStatus === "connected"
              ? "Live"
              : connectionStatus === "connecting"
              ? "Connecting..."
              : "Offline"}
          </span>
        </div>
      </div>

      <div className="space-y-6">
        {rows.map((rowCharts, rowIndex) => (
          <div key={`chart-row-${rowIndex}`} className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {rowCharts.map((chart) => (
              <DynamicChart
                key={chart.chartId}
                chartId={chart.chartId}
                config={chart.config}
                onDelete={handleDeleteChart}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// DynamicChart Component
// ============================================================================
// Renders a single chart from a ChartConfig object. Supports multiple
// chart types and automatically adapts to dark mode.
// ============================================================================

interface DynamicChartProps {
  chartId: string;
  config: ChartConfig;
  onDelete?: (chartId: string) => void;
}

const DynamicChart: React.FC<DynamicChartProps> = React.memo(({ chartId, config, onDelete }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [resolvedConfig, setResolvedConfig] = useState<ChartConfig>(config);

  // Debug: Log when component renders
  useEffect(() => {
    console.log('[DynamicChart] Component rendered/updated for chartId:', chartId);
  });

  // Detect dark mode
  useEffect(() => {
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains("dark"));
    };
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  // Load CSV data if dataSource is provided
  useEffect(() => {
    if (!config.dataSource) {
      // No dataSource, use inline data
      setResolvedConfig(config);
      setDataError(null);
      return;
    }

    if (config.dataSource.type !== 'csv') {
      // Only CSV is supported for now
      setDataError(`Unsupported data source type: ${config.dataSource.type}`);
      return;
    }

    // Fetch and parse CSV
    const loadCSVData = async () => {
      setIsLoadingData(true);
      setDataError(null);

      const dataSource = config.dataSource!; // Already checked above
      console.log('[DynamicChart] Loading CSV data from:', dataSource.url);

      try {
        const { categories, series } = await fetchAndParseCSV(
          dataSource.url,
          dataSource.xColumn,
          dataSource.yColumns,
          dataSource.parseOptions
        );

        console.log('[DynamicChart] CSV data loaded successfully:', { categories: categories.length, series: series.length });

        // Merge CSV data with config
        setResolvedConfig({
          ...config,
          categories,
          series,
        });
      } catch (error) {
        console.error('[DynamicChart] Failed to load CSV data:', error);
        setDataError(error instanceof Error ? error.message : 'Failed to load CSV data');
      } finally {
        setIsLoadingData(false);
      }
    };

    loadCSVData();
  }, [config]);

  // Initialize chart once
  useEffect(() => {
    if (!ref.current) {
      console.log('[DynamicChart] Init skipped: ref.current is null');
      return;
    }

    console.log('[DynamicChart] Initializing ECharts, ref.current:', ref.current);

    try {
      chartRef.current = echarts.init(ref.current);
      console.log('[DynamicChart] ECharts initialized successfully, chartRef:', chartRef.current);
    } catch (error) {
      console.error('[DynamicChart] ECharts initialization failed:', error);
      return;
    }

    const onResize = () => chartRef.current?.resize();
    window.addEventListener("resize", onResize);

    return () => {
      console.log('[DynamicChart] Cleaning up ECharts instance');
      window.removeEventListener("resize", onResize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  // Update chart when resolved config or theme changes
  useEffect(() => {
    if (!chartRef.current) {
      console.log('[DynamicChart] Chart ref not ready yet');
      return;
    }
    if (isLoadingData) {
      console.log('[DynamicChart] Still loading data, skipping render');
      return;
    }
    if (dataError) {
      console.log('[DynamicChart] Data error, skipping render:', dataError);
      return;
    }
    if (!resolvedConfig.series || resolvedConfig.series.length === 0) {
      console.log('[DynamicChart] No series data, skipping render. resolvedConfig:', resolvedConfig);
      return;
    }

    console.log('[DynamicChart] Rendering chart with config:', {
      chartId,
      title: resolvedConfig.title,
      chartType: resolvedConfig.chartType,
      categoriesCount: resolvedConfig.categories?.length,
      categories: resolvedConfig.categories,
      seriesCount: resolvedConfig.series.length,
      series: resolvedConfig.series,
    });

    // Build ECharts option from resolved config
    const option: echarts.EChartsOption = {
      backgroundColor: "transparent",
      title: {
        text: resolvedConfig.title,
        textStyle: { color: isDark ? "#e2e8f0" : "#1e293b" },
      },
      tooltip: (() => {
        const tooltipOptions = (resolvedConfig.options?.tooltip as any) || {};
        // Convert Python-style formatter to JavaScript function
        if (tooltipOptions.formatter && typeof tooltipOptions.formatter === 'string') {
          const formatterStr = tooltipOptions.formatter;
          // Check for Python f-string formatting patterns like {c:,.0f}
          if (formatterStr.includes(':,')) {
            tooltipOptions.formatter = (params: any) => {
              const param = Array.isArray(params) ? params[0] : params;
              const value = typeof param.value === 'number'
                ? param.value.toLocaleString('en-US', { maximumFractionDigits: 0 })
                : param.value;
              return `${param.name}: ${value}`;
            };
          }
        }
        return {
          trigger: "axis",
          backgroundColor: isDark ? "#1e293b" : "#ffffff",
          borderColor: isDark ? "#475569" : "#e2e8f0",
          textStyle: { color: isDark ? "#e2e8f0" : "#1e293b" },
          ...tooltipOptions,
        };
      })(),
      grid: {
        top: resolvedConfig.options?.legend === false ? 50 : 80,
        left: "3%",
        right: "4%",
        bottom: "3%",
        containLabel: true,
        ...(resolvedConfig.options?.grid || {}),
      },
    };

    // Handle legend - show by default unless explicitly disabled
    if (resolvedConfig.options?.legend !== false) {
      option.legend = {
        top: 35,
        textStyle: { color: isDark ? "#94a3b8" : "#64748b" },
      };
    }

    // Merge any additional options (but after legend handling)
    if (resolvedConfig.options) {
      const otherOptions = { ...resolvedConfig.options };
      delete otherOptions.legend;
      delete otherOptions.tooltip;
      delete otherOptions.grid;
      delete otherOptions.xAxis;
      delete otherOptions.yAxis;
      Object.assign(option, otherOptions);
    }

    // Add xAxis for chart types that need it
    if (["line", "bar", "area"].includes(resolvedConfig.chartType)) {
      option.xAxis = {
        type: "category",
        data: resolvedConfig.categories || [],
        axisLine: { lineStyle: { color: isDark ? "#475569" : "#cbd5e1" } },
        axisLabel: { color: isDark ? "#94a3b8" : "#64748b" },
        ...(resolvedConfig.options?.xAxis || {}),
      };
      // Process yAxis options and fix formatter if needed
      const yAxisOptions = (resolvedConfig.options?.yAxis as any) || {};
      const yAxisLabelOptions = yAxisOptions.axisLabel ? { ...yAxisOptions.axisLabel } : {};

      // Convert Python-style formatter to JavaScript function
      if (yAxisLabelOptions.formatter && typeof yAxisLabelOptions.formatter === 'string') {
        const formatterStr = yAxisLabelOptions.formatter;
        // Check for Python f-string formatting patterns like {value:,.0f}
        if (formatterStr.includes(':,')) {
          yAxisLabelOptions.formatter = (value: number) => {
            return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
          };
        }
      }

      option.yAxis = {
        type: "value",
        axisLine: { lineStyle: { color: isDark ? "#475569" : "#cbd5e1" } },
        axisLabel: {
          color: isDark ? "#94a3b8" : "#64748b",
          ...yAxisLabelOptions,
        },
        splitLine: { lineStyle: { color: isDark ? "#334155" : "#e2e8f0" } },
        ...yAxisOptions,
      };
    }

    // Map series with proper typing
    option.series = resolvedConfig.series.map((s) => ({
      name: s.name,
      type: (s.type || resolvedConfig.chartType) as any,
      data: s.data as any,
    }));

    // Use setOption with notMerge: false to update existing chart smoothly
    console.log('[DynamicChart] Calling ECharts setOption with:', {
      hasTitle: !!option.title,
      hasXAxis: !!option.xAxis,
      hasYAxis: !!option.yAxis,
      seriesCount: option.series?.length,
      xAxisDataLength: (option.xAxis as any)?.data?.length,
    });

    try {
      chartRef.current.setOption(option, {
        notMerge: false, // Merge with existing option for smooth updates
        lazyUpdate: true, // Batch updates for better performance
      });
      console.log('[DynamicChart] ECharts setOption successful');
    } catch (error) {
      console.error('[DynamicChart] ECharts setOption failed:', error);
    }
  }, [resolvedConfig, isDark, chartId, isLoadingData, dataError]);

  const handleDelete = async () => {
    if (!onDelete) return;

    if (!confirm(`Delete chart "${config.title}"?`)) {
      return;
    }

    setIsDeleting(true);
    try {
      await onDelete(chartId);
    } catch (error) {
      console.error('[DynamicChart] Failed to delete chart:', error);
      alert('Failed to delete chart. Please try again.');
      setIsDeleting(false);
    }
  };

  return (
    <div className="relative rounded-2xl bg-white dark:bg-slate-800 p-4 shadow">
      {/* Delete button */}
      {onDelete && (
        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className="absolute top-2 right-2 z-10 p-2 rounded-lg bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Delete chart"
          aria-label={`Delete chart ${config.title}`}
        >
          {isDeleting ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          )}
        </button>
      )}

      {/* Loading state */}
      {isLoadingData && (
        <div className="h-64 flex items-center justify-center">
          <div className="text-center">
            <svg className="w-8 h-8 animate-spin mx-auto mb-2 text-blue-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading chart data...</p>
            {config.dataSource?.url && (
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 truncate max-w-xs mx-auto">
                {config.dataSource.url.split('/').pop()}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Error state */}
      {!isLoadingData && dataError && (
        <div className="h-64 flex items-center justify-center">
          <div className="text-center max-w-md px-4">
            <svg className="w-12 h-12 mx-auto mb-3 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-medium text-red-600 dark:text-red-400 mb-1">Failed to load chart data</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{dataError}</p>
          </div>
        </div>
      )}

      {/* Chart container */}
      {!isLoadingData && !dataError && (
        <div ref={ref} className="h-64"></div>
      )}
    </div>
  );
});

DynamicChart.displayName = "DynamicChart";

export default DynamicCharts;
