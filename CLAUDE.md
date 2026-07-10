# CLAUDE.md — project context for Claude Code

## What this is

"AYE CAPTAIN" — a networked 1v1 space combat game commanded in natural
language. The captain types English; Claude Haiku translates each utterance
into schema-JSON commands; an authoritative Node server executes them.
`ship_command_schema.json` is the LLM<->server contract. **Where they
disagree on constants, the handoff specs (HANDOFF.md, HANDOFF-v4.md) win.**

**Status: v4 built ("The Big Dark", spec: `HANDOFF-v4.md`) — NOT yet
deployed.** Detection-warfare overhaul on top of v3: 250 km region, 3 km/s
ships, 10 Hz physics substeps + swept collision, signature-scaled sensing
with contact tiers (faint/track/id), seeded terrain (rocks block LOS + are
solid; dust blinds both ways), edge gravity instead of a wall, 6 km/s
burn-and-coast torpedoes, PDCs replacing the laser, full-stop maneuver,
vector overlay, camera (zoom/pan/follow/inset). ~250 headless assertions in
`tests/`. Production still runs v3 at https://aye-captain.fly.dev; v4 ships
as ONE release (constants desync old clients mid-match).

## Commands

```sh
npm run dev        # tsx watch, http://localhost:8080
npm test           # all headless suites (tests/all.ts), exit 0 = green
npm run typecheck  # tsc --noEmit
npm run build      # -> dist/ ; npm start runs it
```

`.env` needs `ANTHROPIC_API_KEY` (translator), `GROQ_API_KEY` (voice STT),
and `ELEVENLABS_API_KEY` (ship voice); gitignored. Each degrades gracefully
when absent (translator offline / Web Speech fallback / text-only ship).
`STT_API_KEY`/`STT_BASE_URL`/`STT_MODEL` switch STT provider
(OpenAI-compatible endpoints). `SPEECH_CACHE_DIR` holds generated voice
lines (on Fly: the /data volume).

Deploy: live on Fly.io as `aye-captain` (region iad, single machine — always
`fly deploy --ha=false`, matches/rooms live in server memory). 1 GB volume
`data` mounted at `/data`; `UTTERANCE_LOG=/data/utterances.jsonl` set in
fly.toml. Secrets: ANTHROPIC_API_KEY, GROQ_API_KEY, ELEVENLABS_API_KEY.
Note: on this machine's rootless Docker, `-p` port publishing doesn't route
(local quirk — the image is fine; verified via `--network host`).

## Architecture (files)

- `server/constants.ts` — EVERY tunable. Never hardcode numbers in sim code.
  Several are LINKED (missile max speed == 2x ship max; spawn dist = 60% of
  region radius) — comments mark them.
- `server/sim.ts` — `step()` = one 10 Hz physics substep; commands/standing
  orders/drone run on the first substep of each 1 Hz tick, sensors/locks/
  painted on the last; `tick()` = 10 substeps (1 s), the turn-based API all
  tests use. Substep body: maneuvers -> ship physics (+ rock collisions,
  edge pull) -> missiles/decoys -> weapons (PDCs, ordnance-vs-rock, swept
  prox fuses, expiry, seekers). Also `snapshotFor()` (contacts[] by tier +
  ghost), `stateSummaryFor()` (LLM prompt state), `queryData()`.
- `server/terrain.ts` — seeded rock/dust generation, circle/ellipse segment
  raycasts, `losClear` (used by sensors, locks, seekers, PDCs, fx).
- `server/match.ts` — Match owns a Sim + sockets; physics timer at 10 Hz,
  snapshot broadcast timer at 4 Hz; terrain seed per match (rematch keeps
  the field unless newField); practice vs room modes, disconnect
  pause/forfeit, transcript routing.
- `server/persona.ts` — ship AI character block for the translator prompt.
- `server/tts.ts` — ElevenLabs voice; stock lines pre-generated at boot into
  a disk cache, dynamic acks synthesized on demand; `GET /speech/:id`.
- `server/translator.ts` — system prompt assembled from the schema file;
  defensive parse (fences/prose/bare-object), hand-rolled validator for every
  verb + condition grammar; `translateUtterance()` and `phraseQueryAnswer()`.
- `server/index.ts` — express static + `/ws` routing, room registry,
  `POST /stt`.
- `server/stt.ts` — speech-to-text via OpenAI-compatible endpoint (Groq
  Whisper default).
- `server/datalog.ts` — appends every utterance to `data/utterances.jsonl`.
- `client/` — vanilla JS + Canvas. `main.js` (ws/state + snapshot-diff sound
  triggers + HUD), `render.js` (camera: wheel zoom / drag+WASD pan / F
  follow / M inset / V vector; interpolated draw, terrain, tier-based
  contact rendering, starfield, tinted SVG sprites with min-px clamp),
  `ui.js` (lobby/transcript/HUD/banner; focus: map owns keys, Enter/backtick
  focuses the box, Esc returns), `voice.js` (push-to-talk: 0.8 s pre-roll
  ring -> /stt, Web Speech fallback), `audio.js` (procedural SFX — PDC
  brrrt, crunch, klaxon, thrust, RWR — and the speech queue), `assets/*.svg`.

## Invariants (do not break)

1. Server is authoritative; clients only render snapshots + send utterances.
2. Fog of war is enforced in `snapshotFor()` — never ship data above the
   viewer's earned contact tier (faint = noisy position only; vector at
   track; hull detail at id). Leak tests in `tests/fog.test.ts`.
3. Standing-order metrics that are unknowable through fog return `null`;
   comparisons on them are false (enemy_range/bearing need tier >= 2).
4. Command acknowledgements go to transcript only when the command actually
   executes (ack event on success, reject event otherwise).
5. Angles: compass degrees, 0 = north/up, clockwise positive. port = CCW.
   `headingVec(deg) = [sin, cos]`. Canvas rotate() matches compass direction.
6. Physics runs in substeps (PHYSICS_SUBSTEPS per command tick) and every
   fast-object interaction uses swept segments (`segmentMinDist`,
   `segCircleHitT`) — never point-in-radius alone. The tunneling regression
   test in `tests/subtick.test.ts` is mandatory-green.
7. fire_missile REQUIRES a held lock, and LOCKS REQUIRE TIER_TRACK; target
   headings are one-shot snapshots — no continuous tracking code path
   exists. The full_stop maneuver is fine (defined end state).
8. Propellant regen gates on the throttle SETTING (not output); signature
   uses EFFECTIVE thrust; drones are exempt from propellant.
9. Detection: range = SENSOR_BASE_M x signature/100, always LOS-gated
   (rocks + dust). Outside the region = signature-max (tier ID at any
   range). Ordnance uses the same math via its own signature.
10. Rocks are solid for everything; ordnance dies on them; ships bounce
    with normal-component damage. Dust has no physical presence.

## Judgment calls already made (user-visible, flagged in check-ins)

- Reply-only translator element `{"acknowledgement": "..."}` (no verb) for
  unmappable intent — deviation from "array of commands only".
- Missiles detonate on enemy *missiles* too — missile-vs-missile defense.
- Re-issuing a standing order with an existing label replaces it.
- Reconnection is seat-based via room code (no accounts); transcript history
  is lost on reconnect (sim state comes back via snapshots).
- Dev harness: command-box input starting with `{`/`[` bypasses the LLM.
- STT has NO vocabulary-bias prompt — deliberately REMOVED (2026-07-10):
  Whisper prompt biasing fabricates commands on marginal audio. Do not
  re-add without the hallucination defenses in stt.ts proving safe. Voice
  capture uses a continuous 0.8s pre-roll ring (voice.js).
- Translator responses go through bracket-repair (`repairJson`) before
  rejection; raw output is logged whenever parsing fails or drops elements.
- v4: decoys (sig 150) now out-shine even a full-burn ship (sig 110) — the
  v3 "burn hard to keep the seeker" counterplay is gone, per spec'd numbers.
- v4: "tell me when X" standing orders use a harmless `show_vector` action —
  the trigger log line itself is the telling (there is no notify verb).
- v4: PDC ship-fire hull damage is applied directly (fractional per substep)
  with edge-triggered notices, not via damageShip (which would spam 10
  notices/s).
- v4: drone with no terrain flies the legacy circle (keeps headless tests
  deterministic); with terrain it patrols rock/dust waypoints with a
  projected-impact dodge.
- Explosion fx are shown within SENSOR_BASE_M + LOS regardless of tier
  (bright events), a deliberate mild softening of fog.

## Testing conventions

Suites in `tests/*.test.ts` are plain tsx scripts (no framework): they log
`ok: ...` per assertion and set `process.exitCode = 1` on failure. When
touching sim behavior, extend the matching suite. Tests that aren't about
point defense set `pdcPosture = "hold"` so the automated PDCs can't add
randomness; missile tests derive tick counts from constants, not literals.
`new Sim()` (no seed) = empty terrain for determinism; tests build exact
fields by hand. For end-to-end checks, use Claude-in-Chrome: practice mode +
the dev harness (raw JSON) for fast maneuvers, English utterances for
translator-path checks. Two tabs for PvP.

## v4 non-goals (HANDOFF-v4.md §10 — do not build)

More than 2 players per room. Ship archetypes. Kinetic weapons/railgun.
Probes. Player-to-player comms. Spectator client. Contact designations
(Alpha/Bravo). Terrain gravity. Subsystem damage. Manual PDC aiming.
