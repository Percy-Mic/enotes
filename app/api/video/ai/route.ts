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
    await finishAIJob(jobId, { status: 'completed', output: result.output });
    return NextResponse.json({ ...result, jobId });
  } catch (error) {
    if (jobId) await finishAIJob(jobId, { status: 'failed', error: error instanceof Error ? error.message : 'AI request failed.' });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'AI request failed.', jobId },
      { status: 400 },
    );
  }
}
