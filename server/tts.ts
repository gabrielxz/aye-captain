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

// ElevenLabs low tiers cap CONCURRENT syntheses (an 8-player room's burst of
// dynamic acks tripped concurrent_limit_exceeded) — synth calls take a slot
// here; waiters re-check on every release until one frees up.
let synthSlots = 0;
let synthQueue: Promise<void> = Promise.resolve();

async function withSynthSlot<T>(fn: () => Promise<T>): Promise<T> {
  while (synthSlots >= C.TTS_MAX_CONCURRENT) await synthQueue;
  synthSlots++;
  let release!: () => void;
  synthQueue = new Promise((r) => (release = r));
  try {
    return await fn();
  } finally {
    synthSlots--;
    release();
  }
}

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
      const buf = await withSynthSlot(() => synthesize(text));
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
  // campaign "Deep Black"
  "Deep black, Captain. The gate's on the board and the clock is running.",
  ...C.CAMPAIGN_LADDER.map((r) => r.spawnLine), // the 8 clock-zero lines — the player learns to fear a word
  "Solution good, Captain.",
  "We're wide left, Captain.",
  "We're wide right, Captain.",
  "It's gone quiet, Captain. The system is ours.",
  "We're through, Captain.",
  "I have the aperture, Captain — taking us through.",
  "The gate's too far for me to take her through, Captain — get us inside fifteen klicks.",
  "We're too hot for the aperture, Captain — kill some speed and I'll thread it.",
  "Burn complete — engines to zero.",
  "Burn belayed — you have the conn.",
  "Gate run belayed — you have the conn.",
  // salvage (§4): the haul narrates itself, one line per landing
  "Coming alongside, Captain.",
  "Alongside. Transfer's running, Captain.",
  "Propellant aboard, Captain.",
  "Missiles aboard.",
  "PDC ammunition aboard.",
  "Decoys aboard.",
  "Sensor probes aboard, Captain.",
  "Hull plating aboard — but she's already whole, Captain.",
  "Propellant aboard — but the tanks are already full, Captain.",
  "Patch crews report hull repairs holding.",
  "Engine baffles, Captain — fitted. We run quieter now.",
  "A sensor suite, Captain — fitted. We hear farther now.",
  "Drive parts, Captain — fitted. She burns harder now.",
  "Armor plate, Captain — fitted. She can take more now.",
  "That's the last of it — wreck's stripped, Captain.",
  "There's something else in here, Captain — big. Stay put.",
  "We've drifted off the wreck, Captain.",
  "Breaking off the salvage — what's aboard stays aboard, Captain.",
  "There's a wreck here alright, Captain. Worth taking.",
  "Nothing here, Captain — that rumor was a dry hole.",
  "Decoy's away — it holds our old course. We should change ours, Captain.",
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
  "Their missile took the decoy.",
  "Missile detonated — it was a decoy.",
  "Missile strike on the enemy ship!",
  // v4: contact tiers
  "Losing resolution — contact's gone faint.",
  "Lost the detail readout — still holding the track.",
  "Close-range ID, Captain — full readout on the contact.",
  // v4: torpedoes
  "Torpedo has gone ballistic — I've lost it.",
  // v4.1: guidance + blind fire + close bark
  "Bird away, running blind.",
  "Uplink lost — bird is autonomous.",
  "Ballistic inbound, close!",
  "No lock, Captain — I can fire blind on a bearing if you want it.",
  // v4: PDCs
  "PDC splash — missile destroyed.",
  "Their point defense got our missile.",
  "PDC ammunition at one-half.",
  "PDC ammunition at one-quarter, Captain.",
  "PDC ammunition critical — ten percent.",
  "PDC magazines dry, Captain.",
  "We're inside their PDC envelope — taking fire!",
  "PDCs are chewing on their hull, Captain.",
  // v4: terrain
  "Rock on our vector — impact in twenty seconds!",
  "Rock on our vector — impact in fifteen seconds!",
  "Rock on our vector — impact in ten seconds!",
  "Rock on our vector — impact in five seconds!",
  "We're in the cloud. Our sensors are blind, but so are theirs.",
  "We're clear of the cloud, Captain. Sensors are back.",
  // v4: maneuvers
  "Flipping to kill our velocity.",
  "Answering all stop.",
  "Full stop belayed — you have the conn.",
  "Tanks dry — I can't finish the stop, Captain.",
  // v4: region edge
  "We've left the shroud — we're lit up and the current's against us, Captain.",
  "Back inside the shroud, Captain. We're under cover again.",
  "Enemy ship destroyed. Well fought, Captain.",
  "Hull breach — we're done. Abandon ship.",
  // v4.3: match-start welcomes
  "Enemy ship is out there somewhere. Good hunting, Captain.",
  "Practice range is hot, Captain. Drone's out there somewhere.",
  // v4.5: hearing + ping
  "Lost the rumble.",
  "Ping away.",
  "One ping only, aye. Very well, Captain.",
  "Transducers recharging, Captain.",
  // v4.7: drift marker
  "Drift marker up, Captain.",
  "Drift marker down.",
  "We're not drifting anywhere, Captain — nothing to mark yet.",
  // v5 §1: continuous tracking
  "Lost him — helm's holding his last known position.",
  "Contact regained — helm's tracking him again.",
  "No contact to point at, Captain.",
  "No rumble to steer on, Captain.",
  // v5 §3: designations (letter/callsign lines are dynamic — synthesized
  // on first use and cached; only the fixed shapes pre-generate)
  "No contact by that name on the board, Captain.",
  "Contact identified — it's a decoy.",
  // v5 §5: railgun
  "Solution ready — firing.",
  "Slug away.",
  "Rail's recharging.",
  "Slugs are out.",
  "No track for a solution, Captain — I can fire on a bearing.",
  "This boat doesn't mount a railgun, Captain.",
  "Rail slug connected.",
  "We just lost a decoy.",
  // v5 §6: probes (launch/loss/spent lines carry ordinals and quantized
  // bearings — bounded dynamic shapes, cached on first use)
  "No probes left, Captain.",
  // v5 §7: comms
  "Transmission away.",
  "Broadcast array is recycling, Captain.",
  "Tightbeam dish is recycling, Captain.",
  "No track on them — I can't point the dish, Captain.",
  "Nothing to send, Captain.",
  "Tightbeam to whom, Captain?",
  // v5 §8: teams
  "They're squawking friendly, Captain.",
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
