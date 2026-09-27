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
 * Browser/client Supabase configuration.
 *
 * Prefer the current publishable key. The legacy anon key remains a
 * compatibility fallback so existing local/deployment environments do not
 * break during the migration.
 *
 * This same key selection must also be used by middleware so the browser
 * client and SSR client always identify the same Supabase project.
 */
export const supabase = createBrowserClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
