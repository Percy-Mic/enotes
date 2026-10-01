import { NextResponse } from 'next/server';
import { createAIJob, finishAIJob, runVideoAI, type AIJobInput } from '@/lib/video/ai';
import { runExternalVideoAI } from '@/lib/video/ai-providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let jobId: string | null = null;
  try {
    const body = (await request.json()) as AIJobInput;
    if (!body?.operation) return NextResponse.json({ error: 'operation is required' }, { status: 400 });

    const job = await createAIJob(body);
    jobId = job.id;

    const selectedProvider = String(process.env.AI_DEFAULT_PROVIDER || 'auto').trim().toLowerCase();

    /*
     * Free mode is intentionally first-party: use ENOTES' existing Gemini,
     * speech, caption, planning, renderer/action and other non-fal paths.
     * It must never silently fall back to a paid media provider.
     */
    const result =
      selectedProvider === 'free'
        ? await runVideoAI(body)
        : (await runExternalVideoAI(body)) || await runVideoAI(body);

    /* Persist the conversation so reopening the AI panel restores chat
       history (video_ai_conversations / video_ai_messages). Best-effort:
       a history failure must never block the edit itself. */
    let conversationId: string | null =
      typeof (body as { conversationId?: unknown }).conversationId === 'string'
        ? (body as { conversationId: string }).conversationId
        : null;
    let historyError: string | null = null;
    if (body.operation === 'assistant' && body.projectId) {
      try {
        const { createClient } = await import('@/lib/supabase/server');
        const db = await createClient();
        const { data: auth } = await db.auth.getUser();
        if (auth.user) {
          const userId = auth.user.id;
          if (conversationId) {
            const { data } = await db.from('video_ai_conversations').select('id')
              .eq('id', conversationId).eq('user_id', userId).maybeSingle();
            conversationId = data?.id || null;
          }
          if (!conversationId) {
            const { data } = await db.from('video_ai_conversations').select('id')
              .eq('user_id', userId).eq('project_id', body.projectId).eq('is_active', true)
              .order('updated_at', { ascending: false }).limit(1).maybeSingle();
            conversationId = data?.id || null;
          }
          if (!conversationId) {
            const promptText = String(body.prompt || '').trim();
            const { data, error } = await db.from('video_ai_conversations')
              .insert({ user_id: userId, project_id: body.projectId, title: promptText.slice(0, 60) || 'Editing session' })
              .select('id').single();
            conversationId = error ? null : data.id;
          }
          if (conversationId) {
            const { error: msgError } = await db.from('video_ai_messages').insert([
              { conversation_id: conversationId, user_id: userId, role: 'user', content: String(body.prompt || '').slice(0, 4000), context: {}, actions: [], tool_calls: [] },
              {
                conversation_id: conversationId,
                user_id: userId,
                role: 'assistant',
                content: String((result.output as { message?: unknown } | null)?.message || '').slice(0, 4000),
                actions: Array.isArray((result.output as { actions?: unknown[] } | null)?.actions) ? (result.output as { actions: unknown[] }).actions.slice(0, 24) : [],
                tool_calls: [],
                context: { provider: result.provider || null },
              },
            ]);
            if (msgError) historyError = msgError.message;
            await db.from('video_ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
          }
        }
      } catch {
        /* History is best-effort. */
      }
    }

    /* Persist executable AI actions as an audit/undo companion. The editor's
       local history remains the source of truth for immediate undo, while
       this record lets the project remember what the AI actually requested. */
    if (body.operation === 'assistant' && body.projectId) {
      const actions = Array.isArray((result.output as { actions?: unknown[] } | null)?.actions)
        ? (result.output as { actions: unknown[] }).actions
        : [];
      if (actions.length) {
        try {
          const { createClient } = await import('@/lib/supabase/server');
          const db = await createClient();
          const { data: auth } = await db.auth.getUser();
          if (auth.user) {
            await db.from('video_ai_actions').insert(
              actions.slice(0, 24).map((action: any) => ({
                user_id: auth.user.id,
                project_id: body.projectId,
                conversation_id: conversationId,
                message_id: null,
                action_type: String(action?.type || 'unknown'),
                target_type: action?.clipId ? 'clip' : action?.elementId ? 'element' : 'project',
                target_id: action?.clipId || action?.elementId || null,
                action,
                before_state: null,
                after_state: null,
                status: 'executed',
                feedback: null,
              }))
            );
          }
        } catch {
          /* Audit trail is best-effort. */
        }
      }
    }

    await finishAIJob(jobId, { status: 'completed', output: result.output });
    return NextResponse.json({ ...result, jobId, conversationId, historyError });
  } catch (error) {
    if (jobId) await finishAIJob(jobId, { status: 'failed', error: error instanceof Error ? error.message : 'AI request failed.' });
    const message = error instanceof Error ? error.message : 'AI request failed.';
    const status = /required|not configured|signed in|operation is required|Select an imported/i.test(message) ? 400 : 502;
    return NextResponse.json(
      { error: message, jobId },
      { status },
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 });

    const { createClient } = await import('@/lib/supabase/server');
    const db = await createClient();
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) return NextResponse.json({ conversationId: null, messages: [] });

    const { data: conv } = await db.from('video_ai_conversations').select('id')
      .eq('user_id', auth.user.id).eq('project_id', projectId).eq('is_active', true)
      .order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (!conv) return NextResponse.json({ conversationId: null, messages: [] });

    const { data: messages } = await db.from('video_ai_messages')
      .select('id,role,content,actions,created_at')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true }).limit(100);
    return NextResponse.json({ conversationId: conv.id, messages: messages || [] });
  } catch {
    return NextResponse.json({ conversationId: null, messages: [] });
  }
}
