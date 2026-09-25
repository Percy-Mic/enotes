import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL. Configure it in the environment used to build enotes.',
  );
}

if (!supabaseKey) {
  throw new Error(
    'Missing Supabase browser key. Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY in the environment used to build enotes.',
  );
}

/*
 * Keep both Supabase key naming conventions supported.
 *
 * - New Supabase projects use NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
 * - Existing enotes deployments may still use NEXT_PUBLIC_SUPABASE_ANON_KEY.
 *
 * This lets the repository migrate without forcing a local .env.local rename.
 */
export const supabase = createBrowserClient(supabaseUrl, supabaseKey);
