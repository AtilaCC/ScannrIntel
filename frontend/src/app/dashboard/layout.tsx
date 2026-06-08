'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap, LayoutDashboard, TrendingUp, Brain, Bell,
  Settings, LogOut, Wifi, WifiOff, Menu, X, ChevronRight, BarChart2, CreditCard, Crosshair,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { PlanBadge } from '@/components/billing/PlanBadge';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useMarketStore } from '@/store/marketStore';
import { toast } from 'sonner';

const NAV_ITEMS = [
  { href: '/dashboard',                icon: LayoutDashboard, label: 'Dashboard'       },
  { href: '/dashboard/scanner',        icon: TrendingUp,      label: 'Scanner'         },
  { href: '/dashboard/scores',         icon: BarChart2,       label: 'Scores'          },
  { href: '/dashboard/insights',       icon: Brain,           label: 'AI Insights'     },
  { href: '/dashboard/trading-engine', icon: Crosshair,       label: 'Decision Engine' },
  { href: '/dashboard/alerts',         icon: Bell,            label: 'Alerts'          },
  { href: '/dashboard/billing',        icon: CreditCard,      label: 'Billing'         },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAuthenticated, logout } = useAuthStore();
  const { updateMarketData, addSignal, addInsight, addTriggeredAlert } = useMarketStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadAlerts, setUnreadAlerts] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) router.push('/auth/login');
  }, [isAuthenticated, router]);

  const { isConnected } = useWebSocket((type, payload) => {
    switch (type) {
      case 'market_data':
        if (payload?.symbol) updateMarketData(payload);
        break;
      case 'signals':
        if (payload) { addSignal(payload); toast.info(`📡 ${payload.type} on ${payload.symbol}`, { duration: 4000 }); }
        break;
      case 'ai_insights':
        if (payload) { addInsight(payload); toast.success(`🤖 AI insight: ${payload.symbol}`, { duration: 5000 }); }
        break;
      case 'alerts':
        if (payload) {
          addTriggeredAlert(payload);
          setUnreadAlerts((n) => n + 1);
          toast.warning(`🔔 ${payload.message}`, { duration: 6000 });
        }
        break;
    }
  });

  const handleLogout = async () => {
    await logout();
    router.push('/auth/login');
  };

  if (!isAuthenticated) return null;

  return (
    <div className="flex h-screen bg-bg-primary overflow-hidden">
      {/* Mobile overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 z-20 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ x: sidebarOpen ? 0 : -300 }}
        className="fixed lg:relative lg:translate-x-0 z-30 w-64 h-full bg-bg-secondary border-r border-bg-border flex flex-col"
        style={{ transform: undefined }}
      >
        <div className={`h-full flex flex-col ${sidebarOpen ? '' : 'lg:flex hidden'}`} />

        <div className="h-full flex flex-col">
          {/* Logo */}
          <div className="p-6 border-b border-bg-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-accent-cyan/20 border border-accent-cyan/40 flex items-center justify-center">
                  <Zap className="w-4 h-4 text-accent-cyan" />
                </div>
                <div>
                  <div className="font-display font-bold text-text-primary text-sm">CryptoIntel</div>
                  <div className="text-text-muted text-xs font-mono">v1.0.0</div>
                </div>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-text-muted hover:text-text-primary">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Connection status */}
          <div className="px-4 py-3 border-b border-bg-border">
            <div className={`flex items-center gap-2 text-xs font-mono px-3 py-2 rounded-md ${
              isConnected ? 'bg-accent-green/10 text-accent-green' : 'bg-accent-red/10 text-accent-red'
            }`}>
              {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {isConnected ? 'LIVE' : 'DISCONNECTED'}
              {isConnected && (
                <span className="ml-auto w-2 h-2 rounded-full bg-accent-green animate-pulse" />
              )}
            </div>
          </div>

          {/* Nav */}
          <nav className="flex-1 p-4 space-y-1">
            {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all group ${
                    active
                      ? 'bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                  }`}
                >
                  <Icon className={`w-4 h-4 flex-shrink-0 ${active ? 'text-accent-cyan' : 'group-hover:text-text-primary'}`} />
                  <span className="font-medium">{label}</span>
                  {label === 'Alerts' && unreadAlerts > 0 && (
                    <span className="ml-auto bg-accent-red text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                      {unreadAlerts > 9 ? '9+' : unreadAlerts}
                    </span>
                  )}
                  {active && <ChevronRight className="ml-auto w-3 h-3 text-accent-cyan" />}
                </Link>
              );
            })}
          </nav>

          {/* User section */}
          <div className="p-4 border-t border-bg-border space-y-2">
            <div className="flex items-center gap-3 px-3 py-2">
              <div className="w-8 h-8 rounded-full bg-accent-cyan/20 border border-accent-cyan/30 flex items-center justify-center text-accent-cyan text-xs font-bold font-mono">
                {user?.email?.[0]?.toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-text-primary text-xs font-medium truncate">{user?.email}</div>
                <PlanBadge plan={(user as any)?.plan ?? 'FREE'} showUpgrade={true} />
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-text-secondary hover:text-accent-red hover:bg-accent-red/10 text-sm transition-all"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      </motion.aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar (mobile) */}
        <div className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-bg-border bg-bg-secondary">
          <button onClick={() => setSidebarOpen(true)} className="text-text-secondary hover:text-text-primary">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-accent-cyan" />
            <span className="font-display font-bold text-text-primary text-sm">CryptoIntel</span>
          </div>
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-accent-green animate-pulse' : 'bg-accent-red'}`} />
        </div>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="h-full"
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
