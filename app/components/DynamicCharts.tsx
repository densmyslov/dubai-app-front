"use client";
import React, { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import type { ChartConfig } from "../lib/chartQueue";

// ============================================================================
// DynamicCharts Component
// ============================================================================
// Listens to the chart SSE stream and dynamically renders charts sent from
// the backend. Charts are displayed in a grid layout and can be added,
// updated, or removed in real-time without cluttering the chat interface.
//
// Usage:
//   <DynamicCharts sessionId="optional-session-id" />
// ============================================================================

interface DynamicChartsProps {
  sessionId?: string;
}

interface ChartState {
  chartId: string;
  config: ChartConfig;
  timestamp: number;
}

const DynamicCharts: React.FC<DynamicChartsProps> = ({ sessionId }) => {
  const [charts, setCharts] = useState<Map<string, ChartState>>(new Map());
  const [connectionStatus, setConnectionStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [mounted, setMounted] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  // Client-side mounting guard
  useEffect(() => {
    setMounted(true);
  }, []);

  // Subscribe to chart stream
  useEffect(() => {
    if (!mounted) return;

    setConnectionStatus("connecting");

    const streamUrl = `/api/charts/stream${
      sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""
    }`;
    console.log("[DynamicCharts] Connecting to chart stream:", streamUrl);

    const es = new EventSource(streamUrl);
    sourceRef.current = es;

    es.onopen = () => {
      console.log("[DynamicCharts] Chart stream connection opened");
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
            const updated = new Map(prev);
            updated.set(chartId, {
              chartId,
              config,
              timestamp: payload.timestamp || Date.now(),
            });
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
        }
      } catch (err) {
        console.error("[DynamicCharts] Failed to parse SSE message", err, event.data);
      }
    };

    es.onerror = (err) => {
      console.error("[DynamicCharts] EventSource error:", err);
      setConnectionStatus("disconnected");
      es.close();
    };

    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, [mounted, sessionId]);

  if (!mounted) return null;

  const chartArray = Array.from(charts.values());

  if (chartArray.length === 0) {
    return null; // Don't render anything if no charts
  }

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {chartArray.map((chart) => (
          <DynamicChart
            key={chart.chartId}
            chartId={chart.chartId}
            config={chart.config}
          />
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
}

const DynamicChart: React.FC<DynamicChartProps> = ({ chartId, config }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isDark, setIsDark] = useState(false);

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

  // Render chart
  useEffect(() => {
    if (!ref.current) return;

    const chart = echarts.init(ref.current);

    // Build ECharts option from config
    const option: echarts.EChartsOption = {
      backgroundColor: "transparent",
      title: {
        text: config.title,
        textStyle: { color: isDark ? "#e2e8f0" : "#1e293b" },
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: isDark ? "#1e293b" : "#ffffff",
        borderColor: isDark ? "#475569" : "#e2e8f0",
        textStyle: { color: isDark ? "#e2e8f0" : "#1e293b" },
        ...(config.options?.tooltip || {}),
      },
      legend: config.options?.legend !== false ? {
        textStyle: { color: isDark ? "#94a3b8" : "#64748b" },
      } : undefined,
      grid: {
        left: "3%",
        right: "4%",
        bottom: "3%",
        containLabel: true,
        ...(config.options?.grid || {}),
      },
      ...(config.options || {}),
    };

    // Add xAxis for chart types that need it
    if (["line", "bar", "area"].includes(config.chartType)) {
      option.xAxis = {
        type: "category",
        data: config.categories || [],
        axisLine: { lineStyle: { color: isDark ? "#475569" : "#cbd5e1" } },
        axisLabel: { color: isDark ? "#94a3b8" : "#64748b" },
        ...(config.options?.xAxis || {}),
      };
      option.yAxis = {
        type: "value",
        axisLine: { lineStyle: { color: isDark ? "#475569" : "#cbd5e1" } },
        axisLabel: { color: isDark ? "#94a3b8" : "#64748b" },
        splitLine: { lineStyle: { color: isDark ? "#334155" : "#e2e8f0" } },
        ...(config.options?.yAxis || {}),
      };
    }

    // Map series
    option.series = config.series.map((s) => ({
      name: s.name,
      type: s.type || config.chartType,
      data: s.data,
    }));

    chart.setOption(option);

    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [config, isDark, chartId]);

  return (
    <div
      ref={ref}
      className="rounded-2xl bg-white dark:bg-slate-800 p-4 shadow"
      style={{ height: 360 }}
    />
  );
};

export default DynamicCharts;
