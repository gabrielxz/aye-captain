# HANDOFF v4: "Aye, Captain" — The Big Dark

You are performing a major overhaul of an existing, working game. Read the repo (especially CLAUDE.md invariants, constants.ts, sim.ts) before changing anything. This milestone transforms the arena from a small circle into a vast region where DETECTION IS THE GAME: who sees whom first, at what quality, decides engagements. Model inspiration: The Expanse. Drive plumes are visible across enormous distances; going dark is the only stealth; torpedoes burn hard then coast ballistic; PDCs handle terminal defense.

Scope of v4: scale + camera, sub-tick physics, the sensor/signature/LOS/contact-tier system, terrain, gravity edges, burn-and-coast missiles, PDCs REPLACING the laser, vector overlay, full-stop maneuver. Still 1v1 + practice drone. Multiplayer, archetypes, kinetics, probes, and comms are v5 — do not build them, but do not paint them into a corner (noted inline where relevant).

All numbers in constants.ts as always. LINKED constants are flagged — comment the relationships.

---

## 0. FOUNDATION FIRST: sub-tick physics (do this before any scale change)

At the new speeds (ships 3 km/s, missiles 6 km/s), objects move kilometers between 1Hz ticks. Naive stepping will tunnel missiles through proximity fuses and ships through rocks.

- Decouple physics from the command tick: PHYSICS_SUBSTEPS = 10 (physics at 10Hz; commands, standing orders, and LLM interaction remain at 1Hz).
- MANDATORY: swept-segment collision for all fast objects (missiles vs prox fuse, anything vs terrain). Test movement as a segment from previous to current substep position against target circles — never point-in-radius checks alone. Even at 10Hz, a 6 km/s missile moves 600m per substep vs a 200m fuse: point checks WILL tunnel. Write an explicit tunneling regression test (max-speed missile head-on vs max-speed ship must always fuse).
- Raise SNAPSHOT_RATE_HZ = 4 (from 1) so client interpolation stays smooth at the new speeds. Include velocities in snapshots. Command processing stays 1Hz.

---

## 1. Scale & camera

### World scale
```
MAX_SPEED_MPS            = 3000      // LINKED to missile speed & region size
ACCEL_FULL_THRUST_MPS2   = 60        // ~6g hard burn; top speed in ~50s
TURN_RATE_DEG_PER_SEC    = 20        // unchanged
REGION_RADIUS_M          = 250000    // 250 km; crossing time ~2.8 min at flank
SPAWN_DIST_FROM_CENTER_M = 150000    // opposite sides, 300 km apart
```
Design note: full tank (100 units at 1.0/s burn) = 100s of hard burn = 6000 m/s of delta-v — enough to reach flank speed and kill it once. Propellant is now explicitly a delta-v budget; the XO should think of it that way ("we have the fuel for one more hard burn, Captain").

### Camera & input (client)
- Mouse wheel zoom (smooth, exponential steps) from full-region view down to ~5km across. Drag-pan and WASD-pan. F: snap to own ship and toggle follow mode. M: toggle a small overview inset (whole region, own ship + known contacts).
- Range rings around own ship at 10 / 50 / 100 km, labeled, fading with zoom appropriateness.
- Ships/objects clamp to a minimum on-screen icon size when zoomed out (existing rule, re-verify at new scale). Missiles/decoys likewise.
- Multi-layer parallax starfield so motion reads even in empty space. Subtle; navigational, not decorative noise.
- Focus management (typing must coexist with WASD): the map owns keys by default; Enter or backtick focuses the command box; Esc returns focus to the map; push-to-talk (Space hold) works globally, including while the map has focus. Never remove typed input — it is the debug harness and the mic-failure fallback.

---

## 2. Sensors, signature, and contact tiers (replaces binary visibility)

### Signature (rebased)
```
SIG_BASE                 = 10        // drifting dark ship
// ship signature = SIG_BASE + effective_thrust_percent  (10..110)
SIG_SPIKE_LAUNCH         = +150 for 5s   // missile launch (replaces flat launch-flash reveal)
SIG_SPIKE_PDC            = +50 for 3s    // PDC firing
DECOY_SIGNATURE          = 150
MISSILE_SIG_BURNING      = 80
MISSILE_SIG_COASTING     = 8         // a ballistic torpedo is nearly invisible. Intended. Terrifying.
```

### Detection
```
SENSOR_BASE_M            = 165000
// detection_range = SENSOR_BASE_M × (signature / 100), LOS permitting
// → full burn (110) seen at ~181 km; 50% cruise at ~99 km; dark drift (10) at ~16.5 km
```
Detection requires line of sight (Section 3). Outside the region boundary a ship is treated as signature-max (see Section 4).

### Contact tiers (the data-texture layer)
A contact's tier depends on range as a fraction of the computed detection range:
```
TIER_FAINT  ≤ 100%  — approximate position only (noise FAINT_POS_NOISE_M = 2000),
                       NO vector, updates every FAINT_UPDATE_INTERVAL_S = 5.
TIER_TRACK  ≤ 60%   — true position + velocity vector, continuous updates.
TIER_ID     ≤ 30%   — everything above + ship status detail (archetype field reserved for v5).
```
- Snapshots replace the single enemyVisible flag with a contacts[] array: {tier, pos, vel?, ...}. Fog-of-war invariant unchanged: never send data above the earned tier. Keep last-known ghosts.
- MISSILE LOCK REQUIRES TIER_TRACK OR BETTER. (This creates the approach game: close in, or provoke a burn, before you can shoot.) Lock range: LOCK_RANGE_M = 80000, cone 30°, LOCK_TIME_S = 5, LOCK_GRACE_S = 2 — all else unchanged.
- Ordnance (missiles, decoys) uses the same detection math via its own signatures — no more flat ordnance-detection radius. A burning inbound torpedo is visible far out; once it goes ballistic it may vanish from sensors. The XO must announce seeker state changes it can observe: "Torpedo has gone ballistic — I've lost it."
- XO contact language: "Faint contact, bearing 045, range approximately one-eight-zero." / "Contact firming up — I have a track." / "Track lost — last known bearing 210." Tier transitions are server transcript events (stock-ish lines with dynamic bearing/range — keep them short).
- Standing-order metrics rework: replace enemy_on_sensors with enemy_contact_tier (0 none / 1 faint / 2 track / 3 id); enemy_range and enemy_bearing_off_nose valid only at tier ≥ 2 (tier-1 comparisons on them are false per the unknowable-metric rule). Add: in_dust (bool), pdc_ammo_seconds, collision_warning (bool). Keep missile_inbound (true only when the missile is currently detected), being_painted, have_lock, propellant_percent, tubes_ready.

---

## 3. Terrain

Generated from a match SEED (rematch offers "same field" or "new field").

### Rocks (asteroids / one centerpiece)
- ROCK_COUNT = 30 circles, radius 1000–8000m, scattered with a minimum spacing so fields are navigable; plus ONE centerpiece body (radius ~15000m — a cracked moonlet or derelict, purely cosmetic distinction) somewhere in the middle third. No gravity from terrain.
- Rocks BLOCK LINE OF SIGHT: sensors, lock acquisition/hold, missile seekers, and PDC engagement all require an unobstructed ray (circle-segment intersection tests). Breaking LOS behind a rock drops locks (after grace) and blinds seekers — hiding behind terrain is core missile counterplay.
- Rocks are SOLID. Missiles/decoys impacting a rock are destroyed (missiles detonate harmlessly). Ships collide:
```
COLLISION_HARMLESS_BELOW_MPS = 50    // gentle bump
// damage = 100 × ((v_impact − 50) / 1450)²   → lethal at ~1500 m/s
COLLISION_RESTITUTION        = 0.5   // bounce: reflect + dampen normal component
```
- COLLISION WARNING: each tick, project own velocity COLLISION_WARNING_S = 20 seconds ahead; if the swept path intersects a rock, HUD warning + XO: "Rock on our vector — impact in fifteen seconds." (Stock lines at coarse countdown steps.)

### Dust (sensor terrain)
- DUST_COUNT = 3 elliptical regions, 30–60 km across. No physical presence — fly through freely.
- Dust blocks sensor LOS: any detection ray crossing a dust region fails (binary, both directions — inside a cloud you are blind and unseen). Locks cannot be held through or inside dust. XO on entry: "We're in the cloud — sensors are blind, but so are theirs."
- Render dust as soft nebula patches; rocks with simple shaded SVG/procedural sprites, varied rotation/scale.

---

## 4. Region edge: gravity, not walls

DELETE the hard limit entirely (clamp code, constant, faint ring). Replace with:
- Outside REGION_RADIUS: no propellant regen (already true), ship treated as signature-max (fully detectable at any range, tier ID), AND a restoring acceleration toward region center:
```
EDGE_PULL_MPS2_PER_50KM = 5     // grows linearly with distance beyond the edge
EDGE_PULL_CAP_MPS2      = 50
```
- Fiction: the shroud's mass, or a current. XO announces crossing out ("We've left the shroud — we're lit up and the current's against us") and back in.
- No ship can be stranded: the pull always eventually returns a derelict. Zone ring remains rendered.

---

## 5. Missiles: burn-and-coast torpedoes

Replaces the constant-speed flight model. Keep velocity-steering guidance (NEWTONIAN_MISSILES stays false) and all seeker logic (cone, strongest-signature, re-evaluation, decoy susceptibility) — what changes is propulsion:

```
MISSILE_MAX_SPEED_MPS   = 6000     // LINKED: 2× ship max
MISSILE_ACCEL_MPS2      = 400      // ~40g
MISSILE_PROPELLANT_S    = 25       // engine-on seconds
MISSILE_TURN_RATE_DPS   = 45       // ONLY while engine is on
MISSILE_LIFETIME_S      = 120      // absolute self-destruct
PROX_FUSE_M             = 200
MISSILE_DAMAGE          = 35
```
- Launch: inherits ship velocity, as today. Engine is ON whenever (below max speed) OR (turning to track); engine-on drains propellant at 1/s. Propellant exhausted → BALLISTIC: no acceleration, no turning, flies its line at current velocity until lifetime, impact, or PDC kill. Ballistic missiles still detonate on prox — lethal on their line, blind to maneuver.
- Signature switches with engine state (Section 2). Seeker keeps evaluating targets while ballistic (for XO reporting) but cannot steer.
- Counterplay set (verify each works in playtest): outrun/outlast the burn at long range; break LOS behind rocks; decoys; PDC attrition; late hard dodge to waste its turning propellant. Missiles should feel deadly inside their burn envelope and beatable at its edges.
- The old flat launch-flash reveal is superseded by SIG_SPIKE_LAUNCH. Keep the distinct "Launch flash detected, bearing X" XO notice, driven by the spike-detection event.

---

## 6. PDCs replace the laser

REMOVE fire_laser from schema, translator validator, sim, tests, HUD, and SFX. Replace with an automated point-defense system commanded by POSTURE:

- New verb: `set_pdc { "posture": "free" | "hold" }`. Default at spawn: free.
- While FREE, PDCs automatically engage: (a) inbound enemy missiles within PDC_RANGE_M = 8000 with LOS — each engaged missile suffers PDC_KILL_PROB_PER_S = 0.25 (evaluate per substep at the substep-scaled probability); (b) enemy SHIPS within PDC_SHIP_RANGE_M = 3000 with LOS — continuous PDC_SHIP_DPS = 5. Mutual PDC range is a mutual mauling; closing to knife range is a deterrent by design.
- Ammo: PDC_AMMO_S = 60 seconds of cumulative fire, no regeneration, HUD gauge, XO warnings at 50/25/10%. Firing applies SIG_SPIKE_PDC. Saturation salvos are supposed to leak — do not tune the kill probability so high that two simultaneous missiles reliably die.
- PDCs never target decoys or terrain. "Hold" silences them entirely (ammo conservation / staying dark).
- Translator: "fire the laser" and similar get a graceful in-character response ("We traded the laser for PDC mounts, Captain") — add a translator rule, don't let it error.
- SFX: the PDC burst (rapid staccato brrrt) is the new signature sound — synthesized, distinct for own vs enemy fire. Add rock-impact crunch and collision-warning klaxon while in the sound file.
- Note for v5 (do not build): the aimed-skill-shot niche the laser vacated will be filled by railgun kinetics. Keep weapon code modular enough that a third weapon type slots in.

---

## 7. New maneuvers & overlays

- New verb: `maneuver { "type": "full_stop" }` — autopilot macro: turn to retrograde, burn at an appropriate throttle, cut thrust when speed < 5 m/s. Cancellable by any subsequent thrust/heading order ("belay that" included). XO announces start ("Flipping to kill our velocity") and completion ("Answering all stop"). Structure the maneuver executor so future macros (v5+) are additive. This does not violate the captain-flies-the-ship doctrine: it has a defined end state, unlike continuous tracking (which remains removed).
- New verb: `show_vector {}` — client draws own velocity vector (line = 10 seconds of travel at current velocity, speed label) for 5s. Also bind V as a client-side toggle without the XO round-trip. If propellant is nonzero, additionally mark the projected stop-point assuming an immediate full-stop maneuver (cheap to compute, enormously educational for new captains).

---

## 8. Schema, translator, HUD, drone

- Schema: remove fire_laser; add set_pdc, maneuver, show_vector; metric changes per Section 2; new query topics: `contacts` (tier list w/ bearings+ranges), `pdc`, `terrain` (nearby rocks/dust summary). Refresh example_translations: contact-tier standing orders ("if you get a track on him, tell me"), PDC posture, full stop, dust/rock play.
- Translator live-state summary: add contact tiers, PDC posture/ammo, in_dust, collision warning state.
- HUD: PDC posture + ammo gauge; contact panel listing contacts with tier badges (single enemy shows as "Contact" — the Alpha/Bravo designation system is v5); collision warning indicator; propellant/hull/tubes as today.
- Practice drone: rescale to new physics (cruise ~800 m/s, patrol among rocks, existing lock-and-fire behavior retained, exempt from propellant as established). Give it a simple dust/rock-aware patrol so solo players experience LOS play.
- datalog.ts: unchanged, keep logging.

---

## 9. Build order (single release at the end; constants desync old clients mid-match)

1. Read repo; run existing tests; branch `v4-big-dark`.
2. Section 0: substeps + swept collision + snapshot rate + client interpolation update. Tunneling regression test. NOTHING ELSE until this is green.
3. Scale constants + camera/input/focus/starfield/rings/inset. Fly around an empty huge region; verify feel and performance.
4. Terrain: seeded generation, rendering, solid collisions + damage + warnings, LOS raycast infrastructure (used by everything after).
5. Sensor/signature/tier system + snapshot contact model + standing-order metric rework + XO contact language.
6. Edge gravity (delete hard wall).
7. Missile burn-and-coast + ordnance signatures + lock-requires-track.
8. PDC system + laser removal + schema/translator/HUD/SFX updates.
9. Maneuvers + vector overlay.
10. Drone rescale; stock-line additions (cache regen); README/CLAUDE.md/TODO updates; full test pass; deploy as one release.

## 10. Non-goals for v4 (do not build)

More than 2 players per room. Ship archetypes. Kinetic weapons/railgun. Probes. Player-to-player comms. Spectator client. Contact designations (Alpha/Bravo). Terrain gravity. Subsystem damage. Manual PDC aiming.
