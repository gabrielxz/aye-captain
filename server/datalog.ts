// Append-only JSONL of everything captains say (voice and typed) — the
// dataset for tuning the STT vocabulary-bias prompt later. Never blocks or
// breaks the game: failures warn once and are otherwise swallowed.
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

function logPath(): string {
  return process.env.UTTERANCE_LOG ?? path.join(process.cwd(), "data", "utterances.jsonl");
}

let dirReady: Promise<unknown> | null = null;
let warned = false;

export interface UtteranceEntry {
  room: string; // room code, or "practice"
  ship: string;
  source: "voice" | "typed" | "panel";
  text: string;
}

export function logUtterance(entry: UtteranceEntry): void {
  const p = logPath();
  const line = JSON.stringify({ t: new Date().toISOString(), ...entry }) + "\n";
  if (!dirReady) dirReady = mkdir(path.dirname(p), { recursive: true });
  dirReady
    .then(() => appendFile(p, line, "utf8"))
    .catch((err: unknown) => {
      if (!warned) {
        warned = true;
        console.error("utterance log failed:", err instanceof Error ? err.message : err);
      }
    });
}

// One line per finished match — the first sim telemetry the game has ever
// had. The `gameover` event already carried every field below; nothing was
// ever written down. Buys archetype win rate and match duration on day one.
//
// 🔴 INVARIANT 18: player names are display-only and a SECURITY boundary. The
// gameover event hands us `winnerName` and `placementNames` right next to
// this call — they must never land here. Log the ARCHETYPE (what balance
// actually turns on) and the seat id; a log we may later feed to analysis, or
// paste into a prompt, is exactly the surface that invariant exists to protect.
// Same never-blocks rules as the utterance log.
function matchLogPath(): string {
  return process.env.MATCH_LOG ?? path.join(process.cwd(), "data", "matches.jsonl");
}

let matchDirReady: Promise<unknown> | null = null;
let matchWarned = false;

export interface MatchEntry {
  room: string; // room code, or "practice" / "campaign"
  mode: string; // ffa | teams | practice | campaign
  durationS: number;
  winner: string | null; // seat id or team — NEVER a player name
  winnerArchetype: string | null;
  // Every seat that flew, in placement order where we know it. Archetypes are
  // the balance question ("does the corvette win too much?"); names are not.
  archetypes: string[];
}

export function logMatch(entry: MatchEntry): void {
  const p = matchLogPath();
  const line = JSON.stringify({ t: new Date().toISOString(), ...entry }) + "\n";
  if (!matchDirReady) matchDirReady = mkdir(path.dirname(p), { recursive: true });
  matchDirReady
    .then(() => appendFile(p, line, "utf8"))
    .catch((err: unknown) => {
      if (!matchWarned) {
        matchWarned = true;
        console.error("match log failed:", err instanceof Error ? err.message : err);
      }
    });
}

// Every PAID synthesis (disk-cache misses only, see tts.ts) — the audit
// trail for hunting TTS quota furnaces: which line shapes never re-hit the
// cache. Same never-blocks rules as the utterance log.
function synthLogPath(): string {
  return process.env.SPEECH_SYNTH_LOG ?? path.join(process.cwd(), "data", "speech-synth.jsonl");
}

let synthDirReady: Promise<unknown> | null = null;
let synthWarned = false;

export function logSynth(text: string): void {
  const p = synthLogPath();
  const line = JSON.stringify({ t: new Date().toISOString(), chars: text.length, text }) + "\n";
  if (!synthDirReady) synthDirReady = mkdir(path.dirname(p), { recursive: true });
  synthDirReady
    .then(() => appendFile(p, line, "utf8"))
    .catch((err: unknown) => {
      if (!synthWarned) {
        synthWarned = true;
        console.error("synth log failed:", err instanceof Error ? err.message : err);
      }
    });
}
