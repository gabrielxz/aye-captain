# HANDOFF v4.7 — "Sensation"

**Baseline: v4.6 deployed (2026-07-11).** This spec is an addendum to
`HANDOFF-v4.md` + `HANDOFF-v4.1.md` + `HANDOFF-v4.3.md` + `HANDOFF-v4.5.md`.
Where it conflicts with any of them, **THIS DOCUMENT WINS**.

This is the polish release immediately before the v5 archetype work. Its job
is to give the game's existing systems a body — sound and light for things
that currently happen silently. It is deliberately the *last* release before a
big feature push, because feel work is the first thing cut when you're
mid-feature, and because v5's three archetypes should inherit a renderer that
already knows how to emit plumes and stings.

---

## 0. Posture: this release does not touch the sim

**With three narrow exceptions, v4.7 is client-side.** The exceptions:

1. One new verb (`set_overlay`) that emits a `ui` event and nothing else.
2. One new fx event (`ping`) with a precomputed occlusion mask.
3. Two existing server fields (`pingRevealS`, `pingCooldownS`) surfaced in the
   owner's snapshot.

**Zero balance changes. Zero constant retunes. No new mechanics.** If you find
yourself editing `sim.ts` physics, sensors, weapons, or `constants.ts` tunables,
stop — you have left the scope of this release.

The v4.5 playtest questions are still open (does the hunt converge? do
throttles come up? is the ping cost honest?). **Do not pre-tune their knobs.**
v4.7 exists partly *so those questions become answerable* — right now half the
game's state changes are invisible, which makes playtest reports unreliable.

---

## 1. Vector overlay repair (`drawVectorOverlay`, client/render.js)

### The bug

The overlay is a world-space projection: pixel length = `speed × 10s ×
camera.zoom`. Two multiplicative variables, each with a large dynamic range.
At low speed, or zoomed out, the line collapses inside the 22px `MIN_SHIP_PX`
hull clamp and becomes invisible. It is also entirely unlabeled: the line means
"10 seconds of travel" and the circle means "where a `full_stop` ordered right
now would bring you to rest," and the UI says neither.

### The fix (three changes, same function)

**a) Minimum screen length.** Draw the line at
`Math.max(MIN_VECTOR_PX, speed * VECTOR_SECONDS * camera.zoom)` pixels along
the velocity direction.

```js
// client/render.js, near MIN_SHIP_PX
const VECTOR_SECONDS = 10;   // the line = this much travel at current velocity
const MIN_VECTOR_PX  = 34;   // legibility floor; clears the 22px hull clamp
```

Below the floor the line is a direction indicator rather than a projection.
This is a deliberate, tiny lie: when it clamps, you are moving so slowly that
"where I'll be in 10 seconds" is *approximately right here* — which is exactly
what the honest version was failing to communicate. Do not add a special dash
pattern or an "out of scale" tell; it is noise for a lie nobody will notice.

**b) Label both ends.** Replace the bare `${speed} m/s` and the bare `stop`:

- Arrowhead label: `+10s · 340 m/s`
- Stop marker label: `all stop · 18 km` — the range from the ship to the stop
  point, rounded to 0.1 km below 10 km and to whole km above. **That number is
  the decision content** ("can I stop before that rock"); the marker without it
  is a mystery circle, which is what shipped.

Keep the existing stop-point math exactly as it is (retrograde flip time at
turn rate, coast through the flip, then `v²/2a`). It is correct. It just needed
a name.

**c) Change the stop glyph.** The 5px dashed circle reads as a contact. Draw a
small dashed bracket/chevron pair straddling the velocity line instead — it
should read as a *wall you come to rest against*, not a thing in space.

---

## 2. The drift marker + `set_overlay`

### The element

A **drift marker**: a small hollow chevron at a fixed screen radius from the
hull, rotated to the ship's velocity bearing. The sprite shows *facing*. The
chevron shows *going*. When they diverge, that divergence is the entire
Newtonian premise of the game, and the eye currently has to construct it.

```js
const DRIFT_STUB_PX      = 26;  // radius from hull center; sits just outside MIN_SHIP_PX
const DRIFT_MIN_SPEED_MPS = 5;  // below this: draw nothing (matches full_stop's cutoff)
```

Independent of the V-key vector overlay and of `show_vector`. Default **off**.
Persists client-side for the session; resets to off on `start`.

### The verb

```json
"set_overlay": {
  "element": "drift",
  "state": "on" | "off"
}
```

- `element` is an enum with exactly one value in v4.7. **v5 adds values to this
  enum, not new verbs** — probe markers, contact designations, and railgun
  bearing lines all want this hook. That is why it is `set_overlay` and not
  `set_drift_marker`.
- Server-side it does nothing but
  `events.push({ kind: "ui", ship: ship.id, what: "overlay", element, state })`
  — the same channel `show_vector` already uses. No sim state, no snapshot
  field, cannot desync.
- `show_vector {}` **stays exactly as it is.** "Show me our vector" (a glance,
  5 seconds) and "keep the drift marker up" (a persistent state) are different
  intents and captains say both. Do not merge them.

**No hotkey.** The drift marker is reachable only through the XO. This is
deliberate: it is the first overlay that must be *asked for*, and asking the
ship for things is the game.

### XO language

Captain-speak is **drift**, never "prograde." Cache these:

- on: "Drift marker up, Captain."
- off: "Drift marker down."
- requested while stopped (`speed < DRIFT_MIN_SPEED_MPS`): the marker still
  toggles on (state is state), but the XO says: "We're not drifting anywhere,
  Captain — nothing to mark yet." Do not reject the command.

---

## 3. The ping, made sensible ★ MARQUEE ITEM

### The problem

`sensor_ping` is the largest voluntary trade in the game: **10 seconds of
map-wide ID-tier reveal, no LOS, in exchange for 5 seconds of TRACK picture
inside 150 km.** It currently produces *no sensation whatsoever*. A captain
cannot tell whether it fired, cannot see its area of effect, cannot feel the
price being paid, and — worst — when it comes back empty cannot distinguish
"nothing was there" from "a rock ate it." That last one is a comprehension
failure, not a polish gap.

**Do not change any ping mechanic.** `PING_RANGE_M`, `PING_TRACK_S`,
`PING_REVEAL_S`, `PING_COOLDOWN_S`, LOS gating, ping-cannot-lock — all
untouched. This section only makes the existing behavior perceivable.

### a) The expanding ring, with a terrain shadow

New fx, routed on the existing fx channel (the one carrying `pdc` and `boom`)
**to both players and to spectators**:

```ts
{ kind: "fx", type: "ping", x, y, r: C.PING_RANGE_M, mask: number[] }
```

`mask` has `PING_SHADOW_SAMPLES = 180` entries (2° resolution). Entry *i* is
the range along bearing `i * 2°` at which line of sight from the ping origin
first breaks — or `PING_RANGE_M` if that bearing is clear all the way out.
**Compute it server-side in the `sensor_ping` case using the existing
`losClear` / segment-raycast helpers in `terrain.ts`.**

The server computes the mask, not the client, for two reasons: the client would
otherwise need a duplicate port of the circle/ellipse segment tests (guaranteed
to drift out of sync with the server, producing a shadow that lies), and 180
floats once per 30-second cooldown is free.

Client renders: a thin bright ring expanding from the origin to `PING_RANGE_M`
over `PING_RING_MS = 1200`, fading as it goes — **but each 2° arc segment stops
being drawn once the animated radius exceeds that bearing's mask value.** The
ring tears itself open behind rocks and dust clouds as it expands.

**This is the single most explanatory graphic in the game.** When a ping comes
back empty because a rock ate it, the captain *sees the shadow*. The most
confusing outcome becomes the most legible one.

**Fog check (this is not a leak, and there is a test for it):** the mask is
derivable entirely from terrain, which both clients already receive in the
`start` message, and the pinger's position, which the enemy already receives at
ID tier for 10 seconds as the ping's stated price. The fx contains *no*
information either side didn't already have. It must contain nothing else —
no contacts, no grants, no ship state.

### b) Sonar, with a diegetic return

In `client/audio.js`, in the existing procedural style (`osc`, `noise`, `env`):

- **`sfxPing(own)`** — a bright sine around 1.2 kHz with a fast pitch drop into
  a long exponential tail. The "one ping only" sound. When `own === false` (the
  enemy pinged, and you heard it map-wide because they screamed), render it
  darker: lowpass it hard, drop the level, stretch the tail. **You should be
  able to tell whose ping it was with your eyes shut.**
- **`sfxPingReturn(delayMs)`** — a short return blip, scheduled at
  `delayMs = PING_RETURN_MS_AT_MAX_RANGE * (range / PING_RANGE_M)` with
  `PING_RETURN_MS_AT_MAX_RANGE = 900`.

The return blip is fired client-side from `main.js`'s existing snapshot-diff
logic: within the grant window following **your own** ping, take the nearest
contact that is new or newly promoted, compute its range, schedule the blip.

**An empty ping is the outgoing ping, a long silence, and nothing.** That
silence is the feedback. "Found nothing" becomes a thing the captain *heard*,
not an absence they had to infer. This is the point of the whole section.

Never fire a return blip for the enemy's ping.

### c) `LIT` — the price, made visible

Surface `pingRevealS` and `pingCooldownS` in the owner's snapshot (`you.*`;
`pingCooldownS` may already be there per v4.5 §6 — verify). HUD, beside the
existing ping-cooldown indicator:

- While `pingRevealS > 0`: a red **`LIT 8s`** countdown.
- While `pingCooldownS > 0` and not lit: the existing dim cooldown readout.

A voice line is one event. A countdown is continuous dread, for exactly as long
as the dread is warranted. **Do not** replace it with an XO line; the enemy's XO
already announces your ping, and your own XO announcing it after the fact is a
statement where you need a clock.

These are the owner's own fields. They must never appear in an enemy's snapshot
of you.

### d) Flashbulb

One-frame white/cyan bloom on the hull at ping-out. Sells "we just emitted."
Nearly free.

---

## 4. Feel pass

Ordered by value. Ship all of them; they are individually tiny.

### 4.1 Engine plume (own ship only)

Thrust is what this game is *about* — it is your signature, your commitment,
and your entire strategic position — and your ship currently looks identical at
0% and 100%.

Emit a plume from the stern whose length, brightness, and flicker scale with
**effective** thrust (the same value already driving `setThrust()` in
`main.js`). Reuse the existing `spawnParticle` system plus a gradient triangle.

**The stern offset must be a sprite-declared property, not a hardcoded number:**

```js
// client/render.js — v5 archetypes add their entries here, nothing else changes
const SHIP_STERN = {
  interceptor: { x: 0, y: 0.42 },  // normalized hull units, +y = aft
  gunship:     { x: 0, y: 0.46 },
  saucer:      { x: 0, y: 0.38 },
};
```

**This convention is the thing v5 inherits.** Get it right here and the
archetype art in v5 gets plumes for free by adding three lines.

> ⚠️ **DO NOT render the enemy's plume in v4.7.** Doing so requires putting
> their effective thrust into the snapshot, which is a genuine fog-of-war
> change — it hands the viewer the enemy's *signature*, which tells them what
> the enemy can see, which is a balance change wearing a costume. It is a real
> design question and it gets decided deliberately, not as a side effect of a
> polish release. Own ship only.

### 4.2 Contact tier ceremony

faint → track → ID is one of the best moments in the game and it currently has
none.

- **Promotion sting:** a three-note ascending motif, one note per tier reached.
  Fired from `main.js`'s snapshot diff, keyed on `cid` against the previous
  tier.
- **Demotion sting:** the same motif descending. Losing a contact should hurt.
- **Suppress both during a ping grant window.** A ping mass-promotes everything
  in range, which would produce a pile-up; the return blip (§3b) is that event's
  sound. Suppress from the ping ack until `PING_TRACK_S` expires.
- **Faint jitter:** tier-1 contacts carry server-noised positions
  (`FAINT_POS_NOISE_M = 2000`, refreshed every `FAINT_UPDATE_INTERVAL_S = 5`).
  Add a small per-frame *visual* wobble around the reported position — **low
  frequency and smooth** (a slow sinusoid seeded per `cid`, ~±6px screen-space).
  **Not white noise per frame**, which strobes and is worse than nothing. The
  eye should read "this is a guess," not "this is broken."

### 4.3 Dust is a state you are *in*

You go sensor-blind, potentially for minutes, and the only feedback is one
voice line. Surface `you.inDust` in the snapshot (the server already tracks it
for the translator's live-state summary — verify it's exposed). While inside:

- Full-canvas overlay: desaturation, a vignette, and a light grain.
- `setDustHiss(on)` in `audio.js` — a filtered noise loop on the SFX bus, low.

~20 lines, and it converts dust from a rule into an experience.

### 4.4 Rock rotation

Rocks already have deterministic craggy outlines seeded by index. Give each a
slow individual spin, seeded from the same index, larger rocks slower (say
±0.6°/s at the small end). **Client-side, cosmetic, no server involvement** —
collision geometry is circular and does not care.

Five lines. Space stops being a still life.

### 4.5 Camera shake

On a `boom` fx flagged as received (own hull — `sfxBoom` already knows), add a
decaying offset to the camera transform, magnitude scaled by `big`. Exponential
decay, short. Two lines and universally beloved.

### 4.6 Hull hum

One filtered noise loop at very low gain, always on once audio is unlocked. The
game's best sonic asset is that it is *quiet* — but true digital silence reads
as "audio broke." A floor hum means that when you cut thrust and go dark, the
*absence* of the thrust rumble lands against something. Dark becomes a felt
state instead of a bug report.

---

## 5. New constants

**Client tunables go at the top of `render.js` / `audio.js`**, alongside the
existing `MIN_SHIP_PX`, `INSET_PX`, `STAR_*`. `server/constants.ts` is for sim
tunables and stays that way.

```js
// client/render.js
const VECTOR_SECONDS       = 10;
const MIN_VECTOR_PX        = 34;
const DRIFT_STUB_PX        = 26;
const DRIFT_MIN_SPEED_MPS  = 5;
const PING_RING_MS         = 1200;
const SHAKE_MAX_PX         = 7;
const SHAKE_DECAY_MS       = 320;
```

```ts
// server/constants.ts — the ONLY sim-side addition in this release
export const PING_SHADOW_SAMPLES = 180; // 2° resolution occlusion mask
```

```js
// client/audio.js
const PING_RETURN_MS_AT_MAX_RANGE = 900;
```

---

## 6. Schema & translator

- Add `set_overlay` with the `element` / `state` properties and a clear
  description. Example translations: "show me our drift", "keep the drift
  marker up", "put a drift marker on the map", "drop the drift marker", "kill
  the drift marker".
- Add a translator rule: **"drift marker" is a persistent overlay
  (`set_overlay`); "show me our vector" is a momentary look (`show_vector`).
  When in doubt between them, a request phrased as a *state* ("keep…up",
  "leave it on") is `set_overlay`; a request phrased as a *look* ("show me",
  "what's our…") is `show_vector`.**
- No new standing-order metrics. No new query topics.
- Regenerate the TTS stock-line cache for the three new XO drift lines.

---

## 7. Docs (same release, per invariants)

**/how-to-play:**

- **Doctrine I ("Hearing, Seeing, Shooting")** — extend the "Passive and
  Active" note: the ping is a circle, not a beam; it is blocked by rocks and
  dust; **the ring you see on the map is the actual area of effect, and the
  gaps in it are where terrain ate your ping.** That last sentence is the whole
  reason §3a exists — say it plainly.
- **Reading the Map box** — add the drift marker: "your hull points where you
  are *aimed*; the drift marker points where you are *going*. They are not the
  same thing, and the gap between them is what will kill you."
- **Phrasebook** — Sensors row gains "Show me our drift" / "Drop the drift
  marker."

**README / CLAUDE.md:** bring current. Note the new fx type, the new verb, and
the `SHIP_STERN` convention (v5 will need it).

**TODO.md:** log v4.7 as deployed. The v4.5 playtest questions remain OPEN and
untuned — carry them forward verbatim.

---

## 8. Tests

Most of this release is render and audio and cannot be asserted headlessly.
Test the parts that can be:

- **`set_overlay` validation** — accepts `{element:"drift", state:"on"|"off"}`;
  rejects unknown elements, unknown states, missing fields. Emits a `ui` event
  and mutates no sim state (assert the ship object is untouched).
- **Translator pair** — "keep the drift marker up" → `set_overlay` on; "show me
  our vector" → `show_vector`. These two must not collapse into each other.
- **Ping fx: emission** — a `sensor_ping` produces exactly one `ping` fx with
  `mask.length === PING_SHADOW_SAMPLES`, every entry `<= PING_RANGE_M`.
- **Ping fx: the shadow is real** — place a rock directly on a known bearing
  from the pinger; assert the mask entry for that bearing is shortened to
  approximately the rock's near face, and that a bearing 90° away is still
  `PING_RANGE_M`.
- **Ping fx: routing** — the fx reaches both players *and* spectators.
- **Ping fx: no leak** (`tests/fog.test.ts`) — the `ping` fx payload contains
  only `x`, `y`, `r`, `mask`. No contacts, no grants, no ship state, no
  tier information. Assert on the key set, not on a happy path.
- **Reveal field ownership** — `pingRevealS` appears in the pinger's own
  snapshot and **never** in the enemy's snapshot of the pinger.
- **Ping mechanics regression** — re-run `tests/ping.test.ts` unchanged and
  green. If any assertion in it had to move, you changed a mechanic, and this
  release does not change mechanics.

---

## 9. Build order

1. Read the repo. Run `npm test` and `npm run typecheck` — green before you
   start. Branch `v4.7-sensation`.
2. **§1 vector overlay** (clamp, labels, stop glyph). Smallest, self-contained,
   immediately visible. Fly around at 40 m/s and at 3 km/s, at both zoom
   extremes. Ship nothing else until it reads correctly at all four corners.
3. **§2 drift marker + `set_overlay`** (verb, validator, schema, translator
   examples, XO lines, render, cache regen).
4. **§3 ping** — in order: (a) server fx + mask + tests, (b) client ring +
   shadow, (c) audio, (d) LIT countdown, (e) flashbulb. **The `tests/ping.test.ts`
   suite must stay green and unmodified throughout.**
5. **§4 feel pass** — plume first (it establishes `SHIP_STERN`), then tier
   ceremony, dust, rocks, shake, hum. Each is independently revertable; commit
   them separately.
6. Docs (§7), full test pass, deploy as one release.

---

## 10. Conventions v5 inherits

Flagging these so v5 can lean on them rather than rediscover them:

- **`SHIP_STERN`** — every ship design declares a normalized stern offset.
  v5's three archetypes add three entries and get plumes for free. A Cruiser's
  plume should be wide and slow; a Corvette's narrow and hot. That is archetype
  flavor at zero cost.
- **`set_overlay { element, state }`** — the overlay hook. v5's probe markers,
  contact designations, and railgun bearing lines are **enum values on this
  verb**, not new verbs.
- **The fx channel carries a `mask`.** The ping's occlusion mask pattern
  (server computes LOS, client animates against it) is the right shape for any
  future "what can I see from here" visual.

---

## 11. Non-goals — DO NOT BUILD

- **New ship art.** v5 replaces the sprite with three archetypes. Anything
  authored here is thrown away in weeks. §4.1 makes the *existing* sprite feel
  alive; that work survives. New geometry does not.
- **Enemy engine plumes.** See the warning in §4.1. It is a fog change and a
  balance change. v5 or later, deliberately.
- **Any archetype work.** No Corvette/Frigate/Cruiser, no railgun, no probes,
  no comms, no N-player, no callsigns, no designations. That is all v5.
- **Any balance or constant retune.** The v4.5 knobs are under observation and
  stay untouched.
- **The escalation ladder** (match timer, shroud contraction). Still in reserve.
  Still not built unprompted.
- **A hotkey for the drift marker.** Deliberate. See §2.
- **A radar sweep line** on the 50 km ring. It implies active scanning and
  contradicts the passive-sensor fiction. If the map needs more life, a slow
  opacity breath on the ring is acceptable; a rotating sweep is not.
