'use client';
import { LineChart, Line, ResponsiveContainer } from 'recharts';

interface MiniPriceChartProps {
  data?: { price: number }[];
  positive?: boolean;
}

export function MiniPriceChart({ data = [], positive = true }: MiniPriceChartProps) {
  const chartData = data.length > 0 ? data : Array.from({ length: 10 }, (_, i) => ({ price: 100 + Math.random() * 10 }));
  return (
    <ResponsiveContainer width="100%" height={40}>
      <LineChart data={chartData}>
        <Line type="monotone" dataKey="price" stroke={positive ? '#22c55e' : '#ef4444'} dot={false} strokeWidth={1.5} />
      </LineChart>
    </ResponsiveContainer>
  );
}
