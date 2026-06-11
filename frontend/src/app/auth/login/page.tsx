'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Zap, TrendingUp, Shield } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { toast } from 'sonner';

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated, isLoading } = useAuthStore();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error,    setError]    = useState('');

  useEffect(() => {
    if (isAuthenticated) router.push('/dashboard');
  }, [isAuthenticated, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      toast.success('Bem-vindo de volta!');
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-bg-primary flex">
      {/* Painel esquerdo — branding */}
      <motion.div
        initial={{ opacity: 0, x: -50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8 }}
        className="hidden lg:flex flex-col justify-between w-1/2 p-16 relative overflow-hidden"
      >
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: `linear-gradient(rgba(0,212,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,0.1) 1px, transparent 1px)`, backgroundSize: '60px 60px' }} />
        <div className="absolute top-1/3 left-1/4 w-96 h-96 rounded-full bg-accent-cyan opacity-5 blur-[120px]" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-accent-cyan/20 border border-accent-cyan/40 flex items-center justify-center">
              <Zap className="w-5 h-5 text-accent-cyan" />
            </div>
            <span className="font-display text-xl font-bold text-text-primary tracking-tight">CryptoIntel</span>
          </div>
        </div>
        <div className="relative z-10 space-y-8">
          <h1 className="font-display text-5xl font-bold text-text-primary leading-tight">
            Inteligência de mercado<br />
            <span className="text-accent-cyan neon-cyan">em tempo real</span><br />
            com IA
          </h1>
          <p className="text-text-secondary text-lg leading-relaxed">
            Detecte movimentos de baleias, picos de volume e anomalias de mercado antes de todo mundo.
          </p>
          <div className="space-y-4">
            {[
              { icon: TrendingUp, label: 'Scanner ao Vivo da Binance', desc: '20+ pares monitorados' },
              { icon: Zap,        label: 'Análise por IA',             desc: 'Insights instantâneos de mercado' },
              { icon: Shield,     label: 'Alertas em Tempo Real',      desc: 'Notificações personalizadas' },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-center gap-4">
                <div className="w-8 h-8 rounded border border-accent-cyan/30 bg-accent-cyan/10 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-accent-cyan" />
                </div>
                <div>
                  <div className="text-text-primary text-sm font-medium">{label}</div>
                  <div className="text-text-muted text-xs">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative z-10 text-text-muted text-xs">
          © 2024 CryptoIntel. Não é conselho financeiro.
        </div>
      </motion.div>

      {/* Painel direito — formulário */}
      <motion.div
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8, delay: 0.1 }}
        className="flex-1 flex items-center justify-center p-8"
      >
        <div className="w-full max-w-md space-y-8">
          <div className="flex lg:hidden items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-lg bg-accent-cyan/20 border border-accent-cyan/40 flex items-center justify-center">
              <Zap className="w-5 h-5 text-accent-cyan" />
            </div>
            <span className="font-display text-xl font-bold text-text-primary">CryptoIntel</span>
          </div>

          <div>
            <h2 className="font-display text-3xl font-bold text-text-primary">Entrar</h2>
            <p className="text-text-secondary mt-2">Acesse seu painel de inteligência</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-text-secondary text-sm mb-2">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="voce@exemplo.com"
                className="w-full bg-bg-secondary border border-bg-border rounded-lg px-4 py-3 text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-cyan transition-colors font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-text-secondary text-sm mb-2">Senha</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full bg-bg-secondary border border-bg-border rounded-lg px-4 py-3 pr-12 text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-cyan transition-colors font-mono text-sm"
                />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-accent-red/10 border border-accent-red/30 rounded-lg px-4 py-3 text-accent-red text-sm">
                {error}
              </motion.div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 rounded-lg bg-accent-cyan text-bg-primary font-display font-bold tracking-wide hover:bg-accent-cyan/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-glow-cyan"
            >
              {isLoading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <p className="text-center text-text-secondary text-sm">
            Não tem uma conta?{' '}
            <Link href="/auth/register" className="text-accent-cyan hover:underline">Criar uma</Link>
          </p>

          <div className="border border-bg-border rounded-lg p-4 bg-bg-secondary/50">
            <p className="text-text-muted text-xs mb-2 font-mono">CREDENCIAIS DEMO</p>
            <p className="text-text-secondary text-xs font-mono">demo@cryptointel.io / Demo1234!</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
