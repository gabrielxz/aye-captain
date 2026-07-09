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

// Whisper-style vocabulary bias: a prompt of in-domain phrases nudges the
// model toward this jargon. Refine from data/utterances.jsonl once real
// players have talked to it.
const STT_BIAS_PROMPT =
  "Naval space-combat voice commands: ahead full, all stop, hard to port, " +
  "hard to starboard, come to heading zero four five, two seven zero, " +
  "fire the laser, launch missile, deploy decoy, standing order, belay that, " +
  "evasive maneuvers, drone, contact, bearing, thrust one hundred percent, " +
  "come about, point at him, weapons free.";

export async function transcribe(audio: Buffer, mime: string): Promise<string> {
  const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `utterance.${ext}`);
  form.append("model", model());
  form.append("language", "en");
  form.append("temperature", "0");
  form.append("prompt", STT_BIAS_PROMPT);
  form.append("response_format", "json");

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
  const data = (await resp.json()) as { text?: string };
  return (data.text ?? "").trim();
}
