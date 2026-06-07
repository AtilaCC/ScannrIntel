'use client';

import Link from 'next/link';
import { Zap, ArrowUpRight } from 'lucide-react';

interface PlanBadgeProps {
  plan: 'FREE' | 'PRO' | 'ENTERPRISE';
  showUpgrade?: boolean;
  size?: 'sm' | 'md';
}

const PLAN_STYLES = {
  FREE:       'bg-text-muted/10 border-text-muted/30 text-text-muted',
  PRO:        'bg-accent-cyan/10 border-accent-cyan/30 text-accent-cyan',
  ENTERPRISE: 'bg-accent-purple/10 border-accent-purple/30 text-accent-purple',
};

const PLAN_BADGES = {
  FREE:       '🆓',
  PRO:        '⚡',
  ENTERPRISE: '🏢',
};

export function PlanBadge({ plan, showUpgrade = true, size = 'sm' }: PlanBadgeProps) {
  return (
    <div className={`flex items-center gap-2 ${size === 'md' ? 'flex-col' : ''}`}>
      <span className={`inline-flex items-center gap-1 border rounded font-mono font-bold transition-all ${
        size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1'
      } ${PLAN_STYLES[plan]}`}>
        {PLAN_BADGES[plan]} {plan}
      </span>

      {showUpgrade && plan === 'FREE' && (
        <Link
          href="/dashboard/billing"
          className="flex items-center gap-0.5 text-xs text-accent-cyan hover:underline font-mono"
        >
          Upgrade <ArrowUpRight className="w-3 h-3" />
        </Link>
      )}
    </div>
  );
}

// ── Upgrade prompt (shown when feature is locked) ─────────────

interface UpgradePromptProps {
  feature:     string;
  requiredPlan:'PRO' | 'ENTERPRISE';
  currentPlan: 'FREE' | 'PRO' | 'ENTERPRISE';
}

export function UpgradePrompt({ feature, requiredPlan, currentPlan }: UpgradePromptProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center space-y-4">
      <div className="w-14 h-14 rounded-xl bg-accent-cyan/10 border border-accent-cyan/20 flex items-center justify-center">
        <Zap className="w-7 h-7 text-accent-cyan" />
      </div>
      <div>
        <h3 className="font-display font-bold text-text-primary text-lg">
          {feature} requires {requiredPlan}
        </h3>
        <p className="text-text-secondary text-sm mt-1 max-w-xs">
          You are on the <span className="font-mono font-bold">{currentPlan}</span> plan.
          Upgrade to unlock {feature} and all other {requiredPlan} features.
        </p>
      </div>
      <Link
        href="/dashboard/billing"
        className="flex items-center gap-2 px-6 py-2.5 bg-accent-cyan text-bg-primary rounded-lg font-display font-bold text-sm hover:bg-accent-cyan/90 transition-all shadow-glow-cyan"
      >
        <Zap className="w-4 h-4" />
        Upgrade to {requiredPlan}
      </Link>
      <Link href="/pricing" className="text-text-muted text-xs hover:text-text-secondary transition-colors">
        View all plans →
      </Link>
    </div>
  );
}
