'use client';

import dynamic from 'next/dynamic';
import type { ArtifactCanvasItem } from '@/types';

const DataVisualization = dynamic(() => import('../DataVisualization'), { ssr: false });

interface ChartViewerProps {
  artifact: ArtifactCanvasItem;
}

export default function ChartViewer({ artifact }: ChartViewerProps) {
  const data = artifact.chartData || [];
  const chartType = (artifact.chartType || 'bar') as 'bar' | 'line' | 'pie' | 'area' | 'scatter' | 'radar' | 'table';

  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-full p-4 text-gray-500">
        <p className="text-sm">No chart data available</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-auto bg-white p-4">
      <DataVisualization
        chartType={chartType}
        data={data}
        title={artifact.title}
      />
    </div>
  );
}
