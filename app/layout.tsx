import type { Metadata, Viewport } from 'next';
import { Poppins } from 'next/font/google';
import AppShell from '@/components/AppShell';
import { ThemeProvider } from '@/lib/theme';
import './globals.css';

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
});

export const metadata: Metadata = {
  title: 'enotes — Your thoughts deserve a place that feels like you',
  description: 'An artistic, interactive, highly customizable online journal.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#FFF7F8',
};

/**
 * Runs BEFORE first paint: applies the saved theme from localStorage so a
 * dark-mode user never sees a white flash on reload. Kept tiny and
 * dependency-free; lib/theme.tsx takes over after hydration.
 */
const themeBootScript = `
(function(){try{
  var t=localStorage.getItem('enotes:theme');
  if(t==='ocean'||t==='forest'){document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t==='ocean'?'dark':'light';return;}
  if(t==='retro'){document.documentElement.dataset.theme='retro';document.documentElement.style.colorScheme='light';return;}
  var dark=t==='dark'||(t!=='light'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);
  if(dark){document.documentElement.dataset.theme='dark';document.documentElement.style.colorScheme='dark';}
}catch(e){}})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={poppins.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="font-sans antialiased bg-[#FFF7F8] text-[#111111]">
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}