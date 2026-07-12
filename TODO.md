# TODO — next steps

## Campaign "Deep Black" STAGE 0 (HANDOFF-CAMPAIGN-v1.md) — BUILT 2026-07-12, NOT DEPLOYED

One system, the clock, one "Sharp Ears" corvette Hunter (fog-based AI —
`hunterDecide` in server/hunter.ts reads ONLY its own `snapshotFor`
snapshot), gate on the rim (pylons are rocks, swept aperture crossing,
§5.4 approach-solution HUD row + XO calls), honest fuel, retry via the
rematch buttons. 843 assertions (77 new in hunter/campaign.test.ts).
Runtime-verified in Chrome end to end: clock → spawn (no pop-in; first
sign was a drifting rumble) → Hunter chased a full-burn player across
the map → loss path (dry tanks + rock = HUNTER WINS, death→spectator) →
retry → coast-and-regen approach → SOLUTION GOOD → SYSTEM CLEARED.

- [ ] **Gabriel plays Stage 0 — THE gate for everything below** (spec §0:
  "if Stage 0 isn't tense, stop"). The deliverable is not "was it fun"
  but **which asymmetry pair (sensorMult, sigMult) is the game** — sweep
  live from the dev harness: `{"mission":{"sigMult":0.7,"sensorMult":1.5}}`
  (also `"hunterSpawnS":40` to compress the clock). Starting pair
  1.4 / 0.75; the tuned pair drops into the Stage 2 ladder table as row 2.
- [ ] **Dry-Hunter watch item**: bait its 4 birds with decoys, then see if
  a missile-less Hunter still scares (it keeps closing, PDCs only — by
  design; if it reads as harmless, that's a finding, not a bug).
- [ ] Minor observed: crossing the gate also fires "We've left the shroud"
  (the gate sits ON the rim, so the zone-exit edge triggers alongside
  "We're through"). Harmless but doubles the exit lines — candidate
  one-line suppression when `gateCleared`.
- [ ] NOT built (later stages, spec §14): salvage, progression, run map,
  ladder, score/music, exit spectacle, how-to-play tab. Gate-clear →
  gameover is STAGE-0-ONLY (comment at the crossing site); Stage 1 must
  decouple it. No deploy, no docs updates until Stage 4.

## v5.1 "Discipline" (HANDOFF-v5.1.md) — BUILT 2026-07-12

All build-order steps: §1 speech discipline (3.5 s gap, three tiers,
HUD-visible acks silent, barge-in), §2 alarm law (lock onset→per-locker
heartbeat, accelerating klaxon), §3 FFA scaling (global rumble budget +
aggregation, contact relevance gate), §4 mix (bed ceiling, SFX/VOX
sliders, XO verbosity), §5 names (never in prompts — invariant 18;
post-match reveal), §6 ship-select stat cards, §7 practice ship+drone
select + MAIN MENU + rematch ready-up. Zero sim/balance changes. Also
fixed en route (v5 bugs): practice rematch spawned no drone; N-player
rematch was first-click-relaunches-everyone and one leaver bricked it.

- [ ] **Playtest §1 and §3 SEPARATELY, by ear** (the handoff's own
  instruction): does the gap feel right at 3500 ms (expect to land
  3000-6000)? Does the FFA board go quiet without going dead? Then the
  lock heartbeat (§2): does the per-locker thump count land?
- [ ] Spectator audio at gameover + the reveal screen: worth one look in
  a real room.

## v5.0.1 — multiplayer voice-pipeline fixes (playtest 2026-07-12)

Two 8-captain rounds (rooms ADBW, RERU): voice near-unusable for some
captains, fine for others; one "transcription failed server 502". Four
distinct causes found in fly logs + /data/utterances.jsonl, all fixed:

- **Groq 20 RPM org cap** (on_demand tier) 429-stormed room RERU at ~30
  voice cmds/min → every 429 surfaced as a 502. Fixed: reservation-style
  RPM pacing (STT_RPM_LIMIT / env STT_RPM), 429 penalty windows, spill to
  an STT_FALLBACK_* provider, 503 "voice channel busy" messaging.
- **ScriptProcessorNode dropped mic buffers under main-thread jank** —
  Gabriel's words lost mid-utterance ("Set engine thrust percent." —
  number gone) while same-room captains were clean; practice minutes later
  was clean. Fixed: AudioWorklet capture (client/pcm-worklet.js) + 150 ms
  stop-grace. NEEDS REAL-BATTLE CONFIRMATION next multiplayer playtest.
- **Translator self-corrections dropped as "unusable"** (4 that night):
  ack-only draft + "Wait—" prose + corrected fenced block. Fixed:
  per-block candidates, last-first, commands-beat-replies; leading-zero
  degrees repaired. Pinned in translator.test.ts.
- **ElevenLabs concurrent_limit_exceeded** on dynamic-ack bursts. Fixed:
  TTS_MAX_CONCURRENT=2 semaphore in tts.ts.

- [x] **STT fallback provisioned** (2026-07-12): OpenAI key staged as
  STT_FALLBACK_API_KEY on Fly (takes effect with the next deploy) + local
  .env; whisper-1 default. Still worth raising STT_RPM once the Groq
  Developer tier reopens ("temporarily unavailable due to high demand" as
  of 2026-07-12) — the fallback absorbs overflow, the primary stays capped
  at 20 RPM.
- [ ] Voice-chat bleed (speaker users): friends' Discord audio transcribed
  as commands ("Can you hear me?" reached the XO). Mitigation is human
  (headphones); revisit only if playtests keep tripping it.

## v5 "The Fleet" (HANDOFF-v5.md) — DEPLOYED 2026-07-11

All ten build-order steps, one release: §1 continuous target tracking
(+ nearest_rumble), §2 N-ship sim + 8-captain rooms + ghost disconnects
+ death→spectator, §3 callsigns + per-observer designations (letter cids,
opaque rumble aliases, correlate window, tombstone ghosts), §4 archetypes
(numbers only; frigate == v4 baseline, LINKED), §5 railgun (solutions
punish coasters; no IFF), §6 probes (via-probe relay, two-bearing
triangulation, lock firewall), §7 comms (broadcast voiceprint spike /
tightbeam), §8 teams + IFF (transponders only), §9 schema audit, §10
docs (Doctrine VI). 659 headless assertions.

- [x] Deployed 2026-07-11 — merge 7c431dd, CI green, live protocol
  verified (room create, archetype pick, callsign assignment, launch).
  Boot pre-generates ~25 new stock lines into /data/speech (one-time
  TTS cost; keep an eye on the ElevenLabs quota today).
- [ ] Playtest watch-list (do NOT pre-tune): does an 8-player FFA hunt
  converge or stall? Rail solution hit rate vs alert targets (the
  190 m dodge margin); is 6 s cooldown / 25 damage the right pressure?
  Probe supply (4/2/1) — enough for the triangulation game? Comms
  cooldown 10 s — chatty enough? Do teams actually TALK (the no-datalink
  bet)? Corvette sig 20 vs cruiser 45 — does the asymmetric-detection
  dance land? Designation letters — do captains use them or say "the
  near one"?
- [ ] The v4.5 playtest questions remain OPEN below (hunt convergence,
  throttles, ping honesty) — now observable in multiplayer too.

## v4.7.2 — playtest patch round two (2026-07-11)

- **"Not sure what 'detail readout' / 'full resolution' means"**: the HUD
  CONTACT row now names what each tier buys — "FAINT · pos only",
  "TRACK · lockable", "ID · full readout" — anchoring the XO's tier
  vocabulary to something visible.
- **"Tube 2 said reloading but we were out of missiles"**: the XO was
  right — a tube only says reloading when a missile already pulled from
  reserve is going in — but reserve reads 0 during the LAST reload, which
  sounds like a lie. The tubes query now carries a magazine_note
  ("the missiles loading now are the LAST aboard") and the XO voices it.
- **Rock spin doubled** (±0.6 → ±1.2°/s at the small end) — the v4.7 rate
  read as stationary.

## v4.7.1 — playtest patch (reports 2026-07-11, same day as v4.7)

- **"XO said 'kilometer' weird / garbled the end of the sentence"**: the
  faint/track contact lines spoke exact numerals + "km" — ElevenLabs
  garbles them, and every unique string was a fresh synthesis (the v4.6
  furnace, still burning in four other line shapes). Fix: notices carry a
  `speak` variant — bearings as 10°-quantized digit words ("three three
  zero"), no ranges/"km" in the voice, exact numbers stay in the
  transcript. Applied to contact tiers, ping scream, launch flash,
  missile inbound, rumbles.
- **"Their PDCs got our missile — should I know that?"**: no. Autonomous
  birds are one-way (v4.1 §3); the code told the owner anyway. All
  own-ordnance fate reports (PDC kill, ate-a-decoy, strike call) now gate
  on `canObserve` (SENSOR_BASE_M + LOS — the explosion-fx rule). Decoy
  owners still always learn (own equipment). tests/ordnance-fog.test.ts.
- **"Weren't rocks supposed to rotate?"**: they do (v4.7 §4.4) — at the
  spec'd ±0.6°/s max for the smallest rocks (a full turn takes 10+ min),
  slower for big ones. Working as specified; visibility knob available if
  wanted.

## v4.7 "Sensation" (HANDOFF-v4.7.md) — DEPLOYED 2026-07-11

The feel release before v5: §1 vector overlay repair (34px floor, labeled
arrowhead `+10s · N m/s`, `all stop · N km` bracket glyph), §2 drift
marker + `set_overlay` verb (pure ui event, XO stock lines, translator
drift-vs-vector doctrine pinned live), §3 the ping made sensible (ping fx
with 180-sample LOS occlusion mask computed server-side — the ring tears
open behind rocks/dust; sfxPing own/enemy + range-delayed return blip,
silence = empty; red LIT countdown; flashbulb), §4 feel pass (SHIP_STERN
plume convention for v5, tier ceremony stings + faint wobble, dust
shroud + hiss, rock spin, camera shake, hull hum). Zero sim/balance
changes; ping.test.ts untouched; 460+ assertions.

**The v4.5 playtest questions remain OPEN and untuned** (carried forward
verbatim below): does the hunt phase converge? Do throttles come up? Is
the ping cost honest? v4.7 exists partly so those become answerable.

## v4.6 — phantom-ack fix + TTS quota furnace (playtest report 2026-07-11)

"Hold PDCs" was STT-heard as "Hold Pieces"; the translator emitted a
REPLY-ONLY element whose text claimed "PDCs holding" — no command ran, HUD
(truthfully) kept saying FREE. Fixes: (1) schema rule — reply-only lines
may never claim an action; if the model can name the action it must emit
the verb; (2) "pieces/PCs" mishearing hint; (3) reply-only lines now
render as dim-italic "XO (note):" so conversation can't masquerade as an
executed order; (4) spoken rumble bearings quantize to 10° — exact
bearings made every announcement a unique ElevenLabs synthesis and burned
the entire TTS quota in one day (Gabriel has since subscribed to the
starter tier). Chevrons/internal tracking stay exact.

## v4.5 "Tempo" (HANDOFF-v4.5.md) — DEPLOYED 2026-07-11

Missile retune to real engagement ranges (2400 m/s / 150 m/s² / 3 km
arming / 30° autonomous cone), 60 s decoys, 30 s reload, steeper edge pull
(300/50km — the handoff's 15 measured at 91 s turnaround vs its own ~20-25 s
intent; retuned with sign-off, ~24 s), the HEARING channel (bearing-only
rumbles at 2.5× detection, chevrons + low audio, rumble_present metric),
and the active PING (sensor_ping verb, 150 km / 5 s track / 10 s map-wide
reveal / 30 s cooldown, ping-cannot-lock pinned). 400+ assertions.

- [x] Deployed 2026-07-11 (commit 602ff00, CI green, verified live)
- [ ] Playtest: does the hunt phase now converge? Do throttles come up?
  Is the ping cost honest?

## Escalation ladder (held in RESERVE — do not build unprompted)

If playtests show the mutual-drift stalemate (both ships dark forever),
the pre-agreed order is: (1) match timer with declared draw, then
(2) slow shroud contraction. Nothing else.

## Rejected (design calls — do NOT resurface)

- **Speed-scaled ramscoop regen** — REJECTED v4.5 §0.
- **Periodic free intel sweeps** — REJECTED v4.5 §5: free intel eats the
  niche player-launched sensors (probes) should own, and flattens
  archetype signature differences at the strategic layer.
- **XO rumble triangulation** — crossing bearings is deliberately human
  skill; v5 probes are the tooling answer.

## Deferred candidates (revisit AFTER v4.5 playtests)

- [ ] **Rock belts / clustered terrain** — map-structure lever, deliberately
  held pending observation of v4.5's effects.
- [ ] **Resupply depots** — same.
- [ ] **Active sensor ping** — SHIPPED in v4.5 (was deferred here by v4.3).

## v4.4 fix patch — three playtest reports, all reproduced live then fixed

- **"Stop engines" flipped the ship** (translator read it as full_stop):
  schema rule — naming the ENGINES is thrust 0; only stopping the SHIP is
  full_stop. Verified: "stop engines" → thrust 0, "all stop" → full_stop.
- **"Spin in a clockwise circle" affirmed but did nothing**: two layers.
  Sim: relative turns collapsed to an absolute goal + shortest-arc — 360°
  normalized to "already there" (silent no-op) and >180° turns went the
  WRONG way ("starboard 270" turned port 90). Fixed with a real `turn`
  goal mode carrying signed remaining degrees (physics.test.ts §7).
  Translator: spin = one relative turn, executed for real now; continuous
  rotation stays a stated non-capability.
- **"Lock missiles then fire both" never fired**: translator emitted an
  IMMEDIATE fire (ack even said "when ready") → rejected at t=0 (no lock
  yet), lock landed at t=3 with nothing armed. Schema rule + example:
  sequenced lock-then-fire = standing order on have_lock. Verified live:
  lock t=3 → salvo t=4 → two strikes.
- Side fix: stale pre-rebase detection numbers (181/16 km) inside
  ship_command_schema.json's set_thrust description → 234/54 km.
- New guard: every schema example must pass the validator
  (translator.test.ts).

## v4.3 playtest patch (HANDOFF-v4.3.md) — DEPLOYED 2026-07-11 with v4.2

- §1 standing-order bug: CONFIRMED as the translator emitting `lte` for
  "cut thrusters at 300" while below threshold (evaluator was clean —
  regression-pinned in orders.test.ts §8/§9). Fixed with schema rules +
  verbatim example; XO readbacks now state trigger direction ("when we
  REACH" vs "if we DROP BELOW"). Verified live against the API in both
  directions (below-threshold → gte, above-threshold → lte).
- §2 XO welcomes (practice line new, both pre-generated at boot), §3
  bearing-only cursor readout, §4 single labeled 50 km ring, §5 sensor
  rebase (SENSOR_BASE 180 km, SIG_BASE 30, decoy 100), §6 handbook
  (Reading the Map box, softened stealth copy, FIG-1 rescale). 328
  assertions green.

## v4.2 delta — spectator presence — DEPLOYED 2026-07-11 with v4.3

Lobby WATCH + room code joins as a spectator: omniscient referee view,
cosmetic callsign from a fixed pool (Ghost, Watcher, Echo, ... , -2 on
reuse), SPECTATOR badge with own callsign, silent WATCHING readout in the
players' top-left map corner (collapses to a count past 3, absent at 0).
No persistence, no commands, no rematch rights, no transcript/XO noise.
21 new assertions in `tests/spectator.test.ts`; handbook §SPECTATING added.

- [x] Deploy v4.2 + v4.3 together — commit d331c95, CI green, verified live

## v4 "The Big Dark" + v4.1 addendum — DEPLOYED 2026-07-11

All ten build-order steps of `HANDOFF-v4.md` plus the full `HANDOFF-v4.1.md`
addendum (sensor-slaved PDCs, blind fire, uplinked/autonomous guidance,
seeker detection math, decoy retune 90 + fake-contact deception, cursor
bearing readout) plus the Captain's Handbook at `/how-to-play` are LIVE at
https://aye-captain.fly.dev — merged `v4-big-dark` → main, CI deploy green,
lobby + handbook verified answering in production. 280 headless assertions;
English paths verified in the browser (flank speed, vector overlay, full
stop, and "put a torpedo down bearing zero four five, fire blind" → bird
curving onto 045 with no lock). The new v4/v4.1 XO stock lines pre-generate
into the /data speech cache on boot (one-time cost per line).

**Remaining before this milestone is DONE:**

- [ ] Gabriel playtests ONLINE — especially the feel items below. Report
  batched feedback as usual; `fly logs` + `/data/utterances.jsonl` localize
  any "XO misbehaved" report.

## v4 playtest watch-list (reserved knobs, do NOT pre-tune)

- **Opening hunt** (numbers re-based by v4.3 §5): spawns 300 km apart, dark
  ships see each other at ~54 km, cruise at ~144 km. Is finding each other
  fun or a slog? Knobs: SENSOR_BASE_M, spawn distance, drone signature.
- **Stealth tax (v4.3)**: dark is now an edge, not an off-switch — does
  play still collapse into slinking, or do throttles come up?
- **Faint-fix noise** (2 km, 5 s refresh): enough texture, or annoying?
- **Lock range 80 km vs detection**: a quiet ship can only be locked inside
  ~32 km (track band of sig 30) — provoking a burn matters. Working?
- **PDC kill prob 0.25/s**: spec says saturation salvos are SUPPOSED to
  leak — resist tuning up (there's a leak-rate test pinning the intent).
- **"Break lock, then spoof" two-step escape** (v4.1 §3 design
  consequence, flagged for playtest): does breaking the uplink via
  rocks/dust/going-dark and THEN decoying the orphaned bird actually land
  as a learnable doctrine?
- **Blind fire usefulness**: seeker base 40 km — does firing into dust
  clouds/shadows ever pay off, or is it pure ammo waste?
- **Decoy-as-fake-contact**: does dropping a decoy at range actually fool
  anyone into a chase? (It reads as an ordinary faint contact to ~180 km.)
- **Propellant as delta-v** (6000 m/s budget): do matches stall dry?
  EDGE pull returns strays, but a dry drifting duel could be long.
- **Collision damage curve**: 600 m/s hit = 14 hull. Punchy enough?
- **Drone patrol at 800 m/s with 12°/s steering**: does it dodge the rocks
  reliably? (It bounces harmlessly if not — drone takes trivial damage.)
- **Torpedo terminal dodges**: 45°/s turn at 6 km/s = wide arcs. Verify the
  "dodge late to waste its fuel" counterplay actually lands.

## Carried over from v3

- [ ] **Real PvP acceptance test in English** — nobody has fought a full
  PvP duel to a kill purely by typed/spoken English. Voice makes this easy.
- [ ] **Refine STT keyword handling** from accumulated `data/utterances.jsonl`
  (pull from Fly: `fly ssh console -C "cat /data/utterances.jsonl"`).
  NO bias prompt (see CLAUDE.md) — tune via post-processing if needed.
- [ ] **Ship design pick**: interceptor is default; gunship + saucer in
  client/assets — swap `SHIP_DESIGN` in render.js.

## Improvements (suggested)

- [ ] **Prompt caching** on the translator's system prompt (large, static;
  the schema grew again in v4) to cut per-utterance cost/latency.
- [ ] **Transcript replay on reconnect** — currently rejoins with an empty log.
- [ ] **Quieter repeat standing orders** — repeating triggers log every
  firing; batch or suppress repeats after the first.
- [ ] **Contact bearing/range readout in the HUD contact panel** (currently
  tier badge only; the map shows position).
- [ ] **Rock-impact crunch heuristic**: client infers a crunch from hull
  drop while a collision warning was active — could miss unwarned grazes.

## Known quirks (documented so nobody re-debugs them)

- Rendered ship icons are clamped to 22 px for legibility; at map scale that
  is enormously bigger than the 60 m hull — visual overlap ≠ collision.
- Rootless Docker on the dev machine doesn't route `-p` published ports;
  test containers with `--network host`. Irrelevant to Fly deploys.
- Missiles that lose all seeker candidates go permanently ballistic after
  2 s (reacquire window) — intended.
- The automation-driven browser can't synthesize wheel/held-key events the
  same way a human does; camera testing uses JS-dispatched events.
