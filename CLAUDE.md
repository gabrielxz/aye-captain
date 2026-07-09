# CLAUDE.md — project context for Claude Code

## What this is

"AYE CAPTAIN" v1 — a networked 1v1 space combat game commanded in natural
language. The captain types English; Claude Haiku translates each utterance
into schema-JSON commands; an authoritative Node server executes them on a
1 Hz tick. Built to the spec in `HANDOFF.md` with `ship_command_schema.json`
as the LLM<->server contract. **Where they disagree on constants, HANDOFF.md
wins.**

**Status: v1 COMPLETE + voice.** All 9 build-order stages from HANDOFF.md §6
are implemented and verified (browser-tested at every stage, 91 headless
assertions in `tests/`). Voice push-to-talk (hold Space) with server-side
STT was added post-v1. Deployed on Fly.io as `aye-captain`
(https://aye-captain.fly.dev). See `TODO.md` for next steps.

## Commands

```sh
npm run dev        # tsx watch, http://localhost:8080
npm test           # all headless suites (tests/all.ts), exit 0 = green
npm run typecheck  # tsc --noEmit
npm run build      # -> dist/ ; npm start runs it
```

`.env` needs `ANTHROPIC_API_KEY` (translator) and `GROQ_API_KEY` (voice STT);
both present locally, gitignored. Without the former the game runs but the
translator is offline; without the latter voice falls back to the browser's
Web Speech API. `STT_API_KEY`/`STT_BASE_URL`/`STT_MODEL` switch STT provider
(OpenAI-compatible endpoints).

Deploy: live on Fly.io as `aye-captain` (region iad, single machine — always
`fly deploy --ha=false`, matches/rooms live in server memory). 1 GB volume
`data` mounted at `/data`; `UTTERANCE_LOG=/data/utterances.jsonl` set in
fly.toml. Secrets: ANTHROPIC_API_KEY, GROQ_API_KEY. Note: on this machine's
rootless Docker, `-p` port publishing doesn't route (local quirk — the image
is fine; verified via `--network host` and in-container curl).

## Architecture (files)

- `server/constants.ts` — EVERY tunable. Never hardcode numbers in sim code.
- `server/sim.ts` — tick pipeline: standing orders → queued commands (lasers
  resolve here, missiles/decoys spawn) → physics → weapons resolve (prox
  fuses, expiry, seeker locks) → sensors/notices. Also `snapshotFor()`,
  `stateSummaryFor()` (LLM prompt state), `queryData()`.
- `server/match.ts` — Match owns a Sim + sockets + 1 Hz interval; practice
  vs room modes, disconnect pause/forfeit, rematch, transcript routing.
- `server/translator.ts` — system prompt assembled from the schema file;
  defensive parse (fences/prose/bare-object), hand-rolled validator for every
  verb + condition grammar; `translateUtterance()` and `phraseQueryAnswer()`
  (second LLM call for query verbs).
- `server/index.ts` — express static + `/ws` routing, room registry,
  `POST /stt` (push-to-talk audio in, transcript out).
- `server/stt.ts` — speech-to-text via OpenAI-compatible endpoint (Groq
  Whisper default) + `STT_BIAS_PROMPT` vocabulary hint.
- `server/datalog.ts` — appends every utterance (voice+typed) to
  `data/utterances.jsonl` for future STT keyword tuning.
- `client/` — vanilla JS + Canvas. `main.js` (ws/state), `render.js`
  (interpolated draw loop), `ui.js` (lobby/transcript/HUD/banner),
  `voice.js` (push-to-talk: MediaRecorder→/stt, Web Speech fallback).

## Invariants (do not break)

1. Server is authoritative; clients only render snapshots + send utterances.
2. Fog of war is enforced in `snapshotFor()` — never ship data the player's
   sensors don't have. There's a leak test in `tests/fog.test.ts`.
3. Standing-order metrics that are unknowable through fog return `null`;
   comparisons on them are false.
4. Command acknowledgements go to transcript only when the command actually
   executes (ack event on success, reject event otherwise).
5. Angles: compass degrees, 0 = north/up, clockwise positive. port = CCW.
   `headingVec(deg) = [sin, cos]`. Canvas rotate() matches compass direction.
6. At 1 Hz, fast movers tunnel: proximity fuses use `segmentMinDist()`
   (closest approach of the two movement segments within a tick), not
   point-in-time distance.

## Judgment calls already made (user-visible, flagged in check-ins)

- Reply-only translator element `{"acknowledgement": "..."}` (no verb) for
  unmappable intent — deviation from "array of commands only".
- Missiles detonate on enemy *missiles* too ("any enemy object" read
  literally) — enables missile-vs-missile defense; user hasn't objected.
- Re-issuing a standing order with an existing label replaces it.
- Reconnection is seat-based via room code (no accounts); transcript history
  is lost on reconnect (sim state comes back via snapshots).
- Contact gained/lost + "Missile inbound" notices added beyond spec (user
  liked them). Repeat standing-order triggers log every firing (spec-faithful
  but noisy — see TODO).
- Dev harness: command-box input starting with `{`/`[` bypasses the LLM and
  is parsed as raw schema commands. Kept in v1 deliberately.

## Testing conventions

Suites in `tests/*.test.ts` are plain tsx scripts (no framework): they log
`ok: ...` per assertion and set `process.exitCode = 1` on failure. When
touching sim behavior, extend the matching suite. For end-to-end checks, use
Claude-in-Chrome: practice mode + the dev harness (raw JSON) for fast
maneuvers, English utterances for translator-path checks. Two tabs for PvP.

## v1 non-goals (HANDOFF.md §7)

No voice (it's TODO #1 for v2), no signature-based sensing (signature exists
only for missile seekers), no ship systems, no accounts/persistence/stats,
no sound/art/mobile.
