# TODO — next steps

## Patches 4+5 "The Loadout" — steps 1-6 BUILT 2026-07-14 (branch `patch-4-loadout`)

Mass (force/mass through accelOf/turnRateOf; ARCHETYPES stays THE BOOK,
internals derived — starting-loadout hulls bit-identical, whole suite
green unmodified), reactor (reject, never shed), installed≠powered
(power instant+free, DRAW IS SIGNATURE), workshop rule (full stop, 60 s,
thrust/drift aborts — tick-enforced so standing orders can't dodge it),
the five modules (baffles ×0.75 total while lit; deep array ×1.6 sensors
while lit — the EARS ring grows; armor +40 hull passive; railgun
auto-lights on fire and STAYS lit; mine layer → station-keeping IFF
mines, sig 8), landModule salvage-installs, verbs in schema/translator,
you.loadout ledger, Doctrine VII docs. 61 pins in tests/loadout.test.ts.
Step-4 gate FLOWN: power the rail while parked → disc swells past ears +
crossover line. The moment lands.

Judgment calls to review: starting modules spawn COLD (only calibration
consistent with bit-identical signature); probe rack grants +2, not the
doc's +4 (frigate book 2 pins it); looted rail arrives with 20 slugs
(fire-out/uninstall/reinstall can farm slugs — §6 rearm economy will
supersede); PDCs do NOT engage mines (unspecced, deferred).

NEXT (before the playtest, per amended build order): §5 wreck types with
module pools shrunk to the five (Military: railgun/armor/mine layer;
Survey: deep array/probe rack; Smuggler: baffles; Freighter:
consumables; type visible from t=0) + 6b bring multiplayer over (wrecks
on the MP map, salvage verb in MP, death hulks in ALL modes carrying
loadout+hold at 0.4 momentum). THEN the two-mode playtest (watch 1v1
snowballing — the lever is POWER_TO_SIG, never a handicap). After
playtest: §6 ore/refit/Mk II, §8 legibility (sprite from loadout, plume
from signature, hum from draw), §7 panel fill, rest of the catalog.

OPEN QUESTION (blocks the campaign leg): do modules REPLACE the campaign
§6 upgradeCounts stat-bumps, and how does the loadout persist in run
state (invariant 21 localStorage + coopCarry)? The doc implies
replacement — Gabriel's call.

## Patch 3.5 "Two Rings" (ADDENDUM-PATCH-3-TWO-RINGS-v2.md) — BUILT 2026-07-14

The 50 km ring is gone from the main view (every new player misread it
as a sensor boundary — and they were right to). In its place: the VOICE
disc (soft filled coral, breathes with signature — reference SENSOR_BASE
hearing us) and the EARS ring (dashed teal — our suite hearing a
reference SIG_BASE hull). Both are ESTIMATES against the book, never any
real enemy's stats (🔴 pinned in tests/rings.test.ts, with the
no-proximity-alarm-through-fog pin — ringState in client/rings-model.js
is a pure function of you + fogged contacts, the music-brain law). XO
crossover lines are edge-triggered stock lines; "That's the book,
Captain. He may not have read it." goes out once per match, all modes.
The B compass is now a fixed-SCREEN-radius ticked protractor carrying
the rumble chevrons (bearing-only contacts no longer sit on a lying
range ring); the ruler moved to the inset (concentric 50 km rings).
Frigate identity note: its voice EQUALS its ears at zero throttle
(SIG_BASE/SENSOR_BASE are its stats) — any thrust makes it prey.

- [ ] Playtest BY EYE: disc fill/rim alphas (RING_STYLES in render.js),
  the crossover tint, whether the full-screen wash when deep inside your
  own voice reads as information or noise.
- [ ] Watch: does the ears ring tempt captains to treat it as a hard
  detection promise? It's the book, not the enemy.

## Side panel redesign (Claude Design "Side Panel" synthesis) — BUILT 2026-07-13

The flat HUD grid replaced by the designed panel: identity row, teammate
strip (absorbs the Patch 2 §3b "temporary placement" item — teams mode
gets it free), speed/hull hero, propellant dial + signature vocabulary
(QUIET/LOUD/SCREAMING display bands at the old color thresholds — words
never gate anything), campaign MISSION block (hunter clock, gate
solution, closing phases, salvage clock, wreck-in-range hint), the FIXED
ten-lamp annunciator (lamps light in place, nothing reflows — pinned),
CONTACTS row (tier vocabulary kept, v4.7.2), posture display, armament
cards, HOLD ledger (new `mission.hold` wire field — the only wire
addition), standing orders with a wired × (cancel_label via the raw-JSON
pipeline), footer with sliders/verbosity/EXIT. View-model is PURE
(client/panel-model.js, tests/panel.test.ts — 40 assertions incl. decoy
indistinguishability at the panel and ally-bird exclusion from MSL
INBOUND). Drive-by fix: ally missiles no longer trigger the enemy-launch
sting/lock reassert (main.js — sim.ts always promised "friendly paint,
no alarm"). Deviations from the design, deliberate: JETTISON omitted (no
cargo model exists — hold items are applied consumables; HOLD renders
the ledger), reactor placeholder shrunk to one line (no fake power
bars), THRUST restored to the hero sub-line, CONTACTS row restored,
posture control display-only (a click would bypass the XO's
price-quoting doctrine — decide before wiring).

- [ ] Playtest with the co-op flight: does the lamp grid read at a
  glance? Is the teammate strip's two-line wrap at 380px acceptable?
- [ ] If captains start flying to "keep it QUIET" as if the sig words
  were mechanics, consider dropping the words (invariant-13-adjacent).

## CAMPAIGN PATCH 2 "Two Ships" (HANDOFF-CAMPAIGN-COOP.md) — DEPLOYED 2026-07-13

Merged from `campaign-coop`, all sections, 1,186 assertions green (incl.
the same-day playtest fixes: discipline-honest stop bracket, the
salvage-orbit hop alignment gate). Step 0
(Anvil §9 verify) found mission.playerId still SINGULAR — converted to
playerIds[] with per-captain salvage clocks + gate-solution bookkeeping;
hunterDecide was already a pure snapshot query. Built: §7 the co-op room
(CREATE CO-OP RUN, ordinary room-code lobby capped at 2, hull picks
visible, run lives in the Match — coopCarry map, no save), crew on a
shared transponder team (v5 §8 gives allies/IFF/PDC safety free); §1
loudest-signature targeting (contacts carry `loud` = the hearing scalar
sig/LOUD_SIG_REF — "the sound doesn't stop when you can see it";
cadence 5 s + hysteresis 1.4x louder / 0.6x closer, and the CLOSER gate
breaks near-ties only — the §8 checkpoint caught the bait dying the
moment it opened the range); §3 teammate strip (allies + propellant/sig;
▲ marks the louder; inset dots) + the XO loudness read (margin 1.15,
cooldown 20 s, hunter-gated, fixed spoken lines) + TEAMMATE state-summary
line; §4 death = role change (survivor's-eyes snapshots labeled coopEyes
— NEVER omniscient, pinned; hulk carries the whole hold at 0.4 death-v;
fresh base ship + empty hold next system); §5 the gate needs the whole
crew (through-ships FROZEN + departed — off every board, carry still
readable; first-through coaches; stranded_death with a partner through
keeps the run alive); §6 come_alongside (campaign-co-op-only verb, exact
salvage rendezvous — existing salvage tests passed UNCHANGED; give
manifest crosses per SALVAGE_ITEM_S cheap-to-dear, clamps honest, abort
keeps what crossed; verified against the live API incl. the
"give Kestrel two missiles = one command" phantom-ack trap).

- [ ] **Playtest with two humans (build order step 7 — Gabriel + friend).**
  Watch: does the bait play LAND as a story? Is the loudness read audible
  enough to drive it (LOUD_CALL_MARGIN 1.15 / COOLDOWN 20 s first-guess)?
  Does coach-mode spectating feel like coaching or like a bench? Transfer
  pacing (SALVAGE_ITEM_S per consignment) — ceremony or chore?
- [ ] §2 by design: Hunter ladder UNMODIFIED for two players — if too
  easy the lever is HUNTER COUNT (forces a split), never stats.
- [ ] Retarget knobs are first-guess: HUNTER_RETARGET_EVERY_S 5,
  LOUDER 1.4, CLOSER 0.6 (near-ties only).
- [ ] Judgment calls to sanity-check in play: rumors/wreck board SHARED
  between partners (run-level state; only the resolver's XO speaks);
  loudness read gated on a live Hunter; dead captain's hulk is MARKED
  (the Hunter patrols the corpse — a trap, intentionally); scuttled
  (disconnect-timeout) co-op ships leave NO hulk (quiet forfeit).
- [ ] Client is browser-verified only lightly — first co-op lobby flight
  should watch: lobby copy, teammate strip layout (temporary placement,
  §3b — Patch 3 absorbs it), coopEyes badge, run-map flow for the
  spectating partner.

## CAMPAIGN PATCH 1.1 "The Anvil, Sharpened" (HANDOFF-CAMPAIGN-ANVIL-1.1.md) — BUILT 2026-07-13

Branch `campaign-anvil-1.1`, all sections, 1,043+ assertions green.
Playtest verdict absorbed: Hunter finds/presses ✓, but the bounty failed
(2 km/s corpse into deep space) and the gate close was illegible. Built:
§3a the missM HULL-RADIUS fix (SOLUTION GOOD while scraping a pylon was
the mystery rock — pinned) + §3c aperture 3000→3600 (band re-checked);
§2 MANEUVER DISCIPLINE (the big one): silent 25 / standard 60 (NEW
DEFAULT, was 100) / flank 100, set_maneuver_discipline verb + per-command
override, XO quotes the price (silent ETA in minutes, flank warning),
timed burns exempt, synonyms verified against the live API; §1 the hulk
is a live decision — momentum retention 0.4 (direction preserved: kill
quality still decides pay), rock collision (crunch, keep loot, never
despawn), the SHROUD CURRENT (unpowered bodies entrained back inside,
~174 s from max escape, arriving ~80 m/s; ships keep the old edge pull —
pinned); §5b rendezvous PURSUE (braking envelope to engage range, no
yo-yo — ≤1 reversal pinned) + §5a burn-leash verified at max speed; §4
railgun tiers (ID pinpoint / TRACK ±1.2° cone / FAINT bearing-only); §6
propellant refills per jump (hull/missiles/ammo attrition — pinned,
don't re-litigate); §3b gate phases GRACE 240 + CLOSE 180 (7 min total,
tune DOWN), GATE STABLE / GATE CLOSING HUD states, grace-end NEWS line.

- [ ] **Playtest, report** (§8.7). Watch: does the hulk chase-or-wait
  decision land? Hunter quieter under discipline doctrine — too quiet?
  (§2e: raise his default if unhearable.) Is 7 minutes the right vise?
  (knob: GATE_CLOSE_DURATION_S, never a floor.) Silent-approach ETA
  quotes accurate enough to trust?
- [ ] Datum/current knobs are first-guess: SHROUD_CURRENT_* (174 s
  return), RAIL_TRACK_DISPERSION_DEG 1.2, HUNTER_CLOSE_RATE_FLOOR 150.
- [ ] The Mine Layer is BANKED (§9 — reached for unprompted mid-flight;
  anchor of the module catalog. NOT before the module patch.)

## CAMPAIGN PATCH 1 "The Anvil" (HANDOFF-CAMPAIGN-ANVIL.md) — BUILT 2026-07-13

Branch `campaign-anvil`, all sections, 1,002 assertions green. §1 the
Hunter works: hard leash (every waypoint/intercept clamped to 0.9R, the
boundary in AVOID via braking-distance, never-exits pinned at sim level),
datum search (uncertainty circle r = age × MAX_SPEED, golden-angle spokes
— sitting still gets you found, coasting away doesn't), escalation by
UNCERTAINTY (probes seeded on the circle past 60 km, pings past 120 km
with frequency ∝ r; never below threshold — pinned; old dry-spell spend
survives for the datum-less cold hunt). §5 corvette turn 28 → 39.2
(+40%), aperture pins re-derived, ordering holds. §3 relative salvage —
the transfer gate and the whole XO approach run in the WRECK'S FRAME
(|v_rel|; existing salvage tests passed UNCHANGED — the §3b proof) — and
the Hunter dies into a HULK carrying his exact velocity (integrates, no
collision, no decay, shroud drag, never clamped inside). §2 bounty
placeholder: 6 pieces, TWO modules. §4 the closing gate: last Hunter's
death arms it (CRITICAL line), linear to EXACTLY ZERO across 180→300 s,
pylons creep to a contiguous wall (client re-derives them from the live
aperture — nothing extra on the wire), 50%/25% NEWS calls, GATE CLOSING
HUD row, in-system at closure = RUN ENDED — STRANDED (no boom — the
silence is the point). THE VISE pinned: a far-side cruiser at
close-start falls ~250 km short.

- [ ] **THE §0 GATE: playtest verdict before ANYTHING else is built.**
  Fly it: does the Hunter find you, press you, and stay audible doing it?
  Does the bounty chase feel like a bet (not a chore)? Is the 120 s
  closing window right? (§4a: if too tight the knob is GATE_CLOSE_END_S
  — never a floor, never APERTURE_W_M.)
- [ ] Watch: datum-search knobs are first-guess (spoke 0.6r, probe band
  60 km / 30 s cadence, ping band 120 km / 75 s base interval).
- [ ] Watch: does killing one of the Pair while the second hunts read
  correctly? (Judgment call: the gate arms on the LAST Hunter's death,
  not the first.)
- [ ] Watch: corvette +40% turn in normal flight — this was the wanted
  turn-rate pass, corvette leg only; frigate/cruiser unchanged by spec.
- [ ] Forward architecture honored (§9): no new constants.ts stat reads
  in touched paths (statsOf(ship) accessors), no new singular-player
  assumptions, no shop/credits.

## TTS quota economy (2026-07-13)

Audit: 15.5k/30k credits gone in ~2 days; the Fly speech cache showed
~1,340 dynamic one-off lines (904 on Jul 12 alone) vs ~140 stock — the
v4.6 furnace generalized: FREEFORM SPEECH NEVER RE-HITS THE CACHE.
Shipped: (1) every cache-miss synthesis logs text+chars to console (fly
logs) and SPEECH_SYNTH_LOG (/data/speech-synth.jsonl); (2) dynamic acks
voice a bounded 3-line phrasebook (ACK_SPEAK_LINES, deterministic
per-text pick) and query answers voice QUERY_ANSWER_SPEAK — full text
stays in the transcript; standing-order readbacks exempt (v4.3: the
voice must state trigger direction). Pinned in speech.test.ts §8.

- [ ] After the next playtest, read the synth log for remaining furnace
  shapes. Known still-freeform speakers (deliberate, priced later):
  xo-note replies (conversation), comms transmissions (MESSAGE_MAX_CHARS
  is the cap), rejection reasons (mostly fixed strings from sim).
- [ ] Local dev burns the same key into a separate cache (data/speech,
  337 files) — blank ELEVENLABS_API_KEY in .env for silent dev days, or
  sync the Fly cache down once.
- [ ] If the phrasebook isn't enough: a daily dynamic-synth budget guard
  in tts.ts (stock cache keeps playing past the cap).
- [ ] tests/speech.test.ts §7-8 fire real HTTP at ElevenLabs with a fake
  key (harmless 401s, but tests shouldn't touch the network) — stub the
  fetch someday.

## Campaign "Deep Black" (HANDOFF-CAMPAIGN-v1.md) — RELEASED 2026-07-12

All stages + four playtest patch rounds (rumor resolve-by-presence,
haul manifest, lettered sites + 15 km envelope, Hunter leash +
ping/probe escalation, bearing compass). Stage 0 passed its tension
playtest; Gabriel flew stages 1-4 across several sessions and called
the merge. Built: §4 salvage (marked/rumored wrecks, full-stop
cost, sequential worst-first haul, abort keeps landed items, Hunter
drops the best wreck), §6 progression (pools persist across jumps;
upgrade modules = multipliers at the ship stat choke points), §1
multi-system runs (localStorage run state — client-owned BY DESIGN,
invariant 21 — run map between systems, CONTINUE RUN from the menu), §3
the 8-row ladder (Drifter → Wolfpack; multi-Hunter spawns with pack
spacing; gate-camping pickets late rows only; named spawn lines), §9
run summary + best run, §7 the adaptive score (music-brain.js PURE and
fog-tested BEFORE the oscillators — tests/music.test.ts is
mandatory-green; audio driver with speech/alarm ducking + the rumble
sidechain; MUS slider), §8 exit spectacle (silence beat, rising tone,
flash, starfield streak, resolve), §11-12 salvage verb + gate/mission
XO vocabulary (both playtest findings fixed: gate-as-contact, doubled
shroud line) and the how-to-play CAMPAIGN tab.

- [ ] **Post-release watch-list** (do not pre-tune): the deep-run arc —
  "system five is when they start coming in pairs" (rows 5-8 were never
  flown to). Does the score have a soul, and is the Jaws-silence right
  (BY EAR)? Multi-Hunter valve: if S5/S7 feel unwinnable, the knob is
  SENSOR RANGE, never count. Dry-Hunter watch item still open. Does the
  Hunter's first desperation PING land as a moment (HUNTER_DRY_SPELL_S
  75 is a first guess)? Dev knobs: `{"mission":{"sigMult":..,
  "sensorMult":..,"hunterSpawnS":..}}`.
- [ ] **Turn-rate tuning pass wanted** (Gabriel, 2026-07-12, end of the
  release session): turning feels off — no specifics captured yet, just
  the instinct. Turn rates are archetype identity (28/20/14 °/s) and
  LOAD-BEARING in the aperture derivation (campaign.test.ts pins the
  per-archetype gate envelope to live accel/turn constants — retune the
  two together, and expect that test to force the conversation).
- [ ] Ladder numbers are FIRST-DRAFT (rows 3-8 multipliers/contents were
  never flown) — expect a tuning pass from the playtest.
- [ ] Wreck contents/counts (2 marked + 3 rumored, 35% dry rumors outside
  dust) are first-draft economy — same.
- [ ] **Live finding (Chrome run-through 2026-07-12): the Hunter killed
  ITSELF on terrain** — went quiet with no shot fired (it appears to have
  hit the gate pylons or a rock while pursuing near the rim). Free wins
  cheapen the trap-or-run decision; watch how often it happens in real
  play. Candidate fixes if frequent: pylons in the Hunter's AVOID pad
  list get a bigger margin, or the AVOID lookahead scales with speed. Do
  not fix preemptively — one occurrence, maybe seed-specific.
- [ ] Same run-through validated by accident: the pylon clip at speed is
  survivable (hull 100→31, "so close"), the shroud overshoot recovery is
  a real (miserable, correct) loop, and dry-tanks-mid-brake is the
  dominant failure for a greedy pilot — all three §5 failure modes fired
  organically in one session. The XO's terminal salvage approach
  ("Coming alongside") flew a 300 m dock from a 5 km handoff.

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
