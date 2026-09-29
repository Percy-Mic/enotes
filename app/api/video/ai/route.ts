import { NextResponse } from 'next/server';
import { createAIJob, finishAIJob, runVideoAI, type AIJobInput } from '@/lib/video/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let jobId: string | null = null;
  try {
    const body = (await request.json()) as AIJobInput;
    if (!body?.operation) return NextResponse.json({ error: 'operation is required' }, { status: 400 });

    const job = await createAIJob(body);
    jobId = job.id;

    const result = await runVideoAI(body);

    /* Persist executable AI actions as an audit/undo companion. The editor's
       local history remains the source of truth for immediate undo, while
       this record lets the project remember what the AI actually requested. */
    if (body.operation === 'assistant' && body.projectId) {
      const actions = Array.isArray((result.output as { actions?: unknown[] } | null)?.actions)
        ? (result.output as { actions: unknown[] }).actions
        : [];
      if (actions.length) {
        const { createClient } = await import('@/lib/supabase/server');
        const db = await createClient();
        const { data: auth } = await db.auth.getUser();
        if (auth.user) {
          await db.from('video_ai_actions').insert(
            actions.slice(0, 24).map((action: any) => ({
              user_id: auth.user.id,
              project_id: body.projectId,
              conversation_id: null,
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
      }
    }

    await finishAIJob(jobId, { status: 'completed', output: result.output });
    return NextResponse.json({ ...result, jobId });
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
