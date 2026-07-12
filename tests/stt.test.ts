// STT request budget (stt.ts RateWindow): one 8-captain room shares the
// primary provider's per-org RPM cap, so slots are RESERVED (not checked)
// to keep concurrent captains from oversubscribing, and a 429 sits the
// provider down. Playtest 2026-07-12: the 20 RPM Groq cap 429-stormed room
// RERU at ~30 voice commands/min.
import { RateWindow } from "../server/stt.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

// 1. under the limit: slots are free, no waiting
{
  const w = new RateWindow(3);
  const t0 = 1_000_000;
  assert(w.reserve(t0) === 0, "first reservation is immediate");
  assert(w.reserve(t0 + 100) === 0, "second reservation is immediate");
  assert(w.reserve(t0 + 200) === 0, "third reservation is immediate");
}

// 2. over the limit: the next slot opens when the oldest stamp ages out
{
  const w = new RateWindow(2);
  const t0 = 1_000_000;
  w.reserve(t0);
  w.reserve(t0 + 1_000);
  const wait = w.reserve(t0 + 2_000);
  assert(wait === 58_000, `third caller waits for the oldest slot to age out (got ${wait})`);
}

// 3. reservations stack: concurrent callers can't book the same slot
{
  const w = new RateWindow(1);
  const t0 = 1_000_000;
  w.reserve(t0);
  const a = w.reserve(t0 + 1); // books t0+60000
  const b = w.reserve(t0 + 2); // must book AFTER a's slot, not alongside it
  assert(a === 59_999, `first waiter books the next slot (got ${a})`);
  assert(b === 119_998, `second waiter books the slot after that (got ${b})`);
}

// 4. old stamps age out — a quiet minute restores the full budget
{
  const w = new RateWindow(2);
  const t0 = 1_000_000;
  w.reserve(t0);
  w.reserve(t0 + 1);
  assert(w.peek(t0 + 61_000) === 0, "budget restored after the window passes");
}

// 5. a 429 penalty blocks even a budget with free slots
{
  const w = new RateWindow(10);
  const t0 = 1_000_000;
  w.penalize(t0, 20_000);
  assert(w.peek(t0 + 1_000) === 19_000, "penalty outweighs free slots");
  assert(w.peek(t0 + 21_000) === 0, "penalty expires");
}

// 6. peek prices without booking
{
  const w = new RateWindow(1);
  const t0 = 1_000_000;
  w.reserve(t0);
  const p1 = w.peek(t0 + 1);
  const p2 = w.peek(t0 + 1);
  assert(p1 === p2 && p1 === 59_999, "peek is idempotent (no slot consumed)");
}
