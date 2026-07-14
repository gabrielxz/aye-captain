# HANDOFF — PATCHES 4 + 5: "The Loadout"

**Baseline: Patch 3 (panel) + Patch 3.5 (rings).** Where this conflicts with earlier
campaign docs, **THIS DOCUMENT WINS.**

Patches 4 and 5 ship together. The reactor is meaningless without modules to power; the
modules are meaningless without a budget to strain.

---

## 0. Intent, and the one law

The campaign currently rewards playing slow and quiet, and loot is a stat bump that
changes a number without changing how you play.

**This patch makes the ship a deck, and signature the cost of every card in it.**

> **THE LAW: everything you run makes noise. Power draw *is* signature.**

One number, two consequences — it spends your reactor **and** it makes you loud. That
collapses the power budget and the noise budget into a single decision, and it means the
deckbuilder's question — *"is this card better than my average card?"* — becomes:

> **"Is this system worth the noise it makes?"**

### 🔴 SCOPE: CAMPAIGN ONLY

**Multiplayer is not touched.** No modules, no reactor, no mass system. MP archetypes keep
their fixed stats and their hardcoded railguns exactly as they are today. **NeWk is close
and MP is tuned — do not risk it.**

**Exception — the legibility work (§8) applies everywhere**, because MP ships already have
signature and thrust. A plume that scales with signature is an improvement to every mode.

---

## 1. Mass

```
mass  = baseMass(archetype) + Σ(installed module mass) + Σ(hold mass)
accel = thrustForce(archetype) / mass
turn  = turnTorque(archetype) / mass
```

Braking distance (`v²/2a`) and lateral authority at the gate follow automatically.

### 🔴 An empty ship must fly EXACTLY as it does today

Derive `thrustForce` and `turnTorque` from the *current* constants:

```
thrustForce = accel_current × baseMass
turnTorque  = turnRate_current × baseMass
```

**Pin this.** An archetype with nothing installed and an empty hold must produce
bit-identical acceleration and turn rate to today. Every existing physics test stays green
and unmodified.

### The hold has NO capacity limit

**Mass is the limit.** You can carry as much as you want — and it will destroy your
acceleration, your turn rate, and your ability to stop.

Greed literally weighs you down. **That is the entire design and it needs no rule.**

### ⚠️ The gate derivation is downstream of mass

Mass reduces lateral authority, so a loaded ship has a harder gate. **That is correct and
intended.** Re-run the all-three-archetype aperture pin *with representative loadouts*,
and keep the **vise pin** green: *a full-hold Cruiser at the far side when the gate starts
closing cannot make it without jettisoning.*

---

## 2. Reactor and power

```
signature = ( sigBase + effectiveThrust + Σ(powerDraw of POWERED modules) × POWER_TO_SIG )
            × Π(signature multipliers)
```

- `Σ(powerDraw of powered modules) ≤ reactorCapacity(archetype)`.
- **Attempting to exceed capacity is REJECTED**, not auto-shed. *"Not enough power,
  Captain — something has to go cold."* The captain decides what dies.

```ts
export const POWER_TO_SIG = 8;  // TUNE. A fully-lit Cruiser should be roughly as loud
                                // as a Corvette at full burn.
```

### Archetype table

| | Slots | Base mass | **Reactor** | Sig base |
|---|---|---|---|---|
| **Corvette** | 4 | low | **6** | 20 |
| **Frigate** | 6 | mid | **9** | 30 |
| **Cruiser** | 8 | high | **12** | 45 |

**The reactor is the archetype's soul.** The Corvette is a *tight deck* — it physically
cannot power a big kit, so it is pushed toward being a ghost. The Cruiser is a *greedy
deck* — it can run everything at once, and it will be **heard** doing it. Some modules
draw more power than a Corvette can ever supply.

---

## 3. Installed ≠ powered ★★

**This is the deck/hand split and it is the heart of the system.**

| | Costs | Speed |
|---|---|---|
| **Installed** | **Mass — always.** Occupies a slot. **You haul it even when it's off.** | **Slow.** A maneuver. |
| **Powered** | **Signature.** Draws reactor. | **Instant.** A sentence. |

**You will typically install more than you can power.** So the loadout is your **deck**,
and what's lit right now is your **hand.** Choosing your hand is a live decision, every
second of transit.

*You can haul a Deep Array through a hot system stone cold — dead weight, zero noise — and
light it only when you need to look.*

### 3a. Verbs

```json
"power":     { "module": "<id>", "state": "on" | "off" }
"install":   { "module": "<id>" }
"uninstall": { "module": "<id>" }
"refit":     { "action": "repair" | "rearm" | "refine", "module": "<id>?" }
```

**`power` is instant and free.** *"Power down the array." / "Light up the railgun."*
Respects nothing but reactor capacity.

### 3b. 🔴 THE WORKSHOP RULE

> **Anything that modifies the ship requires a full stop.**

`install`, `uninstall`, and every `refit` action require `|v| < SALVAGE_STOP_SPEED_MPS` and
take real time (`MODULE_INSTALL_S`, ~60 s per module). **Any thrust command aborts** and
loses that module's progress.

You are **stationary, helpless, and your reactor is still running** for a minute — with
something hunting you. **One rule, one cost, consistent across salvage, install, repair,
rearm, and refine.**

---

## 4. The catalog

**Every module must change what you can DO, not just a number.**

### 🔴 SHIP FIVE FIRST

Do not build the whole catalog. **Ship these five, playtest, then expand.** They span every
axis and they will tell you whether the system works:

| Module | Mass | Power | Effect |
|---|---|---|---|
| **Baffles** | 2 | 1 | **−25% total signature.** The bread and butter. |
| **Deep Array** | 1 | **4** | **+60% sensor range.** *Seeing costs being seen.* |
| **Railgun** | 4 | 2 | Direct fire. Heavy, and it commits you. |
| **Mine Layer** | 3 | 1 | **Drop mines behind you. The chase becomes the trap.** ★ |
| **Armor Plate** | 5 | 0 | **+hull. Pure mass.** Proves the cost. |

**The Railgun is now a module. Delete the Frigate/Cruiser-only rule.** A Corvette *can*
mount one — it will eat most of its slots, most of its mass tolerance, and a third of its
tiny reactor. **That is a build. Let it exist and let it hurt.**

**The Mine Layer is the anchor.** The captain reached for it, unprompted, mid-chase, in a
module system that did not exist. It turns *fleeing* into an *attack*.

### The full catalog (after the five prove out)

**Stealth**
- **Cold Cycle** — 1 / 1 — below 25% throttle, signature drops a further 50%. *Patience as a weapon.*

**Sensing**
- **Probe Rack** — 2 / 0 — +4 probes. Passive, free to run.
- **Passive Trawl** — 2 / 2 — contacts promote a tier faster without ever pinging.

**Deception — attack HIS information, not protect yours**
- **Screamer Probe** ★ — 2 / 1 — a probe that emits a **massive fake signature.** He burns two minutes chasing a ghost. **You did that to him.**
- **Mimic Decoy** — 1 / 1 — your decoys read as **wrecks.** He goes to investigate.
- **Chaff Hold** — 1 / 0 — jettisoned cargo reads as a **moving ship**, not a static cloud.
- **Jammer** — 3 / 4 — cuts enemy sensor range in a radius. Loud, active, and it takes his advantage away.

**Violence**
- **Torpedo Rack** — 3 / 1 — +2 tubes, salvo fire.
- **PDC Overdrive** — 2 / 3 — **RARE.** Permanent, significant PDC boost.

**Speed**
- **Drive Tune** — 1 / 2 — +15% thrust force.
- **Overburn** ★ — 2 / 2 — **3× accel for 10 seconds, once per system. Deafening.** Everyone on the map hears it. The loud, dumb, glorious button.

*(**Logic Circuit** is deferred to Patch 6 — do not ship a module whose effect does not
exist yet.)*

### Starting loadouts — the archetype's opening hand

- **Corvette** — Baffles. Nearly naked. Room to become anything.
- **Frigate** — Railgun, Probe Rack. Balanced.
- **Cruiser** — Railgun, Armor Plate. A big, slow, greedy deck.

---

## 5. Wreck types

**Stochastic, not deterministic.** A military wreck *probably* has weapons.

| Type | Pool |
|---|---|
| **Military** | Railgun · Torpedo Rack · Armor · Mine Layer · PDC Overdrive |
| **Survey** | Deep Array · Probe Rack · Passive Trawl |
| **Smuggler** | Baffles · Cold Cycle · Mimic Decoy · Chaff Hold |
| **Freighter** | Ore, and a great deal of it · consumables |
| **Derelict Warship** ★ | Rare. Jammer · Overburn · PDC Overdrive · Mk II items |

### 🔴 The type is VISIBLE from across the system

**This is what makes transit a decision.** Without it, loot is a surprise, you cannot plan,
and there is no deckbuilding — only fetching.

> *"I need baffles. The smuggler wreck is 80 km across open ground. He's out there
> somewhere. Worth it?"*

**That question lasts the entire flight**, and it is the thing the campaign has been
missing.

**Rumors** keep their Patch 1 rules: type unknown or unverified, might be empty, might be
the run-maker — **and the Hunter does not patrol them, because he doesn't know either.**

**The Hunter's hold is still the best in the system**: 2–3 modules with a real chance at a
rare.

---

## 6. Ore

**Feedstock, not currency. There is no shop and there will never be one.**

Four uses:

1. **Repair** hull
2. **Rearm** missiles and PDC
3. **Refine** a module you already own — **Mk I → Mk II only.** Two tiers, one price, no
   bespoke trees. Mk II ≈ the same effect, ~50% stronger. **You cannot buy what you didn't
   find. You can only make what you found better.**
4. **It is your best decoy.** A jettisoned hold is a mass cloud (Patch 1). **You are
   throwing away your repairs, your ammo, and your upgrades to survive the next ninety
   seconds.**

**Ore is mass.** Hoarding it slows you down. All refit actions obey the **workshop rule**
(§3b).

---

## 7. The panel

Patch 3 reserved the containers. Fill them.

- **Reactor bar** — segmented. One segment per point of draw. **Click a segment to power
  that module down.**
- **Module list** — name · mass · power · `ON` / `COLD`.
- **Signature decomposition** — the panel's compact `SIG 30 · QUIET` line expands:

```
SIG 103 · SCREAMING     thrust 55 · array 32 · rail 16
```

- **HOLD** stays **strictly separate** from installed modules. A module in the hold is
  **cargo** — dead weight, jettisonable, does nothing. A module installed is a **system.**
  These must never read as the same thing.

---

## 8. Legibility ★★★ — this is not polish, it IS the mechanic

**If the captain cannot perceive their own noise, mass and signature are a spreadsheet.**
Every decision in this document becomes an accounting exercise without §8.

- **🔴 The sprite is built from the loadout.** Visible railgun barrels. Probe tubes. Armor
  plating. A loaded hull bulging with containers. **A stripped Corvette looks like a dart;
  a loaded hauler looks like a junk barge.** *(This also makes other ships' builds readable
  at a glance — a whole tactical layer, free.)*
- **The plume scales with SIGNATURE, not throttle.** v4.7 already built the plume. A loud
  ship has a huge, sloppy, bright wash. A ghost has a thin blue whisper. **Applies to
  multiplayer too.**
- **The hull hum scales with REACTOR DRAW.** v4.7 already built the hum. **The captain hears
  their own power, continuously, in their chest.** This is the most important feedback loop
  in the design.
- **Powering a module swells the VOICE RING** (Patch 3.5). Light up the Deep Array and
  watch your noise ring physically grow. **That single interaction teaches the entire
  system.**
- **Module sounds.** The Deep Array whines. The Jammer buzzes. The Overburn **roars.**

---

## 9. Tests

- **🔴 Empty ship is identical.** An archetype with nothing installed and an empty hold
  produces **bit-identical** accel and turn rate to today. **Every existing physics test
  green and unmodified.** Pin it.
- **Mass** — accel and turn degrade as `force / mass`; braking distance follows.
- **🔴 The vise pin stays green** — a full-hold Cruiser at the far side when the gate starts
  closing cannot make it without jettisoning.
- **Aperture derivation** — re-run all three archetypes *with representative loadouts*;
  ordering preserved.
- **Reactor** — powering beyond capacity is **rejected**, never auto-shed.
- **Signature** — equals `sigBase + thrust + Σ(powered draw × POWER_TO_SIG)`, then
  multipliers. **A cold module contributes ZERO signature and FULL mass.** Pin both halves.
- **Workshop rule** — install / uninstall / repair / rearm / refine all require a full stop;
  any thrust command aborts and loses that module's progress.
- **Power is free** — `power on/off` costs no time, no propellant, and works at any speed.
- **Hold ≠ installed** — a module in the hold has full mass, zero power draw, zero function.
- **Ore** — refine is **Mk I → Mk II only** (a Mk II cannot be refined again); repair and
  rearm consume ore.
- **Wreck types** — stochastic within their pool; type is present in the snapshot **from
  t=0** and visible at any range.
- **🔴 Multiplayer is untouched.** Every existing MP test green. No MP ship has a reactor,
  modules, or variable mass.

---

## 10. Build order

1. `npm test` green. Branch `patch-4-loadout`.
2. **§1 mass.** **Prove the empty ship is identical before anything else.** This is the
   whole foundation and it must be provably non-breaking.
3. **§2 reactor + §3a `power`.** Instant on/off, capacity rejection.
4. **Signature = base + thrust + draw.** Wire it to the voice ring (§8) and **fly it** —
   light a module and watch the ring grow. **If that moment doesn't land, stop and report.**
5. **§3b the workshop rule** — install / uninstall as a full-stop maneuver.
6. **§4 the FIVE modules.** Not the catalog. **Playtest here.**
7. **§5 wreck types** + **§6 ore refit.**
8. **§8 legibility** — sprite from loadout, plume from signature, hull hum from draw.
9. **§7 the panel.**
10. The rest of the catalog.
11. Playtest. Report.

---

## 11. Non-goals

- **Any multiplayer change** beyond §8's plume and hum. §0.
- **A shop.** Ore is feedstock. **There is no currency and no credits field.**
- **A tech tree.** Mk I → Mk II. Two tiers. One price.
- **Logic Circuits or standing-order changes.** Patch 6.
- **A hold capacity limit.** Mass is the limit.
- **Auto-shedding power** when over capacity. Reject and make the captain choose.
- **Three stats per module.** Mass and power. **Power is noise.** §0.
- **Cloak, Dead Burn, Reflex Core, Wake Reader, Shields.** All previously cut. Do not
  reintroduce them.
- **Building the full catalog before the five have been played.** §4.
