"use client";
import React, { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";

export type Series = { name: string; data: (number | null)[] };

export interface ChartCardProps {
  title: string;
  chartType?: 'line' | 'bar' | 'pie' | 'scatter' | 'area';
  categories: string[];
  series: Series[];
  streamSessionId?: string; // ok to keep/ignore
}

const ChartCard: React.FC<ChartCardProps> = ({
  title,
  chartType = 'line',
  categories,
  series,
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isDark, setIsDark] = useState(false);

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

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      backgroundColor: "transparent",
      title: {
        text: title,
        textStyle: { color: isDark ? "#e2e8f0" : "#1e293b" },
      },
      legend: {
        top: 35,
        textStyle: { color: isDark ? "#94a3b8" : "#64748b" },
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: isDark ? "#1e293b" : "#ffffff",
        borderColor: isDark ? "#475569" : "#e2e8f0",
        textStyle: { color: isDark ? "#e2e8f0" : "#1e293b" },
      },
      grid: {
        top: 80,
        left: "3%",
        right: "4%",
        bottom: "3%",
        containLabel: true,
      },
      xAxis: {
        type: "category",
        data: categories,
        axisLine: { lineStyle: { color: isDark ? "#475569" : "#cbd5e1" } },
        axisLabel: { color: isDark ? "#94a3b8" : "#64748b" },
      },
      yAxis: {
        type: "value",
        axisLine: { lineStyle: { color: isDark ? "#475569" : "#cbd5e1" } },
        axisLabel: { color: isDark ? "#94a3b8" : "#64748b" },
        splitLine: { lineStyle: { color: isDark ? "#334155" : "#e2e8f0" } },
      },
      series: series.map((s) => ({ name: s.name, type: chartType, data: s.data })),
    });
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [title, chartType, categories, series, isDark]);

  return (
    <div
      ref={ref}
      className="rounded-2xl bg-white dark:bg-slate-800 p-4 shadow"
      style={{ height: 360 }}
    />
  );
};

export default ChartCard;
