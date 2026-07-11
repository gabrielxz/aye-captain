# HANDOFF v4.3 — Playtest patch: the bug, the welcome, and longer eyes

Post-playtest patch. Two themes: small fixes from live play, and a sensor rebase addressing the finding that STEALTH IS CURRENTLY FREE — going dark costs nothing and counters everything, so all play collapses into slinking. This patch compresses the detection spread (dark is an edge, not an off-switch). Positive burn-hot incentives (speed-scaled ramscoop regen, active sensor ping) were designed but DEFERRED to a future update — add both to TODO.md so the ideas persist; do not build them now.

Constants discipline as always. Update /how-to-play in the same commits per the CLAUDE.md invariant (specific copy notes in Section 8).

---

## 1. BUG (do first): standing order fired immediately

Repro from live play: CAPT: "cut thrusters at 300 meters per second" → XO acknowledged → order triggered instantly at 114 m/s. Worked pre-v4. Investigate in this order:

1. TRANSLATOR (most likely): pull the emitted JSON from the datalog for this utterance. Hypothesis: emitted {metric: own_speed, op: lt|lte, value: 300} — reading "at 300" as below-threshold rather than threshold-reached. At 114, lte fires immediately. If confirmed: add translator guidance + schema examples for rising vs falling thresholds ("cut X AT <speed>" while below it = gte / rising).
2. EVALUATOR REGRESSION: v4's metric rework touched the condition evaluator. Verify own_speed survives under that exact name end-to-end (schema → validator → evaluator) and that unknown/renamed metrics evaluate FALSE per the unknowable-metric rule — never undefined-truthy (which fires any order instantly).
3. UNITS/STATE: confirm the evaluator reads m/s post-substep refactor (not per-substep delta, not thrust %).

Repro tool: inject the raw JSON order via the debug harness with op gte — correct behavior implicates #1; still-instant implicates #2/#3.

REGARDLESS OF ROOT CAUSE: the XO's registration readback must state the trigger DIRECTION — "Aye — cutting thrust when we REACH three hundred" vs "...if we DROP BELOW three hundred" — so operator errors are audible at registration, not discovered mid-burn. Update the acknowledgement guidance in the translator prompt. Add a regression test for this utterance verbatim.

## 2. XO welcome (both modes)

On match start, the XO speaks a cached stock line:
- 1v1: "All systems nominal, Captain. The ship is yours." (If a welcome already exists in 1v1, keep it; add the practice one.)
- Practice: "Practice range is hot, Captain. Drone's out there somewhere."
One transcript event + cached audio. Fires after the client is connected and audio is unlocked (post user-gesture), not before.

## 3. Cursor readout: bearing only

Drop range from the hover readout: "BRG 220". Rationale: bearing is the speakable currency; range-to-empty-space invites false precision. (Distance sense is preserved by Section 4.)

## 4. Range rings: three → one

Keep a SINGLE ring at 50 km. Remove 10 and 100. The survivor MUST be clearly labeled ("50 km" tag at the ring's top crossing — the playtest showed unlabeled rings read as a mystery). It is now the map's only ruler; after the Section-5 rebase it also approximates "the distance at which a dark ship gets spotted," which makes it quietly educational. If future playtests want it gone too, that's a one-line delete — do not remove it in this patch.

## 5. Sensor rebase + linked decoy retune

The spread compression:
```
SENSOR_BASE_M   = 180000   (was 165000)
SIG_BASE        = 30       (was 10)     // ship signature = 30 + effective thrust%
```
Resulting detection (vs standard sensor): dark drift (30) ~54 km; 50% cruise (80) ~144 km; flank (130) ~234 km. Tier thresholds unchanged (100/60/30%): a dark ship becomes TRACKABLE (lockable) at ~32 km and IDs at ~16 km — stealth still denies locks at range; it no longer denies contact entirely.

Linked retunes (keep the relationships commented):
```
DECOY_SIGNATURE = 100      (was 90)     // must sit between cruise and full burn:
                                        // spoof now works below ~70% throttle
MISSILE_SIG_COASTING = 8   (unchanged — ballistic birds seen at ~14km; still scary)
MISSILE_SIG_BURNING  = 80  (unchanged — burning birds visible at ~144km)
```
Update seduction-threshold tests. Spot-check that spawn (300 km apart) still opens with a hunt: a full-burner becomes faint at ~234 km — first move still precedes first contact. Good.

## 6. /how-to-play updates (same release)

- Add a "Reading the Map" box to Doctrine I: the 50 km ring is a ruler, not a sensor boundary; hover for bearing; the big ring is the zone edge.
- Doctrine I: soften "hole in the sky" language per the rebase — dark is now "seen only at a fraction of the distance," not near-invisible. Keep numbers qualitative.
- FIG-1 caption tweak if needed (relative circle scale ~1 : 2.7 : 4.3 now).

## 7. Tests

Bug regression (Section 1 verbatim utterance); rising/falling threshold translation pair; welcome events both modes; ring/cursor render checks if UI tests exist; new detection thresholds (dark/cruise/flank + tier boundaries); decoy seduction threshold at new value.
