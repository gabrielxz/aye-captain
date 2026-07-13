# CLAUDE.md — project context for Claude Code

## What this is

"AYE CAPTAIN" — a networked multiplayer space combat game (up to 8
captains, FFA or teams) commanded in natural language. The captain types English; Claude Haiku translates each utterance
into schema-JSON commands; an authoritative Node server executes them.
`ship_command_schema.json` is the LLM<->server contract. **Where they
disagree on constants, the handoff specs win (HANDOFF.md, HANDOFF-v4.md,
newest addendum last: HANDOFF-v4.1.md, HANDOFF-v4.3.md, HANDOFF-v5.md);
constants.ts is the runtime source of truth.**

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
quantized to 10° for the TTS cache) are deployed. v4.7 "Sensation"
(`HANDOFF-v4.7.md`) is the client-side feel release before v5: vector
overlay repair (min length, labeled ends, all-stop bracket), the drift
marker behind the new `set_overlay` verb (pure ui event — v5 overlays are
ENUM VALUES on it, not new verbs), the ping made perceivable (new `ping`
fx carrying a 180-sample server-computed LOS occlusion mask — the client
ring tears open behind terrain; sonar sounds; red LIT countdown off
`you.ping.revealS`, owner-only), and the feel pass (engine plume anchored
by the `SHIP_STERN` normalized-offset table in render.js — v5 archetypes
add one entry each and get plumes free; tier ceremony stings; dust
shroud + hiss; rock spin; camera shake; hull hum). Zero sim/balance
changes; ping mechanics untouched (`tests/ping.test.ts` unmodified).
v4.7.1 + v4.7.2 (same-day playtest patches) are deployed: TTS-safe
`speak` variants on dynamic notices, own-ordnance fate reports gated on
`canObserve`, tier vocabulary on the HUD CONTACT row, last-missile
reload note, 2x rock spin. ALL of v4 through v4.7.2 is LIVE in
production. **v5 "The Fleet" DEPLOYED 2026-07-11** (merge 7c431dd, CI
green, live protocol verified: rooms/archetypes/callsigns answering in
production): all ten HANDOFF-v5.md build-order steps — §1 continuous
tracking, §2 N-ship rooms/ghosts/death→spectator, §3 callsigns +
designations, §4 archetypes, §5 railgun, §6 probes, §7 comms, §8
teams/IFF, §9 schema audit, §10 docs (Doctrine VI) — 661 headless
assertions. v5.0.1 (2026-07-12, post-playtest): STT rate pacing + OpenAI
fallback (STT_FALLBACK_*), AudioWorklet mic capture, translator
multi-block recovery, TTS concurrency semaphore — all deployed. **v5.1
"Discipline" (`HANDOFF-v5.1.md`) BUILT 2026-07-12**: speech discipline
(3.5 s gap, CRITICAL/NEWS/CHATTER tiers replacing the alert boolean,
HUD-visible acks silent, PTT barge-in), the alarm law (lock
onset→per-locker heartbeat via you.lockedBy, accelerating klaxon), FFA
announcement scaling (GLOBAL 15 s rumble budget + aggregation, contact
relevance gate contactAnnounceRange(n)), audio mix (bed ceiling 0.22,
SFX/VOX sliders, XO verbosity), player names (invariant 18), ship-select
stat cards, practice ship+drone select, MAIN MENU everywhere, rematch
ready-up vote. Zero sim/sensor/weapon/balance changes (v5.1 §0 law).
NEXT: the v5 playtest watch-list in TODO.md (do not
pre-tune) — v5.1's audio changes are only assessable BY EAR (playtest §1
and §3 separately, per the handoff). v5 design policy: archetypes
differ in NUMBERS ONLY — stat blocks, no special abilities (explicitly a
v5 policy, not permanent doctrine; the railgun loadout row is the first
sanctioned asymmetry). **CAMPAIGN "Deep Black"
(HANDOFF-CAMPAIGN-v1.md) RELEASED 2026-07-12** (branch
`campaign-deep-black`, playtested by Gabriel through four patch rounds:
rumor resolve-by-presence, haul manifest + wreck rings, lettered sites +
the 15 km one-command envelope, Hunter leash + ping/probe escalation,
the B bearing compass). Stage 0 passed its tension playtest ("very
fun"); stages 1-4 built in one authorized pass: salvage (§4, `salvage` verb — the ONLY new
verb), run structure + §6 progression (pools persist; upgrades are
multipliers at the sensorMult/sigMult/accelMult/hullMult choke points),
the 8-row ladder (CAMPAIGN_LADDER — a table, not a formula; gate-camping
late rows only), §9 run summary (systems cleared IS the score), the §7
adaptive procedural score (music-brain.js pure + fog-tested BEFORE the
oscillators; audio.js driver with rumble sidechain), the §8 exit
spectacle, and the how-to-play CAMPAIGN tab. The Hunter's AI
(server/hunter.ts `hunterDecide`) and the music brain are PURE FUNCTIONS
OF WIRE SNAPSHOTS — the function signature is the fog guarantee.
**CAMPAIGN PATCH 1 "The Anvil" (HANDOFF-CAMPAIGN-ANVIL.md) BUILT
2026-07-13 on branch `campaign-anvil`** (1,002 assertions; AWAITING the
§0 playtest gate — nothing further gets built until the verdict): §1
Hunter datum search (uncertainty circle r = age × MAX_SPEED, golden-angle
spokes, escalation by r: probes then pings, ping frequency ∝ r, never at
low uncertainty — pinned) + hard leash (waypoints/intercepts clamped to
0.9R, boundary in AVOID by braking distance, never-exits pinned); §5
corvette turn 39.2 (+40%, aperture pins re-derived); §3 relative salvage
(wreck-frame substitution — existing salvage tests UNCHANGED is the
proof) + the Hunter hulk (carries death velocity, debris physics, shroud
drag, no clamp); §2 bounty (6 pieces / 2 modules, Patch-5 placeholder);
§4 the closing gate (armed by the LAST Hunter death, linear to EXACTLY
zero across GATE_CLOSE_START/END_S 180→300, pylons creep to a contiguous
wall, STRANDED gameover, GATE CLOSING HUD row). Anvil judgment calls:
gate arms on the LAST Hunter's death in pack rows; the client re-derives
creeping pylons from gate geometry + live aperture (nothing extra on the
wire); boundary-AVOID triggers on braking distance vs the weakest
archetype drive (a fixed lookahead can't promise containment at 3 km/s);
STRANDED plays no explosion.

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
(OpenAI-compatible endpoints). STT requests are paced under the primary
provider's per-org RPM cap (STT_RPM_LIMIT in constants.ts, env `STT_RPM`
overrides) and spill to `STT_FALLBACK_API_KEY`/`STT_FALLBACK_BASE_URL`/
`STT_FALLBACK_MODEL` (default OpenAI whisper-1) when saturated — one
8-captain room shares the primary budget (Groq on_demand = 20 RPM).
`SPEECH_CACHE_DIR` holds generated voice
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
  raycasts, `losClear` (used by sensors, locks, seekers, PDCs, fx),
  `firstLosBreakT` (earliest LOS break along a ray — feeds the v4.7 ping
  fx occlusion mask; the server computes LOS, the client only animates).
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
  ring -> /stt, Web Speech fallback; hold Space, or on coarse-pointer
  devices the #ptt HOLD button in the cmd row — same start/stop path;
  capture runs in an AudioWorklet, `pcm-worklet.js`, on the audio thread —
  main-thread jank in busy rooms DROPPED ScriptProcessor buffers mid-word,
  the 2026-07-12 multiplayer garble; 150 ms stop-grace catches in-flight
  chunks), `audio.js` (procedural SFX — PDC
  brrrt, crunch, klaxon, thrust, RWR — and the speech DRIVER; scheduling
  policy lives in `speech-scheduler.js`, a pure module unit-tested in
  tests/speech.test.ts; v5.1 mix: all four continuous beds share a
  ceiling-limited bedBus that ducks under speech; SFX/VOX sliders;
  verbosity filter), `ship-select.js` (v5.1 §6 archetype stat cards, built
  from the hello config's ARCHETYPES block — used by lobby + practice),
  `assets/*.svg`.

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
   TIER_TRACK ON YOUR OWN SENSORS — probe-relayed tracks never feed locks
   (v5 §6 firewall: probes FIND ships; a fused tier would let you lock
   through a rock). The lock is per-designated-target (auto-picks nearest
   eligible; set_lock_target chooses). What a lock buys: the bird flies UPLINKED (intercept off the
   mother ship's track, decoy-immune) until the lock breaks or the launcher
   dies — then AUTONOMOUS, one-way, seeker-only, decoy-susceptible. Blind
   fire (guidance "bearing") skips the lock and is autonomous from birth;
   the translator emits it ONLY on explicit request. Target headings TRACK
   CONTINUOUSLY (v5 §1, a deliberate reversal of the v4 snapshot rule): a
   `track` goal re-resolves the bearing every tick until a new heading or
   maneuver order replaces it; a ship contact that drops below faint falls
   back to last-known position with a one-time XO notice. The full_stop
   maneuver is unchanged (defined end state).
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
15. v5 designations: below ID every trackable object (hostile ships AND
    unresolved decoys) draws a per-observer letter with the IDENTICAL XO
    ceremony — silence or different treatment unmasks decoys. Wire ids
    are the letters (contacts) and opaque per-viewer aliases (rumbles:
    "r1") — never object-keyed ids a JSON reader could correlate.
    Callsigns cross the wire only at/after ID, with ONE sanctioned
    exception: the broadcast comms spike's voiceprint.
16. v5 IFF is for GUIDED systems only (locks, seekers, prox fuses, PDCs
    — via team stamps on ordnance that outlive their owners). RAIL SLUGS
    AND COLLISIONS CHECK NOTHING — physics doesn't read transponders; do
    not soften (tests/rail.test.ts pins the teammate slugging).
17. v5 transponders: teammates see each other at full state, ALWAYS —
    and NOTHING else is shared: no fused contact picture, no shared
    rumbles, no probe feeds. Intel moves by tightbeam; that minigame is
    load-bearing. (`share contact` is a backlogged concession — do not
    build unprompted.)
18. v5.1 player names are DISPLAY-ONLY and a SECURITY BOUNDARY, not a
    scope call: never in any LLM prompt, schema field, state summary, or
    standing-order condition (prompt-injection surface — names live on
    Match seats; the Sim never learns them), and never spoken (unbounded
    TTS vocabulary). Fog: teammates + spectators only; the callsign→name
    mapping ships ONLY in the gameover reveal. tests/names.test.ts is
    mandatory-green.
19. v5.1 speech discipline: the XO speaks when he knows something the
    captain doesn't. Non-critical lines respect SPEECH_MIN_GAP_MS;
    HUD-visible acks carry no speech id; the server classifies every
    transcript line critical/news/chatter (no alert boolean); alarms obey
    the alarm law (onset + change carry the information, sustains decay —
    setMissileProximity is the reference and must not be touched).
20. Campaign fog firewalls: the Hunter's AI (`hunterDecide`) is a pure
    function of ITS OWN wire snapshot + public intel (marked wrecks only
    — rumored sites are the player's private leads and never reach it);
    THE MUSIC IS UNDER THE SAME LAW (`music-brain.js` — a pure function
    of the player's snapshot; an undetected Hunter near and far must
    sound identical; tests/music.test.ts is mandatory-green). The
    function signatures ARE the guarantee — never hand either one a Sim.
21. Campaign run state is CLIENT-OWNED (localStorage), handed to the
    server at each system start — single-player deliberately suspends
    server authority (nobody to cheat but yourself). Sanitize for
    finiteness only; do not "fix" with accounts or server persistence.
22. The campaign clock never shrinks: CAMPAIGN_HUNTER_SPAWN_S is the
    only clock, identical across all 8 ladder rows (pinned) — the ladder
    escalates the HUNTER (numbers only), never the budget. Player-facing
    sigMult scales TOTAL signature and is therefore also an
    anti-lock/anti-seeker stat — deliberate double-axis, documented at
    HUNTER_SIG_MULT.

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
- v4.7.1: XO reports about OUR ordnance are gated on `canObserve` (same
  SENSOR_BASE_M + LOS rule as explosion fx): "their PDCs got our missile",
  "it was a decoy", "missile strike on the enemy ship" only when the owner
  could watch it happen — autonomous birds are one-way (v4.1 §3) and an
  unseen bird just never phones home. Exception: the DECOY owner always
  learns their decoy died (own equipment). Playtest report 2026-07-11.
- v4.7.1: notices may carry `speak` — a TTS-safe variant the voice says
  while the transcript shows `text`. Bearings speak as 10°-quantized digit
  words ("three three zero"); ranges and "km" never reach the voice
  (ElevenLabs garbled "143 km."; also each numeral string was a fresh
  synthesis — the v4.6 furnace lesson extended to every bearing call).
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
- v4.1: decoy contacts get no XO transition lines — REVERSED in v5 §3:
  with per-observer designation letters, silence would unmask decoys, so
  decoy contacts draw letters and get the full XO ceremony ("New contact —
  designating Bravo"; at ID: "it's a decoy"). Same reasoning made contact
  cids the designation LETTERS and rumble cids per-viewer opaque aliases
  ("r1") — object-keyed wire ids let a JSON reader correlate tracks and
  spot decoys by prefix.
- v5.1 judgment calls: the relevance gate keeps decoy/ship ceremony
  IDENTICAL (silence gating is by range/lock/board-count, never identity —
  invariant 15 holds); a silent notice may still be critical-priority (red
  transcript, no voice); "lock trumps range" (losing a contact that holds
  a lock on you speaks from anywhere); rematch field choice is majority
  with ties keeping the field; MAIN MENU is location.reload() on purpose —
  the socket-close teardown path is the one already tested; practice
  rematch was FOUND BROKEN in v5 (spawnShips spawned the captain alone, no
  drone) and beginMatch now rebuilds the practice sim; the practice
  drone's picked archetype changes shape/signature/handling but hull stays
  DRONE_HULL_POINTS (no balance change); lobby rosters show names
  (callsigns don't exist pre-launch, so the reveal's mapping can't leak).
- v5.0.1 (2026-07-12 playtest): the translator sometimes emits an ack-only
  draft, prose ("Wait — I need to emit the command:"), then a corrected
  fenced block — parseResponse now tries each fenced block as its own
  candidate, LAST first, and a candidate yielding real commands beats any
  reply-only one (four live "unusable response" drops pinned in
  translator.test.ts). Leading-zero bearings (`"degrees": 051`) are
  repaired string-aware. STT saturation returns 503 "voice channel busy"
  (client shows the server's message), distinct from 502 real failures.
- TTS economy (2026-07-13): the v4.6 furnace lesson GENERALIZED — freeform
  speech never re-hits the disk cache (~900 unique paid syntheses in one
  play day). Dynamic acks voice a bounded phrasebook (ACK_SPEAK_LINES,
  deterministic per-text pick) and query answers voice QUERY_ANSWER_SPEAK;
  the full text always stays in the transcript. Standing-order readbacks
  are EXEMPT and speak verbatim (v4.3: the voice must state trigger
  direction). Every cache-miss synthesis logs to console + SPEECH_SYNTH_LOG
  (/data/speech-synth.jsonl on Fly) — the audit trail for remaining
  furnaces. Still deliberately freeform: xo-note replies, comms
  transmissions (MESSAGE_MAX_CHARS caps those). Pinned in speech.test.ts §8.
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
  (bright events), a deliberate mild softening of fog. (v5: the viewer's
  own archetype sensor base.)
- v5 §2: an OBSERVED ship death closes every watcher's book on that track
  (no ghost); an UNOBSERVED death/scuttle leaves a last-known ghost of a
  track that simply went dark. Kill lines go to the INVOLVED parties only
  (killer + victim; §10's global kill feed stays backlogged).
- v5 §3 correlate rule implementation: a lost track keeps its letter iff
  reacquired within CONTACT_CORRELATE_S AND within max-speed reach of its
  last fix; a failed correlation tombstones the old letter's ghost ON THE
  MAP (deleting it would leak that both letters are one hull).
- v5 §5: the rail slug exempts only its OWNER (muzzle geometry — it spawns
  inside the shooter's hit radius and can never be re-caught at 2x max
  speed); a deliberate rail SOLUTION on a named teammate is refused by the
  XO — the bearing-mode accident remains possible ("the first teammate
  slugging will be legend").
- v5 §7: tightbeaming a track that is secretly a decoy is ACCEPTED and
  delivered to nobody — rejection would unmask it. Same fog logic lets
  set_lock_target designate a decoy contact (the lock just never builds).
- v5 §2 lobby: joining after launch = seat-based reconnect to the first
  vacant living seat; rematch re-seats dead captains with the same picks
  (archetype changes between matches need a fresh room for now).
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

## v5 non-goals (HANDOFF-v5.md §14 — do not build)

Spectator polish suite (follow-cam cycling, kill feed, caster overlay —
BACKLOGGED, wanted later). Per-contact standing-order metrics. Team
sensor fusion / `share contact` verb (backlogged concession). Archetype
special abilities. More than 2 teams. Respawns. Depots, belts, shroud
contraction (unchanged deferrals). Numeric rumble-bearing metrics.
Auto-triangulation by the XO. (Most v4 non-goals — N players,
archetypes, railgun, probes, comms, designations — were BUILT in v5 by
spec; terrain gravity, subsystem damage, and manual PDC aiming remain
out.)
