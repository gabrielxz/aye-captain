// Server-side speech-to-text via OpenAI-compatible /audio/transcriptions
// endpoints. Defaults to Groq-hosted Whisper; point STT_BASE_URL/STT_MODEL at
// api.openai.com (or any compatible host) to switch providers. A secondary
// provider (STT_FALLBACK_API_KEY, + optional STT_FALLBACK_BASE_URL /
// STT_FALLBACK_MODEL, defaulting to OpenAI whisper-1) absorbs overflow when
// the primary is rate-limited — one 8-captain room shares the primary's
// per-org request budget, so multiplayer bursts NEED somewhere to spill.
import * as C from "./constants.js";

interface Provider {
  name: string;
  key: string;
  baseUrl: string;
  model: string;
  window: RateWindow | null; // null = no known request budget
}

function primaryKey(): string {
  return (
    process.env.STT_API_KEY ??
    process.env.GROQ_API_KEY ??
    process.env.OPENAI_API_KEY ??
    ""
  );
}

// If the only key present is OpenAI's, aim at OpenAI by default.
function openaiFallback(): boolean {
  return (
    !process.env.STT_API_KEY &&
    !process.env.GROQ_API_KEY &&
    !!process.env.OPENAI_API_KEY
  );
}

export function sttAvailable(): boolean {
  return !!primaryKey();
}

// Sliding-window request budget. reserve() books a dispatch slot and returns
// how long to wait for it (reservation-style so concurrent callers can't
// oversubscribe a slot between check and dispatch); peek() prices a slot
// without booking. penalize() sits the provider down after a 429.
export class RateWindow {
  private stamps: number[] = [];
  private blockedUntil = 0;
  constructor(private limit: number) {}

  peek(now: number): number {
    this.prune(now);
    let at = now;
    if (this.stamps.length >= this.limit) {
      at = this.stamps[this.stamps.length - this.limit] + 60_000;
    }
    return Math.max(at, this.blockedUntil) - now;
  }

  reserve(now: number): number {
    const wait = this.peek(now);
    this.stamps.push(now + wait); // monotone: peek() never yields an earlier slot
    return wait;
  }

  penalize(now: number, ms: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, now + ms);
  }

  private prune(now: number): void {
    while (this.stamps.length > 0 && this.stamps[0] <= now - 60_000) this.stamps.shift();
  }
}

function rpmLimit(): number {
  const env = Number(process.env.STT_RPM);
  return Number.isFinite(env) && env > 0 ? env : C.STT_RPM_LIMIT;
}

let providers: Provider[] | null = null;

function getProviders(): Provider[] {
  if (providers) return providers;
  providers = [];
  if (primaryKey()) {
    providers.push({
      name: "primary",
      key: primaryKey(),
      baseUrl:
        process.env.STT_BASE_URL ??
        (openaiFallback() ? "https://api.openai.com/v1" : "https://api.groq.com/openai/v1"),
      model:
        process.env.STT_MODEL ??
        (openaiFallback() ? "gpt-4o-mini-transcribe" : "whisper-large-v3-turbo"),
      window: new RateWindow(rpmLimit()),
    });
  }
  if (process.env.STT_FALLBACK_API_KEY) {
    providers.push({
      name: "fallback",
      key: process.env.STT_FALLBACK_API_KEY,
      baseUrl: process.env.STT_FALLBACK_BASE_URL ?? "https://api.openai.com/v1",
      model: process.env.STT_FALLBACK_MODEL ?? "whisper-1",
      window: null,
    });
  }
  return providers;
}

// Thrown when every provider is saturated — the captain should just re-key
// the mic, not stare at a mystery 502.
export class SttBusyError extends Error {
  constructor() {
    super("voice channel saturated");
  }
}

// NOTE: no vocabulary-bias prompt. Whisper prompt biasing measurably
// increases hallucination on marginal audio (quiet mics, game-audio bleed),
// which fabricates commands — worse than mishearing. The translator prompt
// already interprets phonetic mistakes; reintroduce boosting data-driven
// (from data/utterances.jsonl) only with the confidence filter below proven.

interface WhisperSegment {
  text: string;
  start?: number;
  end?: number;
  no_speech_prob?: number;
  avg_logprob?: number;
}

// Whole-transcript hallucination phrases: what Whisper invents for
// silence/noise. Only dropped when they are the ENTIRE transcript — none is
// ever a meaningful ship command on its own.
const HALLUCINATION_PHRASES = new Set([
  "thank you", "thank you.", "thanks for watching", "thanks for watching.",
  "thank you for watching", "thank you for watching.", "please subscribe",
  "so", "so,", "you", "bye", "bye.", ".", "the end", "the end.",
]);

// Groq's turbo Whisper reports no_speech_prob=0 even for pure-silence
// hallucinations, so confidence stats are useless. The reliable tell:
// hallucinated segments span the model's whole 30s window instead of the
// clip's real duration (verified: 2.5s of silence -> segment end 29.98).
function filterSegments(segments: WhisperSegment[], durationS: number): string {
  const text = segments
    .filter((s) => durationS <= 0 || (s.end ?? 0) <= durationS + 2)
    .map((s) => s.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (HALLUCINATION_PHRASES.has(text.toLowerCase())) return "";
  return text;
}

function retryAfterMs(resp: Response): number {
  const s = Number(resp.headers.get("retry-after"));
  if (Number.isFinite(s) && s > 0) return Math.ceil(s * 1000);
  return C.STT_429_PENALTY_MS;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function requestTranscription(p: Provider, audio: Buffer, mime: string): Promise<string> {
  const ext = mime.includes("wav")
    ? "wav"
    : mime.includes("mp4")
      ? "m4a"
      : mime.includes("ogg")
        ? "ogg"
        : mime.includes("mpeg")
          ? "mp3"
          : "webm";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `utterance.${ext}`);
  form.append("model", p.model);
  form.append("language", "en");
  form.append("temperature", "0");
  // Only whisper-family models return segment timestamps (and gpt-4o-*
  // transcribe rejects verbose_json outright); the silence-hallucination
  // filter needs them, so ask when the model can answer.
  const wantSegments = p.model.includes("whisper");
  form.append("response_format", wantSegments ? "verbose_json" : "json");

  const resp = await fetch(`${p.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${p.key}` },
    body: form,
    signal: AbortSignal.timeout(C.STT_TIMEOUT_MS),
  });
  if (!resp.ok) {
    if (resp.status === 429) p.window?.penalize(Date.now(), retryAfterMs(resp));
    const detail = (await resp.text().catch(() => "")).slice(0, 200);
    throw new Error(`STT ${resp.status} (${p.name}): ${detail}`);
  }
  const data = (await resp.json()) as {
    text?: string;
    duration?: number;
    segments?: WhisperSegment[];
  };
  if (Array.isArray(data.segments)) {
    return filterSegments(data.segments, Number(data.duration ?? 0));
  }
  return (data.text ?? "").trim();
}

export async function transcribe(audio: Buffer, mime: string): Promise<string> {
  const chain = getProviders();
  if (chain.length === 0) throw new Error("no STT key configured");

  let lastErr: unknown = null;
  for (const p of chain) {
    const wait = p.window?.peek(Date.now()) ?? 0;
    if (wait > C.STT_MAX_QUEUE_DELAY_MS) continue; // saturated — spill to the next provider
    if (p.window) {
      const booked = p.window.reserve(Date.now());
      if (booked > 0) await sleep(booked);
    }
    try {
      return await requestTranscription(p, audio, mime);
    } catch (err) {
      lastErr = err; // 429/timeout/network: fall through to the next provider
    }
  }
  if (lastErr) throw lastErr;
  throw new SttBusyError();
}
