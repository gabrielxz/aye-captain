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
    lock: { has: boolean };
    tubes: { state: string }[];
    ping?: { ready: boolean };
    probes?: number;
  };
  contacts: { cid: string; tier: number; x: number; y: number; vx?: number; vy?: number }[];
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
    dryS: 0,
    lastSignalBearing: null,
    gateProbed: false,
  };
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
  const next: HunterMem = { ...mem, fireCooldownS: Math.max(0, mem.fireCooldownS - 1) };
  const commands: Command[] = [];

  // fuel discipline (hysteresis): below the floor, coast in the regen band
  // until the tank recovers. The coast throttles its own drive rumble —
  // the Hunter's discipline is the player's tell, on purpose.
  if (!next.lowFuel && you.propellant < C.HUNTER_FUEL_FLOOR) next.lowFuel = true;
  if (next.lowFuel && you.propellant >= C.HUNTER_FUEL_RESUME) next.lowFuel = false;

  // best contact: highest tier, then nearest. Decoy contacts are
  // indistinguishable here (invariant 11) — the Hunter chases them like
  // any hull until its own sensors resolve the lie. That is the design.
  let best: HunterSnap["contacts"][number] | null = null;
  let bestRange = Infinity;
  for (const c of snap.contacts) {
    const r = dist(you.x, you.y, c.x, c.y);
    if (!best || c.tier > best.tier || (c.tier === best.tier && r < bestRange)) {
      best = c;
      bestRange = r;
    }
  }

  let heading: number;
  let throttle: number;

  if (best) {
    // PURSUE: lead the target when we hold a vector (tier >= 2), else
    // steer at the faint fix. The intercept is a cheap constant-bearing
    // projection, not a solver — a state machine, not a mind.
    let aimX = best.x;
    let aimY = best.y;
    if (best.tier >= 2 && best.vx !== undefined && best.vy !== undefined) {
      const closeSpeed = Math.max(800, Math.hypot(you.vx, you.vy));
      const t = bestRange / closeSpeed;
      aimX += best.vx * t;
      aimY += best.vy * t;
    }
    heading = bearingTo(you.x, you.y, aimX, aimY);
    throttle = C.HUNTER_PURSUE_THROTTLE;

    if (best.tier >= 2 && bestRange <= C.HUNTER_ENGAGE_RANGE_M) {
      // ENGAGE: designate, and shoot on cadence once the lock holds.
      // WATCH ITEM (Stage 0 playtest): with the magazine dry this branch
      // fires nothing — but the pursuit above continues at full commit,
      // PDCs still auto-engage. A dry Hunter is fanatical, never passive
      // (spec §2.2). Do not add a retreat here.
      throttle = C.HUNTER_HUNT_THROTTLE; // steady the approach; regen stays honest
      if (next.lockedCid !== best.cid) {
        commands.push({ verb: "set_lock_target", params: { contact: best.cid } });
        next.lockedCid = best.cid;
      }
      const tubeReady = you.tubes.some((t) => t.state === "ready");
      if (you.lock.has && tubeReady && next.fireCooldownS <= 0) {
        commands.push({ verb: "fire_missile", params: {} });
        next.fireCooldownS = C.HUNTER_FIRE_COOLDOWN_S;
      }
    }
  } else if (intel.gateCamp) {
    // PICKET (§3, late rows): hold station just inside the gate and let
    // the door do the hunting. Deliberately deaf to rumbles and ghosts —
    // a picket that chases every noise abandons the thing it exists to
    // deny. Contacts (the branch above) still pull it into a fight.
    next.lockedCid = null;
    const gl = Math.max(1, Math.hypot(intel.gate.x, intel.gate.y));
    const station = {
      x: intel.gate.x * (1 - 20000 / gl), // 20 km inward of the aperture
      y: intel.gate.y * (1 - 20000 / gl),
    };
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
    } else if (snap.ghost && dist(you.x, you.y, snap.ghost.x, snap.ghost.y) > C.HUNTER_PATROL_ARRIVE_M) {
      heading = bearingTo(you.x, you.y, snap.ghost.x, snap.ghost.y);
      throttle = C.HUNTER_HUNT_THROTTLE;
      next.dryS += 1; // a stale fix is a lead, not a signal — the clock runs
    } else {
      const wps = intel.sites.length > 0 ? intel.sites : patrolWaypoints(terrain);
      let wp = wps[next.wpIdx % wps.length];
      if (dist(you.x, you.y, wp.x, wp.y) <= C.HUNTER_PATROL_ARRIVE_M) {
        next.wpIdx = (next.wpIdx + (intel.sites.length > 0 ? 1 : 7)) % wps.length;
        wp = wps[next.wpIdx % wps.length];
      }
      heading = bearingTo(you.x, you.y, wp.x, wp.y);
      throttle = C.HUNTER_HUNT_THROTTLE;
      next.dryS += 1;
    }

    // ESCALATION: a Hunter that can't find you starts SPENDING. Every
    // HUNTER_DRY_SPELL_S of silence: PING first — the reveal is priced in,
    // and the frustrated scream is the player's gift — then probes (the
    // gate first: the player must come there eventually; after that, down
    // the last bearing it ever heard, else a spread off the patrol index).
    if (next.dryS >= C.HUNTER_DRY_SPELL_S) {
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
  if (threat) {
    if (next.dodge === 0) {
      // steer away from the side the rock sits on
      const cross = you.vx * (threat.y - you.y) - you.vy * (threat.x - you.x);
      next.dodge = cross > 0 ? 1 : -1;
    }
    const travel = norm360((Math.atan2(you.vx, you.vy) * 180) / Math.PI);
    heading = norm360(travel + next.dodge * 60);
    throttle = 100; // survival outranks fuel discipline
  } else {
    next.dodge = 0;
    if (next.lowFuel) throttle = Math.min(throttle, C.REGEN_MAX_THRUST_PCT);
  }

  commands.push({ verb: "set_heading", params: { mode: "absolute", degrees: heading } });
  commands.push({ verb: "set_thrust", params: { percent: throttle } });
  return { commands, mem: next };
}
