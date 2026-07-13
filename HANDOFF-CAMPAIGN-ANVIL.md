# HANDOFF — CAMPAIGN PATCH 1: "The Anvil"

**Baseline: campaign Stage 1.** Addendum to `HANDOFF-CAMPAIGN-v1.md`. Where this
conflicts with it, **THIS DOCUMENT WINS.**

---

## 0. Intent

The campaign currently rewards playing slow, quiet, and passive, because signature
equals thrust — so going fast, shooting, and being aggressive all get you killed.
This patch makes aggression viable and rewarding: it puts a **bounty on the Hunter**
and a **clock on the door**.

**This patch gates everything after it.** Every future system prices itself against a
threat that does not currently work. Build it, ship it, playtest it, report. **Nothing
else gets built until the playtest verdict comes back.**

---

## 1. The Hunter must actually work

If these three fixes have not already landed, they land here. **The rest of the patch
is worthless without them.**

### 1a. Boundary leash

`hunterDecide` has `AVOID` for rocks and nothing for the region edge, so in HUNT it
flies a rumble bearing straight through the shroud.

- Add the boundary to `AVOID`.
- **Clamp every waypoint and intercept solution to `≤ 0.9 × REGION_RADIUS_M`.**

### 1b. Datum search

HUNT currently falls back to seeded patrol waypoints — a random walk across a 500 km
map hunting a silent ship. A player who goes dark is never found.

- On losing contact, record a **datum**: `{ x, y, t }`.
- **Uncertainty radius** grows: `r = (now - t) × MAX_SPEED_MPS`.
- **Search that circle** — expanding spiral or sector sweep from the datum — instead
  of wandering the map.

The intended consequence: sitting still after being seen gets you found. Coasting away
silently on momentum you already had does not.

### 1c. Escalation to active sensors

As `r` crosses thresholds, escalate:

1. **PASSIVE** — datum spiral.
2. **PROBES** — seed remote ears around the datum circle. The player can kill them.
   *(Skip this stage if the corvette archetype does not carry probes. Do not add
   probes to the archetype.)*
3. **PING** — frequency scales with `r`. Never ping at low uncertainty.

The ping lights the Hunter at ID tier, map-wide, for 10 seconds — so every sweep hands
the player a free exact fix on him. That trade is the point. The v4.7 ping fx already
renders the expanding ring for every viewer, so the player will see it wash over them.
Nothing to build there.

XO line: *"Active ping — he's sweeping for us, Captain."*

---

## 2. The bounty

> **The Hunter's hold is the richest loot in the system.**

**Patch 1 implementation is a placeholder:** a large multiple of the best hold the
existing loot system can generate. **Patch 5 replaces this with modules.** Do not build
a bespoke loot category for it — reuse what exists and make the numbers big.

---

## 3. The Hulk

On death, the Hunter becomes a **drifting hulk carrying exactly the velocity he had
when he died** — tumbling, venting, trailing debris.

**Do not spawn a static wreck. Do not transfer the loot to the player.**

### 3a. The transfer gate becomes relative

Currently `speed < SALVAGE_STOP_SPEED_MPS` — **absolute speed.** Change to:

```ts
|v_ship - v_wreck| < SALVAGE_STOP_SPEED_MPS
```

Static wrecks have `v = 0`, so **nothing about them changes.**

### 3b. The maneuver generalizes by substitution

In the `salvage` branch of `stepManeuver()`, **replace `v` with `v_rel = v_ship -
v_wreck` throughout**:

- The retro-flip-and-brake regime flips to the retrograde of `v_rel` and nulls it.
- The terminal-hop regime aims at a **lead intercept**, not the wreck's current
  position.
- The station-keeping threshold (`speed < 5`) becomes `|v_rel| < 5`.

**This is a substitution, not a rewrite.** For static wrecks `v_wreck = 0` and the
behavior must be bit-identical to today. **The proof is that every existing salvage
test passes unchanged. If any of them needs editing, something was rewritten that
should not have been.**

### 3c. Hulk physics

- Wreck entities gain `vx, vy`, integrated in `step()`.
- **No collision.** It is debris.
- **No decay.** It persists for the system — the player needs time to chase it.
- **Shroud drag applies.** If he died fleeing outward, the hulk drifts out of the
  shroud and decelerates, and chasing it means going lit-up and fighting the current.
  **Do not clamp the hulk inside the region.**

### 3d. No additional cost rule

To loot the hulk the player must match its velocity — which means adopting the
Hunter's escape vector: far from the gate, moving fast in the wrong direction, with a
hold full of new mass to kill and reverse. **The momentum is the price. Do not add a
timer, a penalty, or a range restriction on top of it.**

---

## 4. The closing gate

> **When the Hunter dies, the jump gate destabilizes and the aperture narrows to
> zero.**

### 4a. Constants

```ts
export const GATE_CLOSE_START_S = 180;  // after Hunter death: warning + narrowing begins
export const GATE_CLOSE_END_S   = 300;  // aperture reaches ZERO
```

Aperture interpolates from `APERTURE_W_M` to `0` across that window. Linear to start.

**It closes completely. There is no minimum aperture.** If playtest says the window is
too tight, **raise `GATE_CLOSE_END_S`** — do not add a floor, and do not widen
`APERTURE_W_M`.

### 4b. Closed = wall

The pylons are rocks, so a fully closed gate is a wall the player can crash into. A
player still in the system at closure: **gameover, `RUN ENDED — STRANDED`.**

### 4c. Make it unmissable

- **XO, CRITICAL, on Hunter death:** *"The gate's destabilizing, Captain. She's
  closing."* NEWS lines at 50% and 25%.
- **`drawGate()` already renders from the live aperture** — feed it the shrinking value
  and the pylons creep inward for free.
- **One new HUD row:**

```
GATE CLOSING  2:14  ·  aperture 62%
```

The existing `GATE` row already shows `ttg`, `miss`, and `SOLUTION GOOD` — so as the
aperture shrinks the player watches a good solution turn bad. That instrument is
already built.

---

## 5. Corvette turn rate

**+40%.**

⚠️ **The aperture derivation is downstream of turn rate.** This changes the numbers.

- Re-run the all-three-archetype derivation pin.
- Re-assert the ordering test (the Cruiser's viable approach envelope stays slower
  than the Corvette's).
- **Do not widen `APERTURE_W_M` to compensate.** The archetype spread is intentional
  and load-bearing (see the existing comment on that constant).

---

## 6. Tests

- **Hunter boundary** — never exits `REGION_RADIUS_M` across a full match.
- **Hunter datum** — search waypoints lie within `(now - t) × MAX_SPEED_MPS` of the
  datum. A player who sits still after being seen is found; one who coasts away
  silently is not.
- **Hunter escalation** — ping frequency rises with uncertainty radius; no ping fires
  below the threshold.
- **Relative salvage — the important one.** Every existing salvage test passes
  **unchanged and green**. Then: a wreck moving at 800 m/s cannot be looted by a
  stationary ship, and **can** be looted by a ship matching its velocity.
- **Hulk** — spawns at the Hunter's position with the Hunter's velocity and the
  richest hold in the system; integrates; takes shroud drag outside the region; does
  not collide.
- **Gate closing** — aperture reaches exactly 0 at `GATE_CLOSE_END_S`; the pylons
  become contiguous; a player in-system at closure gets `STRANDED`.
- **The vise (regression pin)** — a full-hold Cruiser starting at the far side of the
  region at `GATE_CLOSE_START_S` **cannot** reach the gate without jettisoning. **If
  this test ever passes with a full hold, the endgame tension has been tuned away.**
- **Aperture derivation** — all three archetypes, re-derived from live constants after
  the turn-rate change; ordering preserved.

---

## 7. Build order

1. `npm test` + `npm run typecheck` green. Branch `campaign-anvil`.
2. **§1 the Hunter.** Nothing else matters until he works. Fly it: he must find you,
   press you, and be audible doing it.
3. **§5 Corvette turn rate** + re-derive the aperture pins.
4. **§3 the Hulk** — the relative-velocity substitution first, existing tests green,
   *then* the hulk entity.
5. **§2 the bounty.**
6. **§4 the closing gate** — constants, render, HUD, XO lines, the STRANDED path.
7. Playtest. **Report before anything else is built.**

---

## 8. Non-goals — DO NOT BUILD

- Modules, mass, power, reactor, jettison
- The side-panel redesign (this patch adds **one** HUD row and nothing else)
- Co-op
- Standing-order priority or slot changes
- New wreck types or loot categories
- A minimum aperture floor
- Hulk collision damage
- A replacement Hunter spawning on the first one's death — **the closing gate is the
  threat**

---

## 9. Forward architecture — do not hardcode against these

Later patches will need the following. **Don't build them now** — just don't paint us
into a corner.

**Modules, mass, and power are coming (Patch 4/5).** A ship's `accel`, `turnRate`, and
`signature` will become **derived** from a loadout rather than read from an archetype
constant. Where this patch touches those values, **read them through the ship object,
not from `constants.ts` directly**, so the derivation can be swapped in later without
chasing call sites.

**Co-op is coming (Patch 2).** The campaign will run **2 player ships** in one system.
Do not assume exactly one player in the mission wrapper: `mission.playerId` should
become a list, and the Hunter's target selection should be a **query over player ships**
rather than a stored single reference. **Do not build the multi-player path now** —
just don't hardcode the singular.

**Ore will be feedstock, not currency (Patch 5).** No shop. Don't add one, and don't add
a fungible credits field.

**Everything else is open.** Do not attempt to anticipate the module catalog, the
doctrine system, or the panel redesign.
