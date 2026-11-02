// KG Chart 🎙️ pronunciation check: the logic of the kg-pronounce Edge Function (design: docs/pronunciation-design.md).
// No imports here, so it can be tested outside Supabase with fake Azure / Supabase (index.ts wires the real ones).
//
// POST (with the learner's login token):
//   { lang, text, audio: base64 WAV (16 kHz mono PCM), vocabulary_id?, sentence_id?, source?: 'word' | 'speak_lines' }
// → 200 { ok: true, score, accuracy, fluency, completeness, words: [{ w, accuracy, error }], used, limit }
//   200 { ok: false, reason: 'no_speech' }            nothing recognised (not counted)
//   4xx/5xx { ok: false, reason, message }             reason: auth | not_allowed | bad_request | limit | azure_slow | azure | config
// GET ?check=1 (no login needed) → { ok, configured }   says whether the Azure secrets are set, never their values.

export const LOCALES: Record<string, string> = {
  my: 'my-MM', ja: 'ja-JP', zh: 'zh-CN', si: 'si-LK', ko: 'ko-KR', ta: 'ta-IN',
  th: 'th-TH', ms: 'ms-MY', mr: 'mr-IN', kn: 'kn-IN', te: 'te-IN',
};
export const MAX_TEXT = 300;          // characters of reference text
export const MAX_WAV = 1_000_000;     // bytes: ~31 s of 16 kHz 16-bit mono
export const MIN_WAV = 44 + 16000;    // header + 0.5 s
export const AZURE_TIMEOUT_MS = 45_000;
export const DEFAULT_LIMIT = 100;

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (status: number, reason: string, message: string) => json(status, { ok: false, reason, message });

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const bytesToBase64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

// RIFF/WAVE, PCM, mono, 16 kHz, 16-bit: what the app sends and what Azure short audio wants
export function checkWav(b: Uint8Array): string | null {
  if (b.length < MIN_WAV) return 'Recording too short (under half a second).';
  if (b.length > MAX_WAV) return 'Recording too long (30 seconds at most).';
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return 'Not a WAV recording.';
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // first chunk after WAVE must be "fmt " for the files the app makes
  if (tag(12) !== 'fmt ') return 'Unexpected WAV layout.';
  const format = v.getUint16(20, true), channels = v.getUint16(22, true), rate = v.getUint32(24, true), bits = v.getUint16(34, true);
  if (format !== 1 || channels !== 1 || rate !== 16000 || bits !== 16) return 'WAV must be 16 kHz, 16-bit, mono PCM.';
  return null;
}

// Burmese is written without spaces between words, but Azure scores Burmese per syllable and can't line up a
// sentence sent as one block (owner's test 2 Nov: ဘာလိုချင်လဲ as is → 0, as "ဘာ လို ချင် လဲ" → 99).
// So Burmese reference text gets a space between syllables. A syllable starts at a consonant (or independent vowel)
// that isn't killed by ် (also when ့ sits before it) and isn't stacked (္). Same rule as tools/try_pronunciation.py.
export function burmeseSyllables(text: string): string {
  const chars = Array.from(text.normalize('NFC'));
  let out = '';
  chars.forEach((ch, i) => {
    let j = i + 1;
    while (j < chars.length && chars[j] === '့') j++;
    const nxt = chars[j] || '', prev = chars[i - 1] || '';
    const starts = ((ch >= 'က' && ch <= 'အ') || (ch >= 'ဣ' && ch <= 'ဪ') || ch === 'ဿ')
      && nxt !== '်' && nxt !== '္' && prev !== '္';
    if (starts && out && !out.endsWith(' ')) out += ' ';
    out += ch;
  });
  return out.replace(/\s+/g, ' ').trim();
}
// The text Azure is asked to score (the saved row keeps the text as shown)
export const referenceFor = (lang: string, text: string) => (lang === 'my' ? burmeseSyllables(text) : text);

type Pa = { AccuracyScore?: number; FluencyScore?: number; CompletenessScore?: number; PronScore?: number; ErrorType?: string };
const r = (x: unknown) => (typeof x === 'number' && isFinite(x) ? Math.max(0, Math.min(100, Math.round(x))) : null);

// Azure replies put the scores either under PronunciationAssessment or directly on the item: accept both
export function parseAzure(data: any) {
  if (!data || data.RecognitionStatus !== 'Success') return { status: (data && data.RecognitionStatus) || 'Unknown' };
  const best = (data.NBest && data.NBest[0]) || {};
  const pa: Pa = best.PronunciationAssessment || best;
  if (pa.PronScore === undefined && pa.AccuracyScore === undefined) return { status: 'NoScore' };
  const words = (best.Words || []).map((w: any) => {
    const p: Pa = w.PronunciationAssessment || w;
    return { w: String(w.Word || ''), accuracy: r(p.AccuracyScore), error: p.ErrorType || 'None' };
  });
  return {
    status: 'Success',
    score: r(pa.PronScore ?? pa.AccuracyScore), accuracy: r(pa.AccuracyScore),
    fluency: r(pa.FluencyScore), completeness: r(pa.CompletenessScore), words,
  };
}

export type Deps = {
  env: (k: string) => string | undefined;
  fetch: typeof fetch;
  // user client: built with the caller's Authorization header (RLS applies). admin client: service role.
  userClient: (authHeader: string) => any;
  adminClient: () => any;
  now?: () => Date;
};

async function callAzure(deps: Deps, wav: Uint8Array, locale: string, text: string) {
  const key = deps.env('AZURE_SPEECH_KEY')!, region = deps.env('AZURE_SPEECH_REGION')!;
  const params = { ReferenceText: text, GradingSystem: 'HundredMark', Granularity: 'Word', Dimension: 'Comprehensive', EnableMiscue: 'True' };
  const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${locale}&format=detailed`;
  let last = 'azure';
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), AZURE_TIMEOUT_MS);
    try {
      const res = await deps.fetch(url, {
        method: 'POST', signal: ac.signal, body: wav,
        headers: {
          'Ocp-Apim-Subscription-Key': key, Accept: 'application/json',
          'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
          'Pronunciation-Assessment': bytesToBase64(JSON.stringify(params)),
        },
      });
      if (res.status === 429 || res.status >= 500) { last = 'azure_slow'; continue; }   // busy: one retry
      if (!res.ok) return { error: 'azure', message: `Azure answered ${res.status}.` };
      return { data: await res.json() };
    } catch (_e) {
      last = 'azure_slow';                                                          // timed out / network: one retry
    } finally {
      clearTimeout(timer);
    }
  }
  return { error: last, message: last === 'azure_slow' ? 'Azure is slow right now. Try again.' : 'Azure could not be reached.' };
}

export function makeHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    const configured = !!(deps.env('AZURE_SPEECH_KEY') && deps.env('AZURE_SPEECH_REGION'));
    if (req.method === 'GET') return json(200, { ok: true, configured });
    if (req.method !== 'POST') return fail(405, 'bad_request', 'POST only.');
    if (!configured) return fail(500, 'config', 'The pronunciation check is not set up yet (Azure secrets missing).');

    // 1. who is asking
    const auth = req.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) return fail(401, 'auth', 'Please sign in.');
    const userDb = deps.userClient(auth);
    const { data: u, error: uErr } = await userDb.auth.getUser(auth.slice(7));
    const user = u && u.user;
    if (uErr || !user) return fail(401, 'auth', 'Please sign in again.');
    const { data: allowed } = await userDb.rpc('kg_chart_is_allowed');
    if (allowed !== true) return fail(403, 'not_allowed', 'This account is not allowed to use the app.');

    // 2. what to check
    let body: any;
    try { body = await req.json(); } catch (_e) { return fail(400, 'bad_request', 'Expected JSON.'); }
    const locale = LOCALES[body && body.lang];
    const text = typeof body?.text === 'string' ? body.text.normalize('NFC').trim() : '';
    if (!locale) return fail(400, 'bad_request', 'Unknown language.');
    if (!text || text.length > MAX_TEXT) return fail(400, 'bad_request', 'Nothing to check, or the text is too long.');
    const uuid = (x: unknown) => (typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x) ? x : null);
    const vocabulary_id = uuid(body.vocabulary_id), sentence_id = vocabulary_id ? null : uuid(body.sentence_id);
    const source = body.source === 'speak_lines' ? 'speak_lines' : 'word';
    let wav: Uint8Array;
    try { wav = base64ToBytes(String(body.audio || '')); } catch (_e) { return fail(400, 'bad_request', 'The recording could not be read.'); }
    const wavProblem = checkWav(wav);
    if (wavProblem) return fail(400, 'bad_request', wavProblem);

    // 3. daily limit (checks since midnight UTC)
    const admin = deps.adminClient();
    const { data: lim } = await admin.from('kg_chart_settings').select('value').eq('key', 'pronunciation_daily_limit').maybeSingle();
    const limit = Number.isInteger(lim?.value) && lim.value > 0 ? lim.value : DEFAULT_LIMIT;
    const now = deps.now ? deps.now() : new Date();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const { count } = await admin.from('kg_chart_pronunciation_attempts').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).gte('created_at', dayStart);
    const used = count || 0;
    if (used >= limit) return fail(429, 'limit', `That's ${limit} checks today, the daily limit. More tomorrow.`);

    // 4. Azure
    const az = await callAzure(deps, wav, locale, referenceFor(body.lang, text));
    if ('error' in az) return fail(az.error === 'azure_slow' ? 503 : 502, az.error!, az.message!);
    const p = parseAzure(az.data);
    if (p.status !== 'Success') return json(200, { ok: false, reason: 'no_speech', message: "Didn't catch that. Try again, a little louder." });

    // 5. keep the scores (never the audio)
    const row = {
      user_id: user.id, language_code: body.lang, vocabulary_id, sentence_id, source, reference_text: text,
      score: p.score, accuracy: p.accuracy, fluency: p.fluency, completeness: p.completeness, words: p.words,
    };
    const { error: insErr } = await admin.from('kg_chart_pronunciation_attempts').insert(row);
    if (insErr) console.error('kg-pronounce: could not save', insErr.message);
    return json(200, { ok: true, score: p.score, accuracy: p.accuracy, fluency: p.fluency, completeness: p.completeness,
      words: p.words, used: used + 1, limit, saved: !insErr });
  };
}
