import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /calls/[callId]/end — beacon target so an unexpectedly closed tab
 * still terminates the call server-side (RLS: only participants may update).
 */
export async function POST(request: Request, { params }: { params: { callId: string } }) {
  const { callId } = params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not signed in' }, { status: 401 });

  const { error } = await supabase
    .from('calls')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', callId);

  return NextResponse.json({ ok: !error });
}
