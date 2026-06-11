'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Zap, Check, X, Brain, Bell, BarChart2, Shield,
  TrendingUp, Database, Headphones, ArrowRight,
} from 'lucide-react';

// ── Feature matrix rows ───────────────────────────────────────

const FEATURE_MATRIX = [
  {
    category: 'Scanner',
    icon: TrendingUp,
    rows: [
      { label: 'Live trading pairs',         free: '10',          pro: '50',          ent: 'Unlimited'  },
      { label: 'Watchlist symbols',          free: '5',           pro: '50',          ent: 'Unlimited'  },
      { label: 'Signal history',             free: '1 day',       pro: '30 days',     ent: '365 days'   },
      { label: 'Signal types',               free: '2 types',     pro: 'Todos 7 types', ent: 'Todos 7 types'},
      { label: 'Severity filtering',         free: false,         pro: true,          ent: true         },
    ],
  },
  {
    category: 'Análise de IA',
    icon: Brain,
    rows: [
      { label: 'AI insights per day',        free: '5',           pro: '100',         ent: 'Unlimited'  },
      { label: 'Insight history',            free: '7 days',      pro: '90 days',     ent: '365 days'   },
      { label: 'Token risk/opp scores',      free: false,         pro: true,          ent: true         },
      { label: 'Ranking de pontuações',          free: false,         pro: true,          ent: true         },
      { label: 'Score history',              free: '—',           pro: '30 days',     ent: '365 days'   },
    ],
  },
  {
    category: 'Alertas',
    icon: Bell,
    rows: [
      { label: 'Ativo alert configs',       free: '3',           pro: '25',          ent: 'Unlimited'  },
      { label: 'In-app notifications',       free: true,          pro: true,          ent: true         },
      { label: 'E-mail notifications',        free: false,         pro: true,          ent: true         },
      { label: 'Telegram notifications',     free: false,         pro: true,          ent: true         },
    ],
  },
  {
    category: 'Platform',
    icon: Database,
    rows: [
      { label: 'REST API access',            free: false,         pro: true,          ent: true         },
      { label: 'API rate limit',             free: '—',           pro: '60 req/min',  ent: '600 req/min'},
      { label: 'CSV / JSON export',          free: false,         pro: true,          ent: true         },
      { label: 'Concurrent sessions',        free: '2',           pro: '5',           ent: '20'         },
    ],
  },
  {
    category: 'Support',
    icon: Headphones,
    rows: [
      { label: 'Support level',              free: 'Community',   pro: 'E-mail',       ent: 'Priority'   },
      { label: 'Response time',              free: '—',           pro: '< 24 hours',  ent: '< 4 hours'  },
    ],
  },
];

// ── Cell renderer ─────────────────────────────────────────────

function Cell({ value }: { value: boolean | string }) {
  if (typeof value === 'boolean') {
    return value
      ? <Check className="w-4 h-4 text-accent-green mx-auto" />
      : <X     className="w-4 h-4 text-text-muted mx-auto"   />;
  }
  return (
    <span className={`text-xs font-mono ${value === '—' ? 'text-text-muted' : 'text-text-primary'}`}>
      {value}
    </span>
  );
}

// ── Pricing card ──────────────────────────────────────────────

function PricingCard({
  badge, name, description, price, annualPrice, highlighted,
  features, interval, onSelect, current,
}: {
  badge: string; name: string; description: string;
  price: number; annualPrice: number; highlighted: boolean;
  features: string[]; interval: 'monthly' | 'annual';
  onSelect: () => void; current?: boolean;
}) {
  const displayPrice = interval === 'annual'
    ? Math.round(annualPrice / 12)
    : price;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative rounded-2xl p-6 flex flex-col ${
        highlighted
          ? 'bg-accent-cyan/5 border-2 border-accent-cyan/40 shadow-glow-cyan'
          : 'glass-card border border-bg-border'
      }`}
    >
      {highlighted && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-accent-cyan text-bg-primary text-xs font-display font-bold px-4 py-1 rounded-full">
          MOST POPULAR
        </div>
      )}

      <div className="text-3xl mb-3">{badge}</div>
      <h3 className="font-display text-xl font-bold text-text-primary">{name}</h3>
      <p className="text-text-secondary text-sm mt-1 mb-4">{description}</p>

      <div className="mb-6">
        <div className="flex items-end gap-1">
          <span className="font-display text-4xl font-bold text-text-primary">
            ${displayPrice}
          </span>
          <span className="text-text-muted text-sm mb-1">/mo</span>
        </div>
        {interval === 'annual' && price > 0 && (
          <div className="text-xs text-accent-green mt-1">
            ${annualPrice}/year — save ${(price * 12) - annualPrice}
          </div>
        )}
        {price === 0 && (
          <div className="text-xs text-text-muted mt-1">Grátis forever</div>
        )}
      </div>

      <ul className="space-y-2.5 mb-6 flex-1">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-text-secondary">
            <Check className="w-3.5 h-3.5 text-accent-green flex-shrink-0 mt-0.5" />
            {f}
          </li>
        ))}
      </ul>

      {current ? (
        <div className="text-center text-xs font-mono text-accent-cyan border border-accent-cyan/30 bg-accent-cyan/10 rounded-lg py-2.5">
          Plano Atual
        </div>
      ) : (
        <button
          onClick={onSelect}
          className={`w-full py-2.5 rounded-lg font-display font-bold text-sm transition-all flex items-center justify-center gap-2 ${
            highlighted
              ? 'bg-accent-cyan text-bg-primary hover:bg-accent-cyan/90 shadow-glow-cyan'
              : price === 0
              ? 'bg-bg-secondary text-text-secondary border border-bg-border hover:border-text-secondary'
              : 'bg-bg-tertiary text-text-primary border border-bg-border hover:border-accent-cyan hover:text-accent-cyan'
          }`}
        >
          {price === 0 ? 'Começar Grátis' : `Começar ${name}`}
          <ArrowRight className="w-4 h-4" />
        </button>
      )}
    </motion.div>
  );
}

// ── Main page ─────────────────────────────────────────────────

export default function PricingPage() {
  const [interval, setInterval] = useState<'monthly' | 'annual'>('monthly');

  const plans = [
    {
      badge: '🆓', name: 'Grátis', description: 'Get started with real-time market monitoring',
      price: 0, annualPrice: 0, highlighted: false,
      features: [
        '10 live trading pairs',
        '5 watchlist symbols',
        '5 AI insights per day',
        'In-app notifications',
        '3 alert configs',
        '2 signal types (whale + volume)',
      ],
      href: '/auth/register',
    },
    {
      badge: '⚡', name: 'Pro', description: 'Full AI analysis for serious traders',
      price: 49, annualPrice: 470, highlighted: true,
      features: [
        '50 live trading pairs',
        '50 watchlist symbols',
        '100 AI insights per day',
        'E-mail + Telegram alerts',
        '25 alert configs',
        'Todos 7 signal types',
        'Token risk/pontuações de oportunidade',
        'Ranking de pontuaçõess',
        'REST API (60 req/min)',
        'CSV / JSON export',
      ],
      href: '/auth/register?plan=PRO',
    },
    {
      badge: '🏢', name: 'Enterprise', description: 'Unlimited access for teams and institutions',
      price: 299, annualPrice: 2870, highlighted: false,
      features: [
        'Unlimited pairs & watchlist',
        'Unlimited AI insights',
        'Todos Pro features',
        '365-day history',
        'REST API (600 req/min)',
        'Priority support (< 4h)',
        '20 concurrent sessions',
        'Admin plan overrides',
      ],
      href: '/auth/register?plan=ENTERPRISE',
    },
  ];

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-bg-border">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent-cyan/20 border border-accent-cyan/40 flex items-center justify-center">
            <Zap className="w-4 h-4 text-accent-cyan" />
          </div>
          <span className="font-display font-bold text-text-primary">CryptoIntel</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/auth/login"
            className="text-text-secondary hover:text-text-primary text-sm transition-colors">
            Sign in
          </Link>
          <Link href="/auth/register"
            className="px-4 py-2 bg-accent-cyan text-bg-primary rounded-lg text-sm font-bold hover:bg-accent-cyan/90 transition-all">
            Get started
          </Link>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-16 space-y-16">
        {/* Header */}
        <div className="text-center space-y-4">
          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-display text-5xl font-bold text-text-primary"
          >
            Simple, transparent pricing
          </motion.h1>
          <p className="text-text-secondary text-xl max-w-xl mx-auto">
            Comece grátis. Faça upgrade quando precisar de mais insights de IA, sinais e alertas.
          </p>

          {/* Billing toggle */}
          <div className="flex items-center justify-center gap-3 mt-6">
            <span className={`text-sm ${interval === 'monthly' ? 'text-text-primary' : 'text-text-muted'}`}>
              Monthly
            </span>
            <button
              onClick={() => setInterval((i) => i === 'monthly' ? 'annual' : 'monthly')}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                interval === 'annual' ? 'bg-accent-cyan' : 'bg-bg-border'
              }`}
            >
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                interval === 'annual' ? 'translate-x-7' : 'translate-x-1'
              }`} />
            </button>
            <span className={`text-sm ${interval === 'annual' ? 'text-text-primary' : 'text-text-muted'}`}>
              Annual
            </span>
            {interval === 'annual' && (
              <span className="text-xs text-accent-green font-mono bg-accent-green/10 border border-accent-green/20 px-2 py-0.5 rounded-full">
                Salvar 20%
              </span>
            )}
          </div>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <PricingCard
              key={plan.name}
              {...plan}
              interval={interval}
              onSelect={() => { window.location.href = plan.href; }}
            />
          ))}
        </div>

        {/* Feature matrix */}
        <div className="space-y-8">
          <h2 className="font-display text-2xl font-bold text-text-primary text-center">
            Full feature comparison
          </h2>

          {FEATURE_MATRIX.map(({ category, icon: Icon, rows }) => (
            <div key={category} className="glass-card rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 bg-bg-secondary border-b border-bg-border">
                <Icon className="w-4 h-4 text-accent-cyan" />
                <span className="font-display font-bold text-text-primary text-sm">{category}</span>
              </div>

              {/* Header row */}
              <div className="grid grid-cols-4 px-5 py-2 border-b border-bg-border/50 text-xs font-mono text-text-muted">
                <div>Feature</div>
                <div className="text-center">Grátis</div>
                <div className="text-center text-accent-cyan">Pro</div>
                <div className="text-center">Enterprise</div>
              </div>

              {rows.map(({ label, free, pro, ent }) => (
                <div
                  key={label}
                  className="grid grid-cols-4 px-5 py-3 border-b border-bg-border/30 hover:bg-bg-tertiary/30 transition-colors"
                >
                  <div className="text-text-secondary text-sm">{label}</div>
                  <div className="text-center"><Cell value={free} /></div>
                  <div className="text-center"><Cell value={pro}  /></div>
                  <div className="text-center"><Cell value={ent}  /></div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* FAQ / CTA */}
        <div className="text-center space-y-4 py-8">
          <h2 className="font-display text-2xl font-bold text-text-primary">
            Ready to get started?
          </h2>
          <p className="text-text-secondary">
            Join traders using AI-powered market intelligence.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link
              href="/auth/register"
              className="px-8 py-3 bg-accent-cyan text-bg-primary rounded-lg font-display font-bold hover:bg-accent-cyan/90 transition-all shadow-glow-cyan"
            >
              Começar for free
            </Link>
            <Link
              href="/auth/register?plan=PRO"
              className="px-8 py-3 bg-bg-secondary border border-bg-border text-text-secondary rounded-lg font-display font-bold hover:border-accent-cyan hover:text-accent-cyan transition-all"
            >
              Começar Pro trial
            </Link>
          </div>
          <p className="text-text-muted text-sm">No credit card required for free plan.</p>
        </div>
      </div>
    </div>
  );
}
