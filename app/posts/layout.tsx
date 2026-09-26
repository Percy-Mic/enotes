import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Post | enotes',
  description: 'A public post shared on enotes.',
  robots: {
    index: true,
    follow: true,
  },
};

export default function PostsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
