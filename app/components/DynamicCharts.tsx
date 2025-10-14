"use client";
import React, { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { useSession } from "../contexts/SessionContext";
import type { ChartConfig } from "../lib/chartQueue";

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
            console.log("[DynamicCharts] Charts state updated. Total charts:", updated.size);
            console.log("[DynamicCharts] Chart IDs:", Array.from(updated.keys()));
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
    };

    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, [mounted, sessionId]);

  if (!mounted) return null;

  const chartArray = Array.from(charts.values());

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
      grid: {
        left: "3%",
        right: "4%",
        bottom: "3%",
        containLabel: true,
        ...(config.options?.grid || {}),
      },
    };

    // Handle legend - show by default unless explicitly disabled
    if (config.options?.legend !== false) {
      option.legend = {
        textStyle: { color: isDark ? "#94a3b8" : "#64748b" },
      };
    }

    // Merge any additional options (but after legend handling)
    if (config.options) {
      const { legend, tooltip, grid, xAxis, yAxis, ...otherOptions } = config.options;
      Object.assign(option, otherOptions);
    }

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

    // Map series with proper typing
    option.series = config.series.map((s) => ({
      name: s.name,
      type: (s.type || config.chartType) as any,
      data: s.data as any,
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
