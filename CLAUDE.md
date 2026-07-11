# CLAUDE.md — project context for Claude Code

## What this is

"AYE CAPTAIN" — a networked 1v1 space combat game commanded in natural
language. The captain types English; Claude Haiku translates each utterance
into schema-JSON commands; an authoritative Node server executes them.
`ship_command_schema.json` is the LLM<->server contract. **Where they
disagree on constants, the handoff specs win (HANDOFF.md, HANDOFF-v4.md,
newest addendum last: HANDOFF-v4.1.md, HANDOFF-v4.3.md).**

**Status: v4 + v4.1 DEPLOYED to production 2026-07-11 (specs:
`HANDOFF-v4.md` + `HANDOFF-v4.1.md`, which WINS where they conflict).**
Detection-warfare
overhaul on top of v3: 250 km region, 3 km/s ships, 10 Hz physics substeps
+ swept collision, signature-scaled sensing with contact tiers
(faint/track/id), seeded terrain (rocks block LOS + are solid; dust blinds
both ways), edge gravity instead of a wall, 6 km/s burn-and-coast
torpedoes with UPLINKED/AUTONOMOUS guidance + blind bearing fire,
sensor-slaved PDCs replacing the laser, decoys doubling as fake contacts,
full-stop maneuver, vector overlay + cursor bearing readout, camera
(zoom/pan/follow/inset). 300+ headless assertions in `tests/`. Live at
https://aye-captain.fly.dev; Gabriel's online playtest is the open
milestone item (TODO.md has the watch-list — do not pre-tune its knobs).
v4.2 (spectator presence), v4.3 (`HANDOFF-v4.3.md`: standing-order
threshold fix, XO welcomes, bearing-only readout, single 50 km ring,
sensor rebase SIG_BASE 30 / SENSOR_BASE 180 km) and v4.4 (real relative
turns; stop-engines / lock-then-fire translator doctrine) are deployed.
v4.5 "Tempo" (`HANDOFF-v4.5.md`: missile retune to real engagement ranges
+ 3 km arming distance, 30 s reload, 60 s decoys, steeper edge pull, the
HEARING channel, the active PING) and v4.6 (phantom-ack fix: reply-only
lines never claim actions, render as "XO (note)"; spoken rumble bearings
quantized to 10° for the TTS cache) are deployed.

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
7. A LOCKED fire_missile requires a held lock, and LOCKS REQUIRE
   TIER_TRACK. What a lock buys: the bird flies UPLINKED (intercept off the
   mother ship's track, decoy-immune) until the lock breaks or the launcher
   dies — then AUTONOMOUS, one-way, seeker-only, decoy-susceptible. Blind
   fire (guidance "bearing") skips the lock and is autonomous from birth;
   the translator emits it ONLY on explicit request. Target headings are
   one-shot snapshots — no continuous tracking code path exists. The
   full_stop maneuver is fine (defined end state).
8. Propellant regen gates on the throttle SETTING (not output); signature
   uses EFFECTIVE thrust; drones are exempt from propellant.
9. Detection: range = SENSOR_BASE_M x signature/100, always LOS-gated
   (rocks + dust). Outside the region = signature-max (tier ID at any
   range). Ordnance uses the same math via its own signature. Missile
   seekers use the same formula with MISSILE_SEEKER_BASE_M; PDCs are
   SENSOR-SLAVED (only engage ordnance the ship currently detects).
10. Rocks are solid for everything; ordnance dies on them; ships bounce
    with normal-component damage (drones bounce damage-free — a practice
    drone suiciding on terrain is a degenerate win). Dust has no physical
    presence.
11. Decoys (sig 90, between cruise and full burn) read as ORDINARY
    unresolved contacts to enemy ships at faint/track tier — the snapshot
    must never label them as decoys until ID tier resolves them.
12. Any behavior change updates `/how-to-play` (client/how-to-play.html)
    AND README.md's gameplay description in the same commit — both carry
    rounded gameplay values that must stay true (README added v4.5 §0).
13. The hearing channel is CONTINUOUS end to end — no thresholds anywhere
    in it (v4.5 design law: a threshold instantly becomes a throttle
    policy). Rumbles are a contact class BELOW faint carrying bearing (+ a
    signature-derived loudness for client audio) — never range, position,
    vector, or tier. Terrain never blocks hearing. The XO never
    triangulates rumbles — crossing bearings is deliberately human skill
    (v5 probes are the tooling answer).
14. The information ladder is HEARING bearing -> aimed PING -> passive
    TIERS -> LOCK. A ping FINDS ships, it cannot shoot them:
    PING_TRACK_S must never be extended to where a ping grant alone
    completes a LOCK_TIME_S lock (pinned in tests/ping.test.ts).

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
- v4.1: DECOY_SIGNATURE retuned 150 -> 90 after the flag on the 150 value —
  throttle discipline is back ("break the lock, throttle down, decoy").
  v4.3 re-linked it to the SIG_BASE rebase: 90 -> 100 (spoof works below
  ~70% effective thrust; the relationship comment lives in constants.ts).
- v4.3: stealth is taxed, not removed — SIG_BASE 10 -> 30, SENSOR_BASE
  165 -> 180 km ("stealth was free" playtest finding). Threshold standing
  orders encode crossing DIRECTION resolved against live state, and XO
  readbacks must speak it; the verbatim bug utterance is a schema example.
  Deferred (TODO.md): ramscoop regen, active ping — do not build yet.
- v4.6: reply-only translator elements may NEVER claim an action was
  taken ("PDCs holding" with no verb ran nothing while sounding executed —
  the invariant-4 loophole); they render as a distinct "XO (note)" line
  (who: "xo-note"). Spoken rumble bearings quantize to 10° — exact
  bearings made every announcement a unique ElevenLabs synthesis and
  drained the whole TTS quota in a day. Dynamic XO lines with unbounded
  numeric content are a quota hazard: quantize or template them.
- v4.4: relative turns are REAL turns — a `turn` heading goal carries
  signed remaining degrees, so "starboard 270" goes starboard the long way
  and a 360 pirouette actually happens (they used to collapse to an
  absolute goal + shortest arc: 360 was a silent no-op). Absolute/target
  goals still steer shortest-arc. Prompt doctrine: naming the ENGINES
  ("stop/cut engines") = thrust 0, only stopping the SHIP = full_stop;
  "lock then fire" = standing order on have_lock, never immediate fire.
  Every schema example is validator-checked in translator.test.ts.
- v4.1: the 2 s seeker-reacquire-then-permanently-ballistic rule was
  REMOVED: a target-less autonomous bird holds course and may acquire
  later (blind fire needs long candidate-less flight); only dry fuel ends
  steering.
- v4.1: decoy contacts get no XO transition lines (only the enemy SHIP
  drives contact-tier announcements) — snapshot-level deception only.
- v4: "tell me when X" standing orders use a harmless `show_vector` action —
  the trigger log line itself is the telling (there is no notify verb).
- v4: PDC ship-fire hull damage is applied directly (fractional per substep)
  with edge-triggered notices, not via damageShip (which would spam 10
  notices/s).
- v4: drone with no terrain flies the legacy circle (keeps headless tests
  deterministic); with terrain it patrols SKIM POINTS off rock flanks
  (never rock centers) with a padded, direction-committed dodge — measured
  to occlude it from a trailing pursuer 15-30% of the time on most seeds
  (v4.1 §7 verification).
- Explosion fx are shown within SENSOR_BASE_M + LOS regardless of tier
  (bright events), a deliberate mild softening of fog.
- v4.2: spectators (lobby WATCH + room code) get the OMNISCIENT referee
  view via `snapshotSpectator()` — fog deliberately does not apply, so a
  second-screen spectator is a wallhack; flagged in the handbook as
  cheating, not prevented. Identity is a cosmetic server-assigned callsign
  (pool + -2 suffixes, first-come reuse). Presence is silent by design: a
  corner WATCHING readout only — no sound, no transcript, no XO line. In
  spectator snapshots, ordnance `own` means "ship A's" (reuses the client's
  two-color rendering).

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
Probes. Player-to-player comms. Contact designations (Alpha/Bravo).
Terrain gravity. Subsystem damage. Manual PDC aiming. (A spectator client
WAS a v4 non-goal but was built in v4.2 by explicit request — watch-only,
no chat, no controls.)
