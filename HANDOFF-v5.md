# HANDOFF v5: "Aye, Captain" — The Fleet

The multiplayer milestone. Up to 8 captains per room, FFA or teams; permanent ship callsigns with per-observer contact designations; three ship archetypes; the railgun; sensor probes; ship-to-ship comms; dead captains flow into spectator mode. This is the largest milestone since v4 — read the repo, CLAUDE.md, and TODO.md first. Work the build order in Section 12; ship as ONE release (multiplayer plumbing desyncs old clients anyway).

Design policy for this milestone (record in CLAUDE.md): archetypes differ in NUMBERS ONLY for v5 — stat blocks, no special abilities. (Explicitly a v5 policy, not a permanent doctrine; the railgun loadout row is already the first sanctioned asymmetry.)

All tunables in constants.ts. LINKED constants flagged.

---

## 1. Restore continuous target tracking (remove old special-casing)

Design reversal, deliberate: `set_heading { mode: "target" }` returns to CONTINUOUS tracking — the helm re-resolves the target's bearing every tick until the order is replaced. Delete the snapshot-only logic from v4 §4, the translator rule that refuses "keep facing him," and the associated tests. Rationale (commit message): the rule existed to protect manual-nose-pointing as the laser's skill expression; the laser is gone, PDCs are automatic, railgun solutions are computed, and with up to 7 hostiles the captain's attention is the scarce resource — helm autopilot is now legitimate delegation, not skill deletion.

Target references accept: contact labels (alpha/bravo/...), callsigns (once identified), `nearest_contact`, `nearest_missile`, `nearest_rumble` (points down the bearing). Tracking a contact that drops below faint falls back to last-known position; the XO says so.

## 2. Multiplayer core

- Rooms hold up to MAX_PLAYERS = 8 captains + unlimited spectators. Lobby: create/join by code as today; joiners pick an ARCHETYPE (Section 4) and, if the room is set to Teams, a TEAM. Room creator toggles mode: FFA | Teams (2 teams for v5). Match starts when the creator hits Launch (min 2 captains).
- Spawns: evenly spaced on a ring at SPAWN_RING_RADIUS_M = 150000, facing center, zero velocity. Teams spawn on opposite arcs, teammates ~40km apart.
- Win: FFA — last ship alive. Teams — last team with a ship alive. Banner lists placements/callsigns; rematch resets the room with same picks (players may change archetype between matches).
- DEATH → SPECTATOR: a destroyed captain's client flows directly into the existing spectator pipeline, keeping their ship callsign as their spectator name ("SPECTATOR — Kestrel"). Their XO signs off with a final line ("It's been an honor, Captain.") before the transition. No respawns.
- Disconnect: the ship becomes a GHOST — thrust forced to 0, standing orders suspended, PDCs stay on last posture — drifting ballistic until reconnect (resumes control) or DISCONNECT_FORFEIT_S = 120 (ship self-scuttles quietly; XO does not announce it to others — a ghost that stops being a ghost is information nobody earned).
- Sim cost: verify per-tick sensor/hearing math is O(n²) over ≤8 ships + ordnance and profile at 8 — should be trivial; the LLM/TTS layer is per-player and already isolated.

## 3. Callsigns & contact designations

- Every ship gets a permanent CALLSIGN at match start from a themed pool (Kestrel, Vagrant, Mako, Aurora, Bastion, Wraith, Halcyon, Sable...; suffix on exhaustion). Assigned, never typed. Own callsign shown on own HUD; used in all comms and death/kill events.
- PER-OBSERVER designations: below ID tier, each captain's XO labels hostile tracks in acquisition order: "Contact Alpha", "Contact Bravo"... Labels are stable per observer for the match (a lost-and-reacquired contact keeps its letter if the XO can plausibly correlate — same last-known region within CONTACT_CORRELATE_S = 60; otherwise it's a new letter).
- At ID tier the track RESOLVES: XO — "Contact Bravo identified: it's Kestrel." From then on that observer's HUD and XO use the callsign. Identification is a game event (transcript + tone).
- Fog rules: callsigns are only known at/after ID — EXCEPT a broadcast transmission attaches the sender's callsign to its comms spike (voiceprint; Section 7). Never leak callsigns through any other channel; extend the fog-leak tests.
- Commands accept either form: "point at Bravo", "lock Kestrel". Translator resolves per-observer labels against that player's contact table (included in the live-state summary).
- MULTI-ENEMY METRIC SEMANTICS (important spec change): existing standing-order metrics are redefined as NEAREST-HOSTILE semantics — enemy_range/enemy_bearing_off_nose/enemy_contact_tier refer to the nearest tracked hostile; missile_inbound/being_painted are ANY-source. Per-contact conditional metrics are OUT OF SCOPE for v5 (keep the grammar small). XO warnings name bearings when sources are ambiguous ("We're being painted — bearing 190").

## 4. Archetypes

Free lobby pick, mirrors allowed, mapped to the three existing SVG designs (interceptor→Corvette, gunship→Frigate, saucer-era destroyer→Cruiser; re-tint per player/team). Stat table (all in constants, per-archetype blocks):

```
                     CORVETTE      FRIGATE (baseline)   CRUISER
hull                 60            100                  160
accel (m/s²)         85            60                   40
turn (deg/s)         28            20                   14
sig base             20            30                   45      // cruiser cannot hide; intended
sensor base (m)      210000        180000               160000
tubes / missiles     1 / 4         2 / 6                3 / 9
tube reload (s)      20            30                   30
decoys               6             4                    4
PDC ammo (s)         40            60                   90
railguns             0             1                    1
rail slugs           —             20                   30
probes               4             2                    1
max speed            3000 (shared) 3000                 3000    // shared cap; identity
                                                                // lives in accel/turn/sig
```
- Corvette identity: the ghost — dim, fast-cycling, deception-rich, best eyes, no rail (fiction: a railgun is a spinal mount; the corvette's keel can't take one). Frigate: the baseline everyone already knows — CHANGE NOTHING about current-ship numbers beyond the table. Cruiser: the thunderstorm — audible at map scale perpetually, deep magazines, wins by making you come to it.
- HUD shows own archetype; enemy archetype is ID-tier information only.
- Hearing/detection math needs no per-class code — sig base and sensor base flow through existing formulas. That's the point.
- 

## 4.5
Silhouette test (the acceptance criterion): each archetype must be distinguishable from the other two as a solid black shape at 22px (the min-clamp). If you can't tell them apart as silhouettes at hull size, the design failed. Detail is free; shape is the deliverable.

Shape = archetype. Tint = player. Don't ask shape to carry both; FFA needs both axes independent.
Mass reads as bulk. Corvette: small, narrow, high aspect ratio, sharp. Frigate: mid, visible dorsal spine, the railgun as a long forward axis. Cruiser: broad, slab-sided, blocky, visibly heavy.
The railgun must be an unmistakable forward-facing barrel on the Frigate and Cruiser. It is the bearing-fire affordance, not ornament. A Corvette has no barrel, and its absence should be the fastest way to identify one.
Every design declares a stern offset (the v4.7 plume convention). Cruiser plume: wide, slow, heavy. Corvette: narrow and hot. Free archetype flavor from a system v4.7 already built.

Existing candidates likely map straight across: interceptor → Corvette, gunship → Frigate, saucer → Cruiser. Start there before authoring from scratch.

## 5. The railgun (Frigate & Cruiser)

New verb: `fire_railgun { "mode": "solution" | "bearing", "target"?: contact-ref, "bearing_degrees"?: number }`

```
RAIL_SLUG_SPEED_MPS   = 6000    // LINKED: 2× ship max, 2.5× missile max — must far
                                // exceed ship speed or the weapon has no envelope
RAIL_HIT_RADIUS_M     = 100     // swept-segment collision, MANDATORY
RAIL_DAMAGE           = 25
RAIL_COOLDOWN_S       = 6
RAIL_SIG_SPIKE        = +80 for 3s    // rail fire is HEARD; "if you hear rail fire, burn"
```
- SOLUTION mode: requires a TRACK-or-better contact. The XO computes constant-velocity lead against the track and fires immediately (no lock timer — the slug can't be guided, so there's nothing to hold). Deadly against ballistic targets; ANY thrust during flight time breaks the assumption and the slug misses. This is the designed anti-drifter: every posture now has a predator (missiles punish burners, rails punish coasters, PDCs punish missiles).
- BEARING mode: manual skill shot down a bearing (or the nose if omitted). No requirements.
- Slugs are physical: they hit rocks (stopped), and CAN hit missiles/decoys/probes en route (rare, glorious). Slugs do NOT check IFF — the only friendly-fire vector in the game (Section 8). PDCs do NOT engage slugs (too fast, too small) — nothing stops a slug except not being where it lands.
- Inherits shooter velocity at launch (consistent physics).
- Dodge math for the tuning comment: at 60 m/s² a reacting target displaces ~190m over a 20km shot (flight 3.3s) — dodgeable when alert; a drifter displaces 0. Tune the (speed, hit-radius) pair together.
- XO: "Solution ready — firing." / "No track for a solution, Captain — I can fire on a bearing." / "Rail's recharging." Empty: "Slugs are out." Enemy side (via sig spike + hearing): "Rail fire, bearing 120."

## 6. Probes

New verb: `launch_probe { "bearing_degrees"?: number }` (nose if omitted)

```
PROBE_BURN_S          = 20      // accel 150 m/s² along launch bearing, then drifts
PROBE_LIFETIME_S      = 180
PROBE_SENSOR_BASE_M   = 60000   // reduced eyes; FULL hearing (same multiplier)
PROBE_SIGNATURE       = 25      // findable if hunted; PDCs engage it, slugs hit it
```
- A probe is implementation-wise a decoy with sensors: same launch/physics plumbing, plus it RELAYS its sensor picture (contacts at its tiers, and its rumble bearings) to the owning captain live, merged into their map with a "via probe" provenance marker.
- The payoff (design intent, already provisioned in v4.5's data model): a rumble heard by your ship AND your probe = two bearings = a human-triangulated fix. The XO still does NOT auto-triangulate — render both bearing lines on request ("show me the bearings") and let captains be clever.
- Probe contacts follow all fog rules from the probe's position (it can be LOS-blocked, it hears through terrain, etc.). Destroying a probe is announced to its owner ("We just lost probe two").
- Counts per archetype (Section 4). No reloads.

## 7. Comms

New verb: `transmit { "channel": "broadcast" | "tightbeam", "recipient"?: contact-ref, "message": string }`

- BROADCAST: every captain receives it. Transmitting produces a COMMS SPIKE on the hearing channel — all captains get a bearing chevron for COMMS_SPIKE_S = 5 — and the sender's CALLSIGN attaches (voiceprint). Talking is a tactical act.
- TIGHTBEAM: private. Requires a current TRACK on the recipient (you must know where to point the dish) — EXCEPT teammates: always tightbeamable, no track needed (fleet encryption). No spike, no reveal.
- Delivery is VERBATIM: the receiving ship's XO reads the message aloud — "Transmission from Kestrel: 'nice decoy, very convincing.'" Sender's XO confirms ("Transmission away."). Message text is extracted verbatim by the translator (add explicit examples; the message is everything after the transmit intent — do not paraphrase, do not sanitize beyond trimming).
- Anti-spam: COMMS_COOLDOWN_S = 10 per channel per ship. MESSAGE_MAX_CHARS = 140 (translator truncates gracefully; TTS cost control — relayed messages are dynamic TTS, the only unbounded speech in the game).
- Speech queue priority: incoming transmissions rank above acknowledgements, below combat warnings.
- Received transmissions appear in the transcript attributed to the sender's callsign.

## 8. Teams

- Teammates: permanent mutual ID tier (transponders) — always on each other's maps with full state. NOTHING ELSE IS SHARED: no fused contact picture, no shared rumbles, no shared probe feeds. Sharing intel is done by TALKING (tightbeam) — this is deliberate and load-bearing (the manual-triangulation-over-comms minigame is the team fantasy; do not "fix" it with a datalink). If playtests demand it, the sanctioned concession is a `share contact` verb (transmits one contact's current data as a deliberate act) — backlog it, don't build it.
- IFF: guided weapons cannot engage friendlies — locks can't target teammates, seekers never acquire friendly ships/decoys/probes, prox fuses don't trigger on friendlies, PDCs ignore friendly ordnance. RAIL SLUGS AND COLLISIONS CHECK NOTHING — physics doesn't read transponders. (The first teammate slugging will be legend; do not soften it.)
- Team tinting: team color overrides per-player tint in Teams mode. FFA: 8 distinct player tints (extend the existing palette).
- Team win per Section 2. Dead teammates spectate.

## 9. Schema & translator consolidation

- New verbs: fire_railgun, launch_probe, transmit. Changed: set_heading target refs (Section 1), lock designation — add `set_lock_target { "contact": contact-ref }`; the lock system becomes per-designated-target (default: nearest tracked hostile in the lock cone if never designated). fire_missile unchanged otherwise (locked mode uses the designated lock).
- Contact references: one resolver for {alpha/bravo/..., callsigns, nearest_contact, nearest_missile, nearest_rumble} used by set_heading / set_lock_target / fire_railgun / transmit. The per-observer contact table (labels, tiers, callsigns-if-known, bearings/ranges) joins the translator's live-state summary.
- Standing orders: nearest-hostile semantics per Section 3; no new metrics beyond `rumble_present` (existing). Example translations to add: "lock Bravo", "keep us pointed at Kestrel", "put a slug on that solution", "probe out bearing 090", "broadcast: anyone want to team up on the cruiser?", "tightbeam Mako: he's behind the moonlet".
- Schema example_translations refreshed accordingly; validator updated; datalog unchanged.

## 10. HUD & client

- Contact panel: rows per contact — label or callsign, tier badge, bearing/range (at track+), "via probe" marker. Team/FFA tints. Rail ammo + cooldown (armed classes), probe count, own callsign + archetype badge.
- Lobby: archetype cards (name, silhouette, 3-4 stat bars — speed/hull/firepower/stealth), team selector when in Teams mode.
- Transcript: transmissions styled distinctly (sender callsign). Kill/ID events in transcript for the involved parties only (global kill feed is backlogged with spectator polish).
- Rumble chevrons unchanged; comms spikes reuse them with a distinct style + callsign tag.

## 11. Docs (same release, per invariants)

- /how-to-play: new Doctrine VI "The Fleet" — callsigns & designations (what Alpha/Bravo mean, what ID resolves), archetype briefs (one paragraph each, doctrine-first: "the ghost / the baseline / the thunderstorm"), the railgun (both modes; "if you hear rail fire, burn"), probes ("your remote ears — two bearings make a fix"), comms (broadcast is a flare, tightbeam is a whisper), teams (transponders only — talk to your fleet). Phrasebook: add rows for rail, probe, comms, lock designation. Doctrine I: "any thrust beats a solution" joins the survival notes.
- README current per invariant.

## 12. Build order (single release; verify each stage in practice/local multiplayer before the next)

1. Section 1 (tracking restoration — small, do first, it touches translator+tests).
2. Multiplayer core: N-player rooms, lobby modes, spawns, win conditions, death→spectator inflow, ghost-ship disconnects. Test with 3 local browsers + drone.
3. Callsigns/designations + snapshot/contact-table rework + fog-leak tests. (Biggest refactor of the milestone — everything after depends on it.)
4. Archetypes (constants blocks + lobby + tints + HUD badges).
5. Railgun. 6. Probes. 7. Comms. 8. Teams/IFF.
9. Schema/translator consolidation pass (Section 9 — much lands alongside 3-8; this stage is the audit).
10. Docs, full test pass, stock-line cache regen (many new XO lines), deploy.

## 13. Tests (beyond per-feature)

8-ship sim profile; fog-leak suite extended (callsigns pre-ID, probe provenance, rumble fields); designation stability + correlate window; ID resolution event; nearest-hostile metric semantics; ghost-ship behavior + forfeit; death→spectator handoff retains callsign; IFF matrix (every weapon × friendly/hostile × ship/decoy/probe/missile); slug friendly-fire positive test; solution miss-under-thrust and hit-while-ballistic; probe relay tiers + LOS from probe position; tightbeam track requirement + teammate exemption; broadcast spike + callsign attach; comms cooldown + truncation; translator contact-ref resolution incl. ambiguity ("him" with 3 tracks → nearest, stated in acknowledgement).

## 14. Non-goals (do not build)

Spectator polish suite — follow-cam cycling, kill feed, caster overlay (BACKLOGGED, explicitly wanted for NeWk-adjacent polish later). Per-contact standing-order metrics. Team sensor fusion / `share contact` verb (backlogged concession). Archetype special abilities. More than 2 teams. Respawns. Depots, belts, shroud contraction (unchanged deferrals). Numeric rumble-bearing metrics. Auto-triangulation by the XO.
