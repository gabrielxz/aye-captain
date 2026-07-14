# AMENDMENT — "The Unification"

**Amends `HANDOFF-PATCH-4-5-LOADOUT.md`.** Where they conflict, **THIS DOCUMENT WINS.**

**It replaces §0's campaign-only scope.** Read this first, then that.

---

## 0. The change

**Multiplayer and campaign run on the same systems.** Mass, reactor, power, modules,
wrecks, salvage, the hold, jettison — all of it, everywhere.

> **Multiplayer is the campaign, minus the Hunter, plus other humans.**

Same map generation. Same wrecks. Same physics. **The only difference is who is hunting
you.**

---

## 1. Wrecks in multiplayer — the biggest change, and it fixes a real problem

**The multiplayer map is currently empty.** There is nothing out there but each other. So
the game is: find the enemy, fight the enemy. The map is a featureless arena.

**Put the campaign's wrecks and rumors on it.** Same generator, same types (§5 of the base
doc), same stochastic pools.

What that buys, immediately:

- **Objectives.** Reasons to go somewhere specific.
- **Schelling points.** In an 8-player FFA on a 500 km map, *finding* people is hard.
  Wrecks are where people will be.
- **A reason to be loud.** Salvage requires a **full stop**, and the burn to get there is a
  scream. **Looting is bait.** You are stationary, audible, and predictable.
- **The best fight in the game.** Two captains converging on the same smuggler wreck,
  neither certain the other is there. That encounter is currently impossible to construct.
- **A reason to *see*.** The wreck type is visible from across the system — so *"is that
  module worth going loud for?"* becomes a live question for the whole flight.

---

## 2. 🔴 The anti-snowball is free — do NOT add rubber-banding

The obvious objection to loot in PvP is that the leader snowballs. **The existing design
already solves it, twice:**

**Loot makes you LOUD and HEAVY.** The richest captain is **the loudest thing on the map**
and the slowest. Everyone can hear them. Nobody can be ambushed by them. In FFA, everyone
knows where to gang up.

**Death drops everything.** A dead ship becomes a **hulk carrying its entire loadout and
hold** — under all the Patch 1.1 rules (0.4 momentum retention, rock collision, shroud
entrainment). *(This already exists in co-op for teammates. Apply it to every death, in
every mode.)*

> **The leader is simultaneously the biggest target and the biggest prize.**

That economy self-corrects with **zero** catch-up mechanics. **Do not add any.**

⚠️ **Watch item:** the correction is strongest in FFA (many hunters, one loud leader) and
weakest in 1v1, where the loser cannot gang up. Playtest 1v1 specifically. If it
snowballs, **the lever is the loudness scaling (`POWER_TO_SIG`), not a handicap.**

---

## 3. 🔴 Non-breaking calibration — pin this before anything else

**A multiplayer ship with its starting loadout and no looting must play EXACTLY as it does
today.**

The current MP archetypes have hardcoded capabilities (Frigate and Cruiser have railguns;
Corvette does not). Under the new system the railgun is a **module** — so those
capabilities become **starting loadouts**:

| | Starting loadout | Result |
|---|---|---|
| **Corvette** | Baffles | No railgun — **exactly as today** |
| **Frigate** | Railgun · Probe Rack | Railgun — **exactly as today** |
| **Cruiser** | Railgun · Armor Plate | Railgun — **exactly as today** |

**Calibrate `baseMass` so that an archetype carrying its STARTING LOADOUT with an empty
hold produces today's exact accel, turn rate, and signature.**

*(Note this differs from the base doc's calibration point, which used an empty ship. The
starting loadout is the correct reference — it is what a match actually begins with.)*

**Every existing multiplayer test must pass green and unmodified.** That is the proof.

Looting degrades from there. **Getting stronger costs you speed and silence, in every
mode.**

---

## 4. Salvage installs directly

The **workshop rule** (a full stop, ~60 s per module) is correct in campaign but would make
mid-match installation suicidal in PvP — nobody would ever do it, and the whole system
would be dead in multiplayer.

**So:**

> **A salvaged module installs directly if there is a free slot AND reactor headroom.
> Otherwise it goes to the hold as cargo.**

**The captain already paid the momentum cost** — they stopped, they were loud, they were
helpless. **That stop *is* the install.** Charging them twice would kill the mechanic.

**The workshop rule survives for the deliberate act:** *swapping* (uninstall X to fit Y),
repairing, rearming, and refining all still require their own full stop. **Choosing your
deck is expensive. Picking up a card you had room for is not.**

This applies in **both** modes.

---

## 5. No pre-match loadout editor

Ship select shows the archetype **and its starting loadout**. It is not editable.

Three reasons, and they compound:

- **Lobby friction.** Six players each building a ship is a five-minute wait before anyone
  flies. Your FFA nights are the reason this game exists; do not put a spreadsheet in front
  of them.
- **It would gut the map.** If you can build the ship you want in the lobby, **you have no
  reason to go to a wreck.** The entire objective layer evaporates.
- **It unifies the modes perfectly.** In both campaign and multiplayer, **the only way to
  build a ship is to loot one.** Every match is a fresh run.

*(A pre-match editor is a plausible future feature. It is not this patch, and it is not
obviously an improvement.)*

---

## 6. What still differs between the modes

**Everything else is shared.**

| | Campaign | Multiplayer |
|---|---|---|
| **The threat** | The Hunter | Other captains |
| **The jump gate** | Escape to the next system | *(none — see §7)* |
| **Persistence** | Loadout carries across 8 systems | Match ends, run ends |
| **Win** | Clear systems | Last alive / team elimination |

---

## 7. Extraction mode — noted, not built

With the systems unified, a third mode falls out of the existing parts almost for free:

> **Put the jump gate in a multiplayer match. Escaping with loot is how you win.**

You go in for the modules. So does everyone else. You must reach the gate to keep anything.
**Dying loses it all.** Greed versus extraction, with fog of war and a closing door.

**Everything required already exists** — the gate, the aperture, the loot, the hold,
jettison, the hulk. It is a **win condition**, not a system.

**DO NOT BUILD IT IN THIS PATCH.** It is noted so that nothing gets architected in a way
that forecloses it — keep the win condition pluggable and keep the gate mode-agnostic.

---

## 8. Amended tests

**Replaces the base doc's "🔴 Multiplayer is untouched" test, which is now void.**

- **🔴 MP non-regression — the load-bearing test.** An archetype with its **starting
  loadout** and an empty hold produces **bit-identical** accel, turn rate, and signature to
  today. **Every existing multiplayer test passes green and unmodified.** Pin it.
- **Railgun parity** — a Frigate and a Cruiser begin every MP match with a railgun; a
  Corvette does not. Identical to current behavior.
- **Wrecks in MP** — generated, typed, visible from t=0, salvageable under the existing
  rules.
- **Salvage-installs** — a salvaged module with a free slot and reactor headroom is
  **installed**; without either, it lands in the **hold as cargo**. No second stop is
  required in the first case.
- **Death hulk (all modes)** — a dead ship becomes a hulk carrying its **full loadout and
  hold**, at its death velocity, obeying every Patch 1.1 hulk rule. Another captain can
  match it and loot it.
- **Anti-snowball (behavioral pin)** — a ship carrying N modules has strictly higher
  signature and strictly lower accel than the same ship carrying zero. **Getting stronger
  must always cost speed and silence.**

---

## 9. Amended build order

Insert after step 6 (the five modules) of the base doc:

**6b. Bring multiplayer over.** Starting loadouts, the calibration pin (§3), wrecks on the
MP map, salvage-installs (§4), death hulks for all modes.

**Then playtest BOTH.** A 1v1 and a 6-player FFA. **Watch 1v1 for snowballing** (§2).

---

## 10. Amended non-goals

- ~~Any multiplayer change~~ — **void.** Multiplayer is in scope.
- **Rubber-banding, catch-up mechanics, or handicaps.** §2. The economy already
  self-corrects.
- **A pre-match loadout editor.** §5.
- **Extraction mode.** §7. Noted, pluggable, not built.
- **A Hunter in multiplayer.** *(A neutral third-party threat hunting all players is an
  interesting future mode. Not now.)*
- Everything else in the base doc's §11 still stands.
