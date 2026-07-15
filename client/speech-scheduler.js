// v5.1 §1: the XO's speech scheduler, pure logic — no WebAudio, no DOM —
// so the discipline rules are unit-testable headless (tests/speech.test.ts).
//
// Three tiers (§1.2):
//   CRITICAL — interrupts playback, jumps the queue, ignores the gap,
//              dedupes, keeps only the freshest 2.
//   NEWS     — queues; may not START until SPEECH_MIN_GAP_MS after the
//              previous line ENDED. TTL'd.
//   CHATTER  — plays only if idle AND the gap has elapsed AND nothing else
//              is queued. TTL'd tighter.
//
// The gap is the release's single largest fix: the old scheduler's rule was
// "if I'm not already talking, talk" — at N=8 that is a voice that never
// stops.

export const SPEECH_MIN_GAP_MS = 3500; // non-critical lines may not START until this long after the previous line ENDED
export const SPEECH_TTL_MS = { critical: 6000, news: 6000, chatter: 4000 };
// A TTL asks "is this still worth saying?" — and for a momentary EVENT the
// answer goes false fast. But some lines report a LATCHED STATE ("the wreck
// is stripped"): it stays true and stays actionable, so being late costs it
// nothing. Those enqueue with `hold` and wait out a long line ahead of them
// instead of dying in the queue. Playtest 2026-07-14: the salvage-complete
// line lost this race to the final module's line — reliably, and worst
// exactly when the loot was best (worst-first ordering puts the longest
// line last). Use sparingly: a held line is one that CANNOT go stale.
export const SPEECH_TTL_HOLD_MS = 20000;
export const BARGE_FADE_MS = 120;

// Driver contract:
//   start(id, priority) — begin playback; the driver calls onEnded() when
//                         the line finishes (and only then).
//   stop(fadeMs)        — abort current playback (preemption / barge-in);
//                         the driver must NOT call onEnded() for it.
//   now()               — ms clock (performance.now in the browser).
//   later(ms)           — request a poll() call after ms (gap waits).
export function createSpeechScheduler({ start, stop, now, later }) {
  const queue = []; // {id, priority, at}
  let playing = null; // {id, priority}
  let lastEndedAt = -Infinity;

  function pruneExpired(t) {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (t - queue[i].at > queue[i].ttl) queue.splice(i, 1);
    }
  }

  function takeAt(idx) {
    return idx >= 0 ? queue.splice(idx, 1)[0] : null;
  }

  function pickNext(t) {
    pruneExpired(t);
    const critical = queue.findIndex((e) => e.priority === "critical");
    if (critical >= 0) return takeAt(critical); // ignores the gap
    if (t - lastEndedAt < SPEECH_MIN_GAP_MS) return null;
    const news = queue.findIndex((e) => e.priority === "news");
    if (news >= 0) return takeAt(news);
    // chatter: only into total silence — nothing else waiting
    if (queue.length > 0 && queue.every((e) => e.priority === "chatter")) return takeAt(0);
    return null;
  }

  function poll() {
    if (playing) return;
    const t = now();
    const entry = pickNext(t);
    if (entry) {
      playing = { id: entry.id, priority: entry.priority };
      start(entry.id, entry.priority);
      return;
    }
    // something is gap-blocked: ask the driver to poll again when it opens
    if (queue.length > 0) later(Math.max(0, SPEECH_MIN_GAP_MS - (t - lastEndedAt)) + 10);
  }

  function enqueue(id, priority = "news", hold = false) {
    const t = now();
    const ttl = hold ? SPEECH_TTL_HOLD_MS : SPEECH_TTL_MS[priority];
    if (priority === "critical") {
      // dedupe against the playing line and queued criticals
      if (playing && playing.priority === "critical" && playing.id === id) return;
      if (queue.some((e) => e.priority === "critical" && e.id === id)) return;
      queue.push({ id, priority, at: t, ttl });
      // keep only the freshest 2 warnings — older ones are superseded news
      const criticals = queue.filter((e) => e.priority === "critical");
      while (criticals.length > 2) queue.splice(queue.indexOf(criticals.shift()), 1);
      // interrupt a non-critical line mid-word; a critical one finishes
      if (playing && playing.priority !== "critical") {
        stop(BARGE_FADE_MS);
        playing = null;
        lastEndedAt = t;
      }
    } else {
      queue.push({ id, priority, at: t, ttl });
    }
    poll();
  }

  function onEnded() {
    playing = null;
    lastEndedAt = now();
    poll();
  }

  // PTT down (§1.4): the captain spoke — the XO yields. Drop the playing
  // non-critical line (it is NOT resumed; if it mattered the condition will
  // re-announce), flush CHATTER, keep NEWS (its TTL handles staleness).
  // A playing CRITICAL line survives, ducked: if the captain is about to
  // die, they hear about it even mid-order.
  function bargeIn() {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].priority === "chatter") queue.splice(i, 1);
    }
    if (playing && playing.priority !== "critical") {
      stop(BARGE_FADE_MS);
      playing = null;
      lastEndedAt = now();
    }
  }

  return {
    enqueue,
    onEnded,
    poll,
    bargeIn,
    get playing() {
      return playing;
    },
    get queued() {
      return queue.length;
    },
  };
}
