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
  manifest: '/manifest.webmanifest',
  applicationName: 'enotes',
  appleWebApp: {
    capable: true,
    title: 'enotes',
    statusBarStyle: 'default',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#FFF7F8',
};

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
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function () {
                  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {});
                });
              }
            `,
          }}
        />
      </head>
      <body className="font-sans antialiased bg-[#FFF7F8] text-[#111111]">
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
