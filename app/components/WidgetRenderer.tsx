"use client";
import React from 'react';
import type { Widget } from '../lib/manifest';
import KPICard from './KPICard';
import ChartCard from './ChartCard';
import MarkdownWidget from './MarkdownWidget';
import TableWidget from './TableWidget';

interface WidgetRendererProps {
  widget: Widget;
}

export default function WidgetRenderer({ widget }: WidgetRendererProps) {
  const style: React.CSSProperties = {
    gridColumn: widget.gridColumn,
    gridRow: widget.gridRow,
  };

  switch (widget.type) {
    case 'kpi':
      return (
        <div style={style}>
          <KPICard
            label={widget.label}
            value={widget.value}
            suffix={widget.suffix}
          />
        </div>
      );

    case 'chart':
      return (
        <div style={style}>
          <ChartCard
            title={widget.title}
            categories={widget.categories}
            series={widget.series}
          />
        </div>
      );

    case 'markdown':
      return (
        <div style={style}>
          <MarkdownWidget widget={widget} />
        </div>
      );

    case 'table':
      return (
        <div style={style}>
          <TableWidget widget={widget} />
        </div>
      );

    default:
      console.warn('Unknown widget type:', (widget as any).type);
      return null;
  }
}
