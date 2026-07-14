# ADDENDUM — PATCH 3 §3: The two rings and the compass (v2)

**Amends `HANDOFF-PATCH-3-PANEL-v2.md` §3.** Replaces the single noise ring, **removes
the 50 km range ring from the main view**, and **rehouses the bearing markings.**

---

## The finding

**Every new player misreads the 50 km ring** as either *"how far I can sense"* or *"how
far I'm being sensed."* When every user makes the same mistake, it is not a mistake —
**it is the interface telling you what it should have been.** And they are guessing at
two different things, and **both are real, and the relationship between them is the
game.**

---

## 1. Three elements, three jobs

| | What it is | Space | Behavior |
|---|---|---|---|
| **VOICE** | The range at which a **reference sensor** would detect **you**. Soft **filled** coral disc. | world | **Breathes with throttle, in real time.** |
| **EARS** | The range at which **you** would detect a **reference contact**. Dashed teal **outline**. | world | Mostly fixed; grows on sensor upgrade. |
| **COMPASS** | Bearing ticks + rumble markers. Ticked ring. **Toggleable** (as today). | **screen** | Fixed screen radius. Always visible at any zoom. |

**Radial information lives in the rings. Angular information lives on the compass. No
element does two jobs.**

---

## 2. The two rings

**The voice ring breathes.** That motion is what makes the whole thing unambiguous —
**fixed things don't move.** The moment a captain throttles up and watches the disc
swell, the mechanic is taught, permanently, with no text.

### The read

- **VOICE inside EARS** → *you hear them before they hear you.* **You are the hunter.**
- **VOICE outside EARS** → *they hear you before you hear them.* **You are the prey.**
- **The crossover is the danger state.** Tint the voice disc hotter, and the XO says it
  **once, edge-triggered, on the transition:**

> **"They'll hear us before we hear them, Captain."**

And on the way back under:

> **"We hear them first again, Captain."**

*(State the consequence. Do not use metaphor — an earlier draft of this line was too
clever to be clear.)*

### Why it also solves Patch 4

**Modules become visible as geometry.** Baffles shrink your voice. A deep array grows
your ears — **and powering it swells your voice at the same time.** The captain watches
their build reshape the game. That is the legibility problem Patch 4 has to solve,
solved a patch early, for free.

---

## 3. 🔴 Both rings are ESTIMATES. This is mandatory.

Both are computed **against a reference** (`SIG_BASE` for the ears ring, `SENSOR_BASE`
for the voice ring) — **never against any actual enemy's stats.**

- **An accurate voice ring would leak the Hunter's sensor grade** — his entire unearned
  advantage.
- **An accurate ears ring would leak every contact's signature**, including undetected
  ones.

**The estimate is the correct implementation, not a compromise.**

Consequences, all of them wanted:

- **The Hunter has better ears than the book allows**, so the voice ring **understates**
  exposure, and he will hear the captain from *outside* it. That is his identity, and
  learning it the hard way is the lesson.
- **Both rings have soft, gradient edges.** They must *look* like estimates.
- XO, once, on first draw: *"That's the book, Captain. He may not have read it."*

---

## 4. The compass — and it fixes a bug

The bearing markings currently ride on the 50 km ring, and the rumble marker draws on
top of them.

**That ring is lying about range.** A rumble is **bearing-only** — the captain has *no
idea* how far away it is. Drawing it on a 50 km ring says *"it's 50 km away,"* which is
false, on the one contact type that has no range at all.

- **The compass is a fixed-SCREEN-radius element**, not a world-space one.
  - **Always visible at any zoom.** A world-space ring at 210 km sails off the edge when
    zoomed in; the compass never can.
  - **Ticked** — so it can never be confused with a range ring. Ticks mean compass.
    Nobody mistakes a protractor for a ruler.
- **Rumble markers ride the compass.** A bearing-only contact drawn at an arbitrary
  fixed radius is **honest**: *"we know the direction and nothing else."*
- **Toggle behavior is unchanged.** Players who like the bearings keep them; players who
  don't, don't.

---

## 5. The ruler

The 50 km ring's other job was scale. **It must leave the main view** — anything centered
on the ship reads as a radius, and that semantic cannot be fought.

- **Faint concentric range rings live in the inset minimap.** The inset is a **scope**,
  and a scope is where a scale belongs. Multiple concentric rings read unambiguously as
  a ruler; a single ring never will.
- The main view is a **window**: it shows the captain their **voice**, their **ears**,
  and — on request — their **compass**.

---

## 6. Fog rules (pinned)

- The voice ring turns hot when a **known** contact is inside it.
- **🔴 It does NOT react to an undetected ship inside it.** Pin this as a leak test. It
  would otherwise be a proximity alarm that sees through the fog — and it is exactly the
  kind of "improvement" a future session would helpfully add.

---

## 7. Tests

- **Voice ring** radius tracks signature in real time and expands with throttle.
- **Ears ring** radius tracks sensor range; grows when sensor range grows.
- **🔴 Both rings read only the captain's own stats plus the reference constants.**
  Assert neither reads any other ship's signature or sensors. **Pin it.**
- **🔴 Voice ring does not react to an undetected contact inside it. Pin it.**
- **Crossover** fires exactly when voice radius > ears radius; the XO line is
  **edge-triggered**, not repeated.
- **Compass** renders at a constant screen radius across the full zoom range; rumble
  markers ride it; the existing toggle still works.
- **The 50 km ring no longer renders in the main view.** Range rings render in the inset.
