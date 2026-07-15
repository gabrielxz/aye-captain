// Campaign "Deep Black" (Stage 0): the Hunter's brain.
//
// THE SIGNATURE IS THE FOG GUARANTEE. hunterDecide is a pure function of
// (1) the Hunter's own WIRE SNAPSHOT — the exact fog-of-war object
// snapshotFor() builds for a human captain — and (2) public terrain (every
// client renders every rock; reading geometry is not a leak). It receives
// no Sim, no Ship, no ground truth. Decoys fool it, dust blinds it, rock
// shadows hide you, going dark works — all automatically, with zero
// special-casing, because its eyes ARE the fog code (spec §2.1).
// tests/hunter.test.ts pins this.
//
// A state machine, not a mind (spec §2.2): AVOID > ENGAGE > PURSUE > HUNT.
// No feinting, no retreating — it fights to the death.
import * as C from "./constants.js";
import type { Terrain } from "./terrain.js";
import { segCircleHitT } from "./terrain.js";
import { bearingTo, dist, headingVec, norm360, type Command } from "./sim.js";

// The slices of the wire snapshot the Hunter reads. Deliberately narrow —
// everything here is fog-scoped by construction.
export interface HunterSnap {
  you: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    facing: number;
    propellant: number;
    // owner-only engineering — all of it already on the wire for a human
    // captain's own HUD, so reading it is not a fog seam. `accel` and
    // `turnRate` replace a hardcoded worst-case floor; `rail` is the
    // weapon four of the eight ladder rows carry.
    accel: number;
    turnRate: number;
    lock: { has: boolean; progress?: number };
    tubes: { state: string }[];
    rail?: { slugs: number; cooldownS: number } | null;
    ping?: { ready: boolean };
    probes?: number;
  };
  contacts: { cid: string; tier: number; loud?: number; x: number; y: number; vx?: number; vy?: number }[];
  rumbles: { bearing: number; loud: number }[];
  ghost: { x: number; y: number } | null;
}

export interface HunterMem {
  fireCooldownS: number;
  dodge: -1 | 0 | 1; // committed rock-dodge direction (hysteresis, like droneDodge)
  lowFuel: boolean; // fuel-discipline hysteresis: coast and regen until RESUME
  wpIdx: number; // HUNT patrol waypoint index
  lockedCid: string | null; // contact we last designated (avoid re-issuing)
  // escalation (the Hunter that can't find you starts SPENDING): seconds
  // of total silence, the last bearing it ever heard, and whether the
  // gate probe has gone out
  dryS: number;
  lastSignalBearing: number | null;
  gateProbed: boolean;
  // lethality round: seconds spent chasing a rumble WITHOUT converting it
  // to a contact (the dust fortress), and total hunt seconds (gate drift)
  rumbleChaseS: number;
  huntS: number;
  // Patch 2 §1a: the target he is committed to (a contact cid) and the
  // re-evaluation cadence clock. Hysteresis lives on the SWITCH, not the
  // pick — losing the target picks fresh immediately.
  targetCid: string | null;
  retargetS: number;
  // in the engage band last tick — the band has hysteresis so the fight and
  // the approach don't trade the nose back and forth at 1 Hz
  engaged: boolean;
  // committed to a boundary retro burn: HOLD it until the outward velocity
  // is actually dead, rather than re-testing the trigger every tick
  retro: boolean;
  // Anvil §1b: the datum — where the trail went cold and how stale it is.
  // The uncertainty radius is DERIVED (ageS × MAX_SPEED_MPS), never stored.
  datum: { x: number; y: number; ageS: number } | null;
  spokeIdx: number; // datum-search spoke index (golden-angle sweep)
  sinceProbeS: number; // §1c spend cadences inside the datum search
  sincePingS: number;
}

// Public mission knowledge — nothing here is fog-gated by nature: MARKED
// wreck sites are common knowledge (§4.4 — rumored sites are the player's
// private leads and DELIBERATELY never appear in this struct; pinned in
// tests), the gate is a fixed landmark, gateCamp is this Hunter's ladder
// role (§3: a late-run escalation only).
export interface HunterIntel {
  sites: { x: number; y: number }[];
  gate: { x: number; y: number };
  gateCamp: boolean;
}

export function initialHunterMem(): HunterMem {
  return {
    fireCooldownS: 0,
    dodge: 0,
    lowFuel: false,
    wpIdx: 0,
    lockedCid: null,
    targetCid: null,
    retargetS: 0,
    engaged: false,
    retro: false,
    dryS: 0,
    lastSignalBearing: null,
    gateProbed: false,
    rumbleChaseS: 0,
    huntS: 0,
    datum: null,
    spokeIdx: 0,
    sinceProbeS: 0,
    sincePingS: 0,
  };
}

// Anvil §1a: every waypoint and intercept solution the Hunter steers for
// stays inside the hard leash — a target beyond it is pulled radially onto
// the clamp circle. The chase bends at the rim; it never leaves.
function clampWp(x: number, y: number): { x: number; y: number } {
  const d = Math.hypot(x, y);
  const max = C.REGION_RADIUS_M * C.HUNTER_WP_CLAMP_FRAC;
  return d <= max ? { x, y } : { x: (x / d) * max, y: (y / d) * max };
}

// §1a boundary-AVOID trigger: could the current OUTWARD radial speed carry
// us past the rim before a retro burn kills it? Braking distance — a fixed
// lookahead can't make this promise at 3 km/s, physics can.
//
// Two corrections, 2026-07-14. (1) The old comment claimed "the snapshot
// carries no accel figure, and the conservative floor is safe for all". It
// was factually wrong — sim.ts puts `accel: accelOf(ship)` on the wire — and
// the floor (the cruiser's 40) was simultaneously too conservative for the
// corvette, which flipped and braked ~1.46x earlier than it needed to on
// every approach, and too generous where it mattered. (2) It ignored the
// TURN: a cruiser needs 180/14 = 12.9 s to swing its nose retrograde, and at
// 3 km/s that is 38 km of outward travel the old model simply didn't have.
// Both of those are why "never exits" held in the tests and not in the game.
// ⚠️ KNOWN HOLE, 2026-07-14 — this whole function assumes a burn it may not
// be able to buy. PURSUE runs at 100%, which is PROPELLANT_BURN_AT_FULL =
// 1.0/s, so a long transit empties the tank in 100 s; effectiveThrust() is
// `propellant > 0 ? thrust : 0`, so a dry Hunter has NO drive, and there is
// no regen outside the region (insideZone gates it). Probed across every
// archetype and five seeds against a bait parked outside the rim: the Hunter
// reaches its maximum radius with propellant EXACTLY 0.0 and simply coasts
// out. It is not dodging into the shroud; it is drifting into it, out of
// gas, while this function confidently computes a braking distance nobody
// can pay for. That predates this pass (measured identically on the previous
// build) and the fix is a fuel-budgeting policy call, not a bug fix — see
// TODO.md. Do not "fix" it by making the trigger fire earlier: that just
// spends the tank sooner (measured).
function brakeDistanceM(you: HunterSnap["you"], vOut: number): number {
  const flipS = 180 / Math.max(1, you.turnRate); // worst case: nose is 180° off
  return vOut * flipS + (vOut * vOut) / (2 * Math.max(1, you.accel));
}
function outwardSpeed(you: HunterSnap["you"]): number {
  const d = Math.hypot(you.x, you.y);
  return d < 1 ? 0 : (you.vx * you.x + you.vy * you.y) / d;
}
// `committed` LATCHES the burn. Re-testing the raw trigger every tick let the
// Hunter brake until the threat cleared, burn outward again, re-trigger, and
// repeat — an oscillation that spent the very propellant the real stop needs.
// Once the rim is in play, hold the retro until the outward velocity is
// actually dead. (Propellant is 1.0/s at full burn and effectiveThrust() is
// `propellant > 0 ? thrust : 0`, so a wasted burn is not just noise — a dry
// Hunter has NO drive at all and coasts wherever it was pointed.)
function boundaryThreat(you: HunterSnap["you"], committed: boolean): boolean {
  const vOut = outwardSpeed(you);
  if (vOut <= 0) return false;
  if (committed) return true;
  return Math.hypot(you.x, you.y) + brakeDistanceM(you, vOut) + 5000 > C.REGION_RADIUS_M;
}

// HUNT patrol route: rock flanks, then the region center. Terrain is public
// knowledge; Stage 1 replaces this with salvage sites (spec §4.3 — "the AI
// now appears to be thinking"). Empty terrain (headless tests) patrols the
// center alone, deterministically.
function patrolWaypoints(terrain: Terrain): { x: number; y: number }[] {
  const wps = terrain.rocks
    .filter((r) => !r.centerpiece)
    .map((r) => {
      // a point off the rock's center-facing flank — skimming the field
      // keeps the Hunter weaving cover instead of parked in the open
      const d = Math.max(1, Math.hypot(r.x, r.y));
      const off = (r.r + C.HUNTER_PATROL_ARRIVE_M) / d;
      return { x: r.x * (1 - off), y: r.y * (1 - off) };
    });
  return wps.length > 0 ? wps : [{ x: 0, y: 0 }];
}

// One decision per command tick (1 Hz). Returns the commands to apply and
// the next memory. Commands use the same verbs a captain's translator
// emits — the Hunter has no private physics.
export function hunterDecide(
  snap: HunterSnap,
  mem: HunterMem,
  terrain: Terrain,
  intel: HunterIntel
): { commands: Command[]; mem: HunterMem } {
  const you = snap.you;
  const next: HunterMem = {
    ...mem,
    fireCooldownS: Math.max(0, mem.fireCooldownS - 1),
    huntS: mem.huntS + 1,
  };
  const commands: Command[] = [];

  // fuel discipline (hysteresis): below the floor, coast in the regen band
  // until the tank recovers. The coast throttles its own drive rumble —
  // the Hunter's discipline is the player's tell, on purpose.
  if (!next.lowFuel && you.propellant < C.HUNTER_FUEL_FLOOR) next.lowFuel = true;
  if (next.lowFuel && you.propellant >= C.HUNTER_FUEL_RESUME) next.lowFuel = false;

  // Patch 2 §1a: he pursues the LOUDEST contact he currently holds — the
  // one rule that makes the bait play work (the burning friend draws him;
  // the dark one loots in the silence that buys). With contact on only
  // one ship, that is his target regardless of the other's signature.
  // Re-evaluation runs on a CADENCE with HYSTERESIS: a challenger must be
  // meaningfully louder or meaningfully closer — never oscillate between
  // two comparably-loud ships. Decoy contacts are indistinguishable here
  // (invariant 11, loudness included) — the Hunter chases them like any
  // hull until its own sensors resolve the lie. That is the design.
  const range = (c: HunterSnap["contacts"][number]) => dist(you.x, you.y, c.x, c.y);
  const louder = (a: HunterSnap["contacts"][number] | null, c: HunterSnap["contacts"][number]) =>
    !a || (c.loud ?? 0) > (a.loud ?? 0) || ((c.loud ?? 0) === (a.loud ?? 0) && range(c) < range(a))
      ? c
      : a;
  let best: HunterSnap["contacts"][number] | null = null;
  if (snap.contacts.length > 0) {
    const current = mem.targetCid
      ? snap.contacts.find((c) => c.cid === mem.targetCid) ?? null
      : null;
    if (!current) {
      // no commitment (or the track vanished): take the loudest now
      best = snap.contacts.reduce(louder, null);
      next.retargetS = C.HUNTER_RETARGET_EVERY_S;
    } else {
      best = current;
      next.retargetS = mem.retargetS - 1;
      if (next.retargetS <= 0) {
        next.retargetS = C.HUNTER_RETARGET_EVERY_S;
        // the closer-gate breaks NEAR-TIES only — it must not outrank
        // loudness, or the bait play dies the moment the bait opens the
        // range (found by the §8 checkpoint: the fleeing burner's range
        // grows until the dark looter 'steals' by proximity — wrong)
        const challenger = snap.contacts
          .filter(
            (c) =>
              c.cid !== current.cid &&
              ((c.loud ?? 0) >= (current.loud ?? 0) * C.HUNTER_RETARGET_LOUDER ||
                (range(c) <= range(current) * C.HUNTER_RETARGET_CLOSER &&
                  (c.loud ?? 0) * C.HUNTER_RETARGET_LOUDER >= (current.loud ?? 0)))
          )
          .reduce(louder, null);
        if (challenger) best = challenger;
      }
    }
  }
  next.targetCid = best?.cid ?? null;
  const bestRange = best ? range(best) : Infinity;

  // Anvil §1b datum bookkeeping: a live contact refreshes the datum every
  // tick (age 0, sweep reset); silence ages it until the uncertainty circle
  // covers more than the region — then the trail is cold and it drops.
  if (best) {
    next.datum = { x: best.x, y: best.y, ageS: 0 };
    next.spokeIdx = 0;
    next.sinceProbeS = 0;
    next.sincePingS = 0;
  } else if (mem.datum) {
    const ageS = mem.datum.ageS + 1;
    next.datum =
      ageS * C.MAX_SPEED_MPS > C.HUNTER_DATUM_GIVEUP_R_M
        ? null
        : { x: mem.datum.x, y: mem.datum.y, ageS };
  }

  let heading: number;
  let throttle: number;

  if (best) {
    const hasVector = best.tier >= 2 && best.vx !== undefined && best.vy !== undefined;
    const rvx = you.vx - (best.vx ?? 0); // our velocity in the target's frame
    const rvy = you.vy - (best.vy ?? 0);
    const closing = (rvx * (best.x - you.x) + rvy * (best.y - you.y)) / Math.max(1, bestRange);
    // ENGAGE is a RANGE BAND, not a moment, and it owns the nose. Leaving it
    // needs to clear the band or the two branches chatter at 1 Hz.
    const engaged =
      best.tier >= 2 &&
      bestRange <= C.HUNTER_ENGAGE_RANGE_M * (mem.engaged ? C.HUNTER_ENGAGE_EXIT_FRAC : 1);
    next.engaged = engaged;

    if (engaged) {
      // FIGHT. The nose stays on the target, always.
      //
      // This is the bug that cost the Hunter nearly all of its lethality: a
      // lock needs the contact inside LOCK_CONE_HALF_ANGLE_DEG (±30°) of
      // FACING for LOCK_TIME_S (5) CONTINUOUS seconds, with a 2 s grace
      // before progress resets. The old ENGAGE branch was nested inside
      // PURSUE and only overrode `throttle` — so while the braking envelope
      // held `heading` at the retrograde of relative velocity, i.e. ~180°
      // off, it designated a contact it was physically pointing away from
      // and then polled you.lock.has, which could never go true. The
      // corvette chattered across the envelope with a 4.6 s flip time
      // against a 5 s lock requirement; the CRUISER never even chattered
      // (ENGAGE forced throttle 55, giving it 22 m/s² against the 28.9 its
      // own envelope assumed), so ladder row 6 — "do not trade with it,
      // Captain" — was structurally incapable of firing a missile.
      //
      // You cannot brake and aim at once; that is physics, not code. So the
      // braking now finishes OUTSIDE the band (see below) and in here the
      // Hunter simply flies its nose at you and shoots. Throttle only
      // chases when you are outrunning it — which points at you anyway, so
      // the lock survives the chase.
      heading = bearingTo(you.x, you.y, best.x, best.y);
      throttle = closing < C.HUNTER_CLOSE_RATE_FLOOR_MPS ? C.HUNTER_HUNT_THROTTLE : 0;
      // coasting inside the band also quiets his drive — an emergent tell
      // worth keeping: the Hunter is loudest on the way in, not at the kill

      if (next.lockedCid !== best.cid) {
        commands.push({ verb: "set_lock_target", params: { contact: best.cid } });
        next.lockedCid = best.cid;
      }
      const tubeReady = you.tubes.some((t) => t.state === "ready");
      if (you.lock.has && tubeReady && next.fireCooldownS <= 0) {
        commands.push({ verb: "fire_missile", params: {} });
        next.fireCooldownS = C.HUNTER_FIRE_COOLDOWN_S;
      }
      // THE RAILGUN. Four of the eight ladder rows mount one (frigate and
      // cruiser STARTING_LOADOUT) and row 3's spawn line promises it out
      // loud — and hunter.ts had never contained the word. It is the one
      // weapon whose preconditions this AI already satisfies: the solution
      // needs TRACK tier, not a lock, and fires immediately. He pays for it
      // in noise, which is the trade working as designed.
      if (
        you.rail &&
        you.rail.slugs > 0 &&
        you.rail.cooldownS <= 0 &&
        bestRange <= C.HUNTER_RAIL_RANGE_M
      ) {
        commands.push({ verb: "fire_railgun", params: { mode: "solution", target: best.cid } });
      }
      // WATCH ITEM (Stage 0 playtest): with the magazine dry this branch
      // fires nothing — but the pursuit continues at full commit and PDCs
      // still auto-engage. A dry Hunter is fanatical, never passive (spec
      // §2.2). Do not add a retreat here.
    } else if (hasVector) {
      // APPROACH (1.1 §5b): a RENDEZVOUS, not a ram. Fly the braking
      // envelope so we ARRIVE at the band with a manageable rate, instead
      // of lead-intercepting the position like a heat-seeker (the observed
      // yo-yo: overshoot, flip, burn back).
      //
      // dRem now measures to the EDGE of the engage band, not to 60% of the
      // way inside it. The braking has to be finished by the time the
      // fighting starts, or it spends the whole fight pointing backwards.
      const dRem = Math.max(0, bestRange - C.HUNTER_ENGAGE_RANGE_M);
      const vAllow =
        0.85 * Math.sqrt(2 * Math.max(1, you.accel) * dRem) + C.HUNTER_CLOSE_RATE_FLOOR_MPS;
      if (closing > vAllow) {
        // too hot for the distance left: retrograde of the RELATIVE
        // velocity, full burn — the kill approach is flank (§2e)
        heading = norm360(bearingTo(0, 0, -rvx, -rvy));
        throttle = C.HUNTER_PURSUE_THROTTLE;
      } else {
        const closeSpeed = Math.max(800, Math.hypot(you.vx, you.vy));
        const t = bestRange / closeSpeed;
        const aim = clampWp(best.x + best.vx! * t, best.y + best.vy! * t); // §1a: the chase bends at the rim
        heading = bearingTo(you.x, you.y, aim.x, aim.y);
        throttle = C.HUNTER_PURSUE_THROTTLE;
      }
    } else {
      // a faint fix has no vector to rendezvous with: direct pursuit stays
      // (and stays fallible — fix physics, no omniscience)
      const aim = clampWp(best.x, best.y); // §1a
      heading = bearingTo(you.x, you.y, aim.x, aim.y);
      throttle = C.HUNTER_PURSUE_THROTTLE;
    }
  } else if (intel.gateCamp) {
    // PICKET (§3, late rows): hold station just inside the gate and let
    // the door do the hunting. Deliberately deaf to rumbles and ghosts —
    // a picket that chases every noise abandons the thing it exists to
    // deny. Contacts (the branch above) still pull it into a fight.
    next.lockedCid = null;
    const gl = Math.max(1, Math.hypot(intel.gate.x, intel.gate.y));
    const station = clampWp(
      intel.gate.x * (1 - 20000 / gl), // 20 km inward of the aperture
      intel.gate.y * (1 - 20000 / gl)
    );
    const d = dist(you.x, you.y, station.x, station.y);
    if (d > C.HUNTER_PATROL_ARRIVE_M) {
      heading = bearingTo(you.x, you.y, station.x, station.y);
      throttle = C.HUNTER_HUNT_THROTTLE;
    } else {
      // on station: a slow, quiet loiter — the picket barely breathes
      heading = norm360(bearingTo(you.x, you.y, intel.gate.x, intel.gate.y) + 90);
      throttle = 15;
    }
  } else {
    // HUNT: no contact. Ears first (a rumble is a live bearing), then the
    // last-known ghost, then the SALVAGE SITES (§4.3 — a site is a known
    // place where a ship will predictably be, stationary, for thirty
    // seconds; this is the three-line choice that makes a dumb state
    // machine look like it's thinking), then the rock-flank patrol.
    next.lockedCid = null;
    const loudest = snap.rumbles.reduce<HunterSnap["rumbles"][number] | null>(
      (a, r) => (a === null || r.loud > a.loud ? r : a),
      null
    );
    if (loudest) {
      heading = norm360(loudest.bearing);
      throttle = C.HUNTER_HUNT_THROTTLE;
      next.lastSignalBearing = norm360(loudest.bearing);
      next.dryS = 0; // a rumble is a live signal
      next.rumbleChaseS += 1;
      // BLIND FIRE (the dust fortress answer): a loud rumble it has chased
      // for HUNTER_BLIND_FIRE_S without ever earning a contact gets a
      // bearing-guided bird down the noise. Prox fuses are geometry —
      // torpedoes swim through the cloud the sensors can't.
      const tubeReady = you.tubes.some((t) => t.state === "ready");
      if (
        next.rumbleChaseS >= C.HUNTER_BLIND_FIRE_S &&
        loudest.loud >= C.HUNTER_BLIND_FIRE_LOUD &&
        tubeReady &&
        next.fireCooldownS <= 0
      ) {
        commands.push({
          verb: "fire_missile",
          params: { guidance: "bearing", bearing_degrees: Math.round(loudest.bearing) },
        });
        next.fireCooldownS = C.HUNTER_FIRE_COOLDOWN_S;
        next.rumbleChaseS = 0; // earn the next one
      }
    } else if (next.datum) {
      // DATUM SEARCH (Anvil §1b): the trail is warm. Sweep golden-angle
      // spokes of the uncertainty circle — every waypoint sits INSIDE
      // r = age × prey max speed, so a ship that sat still after being
      // seen is walked over, while one that coasted away silently rides
      // the circle's expanding rim out of the sweep. Not a random walk.
      const r = next.datum.ageS * C.MAX_SPEED_MPS;
      let wp: { x: number; y: number };
      if (next.spokeIdx === 0) {
        wp = clampWp(next.datum.x, next.datum.y); // first: the datum itself
      } else {
        const [sx, sy] = headingVec(norm360(next.spokeIdx * 137.5));
        const rho = C.HUNTER_DATUM_SPOKE_FRAC * r;
        wp = clampWp(next.datum.x + sx * rho, next.datum.y + sy * rho);
      }
      if (dist(you.x, you.y, wp.x, wp.y) <= C.HUNTER_PATROL_ARRIVE_M) next.spokeIdx += 1;
      heading = bearingTo(you.x, you.y, wp.x, wp.y);
      throttle = C.HUNTER_HUNT_THROTTLE;
      next.rumbleChaseS = 0;

      // ESCALATION BY UNCERTAINTY (§1c): PASSIVE below the probe
      // threshold; remote ears seeded around the circle past it; past the
      // ping threshold the sweeps come, and they come FASTER as the
      // circle grows (interval ∝ 1/r, floored by the transducer
      // recharge). Never below the threshold — every sweep hands the
      // player a free map-wide fix on the Hunter, and that trade is only
      // worth it when the circle is already big.
      next.sinceProbeS += 1;
      next.sincePingS += 1;
      if (r >= C.HUNTER_DATUM_PING_R_M && you.ping?.ready) {
        const interval = Math.max(
          1,
          Math.round((C.HUNTER_DATUM_PING_BASE_S * C.HUNTER_DATUM_PING_R_M) / r)
        );
        if (next.sincePingS >= interval) {
          commands.push({ verb: "sensor_ping", params: {} });
          next.sincePingS = 0;
        }
      } else if (
        r >= C.HUNTER_DATUM_PROBE_R_M &&
        (you.probes ?? 0) > 0 &&
        next.sinceProbeS >= C.HUNTER_DATUM_PROBE_EVERY_S
      ) {
        // an ear on the circle, one spoke ahead of the sweep
        const [sx, sy] = headingVec(norm360((next.spokeIdx + 1) * 137.5));
        const rho = C.HUNTER_DATUM_SPOKE_FRAC * r;
        const ear = clampWp(next.datum.x + sx * rho, next.datum.y + sy * rho);
        commands.push({
          verb: "launch_probe",
          params: { bearing_degrees: Math.round(bearingTo(you.x, you.y, ear.x, ear.y)) },
        });
        next.sinceProbeS = 0;
      }
    } else if (snap.ghost && dist(you.x, you.y, snap.ghost.x, snap.ghost.y) > C.HUNTER_PATROL_ARRIVE_M) {
      const g = clampWp(snap.ghost.x, snap.ghost.y);
      heading = bearingTo(you.x, you.y, g.x, g.y);
      throttle = C.HUNTER_HUNT_THROTTLE;
      next.dryS += 1; // a stale fix is a lead, not a signal — the clock runs
      next.rumbleChaseS = 0;
    } else {
      // GATE DRIFT: a hunt that has dragged past HUNTER_GATE_DRIFT_S adds
      // the gate approach to the patrol rotation — it knows where you
      // must eventually go (the soft, every-system picket)
      const gl = Math.max(1, Math.hypot(intel.gate.x, intel.gate.y));
      const gateStation = { x: intel.gate.x * (1 - 30000 / gl), y: intel.gate.y * (1 - 30000 / gl) };
      const base = intel.sites.length > 0 ? intel.sites : patrolWaypoints(terrain);
      const wps = next.huntS >= C.HUNTER_GATE_DRIFT_S ? [...base, gateStation, gateStation] : base;
      let wp = wps[next.wpIdx % wps.length];
      if (dist(you.x, you.y, wp.x, wp.y) <= C.HUNTER_PATROL_ARRIVE_M) {
        next.wpIdx = (next.wpIdx + (intel.sites.length > 0 || wps.length > 2 ? 1 : 7)) % wps.length;
        wp = wps[next.wpIdx % wps.length];
      }
      wp = clampWp(wp.x, wp.y); // §1a
      heading = bearingTo(you.x, you.y, wp.x, wp.y);
      throttle = C.HUNTER_HUNT_THROTTLE;
      next.dryS += 1;
      next.rumbleChaseS = 0;
    }

    // ESCALATION (cold hunt only — a live datum runs the §1c uncertainty
    // ladder above instead): a Hunter that can't find you starts SPENDING.
    // Every HUNTER_DRY_SPELL_S of silence: PING first — the reveal is
    // priced in, and the frustrated scream is the player's gift — then
    // probes (the gate first: the player must come there eventually; after
    // that, down the last bearing it ever heard, else a spread off the
    // patrol index).
    if (!next.datum && next.dryS >= C.HUNTER_DRY_SPELL_S) {
      if (you.ping?.ready) {
        commands.push({ verb: "sensor_ping", params: {} });
        next.dryS = 0;
      } else if ((you.probes ?? 0) > 0) {
        const probeBearing = !next.gateProbed
          ? bearingTo(you.x, you.y, intel.gate.x, intel.gate.y)
          : next.lastSignalBearing ?? norm360(next.wpIdx * 73);
        commands.push({ verb: "launch_probe", params: { bearing_degrees: Math.round(probeBearing) } });
        next.gateProbed = true;
        next.dryS = 0;
      }
      // nothing left to spend: the clock holds at the threshold and fires
      // the moment the transducers recharge
    }

    // SOFT LEASH: rumble bearings carry no range — a noise pointing
    // outward was marching hunters off the map. Beyond the leash radius,
    // an outward HUNT heading bends home. (PURSUE and the picket are
    // exempt: chasing a real contact off the rim is a chase.)
    const rd = Math.hypot(you.x, you.y);
    if (rd > C.REGION_RADIUS_M * C.HUNTER_LEASH_FRAC) {
      const [hx, hy] = headingVec(heading);
      if (hx * you.x + hy * you.y > 0) {
        heading = bearingTo(you.x, you.y, 0, 0);
      }
    }
  }

  // a contact is the strongest signal of all
  if (best) {
    next.dryS = 0;
    next.rumbleChaseS = 0;
    next.lastSignalBearing = bearingTo(you.x, you.y, best.x, best.y);
  }

  // AVOID overrides everything: project the velocity HUNTER_AVOID_LOOKAHEAD_S
  // ahead with a padded hit test (the ray is the center line; grazing arcs
  // clip rocks the raw ray misses). The dodge direction COMMITS until the
  // path clears — re-picking every tick oscillates onto the rock face.
  const speed = Math.hypot(you.vx, you.vy);
  const lookX = you.x + you.vx * C.HUNTER_AVOID_LOOKAHEAD_S;
  const lookY = you.y + you.vy * C.HUNTER_AVOID_LOOKAHEAD_S;
  let threat: { x: number; y: number } | null = null;
  if (speed > 5) {
    let bestT = Infinity;
    for (const r of terrain.rocks) {
      const t = segCircleHitT(you.x, you.y, lookX, lookY, r.x, r.y, r.r + 1500);
      if (t !== null && t < bestT) {
        bestT = t;
        threat = r;
      }
    }
  }
  // 🔴 The two halves of AVOID COMPOSE. They used to chain `if (rock) ...
  // else if (boundary) ...`, so ANY rock on the vector silently disabled
  // containment — and rocks seed to 0.95R while the leash parks the Hunter
  // at 0.9R, so the dodge zone and the rim OVERLAP by 12.5 km. A rock near
  // the rim meant `heading = travel ± 60°` (still outward if travel was
  // outward) at throttle 100 with nothing watching the boundary, for as
  // long as the dodge stayed committed: ~45 km of outward burn at 3 km/s.
  // That is the reported "flies into the shroud", and NEITHER never-exits
  // pin could catch it because both run on empty terrain, where this branch
  // cannot execute.
  //
  // The resolution is that both threats want the SAME answer. Turning the
  // dodge inward isn't available (±60° off a radial-outward vector still
  // points outward) and flipping the dodge sign would steer INTO the rock.
  // But a retro burn serves both masters at once: it kills the outward
  // velocity the rim cares about AND takes the speed out of the rock we're
  // about to hit — and collision damage is quadratic in speed, harmless
  // below 50 m/s. When the rim and a rock both threaten, brake.
  const rimThreat = boundaryThreat(you, mem.retro);
  next.retro = rimThreat;
  if (threat && rimThreat) {
    next.dodge = 0;
    heading = bearingTo(you.x, you.y, 0, 0);
    throttle = 100;
  } else if (threat) {
    if (next.dodge === 0) {
      // steer away from the side the rock sits on
      const cross = you.vx * (threat.y - you.y) - you.vy * (threat.x - you.x);
      next.dodge = cross > 0 ? 1 : -1;
    }
    const travel = norm360((Math.atan2(you.vx, you.vy) * 180) / Math.PI);
    heading = norm360(travel + next.dodge * 60);
    throttle = 100; // survival outranks fuel discipline
  } else if (rimThreat) {
    // Anvil §1a: the boundary is in AVOID — outward momentum that could
    // carry past the rim steers home at full burn. Waypoint clamping
    // keeps this rare; this is the backstop that makes "never exits the
    // region" a law.
    next.dodge = 0;
    heading = bearingTo(you.x, you.y, 0, 0);
    throttle = 100;
  } else {
    next.dodge = 0;
    if (next.lowFuel) throttle = Math.min(throttle, C.REGEN_MAX_THRUST_PCT);
  }

  commands.push({ verb: "set_heading", params: { mode: "absolute", degrees: heading } });
  commands.push({ verb: "set_thrust", params: { percent: throttle } });
  return { commands, mem: next };
}
