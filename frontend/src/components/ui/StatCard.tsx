'use client';

import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  color: 'cyan' | 'green' | 'red' | 'yellow' | 'purple';
  suffix?: string;
  change?: number;
}

const colorMap = {
  cyan:   { text: 'text-accent-cyan',   bg: 'bg-accent-cyan/10',   border: 'border-accent-cyan/20'   },
  green:  { text: 'text-accent-green',  bg: 'bg-accent-green/10',  border: 'border-accent-green/20'  },
  red:    { text: 'text-accent-red',    bg: 'bg-accent-red/10',    border: 'border-accent-red/20'    },
  yellow: { text: 'text-accent-yellow', bg: 'bg-accent-yellow/10', border: 'border-accent-yellow/20' },
  purple: { text: 'text-accent-purple', bg: 'bg-accent-purple/10', border: 'border-accent-purple/20' },
};

export function StatCard({ label, value, icon: Icon, color, suffix = '', change }: StatCardProps) {
  const c = colorMap[color];
  return (
    <div className={`glass-card rounded-xl p-5 border ${c.border}`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg ${c.bg} flex items-center justify-center`}>
          <Icon className={`w-4 h-4 ${c.text}`} />
        </div>
        {change !== undefined && (
          <span className={`text-xs font-mono ${change >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
            {change >= 0 ? '+' : ''}{change.toFixed(1)}%
          </span>
        )}
      </div>
      <div className={`font-display text-2xl font-bold ${c.text} tabular-nums`}>
        {value}{suffix}
      </div>
      <div className="text-text-muted text-xs mt-1 font-medium tracking-wide uppercase">
        {label}
      </div>
    </div>
  );
}
