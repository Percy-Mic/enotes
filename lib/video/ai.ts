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
  mediaUrls?: Array<{
    url: string;
    type?: 'image' | 'video' | 'audio' | null;
  }> | null;
  selection?: {
    clipId?: string | null;
    elementId?: string | null;
    audioId?: string | null;
  } | null;
  conversation?: Array<{
    role: 'user' | 'assistant';
    text: string;
    actions?: unknown[];
  }> | null;
  conversationId?: string | null;
  audioLibrary?: Array<{
    id: string;
    title: string;
    artist?: string | null;
    category?: string | null;
    duration_seconds?: number | null;
    commercial_use?: boolean;
    premium?: boolean;
  }> | null;
  visionFrames?: Array<{ clipId: string; time: number; dataUrl: string; label?: string }> | null;
}

export interface AIResult {
  operation: VideoAIOperation;
  provider: string;
  output: unknown;
  jobId?: string;
}

const GEMINI_KEY = () =>
  process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;

const ASSEMBLY_KEY = () => process.env.ASSEMBLYAI_API_KEY;
const GROQ_KEY = () => process.env.GROQ_API_KEY;

async function uploadGeminiFileFromUrl(
  mediaUrl: string,
  key: string,
  mimeType: string,
) {
  const source = await fetch(mediaUrl, {
    cache: 'no-store',
  });

  if (!source.ok) {
    throw new Error(`Could not read project media (${source.status}).`);
  }

  const contentLength = Number(
    source.headers.get('content-length') || 0,
  );

  const maxInlineBytes = 95 * 1024 * 1024;

  if (contentLength > maxInlineBytes) {
    throw new Error(
      'This video is larger than the free inline AI limit. Use a shorter/proxy clip for AI analysis.',
    );
  }

  const bytes = await source.arrayBuffer();

  if (bytes.byteLength > maxInlineBytes) {
    throw new Error(
      'This video is larger than the free inline AI limit. Use a shorter/proxy clip for AI analysis.',
    );
  }

  const start = await fetch(
    'https://generativelanguage.googleapis.com/upload/v1beta/files',
    {
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
        file: {
          display_name: `enotes-ai-${crypto.randomUUID()}`,
        },
      }),
      cache: 'no-store',
    },
  );

  if (!start.ok) {
    const message = await start.text().catch(() => '');
    throw new Error(
      message ||
        `Gemini file upload could not start (${start.status}).`,
    );
  }

  const uploadUrl = start.headers.get('x-goog-upload-url');

  if (!uploadUrl) {
    throw new Error(
      'Gemini did not return a resumable upload URL.',
    );
  }

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
    throw new Error(
      uploadedData?.error?.message ||
        `Gemini file upload failed (${uploaded.status}).`,
    );
  }

  const file = uploadedData?.file;

  if (!file?.name || !file?.uri) {
    throw new Error(
      'Gemini file upload returned no usable file URI.',
    );
  }

  let state = String(file.state || '');

  for (
    let attempt = 0;
    attempt < 36 && state && state !== 'ACTIVE';
    attempt += 1
  ) {
    if (state === 'FAILED') {
      throw new Error(
        'Gemini could not process the video file.',
      );
    }

    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(2500, 700 + attempt * 80),
      ),
    );

    const statusResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${String(
        file.name,
      )
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`,
      {
        headers: {
          'x-goog-api-key': key,
        },
        cache: 'no-store',
      },
    );

    const statusData = await statusResponse
      .json()
      .catch(() => ({}));

    if (!statusResponse.ok) {
      throw new Error(
        statusData?.error?.message ||
          'Could not check Gemini video processing status.',
      );
    }

    state = String(
      statusData?.state ||
        statusData?.file?.state ||
        '',
    );
  }

  if (state && state !== 'ACTIVE') {
    throw new Error(
      'Gemini video processing timed out.',
    );
  }

  return {
    uri: String(file.uri),
    mimeType: String(
      file.mimeType || mimeType,
    ),
  };
}

async function geminiStructured(
  prompt: string,
  schema: Record<string, unknown>,
  model =
    process.env.GEMINI_MODEL ||
    'gemini-3.5-flash-lite',
  media?: Array<{
    url?: string | null;
    type?: 'video' | 'image' | 'audio' | null;
  }>,
) {
  const key = GEMINI_KEY();

  if (!key) {
    throw new Error(
      'Gemini is not configured. Add GEMINI_API_KEY to Vercel.',
    );
  }

  const mediaParts: Array<
    Record<string, unknown>
  > = [];

  for (const item of (media || []).slice(0, 18)) {
    if (!item?.url) continue;

    const type = item.type || 'video';

    if (item.url.startsWith('data:image/')) {
      const match = item.url.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (match) {
        mediaParts.push({
          inline_data: {
            mime_type: match[1],
            data: match[2],
          },
        });
        continue;
      }
    }

    const mimeType =
      type === 'image'
        ? 'image/jpeg'
        : type === 'audio'
          ? 'audio/mpeg'
          : 'video/mp4';

    const uploaded =
      await uploadGeminiFileFromUrl(
        item.url,
        key,
        mimeType,
      );

    mediaParts.push({
      type,
      uri: uploaded.uri,
      mime_type: uploaded.mimeType,
    });
  }

  /*
   * When media exists, use Gemini generateContent.
   *
   * The Interactions API input format does not accept:
   *
   * {
   *   type: 'video'
   * }
   *
   * for this request path.
   *
   * Uploaded files are instead supplied to generateContent
   * through:
   *
   * file_data: {
   *   file_uri,
   *   mime_type
   * }
   */

  const response = mediaParts.length
    ? await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          model.replace(/^models\//, ''),
        )}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': key,
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  ...mediaParts.map((part) => {
                    if (part.inline_data) {
                      return {
                        inline_data: part.inline_data,
                      };
                    }

                    return {
                      file_data: {
                        file_uri: String(
                          part.uri,
                        ),
                        mime_type: String(
                          part.mime_type,
                        ),
                      },
                    };
                  }),
                  {
                    text: prompt,
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType:
                'application/json',
              responseSchema: schema,
            },
          }),
          cache: 'no-store',
        },
      )
    : await fetch(
        'https://generativelanguage.googleapis.com/v1/interactions',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': key,
          },
          body: JSON.stringify({
            model: model.replace(
              /^models\//,
              '',
            ),
            input: prompt,
            store: false,
            response_format: {
              type: 'text',
              mime_type: 'application/json',
              schema,
            },
          }),
          cache: 'no-store',
        },
      );

  const data = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error?.details?.[0]?.message ||
      `Gemini request failed (${response.status}).`;

    throw new Error(message);
  }

  /*
   * generateContent returns:
   *
   * candidates[].content.parts[].text
   *
   * Interactions can return:
   *
   * output_text
   * output[].content[].text
   * steps[].content[].text
   */

  const text =
    data?.output_text ||
    data?.candidates
      ?.map?.(
        (candidate: {
          content?: {
            parts?: Array<{
              text?: string;
            }>;
          };
        }) =>
          candidate.content?.parts
            ?.map(
              (part) =>
                part.text || '',
            )
            .join('') || '',
      )
      .join('') ||
    data?.output
      ?.map?.(
        (item: {
          content?: Array<{
            text?: string;
          }>;
        }) =>
          item.content
            ?.map(
              (part) =>
                part.text || '',
            )
            .join('') || '',
      )
      .join('') ||
    data?.steps
      ?.map?.(
        (step: {
          content?: Array<{
            text?: string;
          }>;
        }) =>
          step.content
            ?.map(
              (part) =>
                part.text || '',
            )
            .join('') || '',
      )
      .join('') ||
    '';

  if (!text) {
    throw new Error(
      'Gemini returned an empty structured response.',
    );
  }

  return parseJson(text);
}

async function geminiText(
  prompt: string,
  model =
    process.env.GEMINI_MODEL ||
    'gemini-3.5-flash-lite',
) {
  const key = GEMINI_KEY();

  if (!key) {
    throw new Error(
      'Gemini is not configured. Add GEMINI_API_KEY to Vercel.',
    );
  }

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1/interactions',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify({
        model: model.replace(
          /^models\//,
          '',
        ),
        input: prompt,
        store: false,
      }),
      cache: 'no-store',
    },
  );

  const data = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        `Gemini request failed (${response.status}).`,
    );
  }

  const text =
    data?.output_text ||
    data?.output
      ?.map?.(
        (item: {
          content?: Array<{
            text?: string;
          }>;
        }) =>
          item.content
            ?.map(
              (part) =>
                part.text || '',
            )
            .join('') || '',
      )
      .join('') ||
    data?.steps
      ?.map?.(
        (step: {
          content?: Array<{
            text?: string;
          }>;
        }) =>
          step.content
            ?.map(
              (part) =>
                part.text || '',
            )
            .join('') || '',
      )
      .join('') ||
    '';

  if (!text) {
    throw new Error(
      'Gemini returned an empty response.',
    );
  }

  return text;
}

function inferMediaType(
  mediaUrl: string,
): 'image' | 'video' | 'audio' | 'unknown' {
  const pathname = mediaUrl
    .split('?')[0]
    .split('#')[0]
    .toLowerCase();

  if (
    /\.(?:jpe?g|png|webp)$/i.test(
      pathname,
    )
  ) {
    return 'image';
  }

  if (
    /\.(?:mp4|webm|mov|m4v|avi|mkv)$/i.test(
      pathname,
    )
  ) {
    return 'video';
  }

  if (
    /\.(?:mp3|wav|m4a|aac|ogg|flac)$/i.test(
      pathname,
    )
  ) {
    return 'audio';
  }

  return 'unknown';
}

async function removeImageBackground(
  mediaUrl: string,
) {
  const key =
    process.env.REMOVEBG_API_KEY;

  if (!key) {
    throw new Error(
      'Background removal is not configured. Add REMOVEBG_API_KEY to Vercel.',
    );
  }

  const response = await fetch(
    'https://api.remove.bg/v1.0/removebg',
    {
      method: 'POST',
      headers: {
        'X-Api-Key': key,
        'Content-Type':
          'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        image_url: mediaUrl,
        size: 'preview',
        type: 'auto',
      }).toString(),
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    const message = await response
      .text()
      .catch(() => '');

    throw new Error(
      message ||
        `Background removal failed (${response.status}).`,
    );
  }

  const output =
    await response.arrayBuffer();

  const supabase =
    await createClient();

  const { data: auth } =
    await supabase.auth.getUser();

  if (!auth.user) {
    throw new Error(
      'You must be signed in.',
    );
  }

  const path = `${auth.user.id}/ai-bg-${crypto.randomUUID()}.png`;

  const { error } =
    await supabase.storage
      .from('studio-media')
      .upload(path, output, {
        contentType: 'image/png',
        upsert: false,
      });

  if (error) {
    throw new Error(error.message);
  }

  const { data } =
    supabase.storage
      .from('studio-media')
      .getPublicUrl(path);

  return {
    url: data.publicUrl,
    path,
    contentType: 'image/png',
  };
}

async function groqTranscript(
  mediaUrl: string,
  language?: string | null,
) {
  const key = GROQ_KEY();

  if (!key) {
    throw new Error(
      'No speech-to-text provider is configured. Add ASSEMBLYAI_API_KEY or GROQ_API_KEY to Vercel.',
    );
  }

  const form = new FormData();

  form.append('url', mediaUrl);

  form.append(
    'model',
    process.env.GROQ_WHISPER_MODEL ||
      'whisper-large-v3-turbo',
  );

  form.append(
    'response_format',
    'verbose_json',
  );

  form.append(
    'timestamp_granularities[]',
    'word',
  );

  if (language) {
    form.append(
      'language',
      language,
    );
  }

  const response = await fetch(
    'https://api.groq.com/openai/v1/audio/transcriptions',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
      },
      body: form,
      cache: 'no-store',
    },
  );

  const data = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        `Groq transcription failed (${response.status}).`,
    );
  }

  return {
    transcriptId: null,
    text: data?.text || '',
    words: Array.isArray(data?.words)
      ? data.words
      : [],
    utterances: [],
  };
}

async function assemblyTranscript(
  mediaUrl: string,
  language?: string | null,
) {
  const key = ASSEMBLY_KEY();

  if (!key) {
    throw new Error(
      'AssemblyAI is not configured. Add ASSEMBLYAI_API_KEY to Vercel.',
    );
  }

  const response = await fetch(
    'https://api.assemblyai.com/v2/transcript',
    {
      method: 'POST',
      headers: {
        authorization: key,
        'content-type':
          'application/json',
      },
      body: JSON.stringify({
        audio_url: mediaUrl,
        language_code:
          language || undefined,
        speech_models:
          process.env.ASSEMBLYAI_MODEL
            ? [
                process.env
                  .ASSEMBLYAI_MODEL,
              ]
            : [
                'universal-3-5-pro',
                'universal-2',
              ],
        punctuate: true,
        format_text: true,
        speaker_labels: true,
        ...(language
          ? {}
          : {
              language_detection: true,
            }),
      }),
      cache: 'no-store',
    },
  );

  const data = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.error ||
        `AssemblyAI request failed (${response.status}).`,
    );
  }

  const id = data?.id;

  if (!id) {
    throw new Error(
      'AssemblyAI did not return a transcript job id.',
    );
  }

  for (
    let attempt = 0;
    attempt < 30;
    attempt += 1
  ) {
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(
          3000,
          800 + attempt * 100,
        ),
      ),
    );

    const poll = await fetch(
      `https://api.assemblyai.com/v2/transcript/${encodeURIComponent(id)}`,
      {
        headers: {
          authorization: key,
        },
        cache: 'no-store',
      },
    );

    const result = await poll
      .json()
      .catch(() => ({}));

    if (!poll.ok) {
      throw new Error(
        result?.error ||
          `AssemblyAI polling failed (${poll.status}).`,
      );
    }

    if (result.status === 'completed') {
      return {
        transcriptId: id,
        text: result.text || '',
        words: Array.isArray(
          result.words,
        )
          ? result.words
          : [],
        utterances: Array.isArray(
          result.utterances,
        )
          ? result.utterances
          : [],
      };
    }

    if (result.status === 'error') {
      throw new Error(
        result.error ||
          'AssemblyAI transcription failed.',
      );
    }
  }

  throw new Error(
    'Transcription is still processing. Try again in a moment.',
  );
}

type TranscriptWord = {
  text?: string;
  start?: number;
  end?: number;
  confidence?: number;
  speaker?: string;
};

function buildCaptions(
  words: TranscriptWord[],
) {
  const clean = words
    .filter(
      (word) =>
        typeof word.text ===
          'string' &&
        Number.isFinite(
          Number(word.start),
        ) &&
        Number.isFinite(
          Number(word.end),
        ),
    )
    .map((word) => ({
      text: String(word.text).trim(),
      start:
        Number(word.start) / 1000,
      end:
        Number(word.end) / 1000,
      confidence:
        Number.isFinite(
          Number(word.confidence),
        )
          ? Number(word.confidence)
          : null,
      speaker:
        word.speaker || null,
    }))
    .filter(
      (word) => word.text,
    );

  const captions: Array<{
    id: string;
    text: string;
    start: number;
    end: number;
    confidence: number | null;
    needsReview: boolean;
    speaker?: string | null;
  }> = [];

  let group: typeof clean = [];

  const flush = () => {
    if (!group.length) return;

    const start =
      group[0].start;

    const end =
      group[group.length - 1].end;

    const text = group
      .map((word) => word.text)
      .join(' ')
      .replace(
        /\s+([,.!?;:])/g,
        '$1',
      )
      .trim();

    const confidenceValues =
      group
        .map(
          (word) =>
            word.confidence,
        )
        .filter(
          (
            value,
          ): value is number =>
            value != null,
        );

    const confidence =
      confidenceValues.length
        ? confidenceValues.reduce(
            (sum, value) =>
              sum + value,
            0,
          ) /
          confidenceValues.length
        : null;

    captions.push({
      id: `caption-${captions.length}`,
      text,
      start,
      end: Math.max(
        start + 0.25,
        end,
      ),
      confidence,
      needsReview:
        confidence != null &&
        confidence < 0.78,
      speaker:
        group[0].speaker ||
        null,
    });

    group = [];
  };

  for (const word of clean) {
    const previous =
      group[group.length - 1];

    const candidate = [
      ...group,
      word,
    ];

    const candidateText = candidate
      .map(
        (item) => item.text,
      )
      .join(' ');

    const punctuationBreak =
      /[.!?]$/.test(
        previous?.text || '',
      );

    const speakerBreak =
      !!(
        previous?.speaker &&
        word.speaker &&
        previous.speaker !==
          word.speaker
      );

    const gapBreak =
      !!(
        previous &&
        word.start -
          previous.end >
          0.55
      );

    const durationBreak =
      group.length > 0 &&
      word.end -
        group[0].start >
        3.2;

    const lengthBreak =
      candidate.length > 7 ||
      candidateText.length > 48;

    if (
      group.length &&
      (
        punctuationBreak ||
        speakerBreak ||
        gapBreak ||
        durationBreak ||
        lengthBreak
      )
    ) {
      flush();
    }

    group.push(word);
  }

  flush();

  return captions;
}

function parseJson(
  text: string,
) {
  const cleaned = text
    .replace(
      /^\s*```(?:json)?/i,
      '',
    )
    .replace(
      /```\s*$/i,
      '',
    )
    .trim();

  try {
    return JSON.parse(
      cleaned,
    );
  } catch {
    return {
      text: cleaned,
    };
  }
}

async function loadAIMemoryContext(
  supabase: Awaited<
    ReturnType<typeof createClient>
  >,
  userId: string,
  projectId?: string | null,
) {
  const { data: settings } =
    await supabase
      .from('user_settings')
      .select(
        'ai_memory_enabled, ai_personalization_enabled',
      )
      .eq(
        'user_id',
        userId,
      )
      .maybeSingle();

  const memoryEnabled =
    settings?.ai_memory_enabled !==
    false;

  const personalizationEnabled =
    settings?.ai_personalization_enabled !==
    false;

  if (
    !memoryEnabled ||
    !personalizationEnabled
  ) {
    return {
      enabled: false,
      memories:
        [] as Array<
          Record<string, unknown>
        >,
    };
  }

  let query = supabase
    .from(
      'video_ai_memories',
    )
    .select(
      'id,memory_type,content,confidence,importance,use_count,last_used_at,project_id,expires_at',
    )
    .eq(
      'user_id',
      userId,
    )
    .eq(
      'is_active',
      true,
    )
    .order(
      'importance',
      {
        ascending: false,
      },
    )
    .order(
      'confidence',
      {
        ascending: false,
      },
    )
    .limit(16);

  if (projectId) {
    query = query.or(
      `project_id.is.null,project_id.eq.${projectId}`,
    );
  } else {
    query = query.is(
      'project_id',
      null,
    );
  }

  const { data } =
    await query;

  const now =
    Date.now();

  const memories = (
    Array.isArray(data)
      ? data
      : []
  ).filter(
    (memory) =>
      !memory.expires_at ||
      new Date(
        memory.expires_at,
      ).getTime() > now,
  );

  if (memories.length) {
    await Promise.all(
      memories.map(
        (memory) =>
          supabase
            .from(
              'video_ai_memories',
            )
            .update({
              last_used_at:
                new Date().toISOString(),
              use_count:
                Number(
                  memory.use_count ||
                    0,
                ) + 1,
            })
            .eq(
              'id',
              memory.id,
            )
            .eq(
              'user_id',
              userId,
            ),
      ),
    );
  }

  return {
    enabled: true,
    memories,
  };
}

function deriveExplicitMemory(
  prompt: string,
): {
  memoryType: string;
  content: string;
  importance: number;
} | null {
  const text = String(
    prompt || '',
  )
    .trim()
    .replace(/\s+/g, ' ');

  if (
    !text ||
    text.length < 8
  ) {
    return null;
  }

  const recurring =
    /\b(from now on|going forward|always|every time|for all my videos|for my videos|my default)\b/i.test(
      text,
    );

  const preference =
    /\b(i prefer|i like|i want|use|make it|keep it|my style|my preference)\b/i.test(
      text,
    );

  const correction =
    /^(no[,.!? ]|actually[,.!? ]|that's wrong|not like that|don't do that|do not do that)/i.test(
      text,
    ) ||
    /\b(don't|do not|never)\b/i.test(
      text,
    );

  if (
    !recurring &&
    !preference &&
    !correction
  ) {
    return null;
  }

  const memoryType =
    correction
      ? 'correction'
      : recurring
        ? 'recurring_instruction'
        : 'preference';

  const importance =
    correction ||
    recurring
      ? 0.85
      : 0.65;

  return {
    memoryType,
    content: text.slice(
      0,
      800,
    ),
    importance,
  };
}

async function rememberUserInstruction(
  supabase: Awaited<
    ReturnType<typeof createClient>
  >,
  userId: string,
  projectId:
    | string
    | null
    | undefined,
  prompt: string,
) {
  const candidate =
    deriveExplicitMemory(
      prompt,
    );

  if (!candidate) return;

  const { data: settings } =
    await supabase
      .from('user_settings')
      .select(
        'ai_memory_enabled, ai_personalization_enabled',
      )
      .eq(
        'user_id',
        userId,
      )
      .maybeSingle();

  if (
    settings?.ai_memory_enabled ===
      false ||
    settings?.ai_personalization_enabled ===
      false
  ) {
    return;
  }

  const { data: existing } =
    await supabase
      .from(
        'video_ai_memories',
      )
      .select(
        'id,confidence,importance,use_count',
      )
      .eq(
        'user_id',
        userId,
      )
      .eq(
        'memory_type',
        candidate.memoryType,
      )
      .eq(
        'content',
        candidate.content,
      )
      .limit(1)
      .maybeSingle();

  if (existing?.id) {
    await supabase
      .from(
        'video_ai_memories',
      )
      .update({
        confidence: Math.min(
          1,
          Math.max(
            Number(
              existing.confidence ||
                0.8,
            ),
            0.8,
          ) + 0.05,
        ),
        importance: Math.max(
          Number(
            existing.importance ||
              0.5,
          ),
          candidate.importance,
        ),
        use_count:
          Number(
            existing.use_count ||
              0,
          ) + 1,
        last_used_at:
          new Date().toISOString(),
        is_active: true,
        archived_at: null,
      })
      .eq(
        'id',
        existing.id,
      )
      .eq(
        'user_id',
        userId,
      );

    return;
  }

  await supabase
    .from(
      'video_ai_memories',
    )
    .insert({
      user_id: userId,
      project_id:
        projectId || null,
      memory_type:
        candidate.memoryType,
      content:
        candidate.content,
      metadata: {
        source:
          'explicit_user_instruction',
        captured_at:
          new Date().toISOString(),
      },
      confidence: 0.85,
      importance:
        candidate.importance,
      use_count: 1,
      is_active: true,
    });
}

type VideoAIClipVisionIndex = {
  clipId: string;
  fingerprint: string;
  sourceUrl: string;
  sourceDuration: number;
  trimStart: number;
  trimEnd: number;
  description: string;
  shotType: string;
  subjects: string[];
  visualTags: string[];
  textVisible: string[];
  composition: string;
  qualityNotes: string[];
  suggestedUse: string;
  frameTimes: number[];
  analyzedAt: string;
};

async function sha256Text(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadProjectVisionIndex(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, projectId?: string | null) {
  if (!projectId) return [] as VideoAIClipVisionIndex[];
  const { data } = await supabase.from('video_ai_clip_vision_index')
    .select('clip_id,fingerprint,source_url,source_duration,trim_start,trim_end,description,shot_type,subjects,visual_tags,text_visible,composition,quality_notes,suggested_use,frame_times,analyzed_at')
    .eq('user_id', userId).eq('project_id', projectId);
  return Array.isArray(data) ? data.map((row: any) => ({
    clipId: String(row.clip_id), fingerprint: String(row.fingerprint || ''), sourceUrl: String(row.source_url || ''),
    sourceDuration: Number(row.source_duration || 0), trimStart: Number(row.trim_start || 0), trimEnd: Number(row.trim_end || 0),
    description: String(row.description || ''), shotType: String(row.shot_type || ''),
    subjects: Array.isArray(row.subjects) ? row.subjects.map(String) : [],
    visualTags: Array.isArray(row.visual_tags) ? row.visual_tags.map(String) : [],
    textVisible: Array.isArray(row.text_visible) ? row.text_visible.map(String) : [],
    composition: String(row.composition || ''), qualityNotes: Array.isArray(row.quality_notes) ? row.quality_notes.map(String) : [],
    suggestedUse: String(row.suggested_use || ''), frameTimes: Array.isArray(row.frame_times) ? row.frame_times.map(Number).filter(Number.isFinite) : [],
    analyzedAt: String(row.analyzed_at || ''),
  })) : [];
}

async function updateProjectVisionIndex(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, projectId: string | null | undefined, project: Record<string, unknown>, visionFrames: NonNullable<AIJobInput['visionFrames']>) {
  if (!projectId || !visionFrames.length) return [] as VideoAIClipVisionIndex[];
  const clips = Array.isArray(project.clips) ? project.clips as Array<Record<string, unknown>> : [];
  const existing = await loadProjectVisionIndex(supabase, userId, projectId);
  const existingByClip = new Map(existing.map((item) => [item.clipId, item]));
  const framesByClip = new Map<string, typeof visionFrames>();
  for (const frame of visionFrames) {
    const list = framesByClip.get(frame.clipId) || [];
    list.push(frame);
    framesByClip.set(frame.clipId, list);
  }
  const candidates = clips.map((clip) => {
    const clipId = typeof clip.id === 'string' ? clip.id : '';
    const sourceUrl = typeof clip.src === 'string' ? clip.src : '';
    if (!clipId || !sourceUrl) return null;
    const sourceDuration = Math.max(0.1, Number(clip.sourceDuration) || 0.1);
    const trimStart = Math.max(0, Number(clip.trimStart) || 0);
    const trimEnd = Math.max(trimStart + 0.05, Number(clip.trimEnd) || sourceDuration);
    return { clipId, sourceUrl, sourceDuration, trimStart, trimEnd };
  }).filter(Boolean) as Array<{clipId:string;sourceUrl:string;sourceDuration:number;trimStart:number;trimEnd:number}>;
  const stale: typeof candidates = [];
  for (const item of candidates) {
    const fingerprint = await sha256Text(JSON.stringify([item.sourceUrl,item.sourceDuration,item.trimStart,item.trimEnd]));
    if (!existingByClip.has(item.clipId) || existingByClip.get(item.clipId)?.fingerprint !== fingerprint) stale.push(item);
  }
  if (!stale.length) return existing;
  const analysisFrames = stale.flatMap((item) => (framesByClip.get(item.clipId) || []).map((frame) => ({...frame, sourceUrl:item.sourceUrl}))).slice(0, 18);
  if (!analysisFrames.length) return existing;
  const schema = { type:'object', properties:{ clips:{ type:'array', items:{ type:'object', properties:{
    clipId:{type:'string'}, description:{type:'string'}, shotType:{type:'string'},
    subjects:{type:'array',items:{type:'string'}}, visualTags:{type:'array',items:{type:'string'}}, textVisible:{type:'array',items:{type:'string'}},
    composition:{type:'string'}, qualityNotes:{type:'array',items:{type:'string'}}, suggestedUse:{type:'string'},
  }, required:['clipId','description','shotType','subjects','visualTags','textVisible','composition','qualityNotes','suggestedUse']}}}, required:['clips']};
  const prompt = 'Analyze the attached representative video frames as a persistent visual index for a professional video editor.\n' +
    'Each frame is labeled with clipId and source time. Return ONE entry per represented clipId.\n' +
    'Describe only what is actually visible. Do not infer identity, location, brand, or intent without visual evidence.\n' +
    'Classify shotType with editing terminology. subjects must be concrete visible subjects. visualTags must be concise searchable concepts. textVisible must contain readable on-screen text or be empty.\n' +
    'composition describes framing/layout. qualityNotes mention visible blur, shake, exposure, focus, lighting, obstruction, etc. suggestedUse describes a possible editing role based only on visible content.\n\n' +
    'Frame manifest:\n' + JSON.stringify(analysisFrames.map((frame) => ({clipId:frame.clipId,time:frame.time,label:frame.label || ''})));
  const result = await geminiStructured(prompt, schema, process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite', analysisFrames.map((frame) => ({url:frame.dataUrl,type:'image' as const}))) as any;
  const analyzed = Array.isArray(result?.clips) ? result.clips : [];
  const now = new Date().toISOString();
  for (const item of stale) {
    const visual = analyzed.find((entry:any) => String(entry?.clipId) === item.clipId);
    if (!visual) continue;
    const fingerprint = await sha256Text(JSON.stringify([item.sourceUrl,item.sourceDuration,item.trimStart,item.trimEnd]));
    const frameTimes = (framesByClip.get(item.clipId) || []).map((frame) => Number(frame.time)).filter(Number.isFinite);
    await supabase.from('video_ai_clip_vision_index').upsert({
      user_id:userId, project_id:projectId, clip_id:item.clipId, fingerprint, source_url:item.sourceUrl,
      source_duration:item.sourceDuration, trim_start:item.trimStart, trim_end:item.trimEnd,
      description:String(visual.description || '').slice(0,2000), shot_type:String(visual.shotType || '').slice(0,200),
      subjects:Array.isArray(visual.subjects)?visual.subjects.map(String).slice(0,20):[],
      visual_tags:Array.isArray(visual.visualTags)?visual.visualTags.map(String).slice(0,30):[],
      text_visible:Array.isArray(visual.textVisible)?visual.textVisible.map(String).slice(0,20):[],
      composition:String(visual.composition || '').slice(0,1000),
      quality_notes:Array.isArray(visual.qualityNotes)?visual.qualityNotes.map(String).slice(0,20):[],
      suggested_use:String(visual.suggestedUse || '').slice(0,500), frame_times:frameTimes, analyzed_at:now,
      model:process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite', updated_at:now
    }, {onConflict:'project_id,clip_id'});
  }
  return loadProjectVisionIndex(supabase,userId,projectId);
}

export async function runVideoAI(
  input: AIJobInput,
): Promise<AIResult> {
  const supabase =
    await createClient();

  const { data: auth } =
    await supabase.auth.getUser();

  if (!auth.user) {
    throw new Error(
      'You must be signed in to use AI tools.',
    );
  }

  const operation =
    input.operation;

  if (
    operation ===
      'transcribe' ||
    operation ===
      'generate-captions'
  ) {
    if (
      !input.mediaUrl ||
      !/^https?:\/\//i.test(
        input.mediaUrl,
      )
    ) {
      throw new Error(
        'Select an imported video/audio clip first. AI transcription needs a saved studio-media URL.',
      );
    }

    const transcript =
      ASSEMBLY_KEY()
        ? await assemblyTranscript(
            input.mediaUrl,
            input.language,
          )
        : await groqTranscript(
            input.mediaUrl,
            input.language,
          );

    if (
      operation ===
      'transcribe'
    ) {
      return {
        operation,
        provider:
          ASSEMBLY_KEY()
            ? 'assemblyai'
            : 'groq',
        output:
          transcript,
      };
    }

    const captions =
      transcript.words.length
        ? buildCaptions(
            transcript.words as TranscriptWord[],
          )
        : [
            {
              id: 'caption-0',
              text:
                transcript.text,
              start: 0,
              end: 4,
              confidence: null,
              needsReview: true,
              speaker: null,
            },
          ];

    return {
      operation,
      provider:
        ASSEMBLY_KEY()
          ? 'assemblyai'
          : 'groq',
      output: {
        ...transcript,
        captions,
      },
    };
  }

  if (
    operation ===
    'remove-background'
  ) {
    if (
      !input.mediaUrl ||
      !/^https?:\/\//i.test(
        input.mediaUrl,
      )
    ) {
      throw new Error(
        'Select an imported image first. Background removal works on image media.',
      );
    }

    const mediaType =
      input.mediaType ||
      inferMediaType(
        input.mediaUrl,
      );

    if (
      mediaType !==
      'image'
    ) {
      throw new Error(
        'Background removal currently supports images only (JPG, PNG, or WebP). Video background removal needs a video-capable segmentation provider.',
      );
    }

    const output =
      await removeImageBackground(
        input.mediaUrl,
      );

    return {
      operation,
      provider:
        'remove.bg',
      output,
    };
  }

  if (
    operation ===
    'assistant'
  ) {
    const rawProject =
      input.project &&
      typeof input.project ===
        'object'
        ? (input.project as Record<
            string,
            unknown
          >)
        : {};

    const persistedVisionIndex = input.operation === 'assistant' && input.projectId && Array.isArray(input.visionFrames)
      ? await updateProjectVisionIndex(supabase, auth.user.id, input.projectId, rawProject, input.visionFrames)
      : await loadProjectVisionIndex(supabase, auth.user.id, input.projectId);

    const compactProject = {
      aspect:
        rawProject.aspect,

      canvas:
        rawProject.canvas,

      clips: Array.isArray(
        rawProject.clips,
      )
        ? rawProject.clips.map(
            (clip: any) => ({
              id: clip.id,
              name: clip.name,
              sourceDuration:
                clip.sourceDuration,
              trimStart:
                clip.trimStart,
              trimEnd:
                clip.trimEnd,
              speed: clip.speed,
              volume:
                clip.volume,
              muted:
                clip.muted,
              filter:
                clip.filter,
              effect:
                clip.effect,
              transitionIn:
                clip.transitionIn,

              transform:
                clip.transform
                  ? {
                      scale:
                        clip.transform
                          .scale,
                      scale_x:
                        clip.transform
                          .scale_x,
                      scale_y:
                        clip.transform
                          .scale_y,
                      offset_x:
                        clip.transform
                          .offset_x,
                      offset_y:
                        clip.transform
                          .offset_y,
                      rotation:
                        clip.transform
                          .rotation,
                      crop:
                        clip.transform
                          .crop,
                    }
                  : null,
            }),
          )
        : [],

      elements: Array.isArray(
        rawProject.elements,
      )
        ? rawProject.elements.map(
            (el: any) => ({
              id: el.id,
              kind: el.kind,
              content:
                typeof el.content ===
                'string'
                  ? el.content.slice(
                      0,
                      180,
                    )
                  : '',
              start: el.start,
              end: el.end,
              x: el.x,
              y: el.y,
              width:
                el.width,
              height:
                el.height,
              rotation:
                el.rotation,
              opacity:
                el.opacity,
            }),
          )
        : [],

      audio: Array.isArray(
        rawProject.audio,
      )
        ? rawProject.audio.map(
            (audio: any) => ({
              id: audio.id,
              name: audio.name,
              start:
                audio.start,
              trimStart:
                audio.trimStart,
              trimEnd:
                audio.trimEnd,
              volume:
                audio.volume,
              kind:
                audio.kind,
            }),
          )
        : [],
      tracks: Array.isArray(rawProject.tracks)
        ? rawProject.tracks.map((track: any) => ({
            id: track.id,
            name: track.name,
            kind: track.kind,
            order: track.order,
            muted: track.muted,
            locked: track.locked,
          }))
        : [],

      timeline: (() => {
        let cursor = 0;
        const clips = Array.isArray(rawProject.clips) ? rawProject.clips : [];
        return clips.map((clip: any, index: number) => {
          const sourceDuration = Math.max(0.1, Number(clip.sourceDuration) || 0.1);
          const sourceStart = Math.max(0, Math.min(sourceDuration - 0.1, Number(clip.trimStart) || 0));
          const sourceEnd = Math.max(sourceStart + 0.1, Math.min(sourceDuration, Number(clip.trimEnd) || sourceDuration));
          const speed = Math.max(0.05, Number(clip.speed) || 1);
          const duration = Math.max(0.1, (sourceEnd - sourceStart) / speed);
          const item = {
            index,
            clipId: clip.id,
            name: clip.name,
            trackId: clip.track_id || null,
            timelineStart: Number(cursor.toFixed(3)),
            timelineEnd: Number((cursor + duration).toFixed(3)),
            timelineDuration: Number(duration.toFixed(3)),
            sourceStart,
            sourceEnd,
            speed,
          };
          cursor += duration;
          return item;
        });
      })(),

    };

    const schema = {
      type: 'object',

      properties: {
        message: {
          type: 'string',
        },

        summary: {
          type: 'string',
        },

        actions: {
          type: 'array',

          items: {
            type: 'object',

            properties: {
              type: {
                type: 'string',
                enum: [
                  'set_clip_speed',
                  'set_clip_volume',
                  'set_clip_mute',
                  'set_clip_filter',
                  'set_clip_effect',
                  'set_clip_transition',
                  'trim_clip',
                  'transform_clip',
                  'set_clip_adjustments',
                  'fit_clip',
                  'set_aspect',
                  'delete_clip',
                  'duplicate_clip',
                  'generate_captions',
                  'transcribe',
                  'transform_element',
                  'set_element_opacity',
                  'set_keyframe',
                  'add_text_element',
                  'split_clip',
                  'reorder_clip',
                  'add_stock_video',
                  'add_library_audio',
                ],
              },

              // Optional fields are intentionally omitted when unused.
              // Gemini's generateContent responseSchema path used here expects
              // a single protobuf Schema type rather than JSON-Schema unions.
              clipId: {
                type: 'string',
              },

              elementId: {
                type: 'string',
              },

              // Primitive action values are returned as strings and normalized
              // server-side below. This keeps the Gemini schema valid while
              // preserving numbers and booleans for the editor executor.
              value: {
                type: 'string',
              },

              value2: {
                type: 'string',
              },

              object: {
                type: 'object',
              },
            },

            required: [
              'type',
            ],
          },
        },
      },

      required: [
        'message',
        'summary',
        'actions',
      ],
    };

    const memoryContext =
      await loadAIMemoryContext(
        supabase,
        auth.user.id,
        input.projectId,
      );

    const memoryText =
      memoryContext.memories.length
        ? memoryContext.memories
            .map(
              (memory) =>
                `- [${memory.memory_type}] ${String(
                  memory.content,
                ).slice(0, 800)}`,
            )
            .join('\n')
        : '(no saved AI memories)';

    const conversation =
      Array.isArray(
        input.conversation,
      )
        ? input.conversation.slice(
            -10,
          )
        : [];

    const conversationText =
      conversation
        .map((message) => {
          const actions =
            Array.isArray(
              message.actions,
            )
              ? ` Actions: ${JSON.stringify(
                  message.actions,
                ).slice(
                  0,
                  2400,
                )}`
              : '';

          return `${message.role.toUpperCase()}: ${String(
            message.text || '',
          ).slice(
            0,
            1800,
          )}${actions}`;
        })
        .join('\n');

    const prompt = `
You are the professional editing agent inside enotes Studio.

You are NOT a generic chatbot.

Your job is to understand the user's request, inspect the supplied project and media, and create real editor operations.

CRITICAL BEHAVIOR:

- Maintain conversation context.
- If the user says "it", "this", "that", "the suggestions", "do it", "implement it", or "apply that", resolve the meaning from the immediately preceding messages and actions.
- Never ask the user to repeat context that is already present.
- Inspect the supplied project state, timeline manifest, selected media, and attached visual frames.
- The attached frames are the visual ground truth for what each clip actually contains.
- Never invent IDs.
- Never claim an edit was performed unless you emit the corresponding action.
- Never merely explain how to do an edit when the requested operation is supported.
- Emit the actual operation.
- Prefer reversible, non-destructive edits.
- Never delete clips unless the user explicitly requests deletion.
- Use multiple actions when a professional result requires multiple changes.
- You may use up to 16 actions.
- Do not fabricate media or clip IDs.
- For action fields, omit optional fields when they are not needed.
- Primitive value/value2 fields are strings in the response format, but they represent the actual value: write numbers such as "1.25" and booleans as "true" or "false".

ADVERTISEMENT MODE:

For requests such as:
"make it an advertisement"
"turn this into an ad"
"make this a commercial"
"make a promotional video"

create a concrete commercial edit using the available footage.

Consider:

- stronger opening
- tighter pacing
- intentional clip ordering
- appropriate trimming
- readable headline
- CTA text
- professional transitions
- tasteful color treatment
- subtle motion/keyframes
- suitable aspect ratio
- social-friendly composition
- clear visual hierarchy

CINEMATIC MODE:

For requests such as:

"make it cinematic"
"cinematic"
"give it a cinematic look"

consider:

- color treatment
- contrast
- saturation
- exposure
- temperature
- vignette
- subtle grain
- pacing
- transitions
- crop/framing
- slow motion where appropriate
- keyframed camera movement

SOCIAL MODE:

For:

"make it social-ready"
"make this for TikTok"
"make this for Reels"
"make this for Shorts"

consider:

- 9:16
- strong opening
- readable text
- vertical framing
- tighter pacing
- captions when appropriate
- safe text placement
- emphasis on the first seconds

If the user explicitly allows extra footage, you may emit add_stock_video with a concise search query.

Do not claim stock footage was added unless the action is actually emitted.

ALLOWED ACTIONS:

set_clip_speed
value = 0.25..4

set_clip_volume
value = 0..1

set_clip_mute
value = boolean

set_clip_filter
value = filter name

set_clip_effect
value = effect name

set_clip_transition
value = transition type
value2 = duration

trim_clip
value = start
value2 = end

transform_clip
object = {
  offset_x,
  offset_y,
  scale,
  scale_x,
  scale_y,
  rotation
}

set_clip_adjustments
object = {
  brightness,
  contrast,
  saturate,
  hue,
  blur,
  sepia,
  grayscale,
  exposure,
  temperature,
  tint,
  vibrance,
  vignette,
  grain,
  sharpen
}

fit_clip
value = contain | cover

set_aspect
value =
original | 16:9 | 9:16 | 1:1 | 4:5 | 3:2 | 21:9

delete_clip
clipId

duplicate_clip
clipId

transform_element
object = {
  x,
  y,
  width,
  height,
  rotation,
  opacity
}

set_element_opacity
value = 0..1

set_keyframe
object = {
  property,
  t,
  value
}

add_text_element
object = {
  text,
  start,
  end,
  x,
  y,
  width,
  height,
  font_size,
  color,
  background,
  animation
}

split_clip
value = timeline seconds

reorder_clip
object = {
  fromIndex,
  toIndex
}

add_stock_video
object = {
  query,
  orientation
}

add_library_audio
object = {
  soundId,
  reason
}

AUDIO LIBRARY RULES:

- The supplied audio library is the ONLY library you may use.
- Never invent a sound ID.
- Do not add music, SFX, or audio merely because a project is an advertisement.
- Add library audio ONLY when the user explicitly asks for music, soundtrack, background music, SFX, sound effects, audio, or asks you to choose suitable music.
- When audio is explicitly requested, choose a library item whose title/category matches the request and whose commercial_use is true when the project is promotional/commercial.
- If no suitable library item exists, do not invent one and do not silently add unrelated audio.

CAPTIONS RULES:

- Do NOT generate captions for an advertisement unless the user explicitly asks for captions/subtitles/auto-captions.
- "Advertisement", "commercial", and "promotional" alone do NOT authorize captions.
- When captions are explicitly requested, emit generate_captions AND the application will turn the returned timed captions into real text overlays.

ADVERTISEMENT EXECUTION RULES:

- An advertisement request MUST produce actual visual hierarchy, not only color/effect changes.
- Unless the user explicitly says otherwise, include at least one strong headline text overlay and one CTA text overlay.
- Use the actual supplied footage first.
- If there are fewer than 2 usable clips, emit add_stock_video for one relevant B-roll shot. If there is only one very short clip, you may emit a second relevant B-roll shot.
- Do not add stock footage when the user explicitly says to use only their footage.
- Do not add library audio unless the audio rule above is satisfied.

Available audio library:
${JSON.stringify((input.audioLibrary || []).slice(0, 80))}

VISUAL PROJECT INSPECTION:
- Representative frames are supplied for the current clips. Use them to understand the actual footage.
- A clip's metadata tells you WHEN it occurs; its frames tell you WHAT it contains.
- Never substitute generic assumptions for visible evidence.
- When the user refers to "this clip", prioritize the selected clip's frames.
- When the user asks to edit the whole project, inspect the frames across the timeline before choosing an opening, hero shot, supporting shot, or closing shot.

Saved AI memory:

${memoryText}

Previous conversation:

${conversationText || '(none)'}

Current request:

${input.prompt || 'Suggest a useful improvement'}

Selection:

${JSON.stringify(
  input.selection || {},
)}

Project timeline and current state:

${JSON.stringify(
  compactProject,
)}

PERSISTENT CLIP VISUAL INDEX:
${JSON.stringify(persistedVisionIndex.slice(0, 80))}

Use the persistent visual index as the primary project-wide visual reference. It was generated from actual representative frames and persists between requests. If current frames are attached, use them to refine or verify the index. If the index and current frames disagree, prefer the current frames and treat the index as stale.

VISUAL INSPECTION FRAMES:
${JSON.stringify((input.visionFrames || []).slice(0, 18).map((frame) => ({
  clipId: frame.clipId,
  time: frame.time,
  label: frame.label || '',
})))}

The visual frames attached to this request are the actual representative frames extracted from the current project clips. Match each frame to its clipId/time above. Use what you can actually see in those frames when deciding clip order, trims, text placement, pacing, crop/framing, effects, and advertising structure. If a frame is unavailable or ambiguous, do not invent its contents.

TIMELINE RULES:
- Treat the timeline manifest as authoritative for clip order and timing.
- timelineStart/timelineEnd are project-time seconds; sourceStart/sourceEnd are source-media seconds.
- When suggesting a cut, trim, split, reorder, text cue, or keyframe, reason in project time and use the actual clip IDs.
- Respect existing overlays, audio, muted tracks, and current transforms.
- Do not describe a clip as a product/person/location unless the attached visual evidence supports that description.
`;

    const visionInputs = Array.isArray(input.visionFrames)
      ? input.visionFrames
          .filter((frame) => frame && typeof frame.dataUrl === 'string' && frame.dataUrl.startsWith('data:image/'))
          .slice(0, 18)
          .map((frame) => ({ url: frame.dataUrl, type: 'image' as const }))
      : [];

    const sourceInputs =
      Array.isArray(input.mediaUrls) && input.mediaUrls.length
        ? input.mediaUrls.slice(0, 6)
        : input.mediaUrl
          ? [{ url: input.mediaUrl, type: input.mediaType || 'video' }]
          : [];

    const mediaInputs = [...visionInputs, ...sourceInputs].slice(0, 18);

    let plan =
      await geminiStructured(
        prompt,
        schema,
        process.env.GEMINI_MODEL ||
          'gemini-3.5-flash-lite',
        mediaInputs.length
          ? mediaInputs
          : undefined,
      );

    if (
      !plan ||
      typeof plan !== 'object'
    ) {
      plan = {
        message:
          'I could not create a safe edit plan.',
        summary: '',
        actions: [],
      };
    }

    /*
     * Keep the server-side safety limit aligned
     * with the AI prompt.
     */
    const actions =
      Array.isArray(
        (plan as any).actions,
      )
        ? (plan as any).actions.slice(
            0,
            12,
          )
        : [];

    const validClipIds =
      new Set(
        compactProject.clips.map(
          (clip: any) =>
            clip.id,
        ),
      );

    const validElementIds =
      new Set(
        compactProject.elements.map(
          (element: any) =>
            element.id,
        ),
      );

    const selectedClipId =
      input.selection
        ?.clipId &&
      validClipIds.has(
        input.selection.clipId,
      )
        ? input.selection
            .clipId
        : compactProject
              .clips
              .length === 1
          ? compactProject
              .clips[0].id
          : null;

    const selectedElementId =
      input.selection
        ?.elementId &&
      validElementIds.has(
        input.selection
          .elementId,
      )
        ? input.selection
            .elementId
        : compactProject
              .elements
              .length === 1
          ? compactProject
              .elements[0].id
          : null;

    const clipActionTypes =
      new Set([
        'set_clip_speed',
        'set_clip_volume',
        'set_clip_mute',
        'set_clip_filter',
        'set_clip_effect',
        'set_clip_transition',
        'trim_clip',
        'transform_clip',
        'set_clip_adjustments',
        'fit_clip',
        'delete_clip',
        'duplicate_clip',
        'set_keyframe',
        'add_text_element',
        'split_clip',
        'reorder_clip',
      ]);

    const elementActionTypes =
      new Set([
        'transform_element',
        'set_element_opacity',
      ]);

    const normalizeAction = (action: any) => {
      const normalized = { ...action };

      const numericValueTypes = new Set([
        'set_clip_speed',
        'set_clip_volume',
        'set_clip_transition',
        'set_element_opacity',
        'split_clip',
      ]);

      const numericValue2Types = new Set([
        'set_clip_transition',
        'trim_clip',
      ]);

      const booleanValueTypes = new Set([
        'set_clip_mute',
      ]);

      if (numericValueTypes.has(normalized.type)) {
        const parsed = Number(normalized.value);
        normalized.value = Number.isFinite(parsed)
          ? parsed
          : normalized.value;
      }

      if (numericValue2Types.has(normalized.type)) {
        const parsed = Number(normalized.value2);
        normalized.value2 = Number.isFinite(parsed)
          ? parsed
          : normalized.value2;
      }

      if (booleanValueTypes.has(normalized.type)) {
        if (typeof normalized.value === 'string') {
          const lowered = normalized.value.trim().toLowerCase();
          if (lowered === 'true') normalized.value = true;
          if (lowered === 'false') normalized.value = false;
        }
      }

      return normalized;
    };

    const requestText = String(input.prompt || '').toLowerCase();
    const isAdvertisementRequest = /\b(advertisement|advertising|commercial|promotional video|promo video|promo)\b/i.test(requestText);
    const captionsExplicitlyRequested = /\b(captions?|subtitles?|subtitle|auto[- ]?captions?|closed captions?)\b/i.test(requestText);
    const audioExplicitlyRequested = /\b(music|soundtrack|background music|sfx|sound effects?|audio|song)\b/i.test(requestText);
    const useOnlyUserMedia = /\b(only|just)\b.{0,20}\b(my|our|the)\b.{0,20}\b(footage|clips?|media|videos?)\b/i.test(requestText);

    let plannedActions = actions.filter((action: any) => {
      if (!captionsExplicitlyRequested && (action.type === 'generate_captions' || action.type === 'transcribe')) return false;
      if (action.type === 'add_library_audio' && !audioExplicitlyRequested) return false;
      if (action.type === 'add_stock_video' && useOnlyUserMedia) return false;
      return true;
    });

    if (
      isAdvertisementRequest &&
      !useOnlyUserMedia &&
      compactProject.clips.length < 2 &&
      !plannedActions.some((action: any) => action.type === 'add_stock_video')
    ) {
      plannedActions.push({
        type: 'add_stock_video',
        object: {
          query: 'professional product lifestyle b-roll',
          orientation: compactProject.aspect === '9:16' || compactProject.aspect === '4:5' ? 'portrait' : 'landscape',
        },
      });
    }

    const adTextCount = plannedActions.filter((action: any) =>
      action.type === 'add_text_element' &&
      typeof action.object?.text === 'string' &&
      String(action.object.text).trim()
    ).length;

    if (isAdvertisementRequest && adTextCount < 2) {
      const duration = Math.max(3, Number(compactProject.clips.reduce((sum: number, clip: any) => sum + Math.max(0.1, (Number(clip.trimEnd) || 1) - (Number(clip.trimStart) || 0)) / Math.max(0.05, Number(clip.speed) || 1), 0)) || 6);
      plannedActions.push(
        {
          type: 'add_text_element',
          object: {
            text: 'YOUR BRAND',
            start: 0,
            end: Math.min(duration, 3),
            x: Number(compactProject.canvas?.width || 1080) * 0.08,
            y: Number(compactProject.canvas?.height || 1350) * 0.12,
            width: Number(compactProject.canvas?.width || 1080) * 0.84,
            height: 120,
            font_size: 64,
            color: '#FFFFFF',
            background: '#000000',
            animation: 'pop',
          },
        },
        {
          type: 'add_text_element',
          object: {
            text: 'LEARN MORE',
            start: Math.max(0, duration - 3),
            end: duration,
            x: Number(compactProject.canvas?.width || 1080) * 0.12,
            y: Number(compactProject.canvas?.height || 1350) * 0.78,
            width: Number(compactProject.canvas?.width || 1080) * 0.76,
            height: 100,
            font_size: 52,
            color: '#FFFFFF',
            background: '#E5798F',
            animation: 'slide-up',
          },
        },
      );
    }

    const sanitizedActions =
      plannedActions
        .map(normalizeAction)
        .map((action: any) => ({
          ...action,

          clipId:
            action.clipId &&
            validClipIds.has(
              action.clipId,
            )
              ? action.clipId
              : selectedClipId,

          elementId:
            action.elementId &&
            validElementIds.has(
              action.elementId,
            )
              ? action.elementId
              : selectedElementId,
        }))
        .filter(
          (action: any) =>
            action.type ===
              'set_aspect' ||
            action.type ===
              'generate_captions' ||
            action.type ===
              'transcribe' ||
            action.type ===
              'add_stock_video' ||
            action.type ===
              'add_library_audio' ||
            (
              clipActionTypes.has(
                action.type,
              ) &&
              (
                action.type ===
                  'add_text_element' ||
                action.type ===
                  'split_clip' ||
                action.type ===
                  'reorder_clip' ||
                validClipIds.has(
                  action.clipId,
                )
              )
            ) ||
            (
              elementActionTypes.has(
                action.type,
              ) &&
              validElementIds.has(
                action.elementId,
              )
            ),
        )
        .slice(0, 16);

    let captions: unknown[] =
      [];

    let transcript: unknown =
      null;

    if (
      sanitizedActions.some(
        (action: any) =>
          action.type ===
            'generate_captions' ||
          action.type ===
            'transcribe',
      )
    ) {
      if (
        !input.mediaUrl ||
        !/^https?:\/\//i.test(
          input.mediaUrl,
        )
      ) {
        throw new Error(
          'Select an imported video or audio clip first so I can generate accurate captions.',
        );
      }

      const transcriptResult =
        ASSEMBLY_KEY()
          ? await assemblyTranscript(
              input.mediaUrl,
              input.language,
            )
          : await groqTranscript(
              input.mediaUrl,
              input.language,
            );

      transcript =
        transcriptResult;

      if (
        sanitizedActions.some(
          (action: any) =>
            action.type ===
            'generate_captions',
        )
      ) {
        captions =
          transcriptResult
            .words.length
            ? buildCaptions(
                transcriptResult.words as TranscriptWord[],
              )
            : [
                {
                  id: 'caption-0',
                  text:
                    transcriptResult.text,
                  start: 0,
                  end: 4,
                  confidence:
                    null,
                  needsReview:
                    true,
                  speaker:
                    null,
                },
              ];
      }
    }

    await rememberUserInstruction(
      supabase,
      auth.user.id,
      input.projectId,
      input.prompt || '',
    );

    return {
      operation,
      provider:
        'gemini' +
        (
          captions.length
            ? ' + ' +
              (ASSEMBLY_KEY()
                ? 'assemblyai'
                : 'groq')
            : ''
        ),

      output: {
        message: String(
          (plan as any)
            .message ||
            'I prepared an edit plan.',
        ),

        summary: String(
          (plan as any)
            .summary || '',
        ),

        actions:
          sanitizedActions,

        captions,

        transcript,

        captionCount:
          captions.length,

        reviewCount:
          captions.filter(
            (caption: any) =>
              caption?.needsReview,
          ).length,

        memoryUsed:
          memoryContext
            .memories.length,
      },
    };
  }

  if (
    operation ===
    'analyze'
  ) {
    const project =
      JSON.stringify(
        input.project || {},
      ).slice(0, 30000);

    const prompt = `
You are the AI editor inside a professional mobile-first video editor.

Analyze this project JSON and return STRICT JSON with:

summary
pacing
audio
visual
text
recommendations

recommendations must be an array of objects with:

title
reason
action

Do not invent media.

Project:

${project}
`;

    const result =
      await geminiText(
        prompt,
      );

    return {
      operation,
      provider:
        'gemini',
      output:
        parseJson(result),
    };
  }

  throw new Error(
    `${operation} is ready in the AI provider layer, but no execution adapter is configured yet. Set AI_DEFAULT_PROVIDER and the matching provider key to enable it.`,
  );
}

export async function createAIJob(
  input: AIJobInput,
) {
  const supabase =
    await createClient();

  const { data: auth } =
    await supabase.auth.getUser();

  if (!auth.user) {
    throw new Error(
      'You must be signed in.',
    );
  }

  const { data, error } =
    await supabase
      .from('video_ai_jobs')
      .insert({
        user_id:
          auth.user.id,

        project_id:
          input.projectId ||
          null,

        operation:
          input.operation,

        provider:
          process.env
            .AI_DEFAULT_PROVIDER ||
          'auto',

        status:
          'processing',

        input: {
          mediaUrl:
            input.mediaUrl ||
            null,

          prompt:
            input.prompt ||
            null,

          language:
            input.language ||
            null,

          mediaType:
            input.mediaType ||
            null,

          selection:
            input.selection ||
            null,
        },
      })
      .select('id')
      .single();

  if (error) {
    throw new Error(
      error.message,
    );
  }

  return {
    id: data.id,
    userId:
      auth.user.id,
  };
}

export async function finishAIJob(
  id: string,
  patch: {
    status: string;
    output?: unknown;
    error?: string | null;
  },
) {
  const supabase =
    await createClient();

  await supabase
    .from(
      'video_ai_jobs',
    )
    .update({
      status:
        patch.status,

      output:
        patch.output ??
        null,

      error:
        patch.error ??
        null,

      completed_at:
        patch.status ===
          'completed' ||
        patch.status ===
          'failed'
          ? new Date().toISOString()
          : null,
    })
    .eq(
      'id',
      id,
    );
}
