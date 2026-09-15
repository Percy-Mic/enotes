import type { Metadata, Viewport } from 'next';
import { Poppins } from 'next/font/google';
import AppShell from '@/components/AppShell';
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={poppins.variable}>
      <body className="font-sans antialiased bg-[#FFF7F8] text-[#111111]">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}