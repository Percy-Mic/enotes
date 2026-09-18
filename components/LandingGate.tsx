'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';

/**
 * Landing gate — a signed-in visitor on `/` should never see the marketing
 * page (its "Sign in" header is meaningless and it stacks under the app
 * nav). The moment the session is known we replace the route with /feed,
 * so the app header is the first chrome the user gets — no manual refresh.
 * Renders nothing; signed-out visitors just keep the normal landing page.
 */
export default function LandingGate() {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (active && user) router.replace('/feed');
    });
    return () => {
      active = false;
    };
  }, [router]);

  return null;
}
