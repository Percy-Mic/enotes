import type { Metadata } from 'next';

const SITE_URL = 'https://enotes-amber.vercel.app';

export const metadata: Metadata = {
  title: 'Feed | enotes',
  description: 'Explore public posts and shared moments from the enotes community.',
  alternates: {
    canonical: `${SITE_URL}/feed`,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function FeedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
