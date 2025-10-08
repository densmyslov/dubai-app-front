// app/components/ChartCard.tsx
"use client";
import React, { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";

type Series = { name: string; data: number[] };

export default function ChartCard({
  title,
  categories,
  series,
  streamSessionId, // <- optional: if provided, listen to SSE and append
}: {
  title: string;
  categories: string[];
  series: Series[];
  streamSessionId?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const chart = echarts.init(ref.current!);
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); chart.dispose(); };
  }, []);

  useEffect(() => {
    const checkDarkMode = () => setIsDark(document.documentElement.classList.contains("dark"));
    checkDarkMode();
    const obs = new MutationObserver(checkDarkMode);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // render/update chart option when props or theme change
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.setOption({
      backgroundColor: "transparent",
      title: { text: title, textStyle: { color: isDark ? "#e2e8f0" : "#1e293b" } },
      tooltip: {
        trigger: "axis",
        backgroundColor: isDark ? "#1e293b" : "#ffffff",
        borderColor: isDark ? "#475569" : "#e2e8f0",
        textStyle: { color: isDark ? "#e2e8f0" : "#1e293b" },
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
      series: series.map((s) => ({ name: s.name, type: "line", data: s.data })),
    });
  }, [title, categories, series, isDark]);

  // optional SSE: append live points when streamSessionId is set
  useEffect(() => {
    if (!streamSessionId || !chartRef.current) return;
    const es = new EventSource(`/api/webhook/stream?sessionId=${encodeURIComponent(streamSessionId)}`);

    es.onmessage = (e) => {
      const data = JSON.parse(e.data); // { id, text, ... }
      // Update chart directly to avoid re-rendering parent
      const chart = chartRef.current!;
      const option = chart.getOption() as any;

      const x = new Date(data.id || Date.now()).toLocaleTimeString();
      const y = Number(data.text); // adapt to your payload

      const xs = option.xAxis[0].data as string[];
      const series0 = option.series[0].data as number[];

      xs.push(x);
      series0.push(y);
      // keep last 50 points
      if (xs.length > 50) xs.splice(0, xs.length - 50);
      if (series0.length > 50) series0.splice(0, series0.length - 50);

      chart.setOption({ xAxis: [{ data: xs }], series: [{ data: series0 }] });
    };

    es.onerror = () => { es.close(); setTimeout(() => location.reload(), 1500); };
    return () => es.close();
  }, [streamSessionId]);

  return <div className="rounded-2xl bg-white dark:bg-slate-800 p-4 shadow" ref={ref} style={{ height: 360 }} />;
}
