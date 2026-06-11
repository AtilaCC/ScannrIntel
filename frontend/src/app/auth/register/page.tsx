'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Zap, Check, X } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { toast } from 'sonner';

const passwordRules = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One number', test: (p: string) => /[0-9]/.test(p) },
];

export default function RegistrarPage() {
  const router = useRouter();
  const { register, isAuthenticated, isLoading } = useAuthStore();
  const [email, setE-mail] = useState('');
  const [password, setSenha] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isAuthenticated) router.push('/dashboard');
  }, [isAuthenticated, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('Senhas do not match'); return; }
    if (!passwordRules.every((r) => r.test(password))) {
      setError('Senha does not meet requirements');
      return;
    }
    try {
      await register(email, password);
      toast.success('Account created! Welcome to CryptoIntel.');
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-md space-y-8"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent-cyan/20 border border-accent-cyan/40 flex items-center justify-center">
            <Zap className="w-5 h-5 text-accent-cyan" />
          </div>
          <span className="font-display text-xl font-bold text-text-primary">CryptoIntel</span>
        </div>

        <div>
          <h2 className="font-display text-3xl font-bold text-text-primary">Criar conta</h2>
          <p className="text-text-secondary mt-2">Start monitoring markets with AI</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-text-secondary text-sm mb-2">E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setE-mail(e.target.value)}
              required
              placeholder="you@example.com"
              className="w-full bg-bg-secondary border border-bg-border rounded-lg px-4 py-3 text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-cyan transition-colors font-mono text-sm"
            />
          </div>

          <div>
            <label className="block text-text-secondary text-sm mb-2">Senha</label>
            <div className="relative">
              <input
                type={showSenha ? 'text' : 'password'}
                value={password}
                onChange={(e) => setSenha(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full bg-bg-secondary border border-bg-border rounded-lg px-4 py-3 pr-12 text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-cyan transition-colors font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShowSenha(!showSenha)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
              >
                {showSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {/* Senha rules */}
            {password && (
              <div className="mt-2 space-y-1">
                {passwordRules.map((rule) => {
                  const ok = rule.test(password);
                  return (
                    <div key={rule.label} className={`flex items-center gap-2 text-xs ${ok ? 'text-accent-green' : 'text-text-muted'}`}>
                      {ok ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                      {rule.label}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className="block text-text-secondary text-sm mb-2">Confirm Senha</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              placeholder="••••••••"
              className={`w-full bg-bg-secondary border rounded-lg px-4 py-3 text-text-primary placeholder-text-muted focus:outline-none transition-colors font-mono text-sm ${
                confirm && confirm !== password ? 'border-accent-red' : 'border-bg-border focus:border-accent-cyan'
              }`}
            />
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-accent-red/10 border border-accent-red/30 rounded-lg px-4 py-3 text-accent-red text-sm"
            >
              {error}
            </motion.div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-lg bg-accent-cyan text-bg-primary font-display font-bold tracking-wide hover:bg-accent-cyan/90 disabled:opacity-50 transition-all shadow-glow-cyan"
          >
            {isLoading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-text-secondary text-sm">
          Já tem uma conta?{' '}
          <Link href="/auth/login" className="text-accent-cyan hover:underline">Sign in</Link>
        </p>
      </motion.div>
    </div>
  );
}
