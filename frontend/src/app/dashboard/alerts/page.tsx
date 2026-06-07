'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Plus, Trash2, ToggleLeft, ToggleRight, CheckCheck } from 'lucide-react';
import { alertApi } from '../../lib/api';
import { useMarketStore } from '../../store/marketStore';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

const CONDITIONS = [
  { value: 'PRICE_ABOVE', label: 'Price rises above' },
  { value: 'PRICE_BELOW', label: 'Price falls below' },
  { value: 'PRICE_CHANGE_PERCENT', label: 'Price change % exceeds' },
  { value: 'VOLUME_SPIKE_PERCENT', label: 'Volume exceeds (USD)' },
  { value: 'WHALE_TRADE_SIZE', label: 'Whale trade size (USD)' },
];

const SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'ADAUSDT','AVAXUSDT','DOTUSDT','MATICUSDT','LINKUSDT',
];

export default function AlertsPage() {
  const { triggeredAlerts, markAlertRead } = useMarketStore();
  const [configs, setConfigs] = useState<any[]>([]);
  const [triggered, setTriggered] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState<'configs' | 'triggered'>('configs');
  const [form, setForm] = useState({
    symbol: 'BTCUSDT',
    condition: 'PRICE_ABOVE',
    threshold: '',
    channels: ['IN_APP'],
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [cfgRes, trgRes] = await Promise.all([
        alertApi.getAll(),
        alertApi.getTriggered(),
      ]);
      setConfigs(cfgRes.data.data || []);
      setTriggered(trgRes.data.data || []);
    } catch { toast.error('Failed to load alerts'); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await alertApi.create({ ...form, threshold: parseFloat(form.threshold) });
      toast.success('Alert created');
      setShowForm(false);
      fetchData();
    } catch { toast.error('Failed to create alert'); }
  };

  const handleDelete = async (id: string) => {
    try {
      await alertApi.delete(id);
      setConfigs((prev) => prev.filter((c) => c.id !== id));
      toast.success('Alert deleted');
    } catch { toast.error('Failed to delete alert'); }
  };

  const handleToggle = async (id: string) => {
    try {
      const res = await alertApi.toggle(id);
      setConfigs((prev) => prev.map((c) => c.id === id ? res.data.data : c));
    } catch { toast.error('Failed to toggle alert'); }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await alertApi.markRead(id);
      markAlertRead(id);
      setTriggered((prev) => prev.map((a) => a.id === id ? { ...a, isRead: true } : a));
    } catch {}
  };

  const allTriggered = [...triggeredAlerts, ...triggered]
    .filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-primary">Alert System</h1>
          <p className="text-text-secondary text-sm mt-1">Configure real-time market notifications</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-accent-cyan text-bg-primary rounded-lg font-display font-bold text-sm hover:bg-accent-cyan/90 transition-all shadow-glow-cyan"
        >
          <Plus className="w-4 h-4" />
          New Alert
        </button>
      </div>

      {/* Create form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="glass-card rounded-xl p-6 border border-accent-cyan/20"
          >
            <h3 className="font-display font-bold text-text-primary mb-4">Create Alert</h3>
            <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-text-muted text-xs mb-1.5 font-mono uppercase">Symbol</label>
                <select
                  value={form.symbol}
                  onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                  className="w-full bg-bg-secondary border border-bg-border rounded-lg px-3 py-2.5 text-text-primary text-sm focus:outline-none focus:border-accent-cyan"
                >
                  {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-text-muted text-xs mb-1.5 font-mono uppercase">Condition</label>
                <select
                  value={form.condition}
                  onChange={(e) => setForm({ ...form, condition: e.target.value })}
                  className="w-full bg-bg-secondary border border-bg-border rounded-lg px-3 py-2.5 text-text-primary text-sm focus:outline-none focus:border-accent-cyan"
                >
                  {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-text-muted text-xs mb-1.5 font-mono uppercase">Threshold</label>
                <input
                  type="number"
                  required
                  value={form.threshold}
                  onChange={(e) => setForm({ ...form, threshold: e.target.value })}
                  placeholder="e.g. 50000"
                  className="w-full bg-bg-secondary border border-bg-border rounded-lg px-3 py-2.5 text-text-primary font-mono text-sm focus:outline-none focus:border-accent-cyan"
                />
              </div>
              <div>
                <label className="block text-text-muted text-xs mb-1.5 font-mono uppercase">Channels</label>
                <div className="flex gap-2">
                  {['IN_APP', 'EMAIL', 'TELEGRAM'].map((ch) => (
                    <label key={ch} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.channels.includes(ch)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...form.channels, ch]
                            : form.channels.filter((c) => c !== ch);
                          setForm({ ...form, channels: next });
                        }}
                        className="accent-accent-cyan"
                      />
                      <span className="text-text-secondary text-xs">{ch.replace('_', ' ')}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="md:col-span-2 flex gap-3">
                <button type="submit" className="px-6 py-2 bg-accent-cyan text-bg-primary rounded-lg font-bold text-sm hover:bg-accent-cyan/90">
                  Create
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="px-6 py-2 bg-bg-secondary border border-bg-border text-text-secondary rounded-lg text-sm hover:border-text-secondary">
                  Cancel
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabs */}
      <div className="flex gap-1 bg-bg-secondary border border-bg-border rounded-lg p-1 w-fit">
        {[
          { key: 'configs', label: `Configured (${configs.length})` },
          { key: 'triggered', label: `History (${allTriggered.length})` },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key as any)}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-all ${
              tab === key ? 'bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Alert configs list */}
      {tab === 'configs' && (
        <div className="space-y-3">
          {configs.length === 0 && (
            <div className="glass-card rounded-xl p-12 text-center text-text-muted">
              <Bell className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p>No alerts configured yet</p>
            </div>
          )}
          {configs.map((cfg) => (
            <motion.div
              key={cfg.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className={`glass-card rounded-xl p-4 flex items-center justify-between gap-4 ${
                cfg.isActive ? 'border-bg-border' : 'opacity-60'
              }`}
            >
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.isActive ? 'bg-accent-green animate-pulse' : 'bg-text-muted'}`} />
                <div className="min-w-0">
                  <div className="font-mono text-text-primary text-sm font-semibold">
                    {cfg.symbol}
                  </div>
                  <div className="text-text-secondary text-xs mt-0.5">
                    {CONDITIONS.find((c) => c.value === cfg.condition)?.label}{' '}
                    <span className="text-accent-cyan font-mono font-bold">
                      {cfg.threshold.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex gap-1 mt-1">
                    {cfg.channels.map((ch: string) => (
                      <span key={ch} className="text-xs font-mono text-text-muted bg-bg-secondary border border-bg-border px-1.5 py-0.5 rounded">
                        {ch}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleToggle(cfg.id)} className="text-text-muted hover:text-accent-cyan">
                  {cfg.isActive ? <ToggleRight className="w-5 h-5 text-accent-cyan" /> : <ToggleLeft className="w-5 h-5" />}
                </button>
                <button onClick={() => handleDelete(cfg.id)} className="text-text-muted hover:text-accent-red">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Triggered alerts */}
      {tab === 'triggered' && (
        <div className="space-y-2">
          {allTriggered.length === 0 && (
            <div className="glass-card rounded-xl p-12 text-center text-text-muted">
              <CheckCheck className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p>No triggered alerts yet</p>
            </div>
          )}
          {allTriggered.map((alert) => (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={`glass-card rounded-xl p-4 flex items-start justify-between gap-4 cursor-pointer ${
                !alert.isRead ? 'border-accent-yellow/20 bg-accent-yellow/5' : 'opacity-70'
              }`}
              onClick={() => !alert.isRead && handleMarkRead(alert.id)}
            >
              <div className="flex items-start gap-3">
                {!alert.isRead && <div className="w-2 h-2 rounded-full bg-accent-yellow mt-1.5 flex-shrink-0 animate-pulse" />}
                <div>
                  <p className="text-text-primary text-sm">{alert.message}</p>
                  <p className="text-text-muted text-xs font-mono mt-1">
                    {alert.createdAt ? formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true }) : 'just now'}
                  </p>
                </div>
              </div>
              {!alert.isRead && (
                <span className="text-xs text-accent-yellow border border-accent-yellow/30 bg-accent-yellow/10 px-2 py-0.5 rounded font-mono flex-shrink-0">
                  NEW
                </span>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
