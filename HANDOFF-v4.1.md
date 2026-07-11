# HANDOFF v4.1 — Addendum to "The Big Dark"

Apply alongside HANDOFF-v4.md (same release; do not ship v4 without this). This addendum resolves ambiguities discovered in design review: PDC engagement rules, blind-fire missiles, what a lock actually buys you, seeker sensor math, and bearing UI. Where this conflicts with HANDOFF-v4.md, THIS FILE WINS.

---

## 1. PDC engagement rules (clarifications)

- **Default posture: FREE at spawn** (confirmed).
- **Fully automatic while free**: the mount engages any valid target entering the envelope and ceases when it is destroyed, leaves range, or loses LOS. No per-target commands, no XO round trip. Feedback is the sound starting/stopping, the ammo gauge, and the signature spike.
- **PDCs are SENSOR-SLAVED**: they can only engage ordnance the ship currently DETECTS (per the Section-2 sensor math — ordnance signatures, LOS, dust). The mount is not magic; it shares the ship's sensor picture. A ballistic torpedo arriving from sensor shadow (dust, rock occlusion) may not be engaged at all, or only in the final seconds after detection. Intended.
- **Ballistic missiles ARE valid PDC targets** whenever detected. Engine state is irrelevant to the mount; detection is everything.
- **Close-detection bark**: when inbound ordnance is FIRST detected already inside PDC range, urgent XO line ("Ballistic inbound, close!") + immediate engagement (if free). Stock line, high priority in the speech queue (warnings beat acknowledgements, per existing rule).
- PDCs never engage decoys or terrain (unchanged).

## 2. Blind fire

`fire_missile` gains a guidance parameter:

```
fire_missile { "tubes": [...], "guidance": "locked" (default) | "bearing", "bearing_degrees": number (optional) }
```

- **locked**: exactly the v3/v4 rule — requires an active lock (which requires a TRACK-tier contact). Rejected without lock ("No lock, Captain").
- **bearing**: NO lock required. Missile launches down the given absolute bearing (ship turns are NOT implied — the missile steers itself onto the bearing after launch; if bearing omitted, straight out the nose). Autonomous from birth (Section 3). Same tubes, same magazine, same reload — the economy is the spam control.
- Translator rule: emit bearing-guidance ONLY when the captain explicitly asks for unlocked/blind/bearing fire ("put a torpedo down bearing 220", "fire blind into that cloud", "torpedo out the nose, no lock"). Ambiguous "fire missile" with no lock still gets the rejection, with the XO now offering the option: "No lock, Captain — I can fire blind on a bearing if you want it."
- XO launch line distinguishes it: "Bird away, running blind."

## 3. What a lock buys you (missile guidance privileges)

Two guidance states for every missile in flight: **UPLINKED** or **AUTONOMOUS**.

**UPLINKED** — locked launch, while the launching ship still holds lock on the target (and lives):
- The ship feeds continuous track data: the missile steers toward a computed INTERCEPT point (lead pursuit against the track's position+velocity), not merely at the target's current position, regardless of what its own seeker sees.
- **Decoy-immune**: while uplinked, the missile ignores decoys entirely (the mother ship's sensors discriminate; the bird trusts the track).
- Terminal handoff: inside its own seeker detection of the target, the seeker takes over (seamless; still decoy-immune while the uplink holds).

**AUTONOMOUS** — blind-fired from birth, OR uplink severed (launching ship lost the lock past grace, or died):
- Seeker-only guidance under existing rules: strongest signature in the acquisition cone, re-evaluated per tick, fully decoy-susceptible, ballistic when propellant is dry.
- Transition is one-way (a re-acquired lock does NOT re-uplink a bird already in flight — keep it simple, and it makes holding lock through the missile's flight matter).
- XO announces severance for own missiles: "Uplink lost — bird is autonomous."

**Design consequence (verify in playtest)**: decoys alone no longer defeat a well-flown locked attack. The defender must BREAK THE LOCK FIRST (rock LOS, dust, going dark below track threshold) and THEN decoy the orphaned missile. "Break lock, then spoof" is the intended two-step escape doctrine.

## 4. Seeker sensor math

Missile seekers use the standard detection formula with their own (weak) base:

```
MISSILE_SEEKER_BASE_M = 40000
// seeker detection = MISSILE_SEEKER_BASE_M × (target signature / 100), LOS required
// → full-burn ship (110) seen at ~44km; dark drifting ship (10) at ~4km
```
- Acquisition cone (60°) unchanged; a seeker can only grab what it detects inside the cone.
- This replaces any flat seeker-acquisition radius. Blind-fired missiles vs dark targets will usually miss unless they pass very close — intended; blind fire is a flushing tool, not a sniper rifle.
- Decoys: DECOY_SIGNATURE retuned 150 → 90 (see Section 7). Still very visible to autonomous seekers (~36km).

## 5. Bearing UI (client; ship in v4, not later)

- **NO compass ring** (cut in design review — visual noise). The cursor readout below is the whole bearing UI. If playtesting shows players getting lost, the approved minimal fallback is a single faint "N" tick at the top of the follow camera — do not build it preemptively.
- **Cursor readout**: whenever the pointer is over the map, a small HUD element shows BEARING and RANGE from own ship to the cursor position ("BRG 220 / 47.3 km"). This is the captain's plotting table — it makes blind fire, contact callouts, and dust-cloud speculation speakable. Always on; no toggle needed.
- Contact panel entries and XO contact reports already speak in bearings; verify they use the same convention (absolute, 0 = north) everywhere. One convention, no exceptions.

## 6. Schema/translator/test deltas

- Schema: fire_missile guidance params as above; no other verb changes.
- Standing-order metrics: no new metrics required by this addendum (uplink state is observable via XO lines; revisit if playtests demand a metric).
- Translator live-state summary: include own in-flight missiles' guidance state (uplinked/autonomous/ballistic) so "status of my birds?" answers well.
- Tests: locked-vs-blind launch paths; uplink severance on lock break and on launcher death; decoy immunity while uplinked and susceptibility when autonomous; seeker detection thresholds vs dark/burning targets; PDC sensor-slaving (undetected ordnance not engaged); close-detection bark trigger.

---

## 7. Post-build response to implementation flags (tuning patch)

Your two flags were reviewed. Rulings:

### Decoy signature: retune DECOY_SIGNATURE 150 → 90
Your flag was correct and identified an unintended regression: at 150 the decoy out-shines any possible ship signature, which deletes the v3 "throttle discipline" layer of spoofing (a full-burn ship could not be saved by its own decoy; you had to go cold first). Restore that layer by setting the decoy BETWEEN cruise and full burn:

- DECOY_SIGNATURE = 90.
- Resulting seduction behavior vs AUTONOMOUS seekers (uplinked immunity unchanged): a ship at effective thrust ≲ 80% is out-shone by its decoy → spoof works; a ship burning hotter out-shines its own decoy → spoof fails. Intended doctrine: "break the lock, throttle down, decoy."
- Seeker still sees a decoy at ~36km (40000 × 0.9) — orphaned birds remain highly seduceable by a properly used decoy.
- Deliberate side effect to preserve, not fix: at sig 90, a drifting decoy is detected by ENEMY SHIP sensors at ~148km and appears as an ordinary faint contact — indistinguishable from a cruising ship at faint tier. Decoys are now also strategic deception (fake contacts), not just terminal spoofs. Do not label decoys as decoys in enemy snapshots at faint/track tier; at ID tier (≤30% of detection range) the contact resolves as a decoy.
- Update the affected tests (seduction vs thrust thresholds) and add one: enemy snapshot shows a decoy as an unlabeled contact at faint tier and as a decoy at ID tier.

### Drone at 800 m/s patrolling rocks: approved as built
No changes. One verification request: confirm the drone's patrol takes it BEHIND rocks relative to a pursuing player often enough that solo players naturally experience lock-break-by-LOS — if its route never occludes, bias the patrol waypoints to weave the rock field.

### Also in this patch
- Section 5 amended: compass ring is CUT (visual noise); the cursor bearing/range readout is the entire bearing UI.
