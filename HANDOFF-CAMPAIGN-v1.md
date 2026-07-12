# HANDOFF — CAMPAIGN v1: "Deep Black"

**Baseline: v5.1.** The single-player campaign. A run-based roguelike built almost
entirely out of parts that already exist.

**The whole design in one line:** *you have a clock's worth of greed, and when it
runs out, something with better ears than yours wakes up and comes looking.*

**New verbs added to the game: one.** (`salvage`.) The gate is flown through, not
commanded. Everything else is systems, screens, and sound.

---

## 0. Posture and staging

This is the largest feature in the project's history and it must not be built in
one pass. **Stage 0 is playable and proves the thesis. Do not proceed past it
without playing it.**

| Stage | Contains | Question it answers |
|---|---|---|
| **0** | One system. One clock. One Hunter. One gate. | **Is the loop fun with zero content in it?** |
| **1** | Salvage, progression, multi-system runs | Is greed a real decision? |
| **2** | The difficulty ladder, score, run summary | Does it have an arc? |
| **3** | The adaptive score (music) | Does it have a soul? |
| **4** | The exit spectacle, how-to-play | Is it a product? |

**If Stage 0 isn't tense, stop.** No upgrade tree, no ladder, no soundtrack will
save a boring core loop, and you will have found that out in a weekend instead of
over a season.

**Single-player deliberately suspends server authority.** Run state lives in
`localStorage` and is handed to the server at system start. There is nobody to
cheat against but yourself. **State this in the code comments so nobody "fixes" it
later.**

---

## 1. The run

**8 systems. Get out of each one. Your score is how many you cleared.**

Each system is a `Sim` with a seed and an encounter spec — an existing match with a
wrapper. Terrain variety comes free by varying the existing generator's parameters
(a dense rock field hides you and blinds you; an open system is a killing floor).

### The two phases

This structure is the heart of the game and everything else serves it.

**Phase 1 — the race (clock running).** No Hunter exists. Signature does not
matter. **Burn hard. Be greedy.** Physics is your only limiter — and it is already
brutal: rocks kill you at speed, stopping takes an age, and hard burning drains
propellant that only regenerates when you're gentle. **Thrust is already
triple-taxed. Do not add a fourth tax.**

**Phase 2 — the hunt (clock at zero).** The Hunter spawns. **Everything inverts.**
Now you want to be silent. Cut engines. Coast. Hide in dust. Break line of sight.
The entire v4/v5 sensor game switches on at once.

**The clock is not a threat — it is a budget.** It is how much greed you can afford
before the game changes. `HUNTER_SPAWN_S` is **fixed per system** and does **not**
shrink as difficulty rises (see §3).

You may fly straight to the gate at t=0 and leave with nothing. **Let them.**
Cowardice is punished by the difficulty ramp, not by a lock on the door.

---

## 2. The Hunter

### 2.1 It is a real ship, and it perceives through the fog

**The Hunter's AI reads `snapshotFor(hunter)` — the same fog-of-war contact list a
human player receives.** It is not omniscient. It is a ship with *monstrous sensors
and a whisper of a signature.*

This is the most important architectural decision in the document:

- **You do not write a perception system.** The fog code is the AI's eyes.
- **Decoys work on it. Dust blinds it. Rock shadows hide you. Going dark works** —
  all automatically, with zero special-casing.
- **It can be wrong**, and every good stealth moment in the history of games is an
  AI being wrong.
- **Difficulty is numbers only** — `SENSOR_BASE` up, `SIG_BASE` down. Consistent
  with the v5 archetype policy.

> **The Hunter's advantage is information, not firepower.** The counterplay to
> "it has better ears" is **stealth**, which is your entire game. There is no
> counterplay to "it has 40% more hull."

### 2.2 The AI — a state machine, ~150 lines

- **PURSUE** — has contact. Steer to a lead-intercept point (a quadratic, not a
  search). Throttle by range.
- **ENGAGE** — inside weapons envelope. Lock, fire on cooldown. PDC is already
  automatic. Railgun if Frigate or Cruiser.
- **HUNT** — no contact. **Fly to the nearest salvage site**, not to your last
  known position. See §4.3 — this three-line choice is what makes a dumb state
  machine look like it is thinking.
- **AVOID** — rock on vector. **You already compute this**: the collision countdown
  that drives *"Rock on our vector — impact in twenty seconds"* is the trigger,
  sitting there, free.

No feinting. No retreating. **It fights to the death.** Simpler *and* more
characterful — it is a Hunter. It is fanatical.

### 2.3 Killing it

You cannot out-shoot it. You **can** go dark, let it come, and ambush it from a
rock shadow. **That moment is the power fantasy and it falls out of the design for
free.**

So pay for it: **the Hunter carries the best salvage in the system.** Every run now
has a real decision — *run for the gate, or turn and set a trap.* Kill it and
nothing replaces it: the system is yours. Take your time. Breathe. **That relief is
a reward you cannot buy any other way.**

---

## 3. The difficulty ladder

**Escalate the Hunter, never the clock.** Shrinking the clock shrinks the *game*.

**Each system adds exactly one new problem.** Not a smooth multiplier — discrete,
legible, learnable. The player must be able to say *"system five is when they start
coming in pairs."*

| # | Name | What's new | Composition |
|---|---|---|---|
| 1 | **The Drifter** | Nothing. This teaches the loop. | Corvette, near sensor parity |
| 2 | **Sharp Ears** | It finds you first | Corvette, sensor advantage begins |
| 3 | **The Lance** | A railgun enters the game | Frigate |
| 4 | **The Quiet One** | *You can barely hear it* | Frigate, signature floored |
| 5 | **The Pair** | Two bearings at once | 2× Corvette |
| 6 | **The Anvil** | You cannot win a trade | Cruiser — loud, but it doesn't care |
| 7 | **The Picket** | **One of them camps the gate** | 2×, one gate-camping |
| 8 | **The Wolfpack** | All of it | Frigate + Corvette, quiet, gate-camping |

**Name them in the XO's mouth.** *"Two drives, Captain. They've sent a pair."* The
player should learn to fear a word.

⚠️ **Multi-Hunter valve:** two Hunters with great sensors can corner you. This is
survivable **only** because they are not omniscient (§2.1). Playtest S5 and S7
hard. If they feel unwinnable, the knob to turn is **their sensor range**, not their
count — the count is the *identity* of those systems.

**Gate-camping is a late-run escalation, never early.** It removes the sprint-for-
the-door fantasy, which is precious. Save it for the final act, where the twist
lands.

---

## 4. Salvage

### 4.1 The stop is the cost

**In this game, momentum is the most precious thing you own.** Killing it takes
forever; rebuilding it costs propellant and makes noise. So requiring a **full
stop** is a perfect cost — paid in the game's own currency, at the price of zero
new mechanics.

**The verb** — one, and it is a maneuver, like `full_stop`:

```json
"salvage": { "target": "<contact-ref>" }
```

*"Come alongside the wreck." / "Salvage bravo."* Reuses v5's contact-reference
resolver. The XO handles the velocity-matching — *"Coming alongside, Captain."* You
are the captain, not the pilot. **You** decided to spend the momentum; that was the
decision. **Any thrust command aborts the transfer.**

### 4.2 The haul is sequential — a greed curve, not a progress bar

Items transfer **one at a time**, worst to best:

> *"Propellant aboard, Captain."* … *"Missiles aboard."* … *"There's something else
> in here — thirty more seconds."*

**You keep whatever has already landed.** So the transfer is not a bar you watch —
**every ten seconds is a fresh decision.** You are stationary, beside a known
landmark, listening to a rumble grow, deciding whether the last item is worth it.

It is a slot machine you can walk away from, built entirely from parts you already
own.

### 4.3 Sites are watched ★

A salvage site is *a known location where a ship will predictably be, stationary,
for thirty seconds.* So the Hunter's **HUNT** state patrols salvage sites.

**Three lines. The AI now appears to be thinking.** It is waiting where it knows
you will come.

### 4.4 Known vs. suspected

- **Marked sites** — reliable contents. **Watched by the Hunter.**
- **Rumored sites** — might be empty, might be the run-maker. **The Hunter doesn't
  know about them either.**

The richest rumors sit **in the dust**, where you go blind to get rich — and so
does he.

**One currency — noise — and every system pulls on it.**

---

## 5. The gate

### 5.1 Geometry

The gate sits **on the region boundary**, aperture facing outward. It is **always
visible on the map** from t=0. It is the one thing you always know.

**The pylons are rocks.** Reuse rock collision, swept-segment, the collision klaxon,
the impact countdown. A bad approach does not merely miss — **you can smash into the
gate you were trying to escape through.**

**Crossing the aperture segment = you jump.** No charge timer, no verb. The aperture
*is* the difficulty; do not tax it twice.

### 5.2 Missing it — the punishment is already built

Miss, and you punch through the shroud into the **outer zone**, where v4 already
says: *"We've left the shroud — we're lit up and the current's against us,
Captain."* Max signature. No cover. Drag fighting you. And you are travelling fast
in exactly the wrong direction, so recovery means a flip and a long, screaming burn
with a Hunter listening.

**Zero new code. The most flavorful failure state in the game, and you wrote it in
v4.**

### 5.3 Aperture width — solve, don't guess

**Constraint:** *a captain who commits at 40 km out with a 3° error should be able
to correct with a lateral burn if they catch it; a 6° error should not.* Derive the
width from the actual `accel` and `turnRate` constants. Then the dilemma is
emergent and correct:

- **Slow approach** — precise, correctable, forgiving. And you are a crawling
  target for a full minute.
- **Fast approach** — through in seconds. But you committed your vector 60 km out,
  you can barely correct, and a lateral burn to fix your aim costs propellant *and*
  screams.

### 5.4 The approach solution ★

**This is the number that drives everything else in the release.**

Every frame, from the ship's own state and the gate's known position:

```
toGate      = gate.center - ship.pos
range       = |toGate|
closingRate = dot(velocity, normalize(toGate))        // m/s, may be negative
ttg         = closingRate > 0 ? range / closingRate : Infinity
missDistance = lateral offset of the ballistic path where it
               crosses the gate plane, measured from aperture center
solutionGood = |missDistance| < APERTURE_W / 2
```

`missDistance` is **the same projection math the v4.7 drift marker already
performs.** v4.7 accidentally built the gate's targeting reticle six weeks early.

**HUD — the approach solution panel**, appearing whenever `closingRate > 0` and
`range < GATE_SOLUTION_RANGE_M`:

```
GATE   ttg 0:24   miss 1.2 km LEFT     [red]
GATE   ttg 0:18   SOLUTION GOOD        [green]
```

**XO** (NEWS tier, and rate-limited hard — this is not a place to be chatty):
- solution acquired: *"Solution good, Captain. Eighteen seconds."*
- solution lost: *"We're wide — a klick and a half left."*

`ttg`, `missDistance`, and `solutionGood` are computed entirely from your own ship
and a landmark you have always known. **Zero fog leak.**

---

## 6. Progression

**Do not build a tech tree.** Salvage yields:

- **Consumables:** hull repair · propellant · PDC ammo · missiles
- **and one permanent stat bump:** `SIG_BASE` ↓, `SENSOR_BASE` ↑, `accel` ↑,
  `hullMax` ↑

**The upgrade system is a per-run multiplier table applied to constants that
already exist.** Zero new systems.

**Note that −signature is the strongest upgrade in the game**, because it directly
degrades the Hunter's advantage. The economy teaches the player what the game is
actually about.

**And stop resetting the resource pools.** You already have four attrition systems
— propellant, PDC ammo, missiles, hull — that reset every match. **Carry them
across jumps and you have a campaign economy for free.** That is not a feature;
that is deleting a line.

---

## 7. The score ★ THE BIG NEW SYSTEM

### 7.1 🔴 THE FOG INVARIANT APPLIES TO MUSIC

**If the score swells because the Hunter is near, the music is a sensor.** The
player would know he is out there at 30 km with zero contacts, and every hour spent
building fog-of-war leaks through the soundtrack.

> **LAW: the score is a function of the player's SNAPSHOT, never of the sim's TRUTH.**

| Situation | May the music respond? |
|---|---|
| Hunter at 30 km, **no contact** | **NO. Silence.** |
| Hunter detected — any tier | Yes — to *your contact's* tier and *reported* range |
| Hearing rumble present | Yes — to the **rumble**, never to its source |
| You are painted / locked | Yes — you know |
| Missiles inbound | Yes — you know |
| Hull damage | Yes — you know |
| The spawn clock hits zero | **Yes** — the clock is on your HUD. But it must convey **no bearing.** |

**The scariest moment in the game — the Hunter closing, undetected — is scored with
silence.** That is not a compromise. That is *Jaws*. **Write a test for it** (§13).

### 7.2 Procedural, not files

Everything in `audio.js` is Web Audio synthesis. **Keep it that way.** Generative
music is the right call, not a compromise:

- **Zero assets, zero bandwidth, zero licensing.**
- **It responds continuously to a scalar**, which is precisely what §7.4 needs.
  Stems and crossfades would fight you.
- The aesthetic — drones, pulses, sparse arpeggios; *Ex Machina*, *Annihilation*,
  *The Expanse* — is the easiest genre to synthesize convincingly and the exact
  register this game wants.

**Keep the palette narrow. Do not attempt melody or chord progressions.** A fixed
pitch-class set (minor/phrygian), a root that shifts by phase, and layers that are
**rhythmic or textural** rather than melodic. The aesthetic is *tension*, not
*tune*.

### 7.3 Five layers, one scalar

All layers run continuously; each is gated by a gain with a threshold and a
crossfade. Everything is a function of **`intensity` ∈ [0,1]**.

| Layer | Enters at | What it is |
|---|---|---|
| **BED** | always | Low detuned drone through a lowpass. This is space. |
| **PULSE** | ~0.25 | A slow heartbeat. **Rate scales with intensity.** |
| **ARP** | ~0.45 | Sparse plucked sequence. |
| **PAD** | ~0.65 | A swelling high pad. |
| **PERC** | ~0.80 | Driving filtered-noise toms. BSG. |

`intensity` is **smoothed** (ramped, not stepped) — but **discrete events snap it**
(a spawn, a lock, a launch).

### 7.4 What drives intensity

```
intensity = max(perceivedThreat, gateRun, damageStress)
```

- **`perceivedThreat`** — from your snapshot only: nearest *contact's* tier and
  reported range, rumble level, painted/locked, missiles inbound.
- **`damageStress`** — hull fraction.
- **`gateRun`** — §7.5. **This is the one that matters.**

### 7.5 The gate run — the music counts you down ★

**`gateRun` is a function of `ttg` (§5.4).** As time-to-gate falls, intensity
rises. `ttg 90s` → PULSE. `45s` → ARP + PERC. `20s` → everything, full swell.

And because `ttg` is derived from **your actual velocity**, the music **responds to
your piloting**:

- **Burn harder → `ttg` drops → the music surges.**
- **Blow the line and drift wide → `ttg` spikes → the music deflates.**

**The score sags when you botch the approach.** The player *hears* their failure
before they see it. That is a diegetic emotional feedback channel and it costs one
division.

**Gate `solutionGood` gates the commit:** if the solution is bad, the score climbs
but **withholds the top layer.** It does not resolve. Only a good solution lets the
music *commit* to the payoff. **The soundtrack is telling you whether you're going
to make it.**

### 7.6 Phase scoring

| Phase | Feel |
|---|---|
| **Race** (pre-spawn) | Light. Bed, maybe a sparse pulse. **Open, not tense — even beautiful.** The contrast is the entire point. |
| **The spawn** | **A sting.** The clock hits zero, a hit lands, the bed drops to a darker root. The phase inversion, made audible. **No bearing information.** |
| **The hunt** | Dynamic on perceived threat. **Mostly quiet — because you are hiding, and often you cannot see him.** |
| **The gate run** | §7.5. |
| **The exit** | §8. |
| **Run map** | Quiet. Contemplative. A breath between systems. |

### 7.7 The mix — music is the bottom layer

New `musicBus`, alongside v5.1's `sfxBus` and `speechBus`.

- **Music ducks under speech. Music ducks under alarms.** The XO always wins.
- **🔴 Music must NEVER mask the hearing rumble.** The rumble is *information* — it
  is the Hunter's bearing. **Sidechain: duck the music's low layers whenever
  `setRumble` level is nonzero.** The score literally makes room for the threat.
  This is a real audio-engineering move, it costs ~5 lines, and it is thematically
  perfect.
- **Third slider: MUSIC**, alongside SFX and VOICE (v5.1 §4.2).
- Music sits **outside** the v5.1 bed-gain ceiling (it has its own bus), but the
  ceiling still governs hull hum + rumble + thrust + dust.

**No contradiction with the v5.1 alarm law.** Alarms are *information*, and
repetitive alarms are noise because they say nothing new. **Music is emotion.** It
does not compete for the information channel — but it does compete for the *audio*
channel, which is what the ducking rules above are for.

---

## 8. The exit

The payoff. **Almost all of it already exists.**

1. **Approach** — score at maximum, everything screaming.
2. **The aperture plane is crossed** → **one beat of silence.** ~200 ms. Everything
   cuts but a single rising tone. *The oldest trick in cinema, and it is free.*
3. **The flash** — expanding ring (**reuse the v4.7 ping-ring code**), hull
   flashbulb (v4.7), camera shake (v4.7).
4. **The streak** — **the starfield already exists. Streak it along your velocity
   vector.** ~10 lines and it is the single most cinematic thing in the game.
5. **Release** — the score resolves to one sustained chord and decays to nothing.
6. **Silence.** Then fade to the run map.

**XO:** *"We're through, Captain."*

---

## 9. Score & run summary

**The score is systems cleared.** Resist the urge to compute a point total —
*"You made it to system six"* is more memorable than *"Score: 14,850."*

**Run summary screen** (reuse the v5.1 post-match reveal pattern):

- **SYSTEMS CLEARED: 6** — the headline, large
- Hunters killed · salvage recovered · total time · hull remaining · **pings fired**
- Cause of death
- **Best run** (localStorage)

---

## 10. Constants

```ts
// server/constants.ts — campaign block
export const CAMPAIGN_SYSTEMS       = 8;
export const HUNTER_SPAWN_S         = 240;   // FIXED. Does not shrink with difficulty.
export const SALVAGE_STOP_SPEED_MPS = 25;    // must be under this to begin transfer
export const SALVAGE_DOCK_RANGE_M   = 2000;
export const SALVAGE_ITEM_S         = 10;    // per item in the sequential haul
export const APERTURE_W_M           = 0;     // SOLVE per §5.3. Do not guess.
export const GATE_SOLUTION_RANGE_M  = 80000; // HUD panel appears inside this
```

```js
// client/audio.js — music block
const MUSIC_INTENSITY_RAMP_MS = 1500;  // smoothing; discrete events bypass
const MUSIC_DUCK_SPEECH       = 0.35;
const MUSIC_DUCK_RUMBLE       = 0.45;  // sidechain — the rumble must survive
const GATE_RUN_TTG_MAX_S      = 90;    // gateRun begins ramping here
```

Per-system Hunter difficulty is a **table**, not a formula — see §3. Each row is
`{ archetype, count, sensorMult, sigMult, gateCamp }`.

---

## 11. Schema

**One new verb.** `salvage { target }`. That is the entire campaign's addition to
the command surface.

Translator examples: *"come alongside the wreck"*, *"salvage that"*, *"salvage
bravo"*, *"grab the salvage"*, *"break off"* (→ abort, which is any thrust command).

---

## 12. How to play — new tab

The existing page gets a **tab bar**: `MULTIPLAYER` (existing content, unchanged) /
`CAMPAIGN` (new). Same voice — briefing, not manual. Doctrine sections, same as the
multiplayer tab.

**Doctrine: The Run**
- Eight systems. Get out of each one. Your score is how far you got.
- The clock is not a threat. **It is a budget.** It is how much greed you can afford.
- You may leave immediately with nothing. You will not survive system five.

**Doctrine: The Two Silences**
- **Before the clock runs out, noise is free.** Burn hard. Take the detour. Be greedy.
- **After it runs out, noise is death.** Cut your engines. Coast. Hide in the dust.
- *This is the same ship and the same physics. Only the rules of survival have inverted.*

**Doctrine: The Hunter**
- It does not have bigger guns. **It has better ears.**
- It hears you long before you hear it — but **it is not all-seeing.** Go dark and
  it loses you. Sit in a rock's shadow and it passes by. Fire a decoy and it
  believes you.
- **You cannot out-shoot it. You can ambush it.** And it carries the best salvage
  in the system.

**Doctrine: Salvage**
- **You must come to a full stop.** In this game, that is the most expensive thing
  you own.
- The haul comes aboard **one piece at a time, worst first.** Leave whenever you
  like — you keep what has already landed.
- **The Hunter knows where the wrecks are.** It will come and look. What it does not
  know about are the *rumors* — and the best rumors are in the dust, where neither
  of you can see a thing.

**Doctrine: The Gate**
- **You fly through it.** There is no command for this.
- Your hull points where you are aimed. **The drift marker points where you are
  going.** Only one of them threads the gate.
- Commit your line early and coast, or come in slow and correct — but you cannot do
  both, and something is listening to your engines.
- **Miss, and you are outside the shroud**: lit up, no cover, the current against
  you, and a long screaming burn back to a door you already failed to open.

Add `salvage` to the **Phrasebook**.

---

## 13. Tests

- **🔴 MUSIC FOG TEST — mandatory-green.** Place a Hunter at 20 km with **no
  contact** in the player's snapshot. Assert `intensity` is **identical** to the
  Hunter being at 200 km with no contact. *The score must not know.* This is the
  most important test in the file.
- **Hunter perception** — the Hunter AI's target list is derived from
  `snapshotFor(hunter)`. Assert it holds **no** reference to a ship it has no
  contact on. Assert a decoy produces a contact it will pursue.
- **Approach solution** — `missDistance` is zero on a dead-center ballistic line;
  `solutionGood` flips false past `APERTURE_W_M / 2`; `ttg` is `Infinity` when
  `closingRate <= 0`.
- **Gate crossing** — crossing the aperture segment jumps. Striking a pylon is a
  rock collision (reuse existing collision tests).
- **Salvage** — no transfer above `SALVAGE_STOP_SPEED_MPS`. Any thrust command
  aborts. **Items already transferred are retained on abort.**
- **Hunter HUNT state** — with no contact, the Hunter's waypoint is the nearest
  **marked** salvage site, never a **rumored** one.
- **Progression** — stat bumps apply as multipliers over base constants; the pools
  (propellant, ammo, missiles, hull) **persist across a jump**.
- **Ladder** — each system instantiates its table row; `HUNTER_SPAWN_S` is
  **identical across all 8 systems** (regression-pin this; it is the design).
- **Score** — the run summary reports systems cleared; best run persists.

---

## 14. Build order

1. **STAGE 0.** One system, hard-coded. Clock. One Corvette Hunter with the fog-based
   AI (§2.1–2.2). Gate on the rim. No salvage, no music, no ladder, no upgrades.
   **PLAY IT. If it isn't tense, stop and report.**
2. **STAGE 1.** Salvage (§4), progression (§6), multi-system runs, the run map.
3. **STAGE 2.** The ladder (§3), score & summary (§9).
4. **STAGE 3.** The adaptive score (§7). **Fog test first (§13), before a single
   oscillator.**
5. **STAGE 4.** The exit spectacle (§8), how-to-play tab (§12).

Playtest between every stage. Ship nothing that hasn't been flown.

---

## 15. Non-goals — DO NOT BUILD

- **LLM-driven NPC hails, factions, dialogue, or story.** This is a *separate
  experiment* and it must be measured separately. If the run isn't fun without
  hails, hails will not save it — and if you ship both at once and it *is* fun, you
  will not know which one did it. **This is still the moat. It is just the second
  experiment.**
- **A wingman.** A second full AI, and it hands you two sensor pictures, which
  breaks the fog fantasy. **The XO is already the friend** — give him run-aware
  lines and he becomes a companion for free.
- **A tech tree.** §6 is a multiplier table. That is the whole system.
- **Music from audio files.** §7.2.
- **An omniscient Hunter.** §2.1. This is the one that would quietly kill the game.
- **A shrinking clock.** §1. It shrinks the game, not the difficulty.
- **A gate charge timer.** §5.1. The aperture is the difficulty.
- **Multiplayer changes of any kind.** NeWk is the priority; this ships after.
