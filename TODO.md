# TODO — next steps

## GPT AUDIT RESPONSE (2026-07-15) — approved, not yet built

Gabriel dropped `AYE, CAPTAIN.pdf` in the repo root: a 42-page static audit by
ChatGPT ("Simulation, Fiction, Fairness, and Voice-Command Design Audit"). It
never ran the game or the tests, and says so. **Every claim below was verified
against the code by six parallel agents before this list was written** — the
verdicts are ours, not the PDF's. Gabriel approved this whole list on
2026-07-15; nothing here is built yet.

**The audit's headline verdict is worth keeping**: "optimize for physically
consequential command, not maximum realism." Its mechanism reads are almost all
accurate. Its NUMBERS are where it fails, and always the same way: it read the
frigate-linked legacy globals (`SENSOR_BASE_M`, `ACCEL_FULL_THRUST_MPS2`,
`TURN_RATE_DEG_PER_SEC`) as universal law, and it quoted at least one constant
from a version we explicitly superseded.

**🔴 DO NOT BUILD — verified wrong, do not let a future session "fix" these:**
- **Mines inheriting velocity** (audit §2.6, its Option A). It calls the zero
  velocity "the second-clearest physical error" and assumes an oversight. It is
  DELIBERATE and documented three times — `constants.ts:140-143`, `sim.ts:467-471`,
  and `HANDOFF-PATCH-4-5-LOADOUT.md:163,170`: *"cold-gas trim — a drifting mine
  would just follow its layer home."* The `Mine` interface (`sim.ts:472-479`) has
  no velocity FIELD; it was never modeled, not forgotten. Option A deletes the
  module: a fleeing ship's mines would travel WITH the fleeing ship and never
  enter the chaser's path, killing the whole "the chase becomes the trap" premise.
  Its Option B ("make the fiction explicit") is already done in comments — the
  only real gap is that the player never hears it (see Tier 1 item 5).
- **Removing the missile speed cap** (audit §2.4). It claims missile max is
  6000 m/s (2x ship) and wants ~3.75 km/s of delta-v. Real value:
  `MISSILE_MAX_SPEED_MPS = 2400` (`constants.ts:362`), deliberately **0.8x** ship
  max. `constants.ts:356-361` names the trap out loud: the 2x-ship-max link was
  INTENTIONALLY BROKEN in v4.5 because 6 km/s was a no-counterplay zone at real
  engagement ranges. 6000 is `RAIL_SLUG_SPEED_MPS` (`constants.ts:266`) — it
  appears to have grabbed the railgun's constant or read a pre-v4.5 doc.
- **Reducing PDC variance / "deterministic exposure"** (audit §2.7, §4.3). It
  derives ~50/50 from a 2.7 s bubble transit. Real transit at 2400 m/s is 3.33 s
  → ~57%, and `tests/pdc.test.ts:107-110` documents that as *"the spec's intent."*
  It is arguing against a number the game does not have. (Its OTHER PDC claim —
  the ammo asymmetry — is real; see Tier 2 item 8.)
- **§5.2 routing / first-stage classifier.** Prompt caching (Tier 1 item 1) gets
  the same cost win with none of the semantic risk of a classifier picking the
  wrong schema subset. Do caching first, then re-evaluate; probably never needed.
- **Compositional speech from cached fragments** (audit §5.4). Its motivating
  example ("Coming to zero-nine-zero") already speaks NOTHING —
  `HUD_VISIBLE_ACK_VERBS` (`match.ts:68`) deliberately suppresses speech for
  `set_thrust`/`set_heading`/`set_pdc`/`set_overlay` because the HUD shows it. And
  our proven technique (`spokenBearing`, `sim.ts:742-758`) already achieves
  cache-boundedness by CAPPING VARIANTS (36 per line shape), with no clip-concat
  machinery. No audio concatenation exists (`audio.js:547` is one buffer per line,
  and `speech-scheduler.js` promises "one line at a time"). Not worth building.

### Tier 1 — ✅ SHIPPED 2026-07-15 (merged + deployed)

All five landed in one commit. Zero sim/balance change. Measured outcomes and
corrections to what this file originally claimed:
- **Caching is live and verified against the real API.** The prompt is
  **16,421 tokens** (this file said "14–15k" — that was an estimate from char
  count; 16,421 is measured). Cold call writes 16,421; every call after reads
  16,421 with only 8–25 tokens uncached. **`temperature: 0` does NOT invalidate
  the prefix** — that was the open question and it is answered: verified read on
  the true production request shape. ~90% off the input cost of every utterance.
  Boot prewarm logs `translator: prompt cache warm (16421 written, 0 read)`.
- 🔴 **Correction — the ping pin claim in this file was too strong.** It said "a
  future reordering would break invariant 14 with a green suite." Not quite:
  removing the float-dust guard fails the EXISTING test 5 too (verified RED).
  What test 5b uniquely buys is catching margin DRIFT — a grant worth 3 ticks
  instead of 4 still never locks, so test 5 stays green while the mechanism has
  silently moved. 5b pins `maxProgress === PING_TRACK_S - 1` exactly. Verified
  it fails without the guard (`want 4, got 5`) before shipping.
- **A second prompt lie was found while fixing the first** (not in the original
  approved list, fixed anyway — same bug class, one line): `translator.ts` taught
  the LLM *"At zero: no thrust output (setting remembered)"*. That rule was
  REVERSED by the 2026-07-13 playtest — the code auto-safes the throttle to zero
  (`sim.ts:5089-5107`, pinned `propellant.test.ts:67`). The prompt had kept
  teaching the deleted rule. **This is the "state summary IS the LLM prompt"
  lesson recurring a second time — when a rule changes in the sim, grep
  translator.ts before closing the ticket.**

The original analysis follows, kept because it is the evidence trail.

**1. 🔴 PROMPT CACHING — the biggest win, and the audit missed it entirely.**
The audit's §5.2 complains the prompt is too big. Size isn't the problem; the
problem is we re-send it UNCACHED on every single utterance, for every captain,
every time.
- Evidence: `translator.ts:29-74` `buildSystemPrompt()` → `translator.ts:76`
  `const SYSTEM_PROMPT = buildSystemPrompt()` (built ONCE at module load) →
  `translator.ts:542` `system: SYSTEM_PROMPT` as a plain **string**. Zero hits for
  `cache_control`/`ephemeral` anywhere in `server/`.
- Size: **54,870 chars ≈ 14–15k tokens.** The schema is 56% of it
  (`translator.ts:37`, `JSON.stringify(schema.definitions, null, 1)` —
  pretty-printed, so indentation alone is thousands of tokens).
- **The prefix is already 100% static — VERIFIED.** `translateUtterance`
  (`translator.ts:529-547`) puts the dynamic state summary + utterance in
  `messages`, not `system`. This is the textbook ideal caching case. It is a
  one-line change:
  ```ts
  system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
  ```
- Model is `claude-haiku-4-5-20251001` (`constants.ts:494`). **Haiku 4.5's minimum
  cacheable prefix is 4096 tokens** (higher than most models — Sonnet is 1024); we
  are ~15k, well clear. Below the minimum it silently does not cache, no error.
- **TTL: keep the 5-minute default** (`{type:"ephemeral"}`). In-match utterances
  are far closer than 5 min apart, so real traffic keeps it warm. `ttl: "1h"`
  doubles the write cost (2x vs 1.25x) and needs 3+ reads to pay off — only worth
  it if we later measure long idle gaps mattering.
- **Also pre-warm at boot.** A cache entry is only readable once the first
  response STARTS STREAMING, so N concurrent first-utterances in an 8-captain room
  all miss and all pay full price. `LLM_TIMEOUT_MS = 5000` (`constants.ts:495`) —
  a cold 15k-token prefill eats into that budget. Fire one `max_tokens: 0` request
  at boot with the same system array (returns immediately, `content: []`, zero
  output tokens billed, normal cache-write charge). `tts.ts` already
  pre-generates stock lines at boot — same pattern, same rationale.
  Caveat: `max_tokens: 0` is rejected with `stream: true`, `thinking.type:
  "enabled"`, `output_config.format`, or forced `tool_choice` — none of which we use.
- **Verify by:** `resp.usage.cache_read_input_tokens > 0` on the second utterance.
  If it stays 0, something is invalidating the prefix — diff the rendered bytes.
  Note `input_tokens` then reports only the UNCACHED remainder, so the log lines
  will look smaller; total = input + cache_creation + cache_read.
- Do NOT minify the schema first. Once cached, the indentation costs ~nothing, and
  changing the bytes is a one-time invalidation. Caching, then measure.
- `phraseQueryAnswer` (`translator.ts:572-585`) is a SECOND call per query but its
  system prompt is ~180 chars — far below the 4096 minimum. Leave it alone.

**2. 🔴 The `NO RAILGUN` lie — a real invariant-12 violation, shipped in Loadout.**
The audit's §4.7 frames this as a language choice; it is actually a bug. There is
NO hull restriction anywhere — `landModule` (`sim.ts:3908-3917`) checks only slots
+ reactor headroom, and `tests/loadout.test.ts:144-151` deliberately pins a
corvette looting and mounting a rail with the note *"that is a build; let it
hurt"* (`RAIL_SLUGS_LOOTED`, `constants.ts:133`, exists ONLY to serve that case).
A corvette can even AUTO-INSTALL a looted rail with no workshop time (reactor 6,
rail draws 2 — headroom is trivial). So the chassis model is the built, tested
intent, and the text is now false:
- `client/ship-select.js:15` — "Light armor and **no railgun**"
- `client/ship-select.js:116-122` — comment "the railgun's ABSENCE is a headline",
  renders a literal `NO RAILGUN` headline
- `README.md:99` — "no railgun"; `README.md:174` — "a Corvette mounts none"
- `constants.ts:39`, `constants.ts:253` — "the corvette's keel can't take one" /
  "can't take a spinal mount": a fiction the code does not enforce
- `constants.ts:107` is still ACCURATE (it scopes to `STARTING_LOADOUT`) — leave it.
Fix the text to the chassis framing (archetypes are STARTING HULLS, not permanent
classes). Invariant 12 = same commit updates `/how-to-play` AND README.
**Drive-by, same bug class:** `README.md:110-112` says install/uninstall "is the
workshop rule: a full stop, ~a minute, helpless" with no salvage exception — but
salvage-landing bypasses the workshop entirely (`sim.ts:3904-3905`: "the stop that
landed it WAS the install"). Also false; fix in the same pass.

**3. Log the `gameover` event — the cheapest 20% of the audit's Phase 0.**
Verified: telemetry is TOTAL zero. `server/datalog.ts` is 58 lines and logs only
utterances (`logUtterance`, `:21` — and its own comment says it's for STT tuning,
not balance) and TTS cost (`logSynth`, `:45`). No sim/match telemetry: no
outcomes, no win rates, no weapon events. **0 of the audit's ~14 Phase 0 metrics
are collected.** But the `gameover` event ALREADY EXISTS with everything we need
(`match.ts:1396-1428`: `winner`, `winnerName`, `placementNames`, `durationS`) and
is sent to clients — it is just never written to disk. Add `logMatch()` beside
`logUtterance` in datalog.ts, called at `match.ts:1428`. Buys archetype win rate +
match duration immediately.
🔴 **Invariant 18**: log the ARCHETYPE, never the player NAME. Names are a
security boundary + display-only; `winnerName`/`placementNames` are right there on
that event and must not land in a log we later feed anywhere near a prompt.
Everything else in Phase 0 (time-to-first-rumble/faint/track/lock, missile
survival by range, PDC exposure, decoy diversion, rail hit rate by tier) needs new
`sim.ts` instrumentation — separate, bigger job; do the free one first.

**4. Pin the ping/lock margin — do NOT change the constants.**
Audit §4.4 wants `PING_TRACK_S` 5→4 or `LOCK_TIME_S` 5→6 for legibility. It is
right that the tie is opaque, but wrong about the mechanism (it credits
"expiration and grace sequencing"; **grace does nothing** — `sim.ts:3695-3703`, the
non-holding branch only decrements grace and never accrues; progress caps at 4
whether grace is 2, 0, or 200). What is actually true is worse:
- Both are 5 (`constants.ts:246`, `constants.ts:332`). The invariant survives by
  **exactly one tick**, purely from sampling order: timers decrement in `stepShip`
  (`sim.ts:4705`), `updateLock` runs on the last substep (`sim.ts:3430`), so
  `pingGrantS` is always read AFTER decrement → max progress 4 < 5.
- 🔴 **It rests on a float-dust guard.** `sim.ts:4699-4702` snaps timers to zero
  below 1e-9, and its own comment says why: without it, `5 - 0.1x50` in IEEE754
  leaves ~1e-15 > 0, buying a fifth track-tick and completing the lock the design
  forbids (invariant 14).
- `tests/ping.test.ts:99-117` pins the OUTCOME (`!everLocked`) but NOT the margin —
  so a future reordering of `stepShip` vs `updateLock` would break invariant 14
  with a **green suite**. This is exactly the "pin the mechanism, not the
  invariant" lesson from the 2026-07-15 playtest round, live again.
- **Do:** add a pin asserting `maxProgress === 4` + a comment. Leave both
  constants alone (`CLAUDE.md:298-301` gates them on design signoff). Blast radius
  if we ever DO change them: `PING_TRACK_S` = 1 production read (`sim.ts:1607`) + 1
  test file; `LOCK_TIME_S` = 5 production reads incl. the LLM prompt
  (`translator.ts:47`) and a hardcoded "(5)" comment in `hunter.ts:296`, + 12 test
  files. All test usages are constant-relative, so **the suite would not notice
  either change** — another reason to pin the margin now.

**5. Surface the mine fiction to the player.**
The audit's Option B is already written — in `constants.ts:140-143` and
`sim.ts:467-471` ("cold-gas trim"). The player just never hears it. Add it to
`client/how-to-play.html` (and README per invariant 12), and consider one XO line
on the first mine drop. Zero sim change. This closes the audit's §2.6 honestly
without touching the module.

### Tier 2 — ✅ SHIPPED 2026-07-15 (merged + deployed, suite 1,473 green)

🔴 **SHIPPED BUT UNPLAYTESTED — this is the next thing to do.** Thermal and PDC
are the first real BALANCE changes since v5.1's §0 "zero sim/balance changes"
law. `THERMAL_DECAY_PER_S = 10` and `pdcChannels` 1/2/3 are FIRST GUESSES, not
tuned numbers — they were chosen to be defensible, not to be right. Fly them
before building anything else on top:
- **Thermal, by feel**: does "ten seconds to cold" read as tense or tedious?
  Watch the voice disc drain — that is the whole feedback channel. If cutting
  the drive feels pointless, the rate is too slow; if darkness feels free, too
  fast.
- **PDC channels, by outcome**: does a salvo saturating point defense read as a
  real play or an auto-win? The corvette (1 channel) is the hull to watch.
- The two-mode Loadout playtest (1v1 + 6-player FFA) was already the gating
  milestone and now covers these too. The wreck-fairness fix landed BEFORE it
  rather than poisoning it.

Measured outcomes and corrections:
- **Thermal**: built as a decaying floor under the sustained emission. Full
  burn → cut → still 130, decaying 10/s to cold at +10 s. Verified live that
  the XO's doctrine followed: *"Engines cold. Signature bleeding down — we'll
  be dark in ten seconds."* Two judgment calls flagged in the commit: weapon
  SPIKES stay out of thermal (else a 5 s launch flash becomes ~20 s of glow),
  and the floor goes INSIDE the multipliers (the audit's literal
  `max(emission, thermal)` would bypass baffles).
- **Wreck fairness**: the bug was worse than this file said. Measured across
  40 seeds BEFORE touching it: 8-player median spread **177 km**, worst seed
  **286 km**. Fixed by best-of-8 rather than a threshold — perfect fairness is
  geometrically impossible (8 spawns on a ring, ~2 rich wrecks → ~85 km floor),
  so any threshold would have been invented. After: 8p median **91 km** against
  that ~85 km floor; worst case 286 → 134. Solo/practice bit-identical (pinned).
- 🔴 **PDC: I did NOT build what the audit asked for, deliberately.** It wanted
  hard channels; with 1 channel and 2 missiles that never engages the second
  bird at all, so it lives every time — a cliff. Built throughput division
  instead: `pdcChannels` targets at full rate, time-slice past that. The
  single-target case is EXACTLY unchanged (fraction 1), so the ~57% envelope
  kill the spec intends never moved. Verified the pins fail without the fix
  (1-channel corvette vs a 4-bird salvo: 21.4% killed/s → 6.6%).
- 🔴 **I violated invariant 12 and caught it before pushing.** Thermal and PDC
  shipped without docs, and the LLM prompt promised "25%/s kill chance EACH" —
  a lie I wrote myself two commits earlier. That is the THIRD prompt-vs-code
  drift found today (railgun, propellant, this one). **The rule is now: a sim
  rule change is not done until you have grepped translator.ts.**

The original analysis follows, kept because it is the evidence trail.

### Tier 2 — the original analysis

**6. Thermal signature memory (audit §2.10 / §7.1) — its best idea.**
Verified TRUE: `signatureOf()` (`sim.ts:990-1010`) is a pure function of current
state — no smoothing, no decay. `ship.thrust` has no slew rate (assigned outright,
e.g. `sim.ts:4870`) and module power is instant by doctrine (`translator.ts:52`).
So cut thrust / power down and the very next call returns the lower number.
Why it lands cleanly:
- **One chokepoint.** `sim.ts:1006-1008` says so itself: *"Every detection consumer
  (tiers, hearing, seekers, PDC slaving) flows through here, which is the point."*
  ~15 server call sites read it; **zero client changes** (clients are pure
  functions of the wire — `rings-model.js:14`, `panel-model.js:206`,
  `music-brain.js:39` all read wire fields, never compute signature).
- **The Hunter inherits it free** — `hunter.ts` has zero `signatureOf` references;
  it consumes the fogged `loud` scalar.
- **The pattern already exists INSIDE the function**: `sigSpikeLaunch/Pdc/Rail`
  rise instantly and decay on a clock (`sim.ts:4693-4695` decrement,
  `sim.ts:996-998` consume). Square pulses rather than exponential, but the
  state-field + tick-decrement + read-in-`signatureOf` shape is exactly it.
- **Invariant 13 is NOT violated** (checked): the law bans THRESHOLDS in the
  hearing channel; a continuous decay term and `max(a,b)` are continuous (C0).
🔴 **Correction to the audit's design:** it says `max(currentEmission,
thermalSignature)`. Applied naively that BYPASSES baffles and `sigMult`, which
multiply the TOTAL at `sim.ts:1004-1009` — a ship could light baffles and see no
effect while thermal dominates, contradicting the stated "honest math, no special
case" intent at `sim.ts:999-1002`. Apply the `max()` to the PRE-multiplier sum, inside
the multipliers.
Other watch-items: invariant 8 says signature uses EFFECTIVE thrust, so a dry ship
currently goes dim instantly — thermal changes that (probably desirable, but it's a
stated rule). And a thermal floor keeps a frigate above `SIG_BASE` after any burn,
which will perturb ring-crossover timing (`constants.ts:195-201` — the frigate
sits exactly on that boundary; that's why `RINGS_CROSSOVER_HYSTERESIS` exists) and
`tests/rings.test.ts`. Audit's Test C suggests 5/10/20 s; it recommends starting at 10.

**7. Wreck placement fairness in MP — a concrete bug (audit §4.6).**
Verified real. `Match.generateWrecks` (`match.ts:315-381`) does rejection sampling
(60 tries) but rejects only two things: inside a rock (`:342`), and within 30 km of
**one hardcoded point** (`:343`) — `(0, -SPAWN_RING_RADIUS_M)`, which is the
CAMPAIGN south spawn (`match.ts:203`, `:400`). MP ships spawn distributed around
the ring (`spawnShips`, `match.ts:881`), so in multiplayer that exclusion protects
an arbitrary compass point that may be nobody's spawn, and protects no one else.
Worse: **wreck type is rolled independently of position** (`:352`, `:369` —
`rollType()` never sees `p`), so a `military` wreck (27%, `:320`) can land next to
one player and 200 km from another. MP wrecks are all-marked/public from t=0
(`match.ts:831-833`), so it's a VISIBLE unfair race — the worst case. The audit's
prescription is right: don't demand symmetric maps, demand MEASURED ones (nearest
high-value wreck per spawn, expected loot within 50/100 km, cover count, gate
distance, initial LOS between spawns) and reject statistical outliers.
🔴 This matters NOW: the two-mode Loadout playtest (1v1 + 6-player FFA) is the
gating milestone, and it is exactly the thing this bug would poison.

**8. PDC ammo-vs-targets asymmetry (audit §2.7) — real, but lower priority.**
The HALF of its PDC section that survives verification. `stepPdc`
(`sim.ts:2370-2436`) is three unbounded loops (missiles `:2370`, probes `:2394`,
mines `:2414`), each rolling `Math.random()` independently per target, with no
break/counter/cap. Ammo decrements ONCE per substep regardless of target count
(`sim.ts:2458-2462`, `if (firing) ship.pdcAmmoS -= dt`) — `tests/pdc.test.ts:58-61`
pins exactly that. So one mount engages unlimited objects at the same ammo cost.
**The codebase already knows the pattern**: the ship-fire branch
(`sim.ts:2438-2447`) deliberately tracks ONE hull, with a comment noting several
may qualify. So a capacity limit would be idiomatic, not novel.
**Why it's lower priority than it sounds:** with 2 tubes and a 30 s reload, nobody
can currently saturate an 8 km bubble — it's a trap waiting for a future patch that
makes salvos cheap, not a live balance problem. Also note: **no current test would
fail** if we added a cap (`tests/pdc.test.ts` blocks 3 and 5 are single-missile) —
the fairness property is untested, which is itself the finding. If built: cap
engagement channels (audit floats corvette 1 / frigate 2 / cruiser 3) or divide
kill rate among engaged targets. Do NOT touch the ~57% single-missile rate.

### Tier 3 — needs a design call before building

**9. `navigate` (audit §6.2) — right idea, wrong shape. Make it `maneuver.type`.**
The audit wants a NEW verb `{verb:"navigate", params:{objective, target, range_m,
offset_degrees, discipline}}`. Our own doctrine says extend enums instead —
`HANDOFF-v4.7.md:109-112` and `:449-451` ("v5 adds values to this enum, **not new
verbs** — that is why it is `set_overlay` and not `set_drift_marker`"),
`CLAUDE.md:37-38`, and `HANDOFF-CAMPAIGN-v1.md:9,484-485` ("New verbs added to the
game: one"). It's a preference, not an invariant (v5 did ship `fire_railgun`,
`launch_probe`, `transmit`), but a `navigate` verb would be the first thing in the
repo to DUPLICATE an existing verb's surface rather than extend it.
The existing `maneuver` (`ship_command_schema.json:320-368`) is remarkably close:
`objective` → `type` (add enum values), `discipline` → **already there, identical**,
and `target`/`range_m`/`offset_degrees` → new sibling props alongside the existing
per-type `seconds`/`percent` (the schema already uses that idiom). `sim.ts:68-70`
was built for this: *"the executor switches on type so future macros (v5+) are
additive."*
**The shared relative-frame executor already exists** and is generic:
`sim.ts:4913-5007`, taking `(dockAt{x,y}, wvx, wvy)` — `sim.ts:4915-4917` says *"a
teammate is just a wreck that shoots back."* So `match_velocity`, `station`, and
`range` objectives are near-free on it. `offset_degrees` and `cover` are NOT — the
block drives `d → 0` with no offset standoff point.
🔴 **The real cost is translator accuracy, not engine work.** `salvage` and
`come_alongside` are ALREADY separate verbs doing rendezvous, and the schema spends
heavy description budget disambiguating them (`schema:394`: *"'Come alongside
KESTREL' (a ship CALLSIGN) is come_alongside ... never this verb"*). Adding
`maneuver{type:"rendezvous"}` creates a THIRD way to say "go to that thing" and
collides head-on with that disambiguation. Decide the grammar before building.
The audit calls "hold or obtain range" its single most valuable addition, and that
one does NOT collide — if we do one objective, do that.

**10. Newtonian missiles (audit §2.4 / Phase 3) — NOT NOW. Its diagnosis is right.**
The mechanism critique is TRUE and verified. Launch (`sim.ts:2156-2180`) projects
ship velocity onto the nose (`clamp(ship.vx*fx + ship.vy*fy, 0, MISSILE_MAX_SPEED)`)
and discards everything transverse; in flight (`sim.ts:3536-3552`) `vx/vy` are
recomputed from `(course, speed)` every substep with **zero accumulation** — state
is polar, `vx/vy` are a cache. Momentum is not conserved; the vector rotates
rigidly. `MISSILE_TURN_RATE_DPS = 45` (`constants.ts:365`) with no speed term.
(One nuance the audit missed: turning is not free — it forces `burning` and drains
fuel at 1/s; a dry bird cannot turn at all. The cost is FUEL, not momentum.)
**The `NEWTONIAN_MISSILES` flag is REAL** — `constants.ts:366-370`, and its comment
describes exactly the experiment the audit proposes. But it is a **sticky note, not
a seam**: nothing reads it (the only two hits in the repo are the declaration and
`HANDOFF-v4.md:116`); flipping it does nothing.
Why this is a milestone, not a prototype:
- 🔴 **The seeker cone is measured off `m.course`** (`sim.ts:4242-4248`,
  `MISSILE_ACQ_CONE_DEG`). Today course IS the velocity direction, so "cone off the
  nose" and "cone off the flight path" are the same sentence. Decouple them and you
  must decide which one the seeker looks down — and `angDiff(m.course, want)`
  (`:3537`) stops being a steering command at all, because rotating `course` would
  no longer move the bird.
- 28 of 40 suites reference missiles; the load-bearing ones poke `m.speed`/`m.course`
  DIRECTLY and would break at the type level, not just the assertion level
  (`lock.test.ts:148` hardcodes the projection-then-ramp launch model;
  `torpedo.test.ts:51` asserts "dry torpedo cannot turn"; `pdc.test.ts:122-123`
  sets `m.course` to force a coast state — no `vx/vy` equivalent exists).
- PDC code is speed-AGNOSTIC but balance is speed-SENSITIVE (`constants.ts:358`
  justifies 2400 partly by "PDC bubble transit ~triples") — a rewrite silently
  retunes PDC lethality without touching PDC code.
- Hunter AI is SAFE: it goes through the command layer (`hunter.ts:324`, `:425`)
  and never touches a `Missile`.
If we ever do it: implement honest momentum FIRST and observe, per the audit's own
Risk note — and **keep the 2400 cap** (see DO NOT BUILD).

**11. Extraction mode (audit §7.6) — oversold as "surprisingly low complexity".**
Its inventory is right for 8 of 9 pieces, and wrong on the one that defines the
mode. Already in MP rooms: wrecks (`match.ts:833`, same generator, all-marked),
salvage (`sim.ts:811` `salvagers()` = "every human" outside campaign), death hulks
(`sim.ts:2624-2630` — "EVERY non-drone death, in EVERY mode"; solo campaign is the
only exception), moving hulks + velocity-match rendezvous (`sim.ts:4911-4977`,
mode-agnostic), cargo mass / modules / hold, teams, and a winner pipeline
(`sim.winner` → `gameover` → `match.ts:1396-1428` → placements + rematch votes).
🔴 **The gate is welded to the campaign.** `sim.ts:617-619` is explicit: *"Set by
Match on a campaign sim, absent on every multiplayer sim — the presence of this
object is the ONLY gate to any campaign behavior in here."* Crossing is
mission-gated (`sim.ts:3305`), the verb rejects outside a mission (`sim.ts:1401`:
"No gate out here, Captain."), geometry is non-nullably owned (`sim.ts:5243`,
`:6691` — `this.mission!.gate`), and placement happens inside `buildCampaignSim`
(`match.ts:490-492`) alongside ladder rows. Lifting it means giving the gate the
same treatment `seedField`/wrecks already got (`sim.ts:794`). Honest framing: **MP
already has the ECONOMY and lacks only the EXIT.**

**12. `nearest_rumble` picks LOUDEST (audit Phase 1 item 3) — real, but principled.**
`sim.ts:3149`: `rumbles.reduce((a, b) => (b.loud > a.loud ? b : a))`. The comment at
`:3143-3146` pre-empts the audit: a rumble is bearing-only with NO range, so
"nearest" is UNKNOWABLE — loudest is the only available proxy. So the behavior is
not fixable and renaming (`loudest_rumble`) is the only remedy — but it's a
player-facing grammar token (`translator.ts:80`), i.e. a vocabulary break. This is
the ONLY real naming mismatch in the repo: the Hunter's loudest-pursuit is named
`loudest` (`hunter.ts:212-226`, `:403-408`) and `set_lock_target` genuinely picks
nearest (`sim.ts:3674`). Gabriel's call — it's cosmetic vs. a grammar break.

### Also worth knowing (verified, no action)
- The audit's physics arithmetic is CLEAN: corvette/frigate/cruiser accel
  85/60/40 m/s² = **8.67 / 6.12 / 4.08 g** (`constants.ts:60-64`), and its
  stopping-distance table (**66.7 / 102.0 / 151.1 km** at 3 km/s, flip 4.59 / 9.0 /
  12.86 s) checks out against the current post-Anvil corvette turn rate of 39.2°/s.
  Caveat it missed: those are BOOK values — `accelOf()` returns force/mass, so they
  hold only at starting loadout with an empty hold. Every looted ship is worse.
- Its detection formula is WRONG in a way that doesn't damage its argument: it says
  `SENSOR_BASE_M * sig/100` globally, but `sim.ts:1030` uses the VIEWER's archetype
  sensorBase (corvette 210 / frigate 180 / cruiser 160 km) x `sensorMult` x
  `DEEP_ARRAY_SENSOR_MULT^arrays`. `SENSOR_BASE_M` is the frigate row + the
  voice-ring reference (`sim.ts:1039-1042`).
- Standing-order discoverability (§4.8) is MOSTLY FALSE — there's a how-to-play
  section (`how-to-play.html:744-754`), a cheat-sheet row (`:906`), the
  `standing_orders` query (`translator.ts:120`), and the panel list with wired ×
  (`panel.js:85-105`). Real gap is small: no PRESETS, no "suggest standing orders"
  query, and the empty state is a bare "none" (`panel.js:91-96`) — a wasted
  teaching surface.
- Salvage auto-install is real and stronger than the audit says (`landModule`
  calls `fitModule` DIRECTLY — no timer, no abort check; `sim.ts:3904-3905`: "the
  stop that landed it WAS the install"). Its FFA-snowball rebuttal: salvage already
  cost a full stop, just not 60 s. Its recommendation (competitive modes: always
  hold, installation obeys the workshop rule) is ~4 lines from current behavior if
  we ever want it. See item 2 for the README line this makes false.

## 🔴 OPEN: the Hunter runs out of gas and drifts out of the shroud

Found while building the 2026-07-14 lethality pass. **This is the actual
cause of "he flies into the shroud", it is NOT the rocks, and it predates
that pass** (measured identically on the previous build — not a regression).

PURSUE burns `HUNTER_PURSUE_THROTTLE = 100`, which is
`PROPELLANT_BURN_AT_FULL = 1.0`/s, so a long transit empties a 100-unit tank
in 100 s. `effectiveThrust()` is `propellant > 0 ? thrust : 0` — a dry
Hunter has NO drive at all — and regen needs `insideZone`, which is false
exactly where he ends up. So he coasts out, while `boundaryThreat()`
confidently computes a braking distance nobody can pay for.

Probed across all three archetypes × five seeds, bait parked outside the
rim. Max radius vs the 250 km law, **propellant at max radius EXACTLY 0.0**
in every failing case:

| hull | max radius | verdict |
|---|---|---|
| corvette | 245–254 km | marginal |
| frigate | 254–270 km | **out** |
| cruiser | 212–276 km | **out** |

Why nothing caught it: `campaign.test.ts §25` runs `new Sim()` — EMPTY
TERRAIN — and hardcodes the corvette, the one hull with brake authority to
spare. `hunter.test.ts §17` flies a full tank and no fuel model at all. Both
were green the whole time the player was watching it happen.

**Needs a design call — do not guess it.** Measured dead ends, do not repeat:
- making `boundaryThreat` fire earlier (turn-aware braking distance) just
  spends the tank sooner and made the corvette WORSE (245 → 254);
- returning `Infinity` when the fuel won't cover the burn forces a 100%
  burn at low fuel — strictly worse;
- latching the retro burn (`mem.retro`) to stop the brake/re-accelerate
  oscillation: no measurable effect on the exits.

The real question is a POLICY one: should the Hunter reserve the propellant
needed to stop before it spends it? That is a fuel-budgeting rule (a bingo
number, a chase leash priced in fuel, or PURSUE respecting the fuel floor),
and it changes how the chase FEELS — which is Gabriel's call, not a
mechanical fix. Related: `HUNTER_FUEL_FLOOR`/`RESUME` hysteresis works, but
both AVOID branches deliberately ignore it ("survival outranks fuel
discipline"), and that is where the last 20 units go.

Until then `campaign.test.ts §25b` is a comment, not a pin: writing one that
passes on a hand-picked seed would repeat exactly the sin that hid this.

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

cc-rulings-loadout-next-leg.md (2026-07-14) settled: stat bumps DIE
(delete upgradeCounts + UPGRADE_* + "upgrade" items; wrecks drop MODULES
and ORE; migration sig→baffles, sensor→deep array, accel→DRIVE TUNE (new
module, 1 mass / 2 power, ×1.15 thrust while lit), hull→armor; two axes:
horizontal = modules found, vertical = refine Mk I→II with ore — no free
third); rings pushed to prod (DEPLOYED); PDCs clear mines only when FREE
and loudly (BUILT 3be8a1a); rail auto-light speaks (BUILT); rack +2
accepted.

DONE 2026-07-14 (d035cb3 + 3be8a1a on patch-4-loadout; suite 1,364
green; browser-verified: typed wreck labels + approach rings render on a
non-campaign map, salvage verb answers in practice with the honest
range rejection; module landing / death hulks / persistence pinned in
tests/loadout.test.ts §14-18). Leg judgment calls: MP fields are ALL
MARKED (rumor semantics — private leads, resolve-by-presence — stay
campaign; MP wrecks are public Schelling points); death hulks are
PUBLIC (marked) in every mode, following the Hunter/co-op precedent;
practice mode gets the field too (the safest place to learn the
workshop); freighter ore lands as carried mass with its uses (§6 refit
verbs) next leg — this playtest it's deliberately a mass-vs-future bet.
The executed design, for reference:
1. Drive Tune module (constants + accelOf ×1.15^lit + schema enum).
2. Field lift: Sim gets fieldWrecks/fieldSalvaging with get wrecks()/get
   salvaging() delegating to mission when present (campaign paths + tests
   stay bit-identical); salvage verb gate becomes "wrecks exist && not a
   drone"; stepSalvage/stepRumors run when wrecks exist (haul/stats
   pushes stay mission-guarded; stepRumors playerIds → non-drone humans
   in MP); hulk motion loop reads this.wrecks; top-level `wrecks` on
   every snapshot (client reads it from either place).
3. §5 types: Wreck.type military/survey/smuggler/freighter/derelict/
   hulk. Pools (five+tune): military rail/armor/mine_layer + pdc/msl;
   survey deep_array/probe_rack + probes; smuggler baffles/drive_tune +
   decoys; freighter ORE ×lots + consumables; derelict rare (8%): 2
   modules + ore. Marked sites expose type on the wire FROM t=0 at any
   range; rumors hide type until checked (Patch 1 rules).
4. SalvageItem kinds += module{module}/ore, DELETE upgrade. Landing:
   module → landModule (installed: per-module stock fitted lines, reuse
   the four existing "fitted" lines + three new; held: "stowed" stock
   variants); ore → ship.ore += n (NEW ship field, mass = ORE_UNIT_MASS
   each in massOf, on you.loadout.ore; USES land with §6 refit next leg
   — this playtest it's a mass-vs-future bet, deliberate).
5. Death hulks ALL modes (generalize the Patch 2 §4a block): every
   non-drone death except SOLO-campaign spawns a marked hulk (type
   "hulk") at 0.4 death-v carrying installed+hold modules as module
   items + ore + consumables. MP: the leader is the prize (amendment
   §2). Letters continue the site sequence.
6. Persistence: CampaignRun.upgrades → CampaignRun.loadout {installed[],
   hold[], ore} (sanitize: valid ModuleIds only, caps; old saves lose
   bumps — acceptable, note in check-in); buildCampaignSim applies it
   (mults stay 1; carried.hull clamps to hullMaxOf-with-plates);
   CoopCarry mults → installed/hold/ore; totals.upgrades →
   totals.modules (sanitize accepts either key); mission.stats.upgrades
   → stats.modules; mission.hold ledger renders module/ore kinds.
7. MP generation: rooms get generateWrecks(seed) at launch (practice
   too); schema/translator salvage text loses "CAMPAIGN ONLY"; state
   summary lists sites for MP ships as it does for mission players.
8. Client: drawWrecks reads top-level wrecks; marked wrecks draw their
   TYPE word (the whole "worth going loud for?" decision); run-map
   manifest renders module/ore items; localStorage run shape v2.
9. Tests: typed-pool pins, type-on-wire-from-t0 + rumor-hidden pins, MP
   salvage e2e, MP death-hulk-carries-deck pin, sanitize round-trip,
   🔴 re-run the calibration pin — starting loadout + empty hold stays
   bit-identical (the Unification §3 law, do not lose it).
NEXT: THE TWO-MODE PLAYTEST GATES EVERYTHING (amendment §9: a 1v1 AND a
6-player FFA; watch 1v1 for snowballing — the lever is POWER_TO_SIG,
never a handicap; watch the §4 five modules for "does the deck question
land"). After the playtest: §6 ore verbs (repair/rearm/refine Mk I→II),
§8 legibility (sprite from loadout, plume from signature, hum from
draw), §7 panel fill (reactor bar, module list, sig decomposition —
you.loadout is already on the wire for it), rest of the catalog.
Small known gaps, deliberate: MP salvage clock not on the panel (the
transcript narrates; mission.salvaging is campaign wire), slug-farming
via uninstall/reinstall (two full stops for 20 slugs; §6 rearm
supersedes), PDC-vs-mine uses the missile kill prob (tune by ear).

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
