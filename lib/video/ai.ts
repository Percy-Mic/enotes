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
  mediaType?: 'image' | 'video' | 'audio' | null;
  mediaUrls?: Array<{ url: string; type?: 'image' | 'video' | 'audio' | null }> | null;
  selection?: { clipId?: string | null; elementId?: string | null; audioId?: string | null } | null;
  conversation?: Array<{ role: 'user' | 'assistant'; text: string; actions?: unknown[] }> | null;
}

export interface AIResult {
  operation: VideoAIOperation;
  provider: string;
  output: unknown;
  jobId?: string;
}

const GEMINI_KEY = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
const ASSEMBLY_KEY = () => process.env.ASSEMBLYAI_API_KEY;
const GROQ_KEY = () => process.env.GROQ_API_KEY;

async function uploadGeminiFileFromUrl(mediaUrl: string, key: string, mimeType: string) {
  const source = await fetch(mediaUrl, { cache: 'no-store' });
  if (!source.ok) throw new Error(`Could not read project media (${source.status}).`);
  const contentLength = Number(source.headers.get('content-length') || 0);
  const maxInlineBytes = 95 * 1024 * 1024;
  if (contentLength > maxInlineBytes) {
    throw new Error('This video is larger than the free inline AI limit. Use a shorter/proxy clip for AI analysis.');
  }

  const bytes = await source.arrayBuffer();
  if (bytes.byteLength > maxInlineBytes) {
    throw new Error('This video is larger than the free inline AI limit. Use a shorter/proxy clip for AI analysis.');
  }

  const start = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': key,
      'x-goog-upload-protocol': 'resumable',
      'x-goog-upload-command': 'start',
      'x-goog-upload-header-content-length': String(bytes.byteLength),
      'x-goog-upload-header-content-type': mimeType,
    },
    body: JSON.stringify({
      file: { display_name: `enotes-ai-${crypto.randomUUID()}` },
    }),
    cache: 'no-store',
  });

  if (!start.ok) {
    const message = await start.text().catch(() => '');
    throw new Error(message || `Gemini file upload could not start (${start.status}).`);
  }

  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini did not return a resumable upload URL.');

  const uploaded = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'content-length': String(bytes.byteLength),
      'x-goog-upload-offset': '0',
      'x-goog-upload-command': 'upload, finalize',
    },
    body: bytes,
    cache: 'no-store',
  });

  const uploadedData = await uploaded.json().catch(() => ({}));
  if (!uploaded.ok) {
    throw new Error(uploadedData?.error?.message || `Gemini file upload failed (${uploaded.status}).`);
  }

  const file = uploadedData?.file;
  if (!file?.name || !file?.uri) throw new Error('Gemini file upload returned no usable file URI.');

  let state = String(file.state || '');
  for (let attempt = 0; attempt < 36 && state && state !== 'ACTIVE'; attempt += 1) {
    if (state === 'FAILED') throw new Error('Gemini could not process the video file.');
    await new Promise((resolve) => setTimeout(resolve, Math.min(2500, 700 + attempt * 80)));
    const statusResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${String(file.name).split('/').map(encodeURIComponent).join('/')}`,
      {
        headers: { 'x-goog-api-key': key },
        cache: 'no-store',
      },
    );
    const statusData = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok) throw new Error(statusData?.error?.message || 'Could not check Gemini video processing status.');
    state = String(statusData?.state || statusData?.file?.state || '');
  }

  if (state && state !== 'ACTIVE') throw new Error('Gemini video processing timed out.');
  return {
    uri: String(file.uri),
    mimeType: String(file.mimeType || mimeType),
  };
}

async function geminiStructured(
  prompt: string,
  schema: Record<string, unknown>,
  model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  media?: Array<{ url?: string | null; type?: 'video' | 'image' | 'audio' | null }>,
) {
  const key = GEMINI_KEY();
  if (!key) throw new Error('Gemini is not configured. Add GEMINI_API_KEY to Vercel.');

  const mediaParts: Array<Record<string, unknown>> = [];
  for (const item of (media || []).slice(0, 10)) {
    if (!item?.url) continue;
    const type = item.type || 'video';
    const mimeType =
      type === 'image' ? 'image/jpeg' :
      type === 'audio' ? 'audio/mpeg' :
      'video/mp4';

    const uploaded = await uploadGeminiFileFromUrl(item.url, key, mimeType);
    mediaParts.push({
      type,
      uri: uploaded.uri,
      mime_type: uploaded.mimeType,
      ...(type === 'video' ? { processing: 'agentic' } : {}),
    });
  }

  const response = await fetch('https://generativelanguage.googleapis.com/v1/interactions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': key,
    },
    body: JSON.stringify({
      model: model.replace(/^models\//, ''),
      input: mediaParts.length
        ? [{ type: 'text', text: prompt }, ...mediaParts]
        : prompt,
      store: false,
      response_format: { type: 'text', mime_type: 'application/json', schema },
    }),
    cache: 'no-store',
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error?.details?.[0]?.message ||
      `Gemini request failed (${response.status}).`;
    throw new Error(message);
  }

  const text =
    data?.output_text ||
    data?.output?.map?.((item: { content?: Array<{ text?: string }> }) =>
      item.content?.map((part) => part.text || '').join('') || ''
    ).join('') ||
    data?.steps?.map?.((step: { content?: Array<{ text?: string }> }) =>
      step.content?.map((part) => part.text || '').join('') || ''
    ).join('') ||
    '';

  if (!text) throw new Error('Gemini returned an empty structured response.');
  return parseJson(text);
}

async function geminiText(prompt: string, model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite') {
  const key = GEMINI_KEY();
  if (!key) throw new Error('Gemini is not configured. Add GEMINI_API_KEY to Vercel.');

  const response = await fetch('https://generativelanguage.googleapis.com/v1/interactions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': key,
    },
    body: JSON.stringify({
      model: model.replace(/^models\//, ''),
      input: prompt,
      store: false,
    }),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Gemini request failed (${response.status}).`);

  const text =
    data?.output_text ||
    data?.output?.map?.((item: { content?: Array<{ text?: string }> }) =>
      item.content?.map((part) => part.text || '').join('') || ''
    ).join('') ||
    data?.steps?.map?.((step: { content?: Array<{ text?: string }> }) =>
      step.content?.map((part) => part.text || '').join('') || ''
    ).join('') ||
    '';

  if (!text) throw new Error('Gemini returned an empty response.');
  return text;
}

function inferMediaType(mediaUrl: string): 'image' | 'video' | 'audio' | 'unknown' {
  const pathname = mediaUrl.split('?')[0].split('#')[0].toLowerCase();
  if (/\.(?:jpe?g|png|webp)$/i.test(pathname)) return 'image';
  if (/\.(?:mp4|webm|mov|m4v|avi|mkv)$/i.test(pathname)) return 'video';
  if (/\.(?:mp3|wav|m4a|aac|ogg|flac)$/i.test(pathname)) return 'audio';
  return 'unknown';
}

async function removeImageBackground(mediaUrl: string) {
  const key = process.env.REMOVEBG_API_KEY;
  if (!key) throw new Error('Background removal is not configured. Add REMOVEBG_API_KEY to Vercel.');

  const response = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: {
      'X-Api-Key': key,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      image_url: mediaUrl,
      size: 'preview',
      type: 'auto',
    }).toString(),
    cache: 'no-store',
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || `Background removal failed (${response.status}).`);
  }

  const output = await response.arrayBuffer();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('You must be signed in.');

  const path = `${auth.user.id}/ai-bg-${crypto.randomUUID()}.png`;
  const { error } = await supabase.storage.from('studio-media').upload(path, output, {
    contentType: 'image/png',
    upsert: false,
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from('studio-media').getPublicUrl(path);
  return { url: data.publicUrl, path, contentType: 'image/png' };
}

async function groqTranscript(mediaUrl: string, language?: string | null) {
  const key = GROQ_KEY();
  if (!key) throw new Error('No speech-to-text provider is configured. Add ASSEMBLYAI_API_KEY or GROQ_API_KEY to Vercel.');

  const form = new FormData();
  form.append('url', mediaUrl);
  form.append('model', process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  if (language) form.append('language', language);

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Groq transcription failed (${response.status}).`);

  return {
    transcriptId: null,
    text: data?.text || '',
    words: Array.isArray(data?.words) ? data.words : [],
    utterances: [],
  };
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
      speech_models: process.env.ASSEMBLYAI_MODEL ? [process.env.ASSEMBLYAI_MODEL] : ['universal-3-5-pro', 'universal-2'],
      punctuate: true,
      format_text: true,
      speaker_labels: true,
      ...(language ? {} : { language_detection: true }),
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

type TranscriptWord = { text?: string; start?: number; end?: number; confidence?: number; speaker?: string };

function buildCaptions(words: TranscriptWord[]) {
  const clean = words.filter((word) => typeof word.text === 'string' && Number.isFinite(Number(word.start)) && Number.isFinite(Number(word.end)))
    .map((word) => ({ text: String(word.text).trim(), start: Number(word.start) / 1000, end: Number(word.end) / 1000, confidence: Number.isFinite(Number(word.confidence)) ? Number(word.confidence) : null, speaker: word.speaker || null }))
    .filter((word) => word.text);
  const captions: Array<{ id: string; text: string; start: number; end: number; confidence: number | null; needsReview: boolean; speaker?: string | null }> = [];
  let group: typeof clean = [];
  const flush = () => {
    if (!group.length) return;
    const start = group[0].start; const end = group[group.length - 1].end;
    const text = group.map((word) => word.text).join(' ').replace(/\s+([,.!?;:])/g, '$1').trim();
    const confidenceValues = group.map((word) => word.confidence).filter((value): value is number => value != null);
    const confidence = confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : null;
    captions.push({ id: `caption-${captions.length}`, text, start, end: Math.max(start + 0.25, end), confidence, needsReview: confidence != null && confidence < 0.78, speaker: group[0].speaker || null });
    group = [];
  };
  for (const word of clean) {
    const previous = group[group.length - 1]; const candidate = [...group, word];
    const candidateText = candidate.map((item) => item.text).join(' ');
    const punctuationBreak = /[.!?]$/.test(previous?.text || '');
    const speakerBreak = !!(previous?.speaker && word.speaker && previous.speaker !== word.speaker);
    const gapBreak = !!(previous && word.start - previous.end > 0.55);
    const durationBreak = group.length > 0 && word.end - group[0].start > 3.2;
    const lengthBreak = candidate.length > 7 || candidateText.length > 48;
    if (group.length && (punctuationBreak || speakerBreak || gapBreak || durationBreak || lengthBreak)) flush();
    group.push(word);
  }
  flush();
  return captions;
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
    if (!input.mediaUrl || !/^https?:\/\//i.test(input.mediaUrl)) throw new Error('Select an imported video/audio clip first. AI transcription needs a saved studio-media URL.');
    const transcript = ASSEMBLY_KEY() ? await assemblyTranscript(input.mediaUrl, input.language) : await groqTranscript(input.mediaUrl, input.language);
    if (operation === 'transcribe') return { operation, provider: ASSEMBLY_KEY() ? 'assemblyai' : 'groq', output: transcript };

    const captions = transcript.words.length
      ? buildCaptions(transcript.words as TranscriptWord[])
      : [{ id: 'caption-0', text: transcript.text, start: 0, end: 4, confidence: null, needsReview: true, speaker: null }];
    return { operation, provider: ASSEMBLY_KEY() ? 'assemblyai' : 'groq', output: { ...transcript, captions } };
  }

  if (operation === 'remove-background') {
    if (!input.mediaUrl || !/^https?:\/\//i.test(input.mediaUrl)) {
      throw new Error('Select an imported image first. Background removal works on image media.');
    }
    const mediaType = input.mediaType || inferMediaType(input.mediaUrl);
    if (mediaType !== 'image') {
      throw new Error('Background removal currently supports images only (JPG, PNG, or WebP). Video background removal needs a video-capable segmentation provider.');
    }
    const output = await removeImageBackground(input.mediaUrl);
    return { operation, provider: 'remove.bg', output };
  }

  if (operation === 'assistant') {
    const rawProject = (input.project && typeof input.project === 'object') ? input.project as Record<string, unknown> : {};
    const compactProject = {
      aspect: rawProject.aspect, canvas: rawProject.canvas,
      clips: Array.isArray(rawProject.clips) ? rawProject.clips.map((clip: any) => ({
        id: clip.id, name: clip.name, sourceDuration: clip.sourceDuration, trimStart: clip.trimStart, trimEnd: clip.trimEnd,
        speed: clip.speed, volume: clip.volume, muted: clip.muted, filter: clip.filter, effect: clip.effect, transitionIn: clip.transitionIn,
        transform: clip.transform ? { scale: clip.transform.scale, scale_x: clip.transform.scale_x, scale_y: clip.transform.scale_y, offset_x: clip.transform.offset_x, offset_y: clip.transform.offset_y, rotation: clip.transform.rotation, crop: clip.transform.crop } : null,
      })) : [],
      elements: Array.isArray(rawProject.elements) ? rawProject.elements.map((el: any) => ({ id: el.id, kind: el.kind, content: typeof el.content === 'string' ? el.content.slice(0, 180) : '', start: el.start, end: el.end, x: el.x, y: el.y, width: el.width, height: el.height, rotation: el.rotation, opacity: el.opacity })) : [],
      audio: Array.isArray(rawProject.audio) ? rawProject.audio.map((audio: any) => ({ id: audio.id, name: audio.name, start: audio.start, trimStart: audio.trimStart, trimEnd: audio.trimEnd, volume: audio.volume, kind: audio.kind })) : [],
    };
    const schema = {
      type: 'object',
      properties: {
        message: { type: 'string' }, summary: { type: 'string' },
        actions: { type: 'array', items: { type: 'object', properties: {
          type: { type: 'string', enum: ['set_clip_speed','set_clip_volume','set_clip_mute','set_clip_filter','set_clip_effect','set_clip_transition','trim_clip','transform_clip','set_clip_adjustments','fit_clip','set_aspect','delete_clip','duplicate_clip','generate_captions','transcribe','transform_element','set_element_opacity','set_keyframe','add_text_element','split_clip','reorder_clip','add_stock_video'] },
          clipId: { type: ['string','null'] }, elementId: { type: ['string','null'] }, value: { type: ['number','string','boolean','null'] }, value2: { type: ['number','string','boolean','null'] }, object: { type: ['object','null'] },
        }, required: ['type'] } },
      }, required: ['message','summary','actions'],
    };
    const conversation = Array.isArray(input.conversation) ? input.conversation.slice(-10) : [];
    const conversationText = conversation.map((message) => {
      const actions = Array.isArray(message.actions) ? ` Actions: ${JSON.stringify(message.actions).slice(0, 2400)}` : '';
      return `${message.role.toUpperCase()}: ${String(message.text || '').slice(0, 1800)}${actions}`;
    }).join('\\n');

    const prompt = `You are the professional editing agent inside enotes Studio. You are not a generic chatbot. Turn the user's natural-language request into real, safe, reversible editor operations.

CRITICAL BEHAVIOR:
- Maintain conversation context. If the user says "it", "this", "that", "the suggestions", "do it", "implement it", or "apply that", resolve it from the immediately preceding messages and action list. Never ask them to repeat context that is already present.
- Inspect the supplied project state and selected media. Never invent IDs.
- For requests such as "make it an advertisement", create a concrete commercial edit using the existing footage: stronger opening, tighter pacing, readable headline/CTA, intentional transitions, tasteful color treatment, motion/keyframes, and a suitable aspect ratio when inferable.
- You may trim, split, duplicate, reorder, change speed, add transitions, add text, add keyframes, transform/crop, color grade, apply effects, and change the canvas.
- If the user explicitly allows extra footage, you may emit add_stock_video with a concise search query. Do not claim it was added unless the action is emitted.
- Never merely explain how to do an edit when the requested operation is supported. Emit the operation.
- Use up to 16 actions when a coherent edit requires multiple changes. Prefer non-destructive edits and never delete clips unless explicitly requested.

ALLOWED ACTIONS:
set_clip_speed value 0.25..4
set_clip_volume value 0..1
set_clip_mute boolean
set_clip_filter value
set_clip_effect value
set_clip_transition value=type, value2=duration
trim_clip value=start, value2=end
transform_clip object={offset_x,offset_y,scale,scale_x,scale_y,rotation}
set_clip_adjustments object={brightness,contrast,saturate,hue,blur,sepia,grayscale,exposure,temperature,tint,vibrance,vignette,grain,sharpen}
fit_clip value=contain|cover
set_aspect value=original|16:9|9:16|1:1|4:5|3:2|21:9
delete_clip clipId
duplicate_clip clipId
transform_element object={x,y,width,height,rotation,opacity}
set_element_opacity value=0..1
set_keyframe object={property,t,value}
add_text_element object={text,start,end,x,y,width,height,font_size,color,background,animation}
split_clip value=timeline seconds
reorder_clip object={fromIndex,toIndex}
add_stock_video object={query,orientation}

Previous conversation:
${conversationText || '(none)'}

Current request:
${input.prompt || 'Suggest a useful improvement'}

Selection:
${JSON.stringify(input.selection || {})}

Project:
${JSON.stringify(compactProject)}`;
    const mediaInputs = Array.isArray(input.mediaUrls) && input.mediaUrls.length
      ? input.mediaUrls.slice(0, 10)
      : input.mediaUrl ? [{ url: input.mediaUrl, type: input.mediaType || 'video' }] : [];
    let plan = await geminiStructured(prompt, schema, process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite', mediaInputs.length ? mediaInputs : undefined);
    if (!plan || typeof plan !== 'object') plan = { message: 'I could not create a safe edit plan.', summary: '', actions: [] };
    const actions = Array.isArray((plan as any).actions) ? (plan as any).actions.slice(0, 8) : [];
    const validClipIds = new Set(compactProject.clips.map((clip: any) => clip.id));
    const validElementIds = new Set(compactProject.elements.map((element: any) => element.id));
    const selectedClipId = input.selection?.clipId && validClipIds.has(input.selection.clipId)
      ? input.selection.clipId
      : compactProject.clips.length === 1 ? compactProject.clips[0].id : null;
    const selectedElementId = input.selection?.elementId && validElementIds.has(input.selection.elementId)
      ? input.selection.elementId
      : compactProject.elements.length === 1 ? compactProject.elements[0].id : null;
    const clipActionTypes = new Set([
      'set_clip_speed','set_clip_volume','set_clip_mute','set_clip_filter','set_clip_effect',
      'set_clip_transition','trim_clip','transform_clip','set_clip_adjustments','fit_clip',
      'delete_clip','duplicate_clip','set_keyframe','add_text_element','split_clip','reorder_clip',
    ]);
    const elementActionTypes = new Set(['transform_element','set_element_opacity']);
    const sanitizedActions = actions
      .map((action: any) => ({
        ...action,
        clipId: action.clipId && validClipIds.has(action.clipId) ? action.clipId : selectedClipId,
        elementId: action.elementId && validElementIds.has(action.elementId) ? action.elementId : selectedElementId,
      }))
      .filter((action: any) =>
        action.type === 'set_aspect' ||
        action.type === 'generate_captions' ||
        action.type === 'transcribe' ||
        action.type === 'add_stock_video' ||
        (clipActionTypes.has(action.type) && (
          action.type === 'add_text_element' ||
          action.type === 'split_clip' ||
          action.type === 'reorder_clip' ||
          validClipIds.has(action.clipId)
        )) ||
        (elementActionTypes.has(action.type) && validElementIds.has(action.elementId))
      );
    let captions: unknown[] = []; let transcript: unknown = null;
    if (sanitizedActions.some((action: any) => action.type === 'generate_captions' || action.type === 'transcribe')) {
      if (!input.mediaUrl || !/^https?:\/\//i.test(input.mediaUrl)) throw new Error('Select an imported video or audio clip first so I can generate accurate captions.');
      const transcriptResult = ASSEMBLY_KEY() ? await assemblyTranscript(input.mediaUrl, input.language) : await groqTranscript(input.mediaUrl, input.language);
      transcript = transcriptResult;
      if (sanitizedActions.some((action: any) => action.type === 'generate_captions')) captions = transcriptResult.words.length ? buildCaptions(transcriptResult.words as TranscriptWord[]) : [{ id: 'caption-0', text: transcriptResult.text, start: 0, end: 4, confidence: null, needsReview: true, speaker: null }];
    }
    return { operation, provider: 'gemini' + (captions.length ? ' + ' + (ASSEMBLY_KEY() ? 'assemblyai' : 'groq') : ''), output: { message: String((plan as any).message || 'I prepared an edit plan.'), summary: String((plan as any).summary || ''), actions: sanitizedActions, captions, transcript, captionCount: captions.length, reviewCount: captions.filter((caption: any) => caption?.needsReview).length } };
  }

  if (operation === 'analyze') {
    const project = JSON.stringify(input.project || {}).slice(0, 30000);
    const prompt = `You are the AI editor inside a professional mobile-first video editor. Analyze this project JSON and return STRICT JSON with: summary, pacing, audio, visual, text, recommendations (array of objects with title, reason, action). Do not invent media. Project: ${project}`;
    const result = await geminiText(prompt);
    return { operation, provider: 'gemini', output: parseJson(result) };
  }

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
        mediaType: input.mediaType || null,
        selection: input.selection || null,
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
