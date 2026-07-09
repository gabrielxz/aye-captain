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
  source: "voice" | "typed";
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
