# HANDOFF — CAMPAIGN PATCH 1.1: "The Anvil, Sharpened"

**Baseline: `campaign-anvil` (abedfa5).** Addendum to
`HANDOFF-CAMPAIGN-ANVIL.md`. Where this conflicts with it, **THIS DOCUMENT WINS.**

---

## 0. Intent

Playtest verdict on the Anvil: the Hunter now finds and presses the player, the
chase is fun, and the kill is achievable. **But the bounty failed.** The player
killed the Hunter and never even considered chasing the hulk — it was doing 2 km/s
into deep space and was gone. And the gate closed before the player understood it
had started.

**Everything in this patch exists to make the hulk a live decision and the gate a
legible one.** Plus three fixes the playtest surfaced independently.


---

## 1. The Hulk must be chaseable

Three changes, all physics. 

### 1a. The kill spends his momentum

The Hunter dies at 100% throttle, so the corpse inherits the fastest velocity in the
game. But a hull breach is not a clean handoff.

```ts
export const HULK_MOMENTUM_RETENTION = 0.4;  // hulk keeps this fraction of death velocity
```

The rest is venting, tumbling, and debris. **This is not a cheat — it is an
explosion.**

**Preserve the gradient.** The hulk still inherits *direction* and a real fraction of
*speed*, so a stern chase (velocities converging) leaves a corpse you are nearly
matched to, and a head-on kill leaves one that's gone. **How the player kills him
still decides whether he gets paid.** Do not clamp, normalize, or zero the velocity.

### 1b. Collision

The hulk currently passes through rocks. It is a rock-sized object. **Give it rock
collision** — it crunches, sheds velocity, and tumbles. Reuse the existing rock
collision path. It takes damage cosmetically (debris, venting) but **does not lose
loot** and **does not despawn.**

### 1c. The shroud current carries it home ★

The XO already says *"the current's against us."* Make the current do what a current
does:

> **Powered things fight the current. Unpowered things are carried by it.**

A hulk that drifts outside the shroud is decelerated and then **walked back inside**,
arriving with near-zero velocity.

```ts
export const SHROUD_CURRENT_ACCEL = 0;  // TUNE: inward accel on unpowered bodies outside the shroud
```

**Tune it SLOW.** Target: a hulk at max escape velocity returns inside the region in
**~2–3 minutes.** That number is the entire design:

- **Chase it hot** → match a corpse doing ~900 m/s. Skillful, fast, and it preserves
  the kill-quality gradient.
- **Wait for the current** → it returns nearly stationary and is trivially lootable.
  **But the gate is closing while you wait.**

Both paths exist, priced differently. *"Do I chase it, or can I afford to wait?"* is
the decision the bounty was supposed to create.

**Applies to unpowered bodies only** (hulks, wrecks, jettisoned mass clouds). **Ships
are unaffected** — they have engines, and the existing shroud drag on ships stays
exactly as it is.

---

## 2. Maneuver discipline ★★ — the biggest fix in this patch

**Every automatic maneuver currently burns at 100%.** `full_stop`, `salvage`,
`come_alongside` — all of them, in a game where burning is how you die. **The XO has
been screaming on the captain's behalf this entire time.**

### 2a. The posture

```json
"set_maneuver_discipline": { "level": "silent" | "standard" | "flank" }
```

| Level | Throttle cap | Feel |
|---|---|---|
| **SILENT** | **25%** | Takes forever. Nobody hears you. |
| **STANDARD** | **60%** | **The new default.** |
| **FLANK** | **100%** | *"I don't care who hears — get me there."* |

⚠️ **The default changes from 100% to 60%.** Every existing maneuver gets slower and
quieter. This is intentional and it is the point.

Because throttle caps acceleration, a SILENT `full_stop` takes roughly **4× the time
and distance** of a FLANK one. That cost is real, and it is the trade.

### 2b. Per-command override

The posture is the default. **A single command can override it for itself only:**

```json
"maneuver": { "type": "full_stop", "discipline": "silent" }
"salvage":  { "target": "wreck_a", "discipline": "flank" }
```

*"Come to a full stop, quietly"* works at any posture. *"Get me to wreck alpha, fast"*
works at any posture. **The override does not change the standing posture.**

### 2c. The translator eats the synonyms

This is what the LLM layer is *for*. Map liberally:

- **SILENT** ← quiet, quietly, careful, carefully, slow, slowly, gently, softly, dark,
  cold, "don't let him hear us"
- **STANDARD** ← normal, standard, regular, "as usual"
- **FLANK** ← flank, fast, quickly, loud, full, maximum, max, hard, immediate, now,
  "get me there", "I don't care who hears", "burn it"

### 2d. The XO teaches by quoting the price

**This is how the player learns the mechanic — do not skip it.**

- Posture set: *"Maneuver discipline silent, Captain. Nothing above twenty-five
  percent."*
- **On accepting a SILENT maneuver, quote the cost:** *"Silent approach — four
  minutes, Captain."*
- **On accepting a FLANK maneuver, quote the cost:** *"Flank — full burn. They'll hear
  us the whole way."*

Now the choice is a trade, spoken aloud, every time.

### 2e. The Hunter gets it too

The Hunter runs **STANDARD** by default and goes **FLANK** only when closing for a
kill or when uncertainty is maximal.

⚠️ **This makes him quieter and therefore harder.** Watch for it in playtest — if he
becomes too hard to hear, raise his default. But a Hunter who *throttles down to stalk*
and *opens up for the kill* is both more frightening and more readable, and his fuel
discipline already coasts him.

---

## 3. The gate

### 3a. 🔴 The `missM` bug — this is almost certainly the mystery rock

```ts
solutionGood = |missM| < APERTURE_W_M / 2          // WRONG — ignores the hull
solutionGood = |missM| + SHIP_RADIUS_M < APERTURE_W_M / 2   // correct
```

**The HUD says `SOLUTION GOOD` while the player is scraping a pylon.** The gate row
and the collision predictor are both right and they disagree. Fix the math **before**
touching the aperture width.

Apply the same correction to whatever `drawGate()` renders as the safe corridor.

### 3b. Grace, then close — and they must LOOK different

The player reported: *"I wasn't sure if the gate started closing immediately, or if
the timer was a countdown to when it would start."* The single `GATE CLOSING` HUD row
is ambiguous.

```ts
export const GATE_CLOSE_GRACE_S    = 240;  // aperture UNTOUCHED after the last Hunter dies
export const GATE_CLOSE_DURATION_S = 180;  // then narrows to ZERO over this
```

Seven minutes total. **Tune down from there, never up from too-short.** The window has
to fit: chase the hulk (or wait out the current), match, loot, flip, kill the
momentum, and get home.

**Two visually distinct HUD states:**

```
GATE STABLE   ·  closing in 3:12          [calm]
GATE CLOSING  ·  1:44  ·  aperture 62%    [alarm]
```

XO: a NEWS line when grace ends (*"The gate's started to close, Captain"*), NEWS at
50% and 25%.

**Still no floor.** It still closes to exactly zero. If the window is too tight, raise
`GATE_CLOSE_DURATION_S`.

### 3c. Widen the base aperture — after 3a, not instead of it

Once the hull-radius bug is fixed, widen `APERTURE_W_M` modestly for feel. **Re-run
the all-three-archetype derivation pin and the ordering test.** The archetype spread
stays load-bearing.

---

## 4. The railgun needs a firing solution

*"A solution shot doesn't miss if he's not maneuvering."* Currently the precise shot
is available at any lock. Gate it on tier:

| Contact tier | Railgun behavior |
|---|---|
| **ID (3)** | **Pinpoint solution shot.** Current behavior. |
| **TRACK (2)** | **Angular dispersion.** A cone, not a line. Miss grows with range. |
| **FAINT (1)** | No lock. Bearing-only blind fire (already exists). |

**This is not a nerf — it is a reward for winning the sensor game**, which is what
this entire game is about. It makes ID tier *matter*, and it means the Hunter can
defeat the railgun by **maneuvering**, which he should already be doing (§5b).

---

## 5. The Hunter's piloting

### 5a. The leash must BURN, not steer

Clamping his waypoint to `0.9R` does nothing about **momentum**. He can be pointed
perfectly inward and still be carried straight through the shroud by 3 km/s of
accumulated speed. **Turning does not help. Only burning does.**

```
if ( v_radial² / (2 · accel) > (R_limit − currentRadius) )
    → burn retrograde-radially NOW
```

**`AVOID` must be able to command a full braking burn against the boundary**, not just
a heading change. Right now it steers away from a wall it has already committed to
hitting.

*(The braking-distance-based rock lookahead from the last round was the right call and
stays — this is the same principle applied to the boundary.)*

### 5b. PURSUE should rendezvous, not ram

He flies **at** the player — lead-intercept, throttle by range. That is a heat-seeking
missile, and it produces exactly the observed yo-yo: overshoot, flip, burn back,
overshoot.

> **Target a relative velocity, not a position.** Close to weapons range while
> arriving with a *manageable closing rate*.

**You already wrote this code.** It is the `come_alongside` rendezvous math, now
operating in the wreck's frame. Point PURSUE at the same solution — a rendezvous to
`HUNTER_ENGAGE_RANGE_M` with a bounded closing rate, rather than an intercept at the
target's position.

He stops ramming and starts *closing*. Smoother, more deliberate, more frightening.

**Do not make him perfect.** Mistakes are wanted — the player said so explicitly. Fix
the physics; do not add special properties, exemptions, or omniscience.

---

## 6. Propellant refills between systems

Starting a system at 0% propellant is a bug, not a difficulty.

- **Propellant refills to 100% on system transition.**
- **Hull, missiles, and PDC ammo do NOT.** They remain the attrition axes.

Rationale, so this isn't re-litigated: propellant is the one resource that **already
regenerates in flight** at low throttle. A full refill between systems is consistent
with its existing model. The other three never regenerate, so they carry the campaign
economy.

---

## 7. Tests

- **Hulk momentum** — retains exactly `HULK_MOMENTUM_RETENTION` of death velocity,
  direction preserved. A stern-chase kill produces a hulk within matching range; a
  head-on kill does not.
- **Hulk collision** — collides with rocks, sheds velocity, **does not despawn and does
  not lose loot.**
- **Shroud current** — a hulk at max escape velocity returns inside `REGION_RADIUS_M`
  within the tuned window. **Ships outside the shroud are unaffected** (existing drag
  behavior unchanged — pin this).
- **Maneuver discipline** — throttle never exceeds the cap for the active level; a
  per-command `discipline` overrides the posture **for that command only** and leaves
  the posture unchanged; a SILENT `full_stop` takes ~4× the distance of a FLANK one.
- **Translator** — each synonym list maps to the right level. *"Come to a full stop
  quietly"* while at FLANK produces a SILENT stop.
- **🔴 `missM` hull radius** — a ship whose `missM + SHIP_RADIUS_M` exceeds the
  half-aperture reports `SOLUTION GOOD = false`. **Pin this against a regression.**
- **Gate phases** — aperture is untouched for `GATE_CLOSE_GRACE_S`, then reaches
  exactly 0 at `GRACE + DURATION`. The HUD reports STABLE then CLOSING.
- **Railgun tiers** — ID gives a pinpoint solution; TRACK gives dispersion that grows
  with range; FAINT cannot lock.
- **Hunter boundary burn** — a Hunter at max speed on an outbound radial vector burns
  retrograde and **never exits `REGION_RADIUS_M`.** *(The existing boundary test should
  now pass under conditions where it previously could not.)*
- **Hunter pursuit** — closing rate at `HUNTER_ENGAGE_RANGE_M` is bounded; assert he
  does not overshoot past the target and reverse more than once in a clean intercept.
- **Propellant** — 100% on system transition; hull/missiles/PDC ammo carry over
  unchanged.
- **The vise pin stays green.** A full-hold Cruiser at the far side at gate-close start
  still cannot make it without jettisoning.

---

## 8. Build order

1. `npm test` green on `campaign-anvil`. Branch `campaign-anvil-1.1`.
2. **§3a the `missM` bug.** One line, and it may be the reported mystery rock. Do it
   first and confirm.
3. **§2 maneuver discipline.** The biggest behavioral change in the patch — schema,
   translator, XO lines, the cap, the override. **Fly it before continuing.**
4. **§1 the hulk** — momentum, collision, then the current.
5. **§5 the Hunter's piloting** — the burn-leash, then rendezvous-pursuit.
6. **§4 railgun tiers**, **§6 propellant**, **§3b/3c the gate timing and width.**
7. Playtest. Report.

---

## 9. Non-goals

- Modules, mass, power, jettison as a *system* (the existing hold-dump stays as-is)
- The side-panel redesign
- Co-op
- The Mine Layer *(banked — the player reached for it unprompted mid-flight. It is the
  anchor of the module catalog. **Not this patch.**)*
- Any drag fudge on the hulk. §1c is a current, and it acts on unpowered bodies only.
- A minimum aperture floor
- Special properties, exemptions, or omniscience for the Hunter. **Fix his physics; let
  him make mistakes.**
