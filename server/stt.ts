// Server-side speech-to-text via an OpenAI-compatible /audio/transcriptions
// endpoint. Defaults to Groq-hosted Whisper; point STT_BASE_URL/STT_MODEL at
// api.openai.com (or any compatible host) to switch providers.
import * as C from "./constants.js";

function apiKey(): string {
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

function baseUrl(): string {
  return (
    process.env.STT_BASE_URL ??
    (openaiFallback() ? "https://api.openai.com/v1" : "https://api.groq.com/openai/v1")
  );
}

function model(): string {
  return (
    process.env.STT_MODEL ??
    (openaiFallback() ? "gpt-4o-mini-transcribe" : "whisper-large-v3-turbo")
  );
}

export function sttAvailable(): boolean {
  return !!apiKey();
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

export async function transcribe(audio: Buffer, mime: string): Promise<string> {
  const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `utterance.${ext}`);
  form.append("model", model());
  form.append("language", "en");
  form.append("temperature", "0");
  form.append("response_format", "verbose_json");

  const resp = await fetch(`${baseUrl()}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
    signal: AbortSignal.timeout(C.STT_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const detail = (await resp.text().catch(() => "")).slice(0, 200);
    throw new Error(`STT ${resp.status}: ${detail}`);
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
