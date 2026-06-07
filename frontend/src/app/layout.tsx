import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'CryptoIntel — AI-Powered Market Intelligence',
  description: 'Real-time crypto scanning with Claude AI analysis. Detect whale movements, volume spikes, and market anomalies.',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="scanlines bg-bg-primary min-h-screen">
        {children}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#0F1629',
              border: '1px solid #1E2D4A',
              color: '#E8F0FF',
            },
          }}
        />
      </body>
    </html>
  );
}
