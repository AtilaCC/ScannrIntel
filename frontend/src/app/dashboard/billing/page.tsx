'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CreditCard, Zap, Shield, BarChart2, Bell, Brain,
  CheckCircle, XCircle, RefreshCw, ExternalLink, AlertTriangle,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { toast } from 'sonner';

// ── Types ────────────────────────────────────────────────────

interface SubscriptionData {
  plan:              string;
  status:            string;
  billingInterval:   string;
  currentPeriodEnd:  string;
  cancelAtPeriodEnd: boolean;
  planDetails: {
    displayName: string;
    description: string;
    badge:       string;
    pricing:     { monthlyUsd: number; annualUsd: number; annualSavingsPercent: number };
    features:    Record<string, any>;
  };
  invoices: Invoice[];
}

interface UsageSummary {
  aiInsights: { today: number; limit: number; period: number };
  alerts:     { current: number; limit: number };
  watchlist:  { current: number; limit: number };
  apiCalls:   { period: number; rpmLimit: number };
}

interface Invoice {
  id:         string;
  amountUsd:  number;
  status:     string;
  invoiceUrl: string | null;
  pdfUrl:     string | null;
  periodStart:string;
  periodEnd:  string;
  paidAt:     string | null;
  createdAt:  string;
}

// ── Helpers ───────────────────────────────────────────────────

function UsageBar({ label, current, limit, icon: Icon }: {
  label: string; current: number; limit: number; icon: any;
}) {
  const isUnlimited = limit === -1;
  const pct         = isUnlimited ? 0 : Math.min(100, (current / limit) * 100);
  const isWarning   = pct >= 80;
  const isCritical  = pct >= 95;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 text-text-secondary">
          <Icon className="w-3.5 h-3.5" />
          {label}
        </div>
        <span className="font-mono text-xs text-text-muted">
          {isUnlimited ? `${current} / ∞` : `${current} / ${limit}`}
        </span>
      </div>
      <div className="h-2 bg-bg-border rounded-full overflow-hidden">
        {!isUnlimited && (
          <motion.div
            className={`h-full rounded-full ${
              isCritical ? 'bg-red-500' : isWarning ? 'bg-yellow-500' : 'bg-accent-cyan'
            }`}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        )}
        {isUnlimited && (
          <div className="h-full rounded-full bg-accent-green/40 w-full" />
        )}
      </div>
    </div>
  );
}

function FeatureRow({ label, value }: { label: string; value: any }) {
  const isBoolean = typeof value === 'boolean';
  const isMinus   = value === -1;

  return (
    <div className="flex items-center justify-between py-2 border-b border-bg-border/50">
      <span className="text-text-secondary text-sm">{label}</span>
      <span className="text-sm font-mono">
        {isBoolean ? (
          value
            ? <CheckCircle className="w-4 h-4 text-accent-green" />
            : <XCircle    className="w-4 h-4 text-text-muted" />
        ) : isMinus ? (
          <span className="text-accent-green font-bold">Unlimited</span>
        ) : (
          <span className="text-text-primary font-bold">{value}</span>
        )}
      </span>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────

export default function BillingPage() {
  const { user }    = useAuthStore();
  const [sub,       setSub]      = useState<SubscriptionData | null>(null);
  const [usage,     setUsage]    = useState<UsageSummary | null>(null);
  const [invoices,  setInvoices] = useState<Invoice[]>([]);
  const [loading,   setLoading]  = useState(true);
  const [canceling, setCanceling]= useState(false);
  const [interval,  setInterval] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY');

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [subRes, usageRes, invRes] = await Promise.all([
        api.get('/subscriptions/me'),
        api.get('/subscriptions/me/usage'),
        api.get('/subscriptions/me/invoices'),
      ]);
      setSub(subRes.data.data);
      setUsage(usageRes.data.data);
      setInvoices(invRes.data.data || []);
    } catch { toast.error('Failed to load billing info'); }
    finally   { setLoading(false); }
  };

  const handleUpgrade = async (plan: 'PRO' | 'ENTERPRISE') => {
    try {
      const res = await api.post('/subscriptions/checkout', { plan, interval });
      const { checkoutUrl, mock } = res.data.data;
      if (mock) {
        toast.info('Stripe not configured — simulating upgrade');
        await fetchAll();
      } else {
        window.location.href = checkoutUrl;
      }
    } catch { toast.error('Failed to start checkout'); }
  };

  const handleCancel = async () => {
    if (!confirm('Cancel your subscription? You keep access until the end of the billing period.')) return;
    setCanceling(true);
    try {
      await api.post('/subscriptions/cancel');
      toast.success('Subscription will cancel at period end');
      await fetchAll();
    } catch { toast.error('Failed to cancel'); }
    finally { setCanceling(false); }
  };

  const handleReactivate = async () => {
    try {
      await api.post('/subscriptions/reactivate');
      toast.success('Subscription reactivated');
      await fetchAll();
    } catch { toast.error('Failed to reactivate'); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-text-muted">
        <RefreshCw className="w-6 h-6 animate-spin mr-3" />
        Loading billing info...
      </div>
    );
  }

  const plan       = sub?.plan ?? 'FREE';
  const isPro      = plan === 'PRO';
  const isEnt      = plan === 'ENTERPRISE';
  const isPaid     = isPro || isEnt;
  const isCanceled = sub?.cancelAtPeriodEnd;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-text-primary">Billing & Plan</h1>
        <p className="text-text-secondary text-sm mt-1">
          Manage your subscription and monitor usage
        </p>
      </div>

      {/* Cancellation warning */}
      {isCanceled && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30"
        >
          <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-yellow-300 font-medium text-sm">Subscription scheduled for cancellation</p>
            <p className="text-yellow-400/70 text-xs mt-0.5">
              Your {plan} plan remains active until{' '}
              {sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : '—'}.
            </p>
            <button
              onClick={handleReactivate}
              className="mt-2 text-xs text-yellow-300 underline hover:no-underline"
            >
              Reactivate subscription
            </button>
          </div>
        </motion.div>
      )}

      {/* Current plan card */}
      <div className="glass-card rounded-xl p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="text-3xl">{sub?.planDetails?.badge ?? '🆓'}</div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-xl font-bold text-text-primary">
                  {sub?.planDetails?.displayName ?? 'Free'} Plan
                </h2>
                <span className={`text-xs font-mono px-2 py-0.5 rounded border ${
                  sub?.status === 'ACTIVE'   ? 'bg-green-500/10 border-green-500/30 text-green-400' :
                  sub?.status === 'PAST_DUE' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                  'bg-text-muted/10 border-text-muted/30 text-text-muted'
                }`}>
                  {sub?.status ?? 'ACTIVE'}
                </span>
              </div>
              <p className="text-text-secondary text-sm mt-0.5">
                {sub?.planDetails?.description}
              </p>
              {isPaid && (
                <p className="text-text-muted text-xs mt-1 font-mono">
                  Renews {new Date(sub!.currentPeriodEnd).toLocaleDateString()} ·{' '}
                  {sub!.billingInterval === 'ANNUAL' ? 'Annual' : 'Monthly'} billing
                </p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {isPaid && !isCanceled && (
              <button
                onClick={handleCancel}
                disabled={canceling}
                className="px-4 py-2 text-sm text-text-muted border border-bg-border rounded-lg hover:border-red-500/50 hover:text-red-400 transition-all disabled:opacity-50"
              >
                {canceling ? 'Canceling...' : 'Cancel plan'}
              </button>
            )}
            {!isEnt && (
              <button
                onClick={() => handleUpgrade(isPro ? 'ENTERPRISE' : 'PRO')}
                className="px-4 py-2 text-sm bg-accent-cyan text-bg-primary rounded-lg font-display font-bold hover:bg-accent-cyan/90 transition-all shadow-glow-cyan"
              >
                {isPro ? 'Upgrade to Enterprise' : 'Upgrade to Pro'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Usage meters */}
        {usage && (
          <div className="glass-card rounded-xl p-5 space-y-5">
            <h3 className="font-display font-bold text-text-primary text-sm flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-accent-cyan" />
              Current Usage
            </h3>
            <UsageBar label="AI Insights (today)"  current={usage.aiInsights.today}  limit={usage.aiInsights.limit}   icon={Brain}   />
            <UsageBar label="Active Alerts"         current={usage.alerts.current}     limit={usage.alerts.limit}       icon={Bell}    />
            <UsageBar label="Watchlist Symbols"     current={usage.watchlist.current}  limit={usage.watchlist.limit}    icon={BarChart2} />
            {isPaid && (
              <UsageBar label="API Calls (period)"  current={usage.apiCalls.period}    limit={-1}                       icon={Zap}     />
            )}
          </div>
        )}

        {/* Plan features */}
        {sub?.planDetails?.features && (
          <div className="glass-card rounded-xl p-5 space-y-1">
            <h3 className="font-display font-bold text-text-primary text-sm flex items-center gap-2 mb-4">
              <Shield className="w-4 h-4 text-accent-purple" />
              Plan Features
            </h3>
            <FeatureRow label="Watchlist symbols" value={sub.planDetails.features.maxWatchlistSymbols} />
            <FeatureRow label="Active alerts"     value={sub.planDetails.features.maxAlerts} />
            <FeatureRow label="AI insights/day"   value={sub.planDetails.features.aiInsightsPerDay} />
            <FeatureRow label="Signal history"    value={`${sub.planDetails.features.signalHistory}d`} />
            <FeatureRow label="Token scores"      value={sub.planDetails.features.tokenScores} />
            <FeatureRow label="Score leaderboard" value={sub.planDetails.features.scoreLeaderboard} />
            <FeatureRow label="API access"        value={sub.planDetails.features.apiAccess} />
            <FeatureRow label="Data export"       value={sub.planDetails.features.dataExport} />
            <FeatureRow label="Support"           value={sub.planDetails.features.supportLevel} />
          </div>
        )}
      </div>

      {/* Plan comparison */}
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-bg-border flex items-center justify-between">
          <h3 className="font-display font-bold text-text-primary text-sm">Compare Plans</h3>
          <div className="flex gap-1 bg-bg-secondary border border-bg-border rounded-lg p-1">
            {(['MONTHLY', 'ANNUAL'] as const).map((iv) => (
              <button
                key={iv}
                onClick={() => setInterval(iv)}
                className={`px-3 py-1 rounded text-xs font-mono transition-all ${
                  interval === iv
                    ? 'bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {iv === 'ANNUAL' ? 'Annual (save 20%)' : 'Monthly'}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-bg-border">
          {[
            { tier: 'FREE',       price: 0,   annual: 0,   badge: '🆓', name: 'Free'       },
            { tier: 'PRO',        price: 49,  annual: 470, badge: '⚡', name: 'Pro'        },
            { tier: 'ENTERPRISE', price: 299, annual: 2870,badge: '🏢', name: 'Enterprise' },
          ].map(({ tier, price, annual, badge, name }) => (
            <div
              key={tier}
              className={`p-5 ${tier === plan ? 'bg-accent-cyan/5' : ''}`}
            >
              <div className="text-2xl mb-1">{badge}</div>
              <div className="font-display font-bold text-text-primary">{name}</div>
              <div className="mt-2 mb-4">
                <span className="font-display text-2xl font-bold text-text-primary">
                  ${interval === 'ANNUAL' ? Math.round(annual / 12) : price}
                </span>
                <span className="text-text-muted text-xs">/mo</span>
                {interval === 'ANNUAL' && price > 0 && (
                  <div className="text-xs text-accent-green mt-0.5">
                    ${annual}/year
                  </div>
                )}
              </div>
              {tier === plan ? (
                <div className="text-xs text-accent-cyan font-mono border border-accent-cyan/30 bg-accent-cyan/10 rounded px-2 py-1 text-center">
                  Current Plan
                </div>
              ) : (
                <button
                  onClick={() => tier !== 'FREE' && handleUpgrade(tier as 'PRO' | 'ENTERPRISE')}
                  disabled={tier === 'FREE'}
                  className={`w-full text-xs py-1.5 rounded font-bold transition-all ${
                    tier === 'FREE'
                      ? 'text-text-muted cursor-not-allowed'
                      : 'bg-accent-cyan text-bg-primary hover:bg-accent-cyan/90'
                  }`}
                >
                  {tier === 'FREE' ? 'Downgrade' : `Upgrade to ${name}`}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Invoice history */}
      {invoices.length > 0 && (
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-bg-border flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-text-muted" />
            <h3 className="font-display font-bold text-text-primary text-sm">Invoice History</h3>
          </div>
          <div className="divide-y divide-bg-border/50">
            {invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <div className="text-text-primary text-sm font-mono">
                    ${inv.amountUsd.toFixed(2)}
                  </div>
                  <div className="text-text-muted text-xs">
                    {new Date(inv.periodStart).toLocaleDateString()} – {new Date(inv.periodEnd).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-mono px-2 py-0.5 rounded ${
                    inv.status === 'paid' ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'
                  }`}>
                    {inv.status.toUpperCase()}
                  </span>
                  {inv.invoiceUrl && (
                    <a
                      href={inv.invoiceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-text-muted hover:text-accent-cyan"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
