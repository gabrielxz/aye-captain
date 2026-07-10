// Ship-AI voice via ElevenLabs, all server-side. Lines are cached on disk
// keyed by hash(voice|model|text): stock lines are pre-generated once at
// boot; novel acknowledgements synthesize on first use. Without a key the
// game runs silent (text transcript unchanged).
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as C from "./constants.js";

function apiKey(): string {
  return process.env.ELEVENLABS_API_KEY ?? "";
}

export function ttsAvailable(): boolean {
  return !!apiKey();
}

// On Fly this must live on the volume (SPEECH_CACHE_DIR=/data/speech) or the
// cache regenerates every deploy.
function cacheDir(): string {
  return process.env.SPEECH_CACHE_DIR ?? path.join(process.cwd(), "data", "speech");
}

export function speechId(text: string): string {
  return createHash("sha1").update(`${C.VOICE_ID}|${C.TTS_MODEL}|${text}`).digest("hex");
}

const pending = new Map<string, Promise<Buffer | null>>();

async function synthesize(text: string): Promise<Buffer> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${C.VOICE_ID}/stream?output_format=mp3_22050_32`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": apiKey(), "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: C.TTS_MODEL }),
    signal: AbortSignal.timeout(C.TTS_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const detail = (await resp.text().catch(() => "")).slice(0, 150);
    throw new Error(`TTS ${resp.status}: ${detail}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

// Kick off (or join) generation for a line; returns its speech id right away
// so the transcript message can carry it. GET /speech/:id awaits the result.
export function ensureSpeech(text: string): string | null {
  if (!ttsAvailable()) return null;
  const id = speechId(text);
  if (pending.has(id)) return id;
  const file = path.join(cacheDir(), `${id}.mp3`);
  const p = (async (): Promise<Buffer | null> => {
    try {
      return await readFile(file); // cache hit
    } catch {
      /* miss — synthesize */
    }
    try {
      const buf = await synthesize(text);
      await mkdir(cacheDir(), { recursive: true });
      await writeFile(file, buf);
      return buf;
    } catch (err) {
      console.error("tts error:", err instanceof Error ? err.message : err);
      return null;
    }
  })();
  pending.set(id, p);
  // keep the in-flight promise around briefly so fetches that raced the
  // write can still await it; afterwards the disk cache serves
  void p.finally(() => setTimeout(() => pending.delete(id), 30_000));
  return id;
}

export async function getSpeech(id: string): Promise<Buffer | null> {
  if (!/^[0-9a-f]{40}$/.test(id)) return null; // ids are sha1 hex — no paths
  const p = pending.get(id);
  if (p) {
    const buf = await p;
    if (buf) return buf;
  }
  try {
    return await readFile(path.join(cacheDir(), `${id}.mp3`));
  } catch {
    return null;
  }
}

// Fixed lines the sim emits verbatim — generated once, then disk-cached
// forever. Dynamic lines (bearings, hull numbers, novel acks) synthesize at
// runtime; the translator keeps them short (<= 12 words).
const STOCK_LINES = [
  "Aye, Captain.",
  "Say again, Captain?",
  "Acquiring missile lock...",
  "Lock acquired.",
  "Lock lost.",
  "Captain, we're being painted — missile lock in progress!",
  "They have lock!",
  "Enemy lock is off us.",
  "No lock, Captain.",
  "Tube one reloading.",
  "Tube two reloading.",
  "Tube one ready.",
  "Tube two ready.",
  "Magazine dry, Captain.",
  "Tubes are still loading, Captain.",
  "Propellant at one-half.",
  "Propellant at one-quarter, Captain.",
  "Propellant critical — ten percent.",
  "Tanks dry — we're adrift.",
  "Contact lost — off sensors.",
  "Missile destroyed — good shooting.",
  "They've shot down our missile.",
  "Decoy destroyed.",
  "They've burned down our decoy.",
  "Their missile took the decoy.",
  "Missile detonated — it was a decoy.",
  "Direct hit on the enemy ship.",
  "Missile strike on the enemy ship!",
  "Laser fired — clean miss.",
  "Captain, we've left the shroud — we're visible to the enemy and our sensors are degraded.",
  "Back inside the shroud, Captain. Sensor cover restored.",
  "Drive failure at the shroud's absolute edge — we can't push any further out, Captain.",
  "Enemy ship destroyed. Well fought, Captain.",
  "Hull breach — we're done. Abandon ship.",
];

// Sequential on purpose: ElevenLabs free/low tiers have tight concurrency
// caps. Runs in the background at boot; failures are non-fatal.
export async function pregenStockLines(): Promise<void> {
  if (!ttsAvailable()) return;
  let made = 0;
  for (const line of STOCK_LINES) {
    const id = ensureSpeech(line);
    if (id) {
      await pending.get(id);
      made++;
    }
  }
  console.log(`tts: stock lines ready (${made}/${STOCK_LINES.length})`);
}
