'use client';
import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

type Series = { name: string; data: number[] };

export default function ChartCard({
  title,
  categories,
  series
}: {
  title: string;
  categories: string[];
  series: Series[];
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      title: { text: title },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: categories },
      yAxis: { type: 'value' },
      series: series.map(s => ({ name: s.name, type: 'line', data: s.data }))
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); chart.dispose(); };
  }, [title, categories, series]);
  return <div className="rounded-2xl bg-white p-4 shadow" ref={ref} style={{height: 360}} />;
}
