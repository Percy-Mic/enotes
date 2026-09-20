import { permanentRedirect } from 'next/navigation';

/**
 * /dashboard is retired — /journals is the one journals home (identical
 * purpose, richer page). Every entry point (sign-in redirect, sign-up,
 * bookmarks) lands on /journals.
 */
export default function DashboardRedirect() {
  permanentRedirect('/journals');
}
