import type { Metadata, Viewport } from 'next';
import './globals.css';
import { DataProvider } from '@/components/client/DataProvider';

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const metadata: Metadata = {
  title: 'Fitness',
  description: 'Personal body recomposition dashboard — local and private.',
  appleWebApp: { capable: true, title: 'Fitness', statusBarStyle: 'black-translucent' },
  robots: { index: false, follow: false },
  manifest: `${base}/manifest.webmanifest`,
  icons: { icon: `${base}/icons/icon-192.png`, apple: `${base}/icons/apple-touch-icon.png` },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f4f2' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0b' },
  ],
};

// Applies the saved theme before first paint (no flash). 'system' follows the OS live.
const themeScript = `(function(){try{var p=localStorage.getItem('fd-theme')||'system';var m=window.matchMedia('(prefers-color-scheme: dark)');function a(){var d=p==='dark'||(p==='system'&&m.matches);document.documentElement.classList.toggle('dark',d);}a();m.addEventListener('change',function(){p=localStorage.getItem('fd-theme')||'system';a();});}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <DataProvider>{children}</DataProvider>
      </body>
    </html>
  );
}
