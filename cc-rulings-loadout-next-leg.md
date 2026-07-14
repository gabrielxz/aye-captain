Four rulings. The stat-bump question is the big one.

---

## 1. 🔴 The stat bumps DIE. They do not coexist.

Delete `upgradeCounts` and the sig/sensor/accel/hull stat-bump items entirely.

**Coexistence is not a compromise, it is a poison.** A stat bump is a **free** upgrade — strictly better, no cost. A module is a **priced** upgrade — mass and noise. So if both exist:

- **The stat bump is strictly dominant.** Every player takes every one, instantly, without thought.
- **It punches a hole in the only law the system has.** *"Everything you run makes noise"* — except the free stuff. Once there is a free lane, the deckbuilding question (*"is this worth the noise?"*) has an obvious answer.
- **It double-dips.** A free +accel bump AND a Drive Tune module is the same benefit twice, once priced and once not.

**The migration is already built** — the catalog was designed to replace them:

| Old stat bump | Becomes |
|---|---|
| `SIG_BASE` ↓ | **Baffles** (mass 2, power 1) |
| `SENSOR_BASE` ↑ | **Deep Array** (mass 1, power 4) |
| `accel` ↑ | **Drive Tune** (mass 1, power 2) |
| `hullMax` ↑ | **Armor Plate** (mass 5, power 0) |

Wrecks that used to drop a stat bump now drop the **corresponding module**. Same benefit, now with a price. Getting tougher makes you slower. Seeing further makes you louder.

**The resulting progression model, and it should be stated in the docs:**

> **Horizontal progression = modules (new capabilities, found).**
> **Vertical progression = refine (Mk I → Mk II, bought with ore).**

Two axes. No third, free one.

**Run state:** the loadout (installed modules + hold + ore) persists across systems exactly as `upgradeCounts` did — same localStorage + `coopCarry` mechanism. It is the campaign economy. Multiplayer has no persistence; a match is a run.

## 2. Push the rings to prod. Yes.

Pure render, no sim change, leak-pinned. It fixes a confusion that hits **every** new player. Ship it and let the online group react to the compass move.

## 3. PDCs and mines — this is not unspecced. This is the mechanic.

**PDCs engage mines — but only when PDC posture is `FREE`.**

**PDC `FREE` is loud.** So a pursuer running the player down must choose:

- **`FREE`** → the mines get shot down → **but they are now audible, and the player knows exactly where they are.**
- **`HOLD`** → they stay silent → **but they eat the mine.**

> **The Mine Layer does not merely damage the chaser. It forces the chaser to break their own silence.**

This turns the mine into an **information** weapon, reuses the existing PDC posture system, and makes the counterplay a real cost rather than a free auto-clear. It is exactly the direction the catalog is aimed at: *make problems for your enemy.*

Implement it, and make sure the **Hunter's AI** faces the same dilemma — a Hunter that goes PDC-free to clear a minefield should become audible while doing it. Do not exempt him.

## 4. The railgun auto-light needs an XO line

Your call — *a cold railgun auto-lights on the fire order and stays lit until powered down* — is correct and better than the spec. **Keep it exactly as built.**

But **the cost is currently silent.** The captain fires once and is permanently +16 signature without being told. The voice ring will show it, but the transition deserves a voice. One line, NEWS tier, **fired only on auto-light** (not on a manual power-on):

> *"Railgun hot, Captain — and we'll stay loud until it's cold."*

## 5. Probe rack at +2 instead of +4

Accepted. Tuning call, keep it.

---

## Next leg

§5 wreck types (now dropping **modules and ore**, never stat bumps) + §6b (wrecks in MP, death hulks in every mode).

**Do not lose the §3 calibration pin from the Unification amendment**: an archetype with its **starting loadout** and an empty hold must produce **bit-identical** accel, turn rate, and signature to today, and every existing MP test must pass green and unmodified. That pin is the proof the unification did not silently rebalance a game people already love.
