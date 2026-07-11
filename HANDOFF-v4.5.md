# HANDOFF v4.5 — "Tempo": missile retune, the ping, and housekeeping

Post-playtest balance patch. Core findings: (a) weapons were tuned for the 80km-lock game, but real engagements (post-sensor-rebase) start at 20–50km — inside the missile's no-counterplay zone; (b) the strategic search layer is broken — dark ships generate no information at any range, so cautious players drift forever without contact. This patch matches missile kinematics to actual engagement ranges and ships a two-channel sensor model: continuous HEARING (bearing-only, long range) + the active PING. Small scope on purpose; map-structure ideas (rock belts, resupply depots) are DELIBERATELY deferred pending observation of this patch's effects.

Constants discipline as always. LINKED constants flagged.

---

## 0. Docs invariant extension

Add to CLAUDE.md invariants: README.md's gameplay description is covered by the same rule as /how-to-play — any behavior change updates BOTH in the same commit. (The README on main currently describes the v3 game — laser, 10km locks, 30km zone, hard wall. Bring it current with this patch regardless of what branch state caused the drift.)

TODO.md updates: mark "ramscoop regen scales with speed" as REJECTED (design call, do not resurface). Keep "rock belts / clustered terrain" and "resupply depots" as deferred candidates with a note: revisit after v4.5 playtests.

## 1. Missile retune (the package — ship together)

```
MISSILE_MAX_SPEED_MPS   = 2400   (was 6000)  // LINKED: 4× ship max, not 10×
MISSILE_ACCEL_MPS2      = 150    (was 400)   // top speed in ~16s
MISSILE_PROPELLANT_S    = 25     (unchanged) // delta-v ~3750 m/s
MISSILE_ARMING_DIST_M   = 3000   (NEW)       // prox fuse inert until the missile
                                             // has traveled 3km from launch point
MISSILE_ACQ_CONE_DEG    = 30     (was 60)    // AUTONOMOUS seeker half-angle;
                                             // uplinked guidance unaffected
```
- Rationale (for commit message / CLAUDE.md context): from a 40km launch, flight time goes ~8s → ~20–25s. PDC bubble transit roughly triples (single-missile kill probability ~55–60%). Cover within ~10km becomes reachable. Burning directly away at flank cuts closure ~25%, buying PDC time and draining the bird's tank — "outrun to survive the burn" is now a real play at range.
- Arming distance: launches inside 3km produce a dud pass (fuse never arms for that missile). XO should warn if the captain fires with the locked target inside arming range: "He's inside arming distance, Captain." Blind-fire launches get no warning (no known target).
- Seeker cone tightening applies to AUTONOMOUS acquisition/reacquisition only (blind-fired birds and orphaned birds). Blind-bearing fire remains viable but now requires a good bearing, not a gesture. Uplinked intercept steering is unchanged.
- Verify the counterplay set end-to-end in practice mode after tuning: outrun-at-range, LOS break, decoy (with Section 2), PDC attrition, late dodge.

## 2. Decoy endurance

```
DECOY_LIFETIME_S = 60   (was 20)
```
Matches the longer missile flight times; also strengthens decoys as long-range fake contacts (they drift convincingly for a full minute). No signature change.

## 3. Tube reload

```
TUBE_RELOAD_S = 30   (was 20)
```
Intent: firing both tubes should be FELT — a full salvo means ~30 seconds without a next shot. Staggered single-tube fire becomes real doctrine. Verify the XO's reload announcements and tube-status HUD read clearly through the longer cycle; add a "tubes ready" stock line if not already present.

## 4. Edge gravity retune

```
EDGE_PULL_MPS2_PER_50KM = 15    (was 5)    // LINKED to MAX_SPEED: tuned so a
EDGE_PULL_CAP_MPS2      = 150   (was 50)   // full-speed (3 km/s) exit is turned
                                           // around in ~20s, not minutes
```
Add the linkage comment: these were originally tuned for 600 m/s ships and never revisited when speeds quintupled. If MAX_SPEED changes again, retune these.

## 5. The hearing channel (continuous, bearing-only, long-range)

Every ship now emits into TWO concentric information channels, both driven by the same signature value, both continuous — NO thresholds anywhere in this system (a threshold would immediately become a throttle policy; this is a design law, record it in CLAUDE.md):

```
HEARING_RANGE_MULT = 2.5   // hearing_range = detection_range × 2.5
                           // dark drift (sig 30):  heard to ~135 km
                           // 50% cruise (sig 80):  heard to ~360 km (most of map)
                           // flank (sig 130):      heard map-wide
```

- WITHIN hearing range but BEYOND detection range, a ship produces a RUMBLE for other captains: **bearing only.** No range, no vector, no tier, no position. It updates live while conditions hold.
- Rocks and dust do NOT block hearing (different physical channel — the shroud carries drive rumble the way water carries sound). Only distance vs signature matters. This keeps hearing simple, makes it a true backstop under terrain play, and preserves LOS as the thing that distinguishes SEEING.
- Client: a rumble renders as a soft chevron at the edge of the screen (or map border when zoomed out) pointing along the bearing, with a subtle low audio rumble whose volume scales with the emitter's signature. Multiple rumbles = multiple chevrons.
- XO announces NEW rumbles and meaningful bearing shifts (>15°), rate-limited: "Drive rumble, bearing 310." / "That rumble's drifted to 290." / on fade: "Lost the rumble." Stock-ish lines with dynamic bearings.
- Standing orders: add `rumble_present` (bool) ONLY — do not expose numeric bearing comparisons in v4.5 (keeps the condition grammar small; revisit on demand).
- Weapon signature spikes (launch +150, PDC +50) ride the same math — a battle is AUDIBLE at enormous range. Intended, and load-bearing for the future (multiplayer: fights become gravity wells that pull spectator-ships toward them).
- The XO does NOT triangulate rumbles automatically. Cross-referencing bearings over time is deliberately left as human skill. (v5 note: probes will act as remote ears whose bearings enable triangulation — keep the data model open to multiple listeners hearing the same emitter.)
- Snapshot/fog note: rumbles are a new contact class BELOW faint, carrying ONLY {bearing}. The fog invariant applies strictly: never include range/position/vector in a rumble.

Design intent (record in CLAUDE.md): this completes the information ladder — HEARING BEARING → aimed PING → passive TIERS → LOCK. Stealth becomes a speed tax rather than a binary: you can be silent, or you can be going somewhere — not both. The mutual-drift stalemate (both ships dark forever) is a known residual case, deliberately NOT patched in v4.5; if playtests show it, the pre-agreed escalation ladder is: (1) match timer with declared draw, (2) slow shroud contraction. Record the ladder in TODO.md. Also record there: "periodic free intel sweeps" REJECTED — devalues probes (free intel eats the niche player-launched sensors should own) and flattens archetype signature differences at the strategic layer. Reasoning preserved so it is not re-litigated.

## 6. Active sensor ping (the ladder's second rung)

New verb: `sensor_ping {}`.

```
PING_RANGE_M    = 150000   // everything within, LOS permitting (dust/rocks block)
PING_TRACK_S    = 5        // detected objects become TRACK tier for 5s,
                           // then decay to whatever passive sensors sustain
PING_REVEAL_S   = 10       // the pinger is revealed at ID tier to ALL ships,
                           // map-wide, no LOS requirement — you screamed
PING_COOLDOWN_S = 30
```
- Affects all object classes: dark ships, decoys, coasting missiles — anything with LOS inside range snaps to track for the window.
- Lock interaction (IMPORTANT, test it): locks require track held continuously for LOCK_TIME_S. A ping's 5s grant cannot complete a 5s lock on a target passive sensors can't sustain — grant expires, tier drops, lock breaks after grace. A ping FINDS ships; it does not shoot them. Do not extend PING_TRACK_S without design signoff.
- XO lines (cache): "Ping away." / cooldown: "Transducers recharging, Captain." Enemy XO (dynamic bearing): "Active ping — he's lit himself up. Bearing 245."
- Schema: add the verb + example translations ("give me a ping", "light them up", "active sweep"). No new standing-order metrics. Translator note: "one ping only" should translate cleanly (it will be said in a Connery accent; the XO may be permitted a dry acknowledgement).
- HUD: small ping-cooldown indicator near the sensor/contact panel.

## 7. Docs (same release, per invariants)

- /how-to-play: Doctrine I gains a "Hearing, Seeing, Shooting" passage covering the full ladder — you HEAR ships (bearing only, huge range, louder = farther), you SEE ships (tiers, closer), you LOCK ships (closest). Plus a "Passive and Active" note: the ping trades your position for a 5-second picture of everything nearby. Include the tactical proverb: "You can be silent, or you can be going somewhere — not both." Phrasebook: add "Give me a ping" to the Sensors row. Doctrine III: note the arming distance ("inside three kilometers, your bird never arms — standoff is part of the weapon") and the 30s reload. Doctrine IV: refresh the outrun guidance — burning away at range is now genuinely survivable — and note that running loud means being heard map-wide.
- FIG idea (optional, if quick): extend FIG-1 with a second, larger dashed circle per ship labeled "heard" outside the "seen" circle.
- README: bring fully current per Section 0.

## 8. Tests

Missile: new kinematics numbers; arming-distance dud behavior (locked launch inside 3km never fuses); autonomous cone 30° acquisition/reacquisition; uplinked steering unaffected. Decoy lifetime. Reload cycle at 30s incl. announcements. Edge pull: full-speed exit returns within ~25s in sim. Hearing: rumble appears at hearing range and carries bearing ONLY (fog-leak test: assert no position/range/vector fields); continuous scaling with signature (no threshold anywhere); terrain does NOT block hearing; weapon spikes audible; rumble→faint handoff at detection range is seamless (no double contact); XO announcement rate-limiting. Ping: grant tier + range + LOS/dust blocking; decay after 5s; map-wide ID reveal for 10s; cooldown; the lock-cannot-complete-from-ping-alone case explicitly; cooldown rejection line.

## 9. Non-goals (do not build)

Ramscoop/speed-scaled regen (REJECTED). Periodic free intel sweeps (REJECTED — see Section 5). Rumble triangulation by the XO (deliberately human skill; probes are the v5 answer). Numeric rumble-bearing standing-order metrics. Match timer / shroud contraction (escalation ladder, held in reserve). Rock belts / terrain redistribution (deferred). Resupply depots (deferred). Any base regen rate change. Everything in the v5 fleet scope.
