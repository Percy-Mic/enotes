import { createClient } from '@/lib/supabase/server';

export type VideoAIOperation =
  | 'assistant'
  | 'analyze'
  | 'transcribe'
  | 'generate-captions'
  | 'remove-background'
  | 'remove-object'
  | 'track-object'
  | 'auto-reframe'
  | 'enhance'
  | 'generate-image'
  | 'generate-voice'
  | 'generate-music';

export interface AIJobInput {
  operation: VideoAIOperation;
  projectId?: string | null;
  mediaUrl?: string | null;
  prompt?: string | null;
  language?: string | null;
  project?: unknown;
}

export interface AIResult {
  operation: VideoAIOperation;
  provider: string;
  output: unknown;
  jobId?: string;
}

const GEMINI_KEY = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
const ASSEMBLY_KEY = () => process.env.ASSEMBLYAI_API_KEY;

async function geminiText(prompt: string, model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite') {
  const key = GEMINI_KEY();
  if (!key) throw new Error('Gemini is not configured. Add GEMINI_API_KEY to Vercel.');
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      cache: 'no-store',
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Gemini request failed (${response.status}).`);
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '';
  if (!text) throw new Error('Gemini returned an empty response.');
  return text;
}

async function assemblyTranscript(mediaUrl: string, language?: string | null) {
  const key = ASSEMBLY_KEY();
  if (!key) throw new Error('AssemblyAI is not configured. Add ASSEMBLYAI_API_KEY to Vercel.');
  const response = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      authorization: key,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: mediaUrl,
      language_code: language || undefined,
      speech_models: ['universal-2'],
      punctuate: true,
      format_text: true,
    }),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `AssemblyAI request failed (${response.status}).`);

  const id = data?.id;
  if (!id) throw new Error('AssemblyAI did not return a transcript job id.');

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(3000, 800 + attempt * 100)));
    const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${encodeURIComponent(id)}`, {
      headers: { authorization: key },
      cache: 'no-store',
    });
    const result = await poll.json().catch(() => ({}));
    if (!poll.ok) throw new Error(result?.error || `AssemblyAI polling failed (${poll.status}).`);
    if (result.status === 'completed') {
      return {
        transcriptId: id,
        text: result.text || '',
        words: Array.isArray(result.words) ? result.words : [],
        utterances: Array.isArray(result.utterances) ? result.utterances : [],
      };
    }
    if (result.status === 'error') throw new Error(result.error || 'AssemblyAI transcription failed.');
  }
  throw new Error('Transcription is still processing. Try again in a moment.');
}

function parseJson(text: string) {
  const cleaned = text.replace(/^\s*\`\`\`(?:json)?/i, '').replace(/\`\`\`\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { return { text: cleaned }; }
}

export async function runVideoAI(input: AIJobInput): Promise<AIResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('You must be signed in to use AI tools.');

  const operation = input.operation;

  if (operation === 'transcribe' || operation === 'generate-captions') {
    if (!input.mediaUrl) throw new Error('A media URL is required for transcription.');
    const transcript = await assemblyTranscript(input.mediaUrl, input.language);
    if (operation === 'transcribe') return { operation, provider: 'assemblyai', output: transcript };

    const captions = transcript.words.length
      ? transcript.words.map((w: { text: string; start: number; end: number }, i: number) => ({
          id: `caption-${i}`,
          text: w.text,
          start: w.start / 1000,
          end: w.end / 1000,
        }))
      : [{ id: 'caption-0', text: transcript.text, start: 0, end: 4 }];
    return { operation, provider: 'assemblyai', output: { ...transcript, captions } };
  }

  if (operation === 'assistant' || operation === 'analyze') {
    const project = JSON.stringify(input.project || {}).slice(0, 30000);
    const prompt = operation === 'analyze'
      ? `You are the AI editor inside a professional mobile-first video editor. Analyze this project JSON and return STRICT JSON with: summary, pacing, audio, visual, text, recommendations (array of objects with title, reason, action). Do not invent media. Project: ${project}`
      : `You are the editing assistant for enotes Studio. Give concise, practical editing instructions based on this project. User request: ${input.prompt || 'Suggest improvements'}. Project JSON: ${project}`;
    const result = await geminiText(prompt);
    return { operation, provider: 'gemini', output: operation === 'analyze' ? parseJson(result) : { text: result } };
  }

  const provider = process.env.AI_DEFAULT_PROVIDER || 'huggingface';
  throw new Error(
    `${operation} is ready in the AI provider layer, but no execution adapter is configured yet. Set AI_DEFAULT_PROVIDER and the matching provider key to enable it.`,
  );
}

export async function createAIJob(input: AIJobInput) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('You must be signed in.');

  const { data, error } = await supabase
    .from('video_ai_jobs')
    .insert({
      user_id: auth.user.id,
      project_id: input.projectId || null,
      operation: input.operation,
      provider: process.env.AI_DEFAULT_PROVIDER || 'auto',
      status: 'processing',
      input: {
        mediaUrl: input.mediaUrl || null,
        prompt: input.prompt || null,
        language: input.language || null,
      },
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  return { id: data.id, userId: auth.user.id };
}

export async function finishAIJob(id: string, patch: { status: string; output?: unknown; error?: string | null }) {
  const supabase = await createClient();
  await supabase.from('video_ai_jobs').update({
    status: patch.status,
    output: patch.output ?? null,
    error: patch.error ?? null,
    completed_at: patch.status === 'completed' || patch.status === 'failed' ? new Date().toISOString() : null,
  }).eq('id', id);
}
