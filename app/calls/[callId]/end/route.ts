import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      callId: string;
    }>;
  },
) {
  try {
    const { callId } = await context.params;

    if (!callId) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Missing call ID.',
        },
        {
          status: 400,
        },
      );
    }

    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Not signed in.',
        },
        {
          status: 401,
        },
      );
    }

    const { data: call, error: callError } =
      await supabase
        .from('calls')
        .select(
          'id, caller_id, callee_id, status',
        )
        .eq('id', callId)
        .maybeSingle();

    if (callError) {
      return NextResponse.json(
        {
          ok: false,
          error: callError.message,
        },
        {
          status: 500,
        },
      );
    }

    if (!call) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Call not found.',
        },
        {
          status: 404,
        },
      );
    }

    const participant =
      call.caller_id === user.id ||
      call.callee_id === user.id;

    if (!participant) {
      return NextResponse.json(
        {
          ok: false,
          error: 'You are not a participant in this call.',
        },
        {
          status: 403,
        },
      );
    }

    const now = new Date().toISOString();

    const { error: updateError } =
      await supabase
        .from('calls')
        .update({
          status: 'ended',
          ended_at: now,
        })
        .eq('id', callId)
        .in('status', [
          'ringing',
          'connecting',
          'connected',
          'reconnecting',
        ]);

    if (updateError) {
      return NextResponse.json(
        {
          ok: false,
          error: updateError.message,
        },
        {
          status: 500,
        },
      );
    }

    return NextResponse.json({
      ok: true,
    });
  } catch (error) {
    console.error(
      '[POST /calls/[callId]/end]',
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unexpected error.',
      },
      {
        status: 500,
      },
    );
  }
}
