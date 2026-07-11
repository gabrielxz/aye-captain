// tick loop, physics, weapons, standing orders
import * as C from "./constants.js";
import {
  type Terrain,
  type Rock,
  emptyTerrain,
  generateTerrain,
  firstRockHit,
  segCircleHitT,
  losClear,
  insideDust,
} from "./terrain.js";

export type ShipId = "A" | "B";

export type TargetKind =
  | "enemy_ship"
  | "nearest_missile"
  | "nearest_decoy"
  | "nearest_contact";

export type HeadingParams =
  | { mode: "relative"; direction: "port" | "starboard"; degrees: number }
  | { mode: "absolute"; degrees: number }
  | { mode: "target"; target: TargetKind };

export interface Command {
  verb:
    | "set_thrust"
    | "set_heading"
    | "set_pdc"
    | "fire_missile"
    | "reload_tubes"
    | "deploy_decoy"
    | "maneuver"
    | "show_vector"
    | "set_overlay"
    | "sensor_ping"
    | "set_standing_order"
    | "query";
  params: Record<string, unknown>;
  acknowledgement?: string;
}

export type PdcPosture = "free" | "hold";

// Autopilot macros. Unlike continuous tracking (which stays removed), a
// maneuver has a DEFINED END STATE — it runs, finishes, announces. The
// executor switches on type so future macros (v5+) are additive.
export type Maneuver = { type: "full_stop" };

// Goal heading as stored: ALL orders resolve to an absolute bearing at apply
// time — target orders snapshot the target's bearing once (no continuous
// tracking; the captain flies the ship).
// absolute: steer shortest-arc to a compass heading (target orders snapshot
// to this at apply). turn: a RELATIVE turn as signed degrees remaining
// (+ = starboard/CW, - = port/CCW) — honors the commanded direction even
// past 180 and makes a full 360 pirouette real instead of a silent no-op
// (v4.4 fix: norm360(facing + 360) used to collapse to "already there").
export type HeadingGoal =
  | { mode: "absolute"; degrees: number }
  | { mode: "turn"; remaining: number };

export interface Tube {
  loaded: boolean;
  reload: number; // seconds until loaded (0 while loaded or empty-with-no-reserve)
}

// This ship's missile lock ON THE ENEMY. progress accumulates while the
// enemy is in cone+range+sensor-visible; grace keeps it alive through blips.
export interface LockState {
  progress: number; // seconds accumulated toward LOCK_TIME_S
  has: boolean;
  grace: number; // seconds of grace remaining once conditions break
}

export type PaintedState = "none" | "acquiring" | "locked";

export interface Comparison {
  metric: string;
  op: "lt" | "lte" | "gt" | "gte" | "eq";
  value: number | boolean;
}

export type Condition =
  | Comparison
  | { all: Comparison[] }
  | { any: Comparison[] };

export interface StandingOrder {
  label: string;
  condition: Condition;
  actions: Command[];
  repeat: boolean;
  cooldown: number; // seconds until a repeat order re-arms (0 = armed)
}

export interface Ship {
  id: ShipId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number; // degrees, 0 = north/up, clockwise positive
  thrust: number; // throttle SETTING percent 0-100 (output is 0 when tanks dry)
  goal: HeadingGoal | null;
  maneuver: Maneuver | null; // active autopilot macro (cancelled by any thrust/heading order)
  hull: number;
  reserve: number; // missiles in the magazine beyond what's loaded in tubes
  tubes: Tube[];
  decoys: number; // supply remaining
  // Point-defense cannon: an automated system commanded by posture. While
  // FREE it engages inbound missiles and knife-range ships on its own.
  pdcPosture: PdcPosture;
  pdcAmmoS: number; // seconds of cumulative fire remaining; no regeneration
  pdcAmmoTier: number; // lowest ammo warning announced (100/50/25/10/0 %)
  sigSpikePdc: number; // seconds of +SIG_SPIKE_PDC remaining after firing
  underPdcFire: boolean; // edge flag: were we taking PDC hull fire last tick
  propellant: number; // 0..PROPELLANT_MAX (drones exempt: stays full)
  propellantTier: number; // lowest warning tier announced (100/50/25/10/0)
  lock: LockState; // my lock on the enemy
  prevPainted: PaintedState; // enemy's lock on me last tick (edge-triggered notices)
  sigSpikeLaunch: number; // seconds of +SIG_SPIKE_LAUNCH remaining after firing
  droneCooldown: number; // drone-only: seconds until it may fire again
  droneWaypoint: number; // drone-only: index into the patrol route
  droneDodge: -1 | 0 | 1; // drone-only: committed dodge direction (hysteresis)
  isDrone: boolean;
  standingOrders: StandingOrder[];
  orderCounter: number; // for generated labels
  // zone/dust transition tracking (edge-triggered transcript events)
  wasInsideZone: boolean;
  wasInDust: boolean;
  // collision warning: projected seconds to rock impact (null = clear) and
  // the last announced countdown tier (re-armed when the vector clears)
  collisionWarnS: number | null;
  collisionTier: number | null;
  // v4.5 active ping. Cooldown gates re-pinging; reveal marks THIS ship as
  // lit up (ID tier to everyone, map-wide, no LOS — you screamed); the
  // grant is what THIS ship's ping bought it: a snapshot of object ids
  // that read TRACK-or-better while pingGrantS runs. A ping FINDS ships,
  // it does not shoot them — the grant deliberately cannot complete a lock.
  pingCooldownS: number;
  pingRevealS: number;
  pingGrantS: number;
  pingGrantShips: Set<ShipId>;
  pingGrantDecoys: Set<number>;
  pingGrantMissiles: Set<number>;
  // Fog of war, per viewer: what MY sensors currently make of the enemy.
  // 0 = no contact, 1 = faint (approximate position, no vector),
  // 2 = track (true position + velocity), 3 = id (+ ship status detail).
  contactTier: 0 | 1 | 2 | 3;
  // tier-1 data texture: a noisy position that refreshes only every
  // FAINT_UPDATE_INTERVAL_S
  faintContact: { x: number; y: number; t: number } | null;
  lastKnownEnemy: { x: number; y: number; facing: number; t: number } | null;
}

// Total missiles aboard: reserve + loaded tubes + missiles mid-reload (a
// reloading tube already contains its missile).
export function missilesAboard(ship: Ship): number {
  return ship.reserve + ship.tubes.filter((t) => t.loaded || t.reload > 0).length;
}

// Thrust the drive actually produces: the setting, or 0 with dry tanks.
// Drones are exempt from propellant (their thrust is signature-only).
export function effectiveThrust(ship: Ship): number {
  if (ship.isDrone) return ship.thrust;
  return ship.propellant > 0 ? ship.thrust : 0;
}

export interface Missile {
  id: number;
  owner: ShipId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  prevX: number;
  prevY: number;
  course: number; // compass deg; guidance steers this, velocity follows it
  speed: number; // ramps from inherited launch speed to MISSILE_MAX_SPEED_MPS
  age: number; // seconds since launch
  launchX: number; // v4.5 arming: the fuse stays inert until the bird is
  launchY: number; // MISSILE_ARMING_DIST_M from this point — point-blank duds
  fuel: number; // engine-on seconds remaining; dry = ballistic (no accel, no turning)
  burning: boolean; // engine state last substep (drives signature)
  // UPLINKED: the launching ship holds lock and feeds the track — the bird
  // flies an intercept and IGNORES decoys. AUTONOMOUS: seeker-only (blind
  // fired, or the uplink was severed — one-way). See HANDOFF-v4.1 §3.
  guidance: "uplinked" | "autonomous";
  cmdBearing: number | null; // blind fire: absolute bearing to steer onto
  // lock: what the seeker is steering at right now (autonomous only; an
  // uplinked bird's target is the mother ship's track)
  lock: { type: "ship"; id: ShipId } | { type: "decoy"; id: number } | null;
}

export interface Decoy {
  id: number;
  owner: ShipId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

// Transient render effects, cleared after each broadcast.
export type Fx =
  | { type: "pdc"; owner: ShipId; x1: number; y1: number; x2: number; y2: number }
  | { type: "boom"; x: number; y: number };

export type SimEvent =
  | { kind: "reject"; ship: ShipId; verb: string; reason: string }
  | { kind: "ack"; ship: ShipId; text: string }
  | { kind: "notice"; ship: ShipId | "all"; text: string; alert?: boolean }
  | { kind: "ui"; ship: ShipId; what: "show_vector" } // client-side overlay triggers
  // persistent client-side overlay toggles (v4.7): pure ui, no sim state.
  // v5 adds ELEMENT values (probe markers, designations), not new events.
  | { kind: "ui"; ship: ShipId; what: "overlay"; element: string; state: "on" | "off" }
  | { kind: "gameover"; winner: ShipId };

// ---------- angle helpers ----------

export function norm360(d: number): number {
  return ((d % 360) + 360) % 360;
}

// shortest signed arc from a to b, in [-180, 180)
export function angDiff(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}

// unit vector for a compass heading (0 = north/+y, clockwise positive)
export function headingVec(deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)];
}

export function bearingTo(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): number {
  return norm360((Math.atan2(toX - fromX, toY - fromY) * 180) / Math.PI);
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Minimum distance between two objects moving linearly over one tick:
// object M goes (mx0,my0)->(mx1,my1), object T goes (tx0,ty0)->(tx1,ty1).
export function segmentMinDist(
  mx0: number, my0: number, mx1: number, my1: number,
  tx0: number, ty0: number, tx1: number, ty1: number
): number {
  const rx = mx0 - tx0;
  const ry = my0 - ty0;
  const dx = (mx1 - mx0) - (tx1 - tx0);
  const dy = (my1 - my0) - (ty1 - ty0);
  const a = dx * dx + dy * dy;
  let t = a > 0 ? -(rx * dx + ry * dy) / a : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(rx + t * dx, ry + t * dy);
}

export function fmtBearing(deg: number): string {
  return String(Math.round(norm360(deg)) % 360).padStart(3, "0");
}

const TUBE_NAMES = ["one", "two", "three", "four"];

// ---------- sim ----------

export class Sim {
  ships = new Map<ShipId, Ship>();
  missiles: Missile[] = [];
  decoys: Decoy[] = [];
  terrain: Terrain;
  tickCount = 0;
  winner: ShipId | null = null;
  private nextId = 1;
  private fx: Fx[] = [];
  private queues = new Map<ShipId, Command[]>();
  // per-viewer set of enemy missile ids already announced as inbound
  private announcedMissiles = new Map<ShipId, Set<number>>();
  // per-viewer set of enemy missile ids visible last sensor pass (drives the
  // "torpedo has gone ballistic — I've lost it" report)
  private prevVisibleMissiles = new Map<ShipId, Set<number>>();
  // per-viewer noisy faint fixes for enemy decoys read as unresolved
  // contacts (strategic deception, HANDOFF-v4.1 §7)
  private decoyFaint = new Map<ShipId, Map<number, { x: number; y: number; t: number }>>();
  // v4.5 hearing: per-listener rumble bookkeeping for XO announcements.
  // `live:false` entries linger so a boundary-flapping rumble can't spam
  // new/lost lines faster than the cooldown. Keyed per emitter cid — the
  // data model stays open to multiple listeners hearing one emitter (v5
  // probes as remote ears).
  private rumbleState = new Map<ShipId, Map<string, { bearing: number; cooldown: number; live: boolean }>>();

  // No seed = empty terrain (headless tests build exact fields by hand);
  // matches always pass one.
  constructor(seed: string | null = null) {
    this.terrain = seed ? generateTerrain(seed) : emptyTerrain();
  }

  // A sensor/lock/seeker ray between two points, blocked by rocks and dust.
  losClear(x1: number, y1: number, x2: number, y2: number): boolean {
    return losClear(x1, y1, x2, y2, this.terrain);
  }

  addShip(id: ShipId, x: number, y: number, facing: number, isDrone = false): Ship {
    const ship: Ship = {
      id,
      x,
      y,
      vx: 0,
      vy: 0,
      facing: norm360(facing),
      thrust: 0,
      goal: null,
      maneuver: null,
      hull: isDrone ? C.DRONE_HULL_POINTS : C.HULL_POINTS,
      // tubes start loaded from the magazine: 6 aboard = 2 loaded + 4 reserve
      reserve: Math.max(0, C.MISSILE_MAGAZINE - C.TUBE_COUNT),
      tubes: Array.from({ length: C.TUBE_COUNT }, () => ({ loaded: true, reload: 0 })),
      decoys: C.DECOY_SUPPLY,
      pdcPosture: "free", // default at spawn
      pdcAmmoS: C.PDC_AMMO_S,
      pdcAmmoTier: 100,
      sigSpikePdc: 0,
      underPdcFire: false,
      propellant: C.PROPELLANT_MAX,
      propellantTier: 100,
      lock: { progress: 0, has: false, grace: 0 },
      prevPainted: "none",
      sigSpikeLaunch: 0,
      pingCooldownS: 0,
      pingRevealS: 0,
      pingGrantS: 0,
      pingGrantShips: new Set(),
      pingGrantDecoys: new Set(),
      pingGrantMissiles: new Set(),
      droneCooldown: 0,
      droneWaypoint: 0,
      droneDodge: 0,
      isDrone,
      standingOrders: [],
      orderCounter: 0,
      wasInsideZone: true, // spawn is well inside the zone
      wasInDust: false,
      collisionWarnS: null,
      collisionTier: null,
      contactTier: 0,
      faintContact: null,
      lastKnownEnemy: null,
    };
    if (isDrone) ship.thrust = C.DRONE_THRUST_PERCENT; // signature only
    this.ships.set(id, ship);
    this.queues.set(id, []);
    this.announcedMissiles.set(id, new Set());
    this.rumbleState.set(id, new Map());
    this.prevVisibleMissiles.set(id, new Set());
    this.decoyFaint.set(id, new Map());
    return ship;
  }

  // Signature follows EFFECTIVE thrust (a tanks-dry ship goes dim) plus
  // transient spikes (missile launch; PDC fire in §6).
  signatureOf(obj: Ship | Decoy): number {
    if (!("thrust" in obj)) return C.DECOY_SIGNATURE;
    let sig = C.SIG_BASE + effectiveThrust(obj);
    if (obj.sigSpikeLaunch > 0) sig += C.SIG_SPIKE_LAUNCH;
    if (obj.sigSpikePdc > 0) sig += C.SIG_SPIKE_PDC;
    return sig;
  }

  // Signature follows the engine: a coasting torpedo nearly vanishes.
  missileSignature(m: Missile): number {
    return m.burning ? C.MISSILE_SIG_BURNING : C.MISSILE_SIG_COASTING;
  }

  // How far away a target of this signature can be seen (LOS permitting).
  detectionRange(signature: number): number {
    return C.SENSOR_BASE_M * (signature / 100);
  }

  // Contact tier this viewer earns on the enemy ship right now. Every
  // detection path requires an unobstructed ray. Outside the region a ship
  // is treated as signature-max: fully detectable at any range, tier ID.
  // v4.5 overlays: a pinger is revealed at ID to EVERYONE (no LOS — the
  // scream carries); a viewer's ping grant holds its targets at TRACK.
  contactTierFor(viewer: Ship, enemy: Ship): 0 | 1 | 2 | 3 {
    if (enemy.pingRevealS > 0) return 3;
    const granted =
      viewer.pingGrantS > 0 && viewer.pingGrantShips.has(enemy.id) ? 2 : 0;
    if (!this.losClear(viewer.x, viewer.y, enemy.x, enemy.y)) return granted as 0 | 2;
    if (!this.insideZone(enemy)) return 3;
    const range = dist(viewer.x, viewer.y, enemy.x, enemy.y);
    const detect = this.detectionRange(this.signatureOf(enemy));
    if (detect <= 0) return granted as 0 | 2;
    const frac = range / detect;
    if (frac <= C.TIER_ID_FRAC) return 3;
    if (frac <= C.TIER_TRACK_FRAC) return 2;
    if (frac <= C.TIER_FAINT_FRAC) return Math.max(1, granted) as 1 | 2;
    return granted as 0 | 2;
  }

  enemyOf(id: ShipId): Ship | undefined {
    return this.ships.get(id === "A" ? "B" : "A");
  }

  enqueue(id: ShipId, commands: Command[]): void {
    this.queues.get(id)?.push(...commands);
  }

  // Apply a single command immediately. Returns null on success, or a
  // rejection reason (XO line) if the server refuses it.
  applyCommand(ship: Ship, cmd: Command, events: SimEvent[]): string | null {
    switch (cmd.verb) {
      case "set_thrust": {
        const pct = Number(cmd.params.percent);
        if (!Number.isFinite(pct)) return "Helm didn't copy that thrust setting.";
        this.cancelManeuver(ship, events);
        ship.thrust = clamp(pct, 0, 100);
        return null;
      }
      case "set_heading": {
        this.cancelManeuver(ship, events);
        const p = cmd.params as unknown as HeadingParams;
        if (p.mode === "relative") {
          const sign = p.direction === "port" ? -1 : 1; // port = CCW
          // keep the turn RELATIVE: direction and magnitude survive, so
          // "starboard 270" goes starboard and "360" is a full rotation
          ship.goal = { mode: "turn", remaining: sign * Math.abs(p.degrees) };
        } else if (p.mode === "absolute") {
          ship.goal = { mode: "absolute", degrees: norm360(p.degrees) };
        } else if (p.mode === "target") {
          // Snapshot: resolve the target's bearing ONCE, now. No continuous
          // tracking — standing orders re-snapshot at each trigger.
          const pos = this.resolveTargetPos(ship, p.target);
          if (!pos) return "No contact to point at, Captain.";
          ship.goal = {
            mode: "absolute",
            degrees: bearingTo(ship.x, ship.y, pos.x, pos.y),
          };
        } else {
          return "Helm didn't copy that heading.";
        }
        return null;
      }
      case "set_pdc": {
        const posture = cmd.params.posture;
        if (posture !== "free" && posture !== "hold") {
          return "PDC posture is 'free' or 'hold', Captain.";
        }
        ship.pdcPosture = posture;
        return null;
      }
      case "maneuver": {
        if (cmd.params.type !== "full_stop") return "Helm doesn't know that maneuver.";
        if (this.speedOf(ship) < 5) return "We're already stopped, Captain.";
        ship.maneuver = { type: "full_stop" };
        if (!ship.isDrone) {
          events.push({ kind: "notice", ship: ship.id, text: "Flipping to kill our velocity." });
        }
        return null;
      }
      case "show_vector": {
        events.push({ kind: "ui", ship: ship.id, what: "show_vector" });
        return null;
      }
      case "set_overlay": {
        // v4.7: toggles a persistent CLIENT overlay. Server-side this is a
        // ui event and nothing else — no sim state, cannot desync.
        const element = cmd.params.element;
        const overlayState = cmd.params.state;
        if (element !== "drift") return "No such overlay, Captain.";
        if (overlayState !== "on" && overlayState !== "off") {
          return "Overlay goes 'on' or 'off', Captain.";
        }
        events.push({ kind: "ui", ship: ship.id, what: "overlay", element, state: overlayState });
        // the ship owns this voice: the stock notice below is the whole
        // confirmation, so a translator ack would double-speak (and burn a
        // dynamic TTS synth). Drop it even if the model supplied one.
        delete cmd.acknowledgement;
        if (!ship.isDrone) {
          // state is state: the marker toggles even when there's nothing to
          // mark yet — the XO just says so instead of parroting "up".
          const text =
            overlayState === "off"
              ? "Drift marker down."
              : this.speedOf(ship) < 5
                ? "We're not drifting anywhere, Captain — nothing to mark yet."
                : "Drift marker up, Captain.";
          events.push({ kind: "notice", ship: ship.id, text });
        }
        return null;
      }
      case "sensor_ping": {
        // v4.5: everything with LOS inside PING_RANGE_M snaps to TRACK for
        // PING_TRACK_S; the price is a map-wide, no-LOS ID reveal of the
        // pinger for PING_REVEAL_S. A ping finds ships; it can't shoot them.
        if (ship.pingCooldownS > 0) {
          return "Transducers recharging, Captain.";
        }
        ship.pingCooldownS = C.PING_COOLDOWN_S;
        ship.pingRevealS = C.PING_REVEAL_S;
        ship.pingGrantS = C.PING_TRACK_S;
        ship.pingGrantShips = new Set();
        ship.pingGrantDecoys = new Set();
        ship.pingGrantMissiles = new Set();
        const insonified = (x: number, y: number) =>
          dist(ship.x, ship.y, x, y) <= C.PING_RANGE_M && this.losClear(ship.x, ship.y, x, y);
        const enemy = this.enemyOf(ship.id);
        if (enemy && insonified(enemy.x, enemy.y)) ship.pingGrantShips.add(enemy.id);
        for (const d of this.decoys) {
          if (d.owner !== ship.id && insonified(d.x, d.y)) ship.pingGrantDecoys.add(d.id);
        }
        for (const m of this.missiles) {
          if (m.owner !== ship.id && insonified(m.x, m.y)) ship.pingGrantMissiles.add(m.id);
        }
        // the scream is heard by everyone, terrain or not
        if (enemy && !enemy.isDrone) {
          events.push({
            kind: "notice",
            ship: enemy.id,
            text: `Active ping — he's lit himself up. Bearing ${fmtBearing(bearingTo(enemy.x, enemy.y, ship.x, ship.y))}.`,
            alert: true,
          });
        }
        return null;
      }
      case "fire_missile": {
        // guidance: "locked" (default; needs a held lock -> UPLINKED bird)
        // or "bearing" (blind fire, no lock -> AUTONOMOUS from birth)
        const blind = cmd.params.guidance === "bearing";
        if (!blind && !ship.lock.has) {
          return "No lock, Captain — I can fire blind on a bearing if you want it.";
        }
        const rawBearing = cmd.params.bearing_degrees;
        const cmdBearing =
          blind && typeof rawBearing === "number" && Number.isFinite(rawBearing)
            ? norm360(rawBearing)
            : null; // blind with no bearing = straight out the nose

        // Which tubes? Explicit list (1-based) or the first ready tube.
        let requested: number[];
        const rawTubes = cmd.params.tubes;
        if (Array.isArray(rawTubes) && rawTubes.length > 0) {
          requested = [...new Set(rawTubes.map(Number))].filter(
            (n) => Number.isInteger(n) && n >= 1 && n <= C.TUBE_COUNT
          );
          if (requested.length === 0) return "Helm didn't copy those tube numbers.";
        } else {
          const first = ship.tubes.findIndex((t) => t.loaded);
          if (first === -1) {
            return ship.tubes.some((t) => t.reload > 0)
              ? "Tubes are still loading, Captain."
              : "Magazine dry, Captain.";
          }
          requested = [first + 1];
        }

        let fired = 0;
        for (const n of requested) {
          const tube = ship.tubes[n - 1];
          if (!tube.loaded) {
            events.push({
              kind: "reject",
              ship: ship.id,
              verb: "fire_missile",
              reason:
                tube.reload > 0
                  ? `Tube ${TUBE_NAMES[n - 1]} is still loading.`
                  : `Tube ${TUBE_NAMES[n - 1]} is empty.`,
            });
            continue;
          }
          this.launchMissile(ship, n, events, blind, cmdBearing);
          fired++;
        }
        if (fired === 0) {
          // every requested tube was rejected above; report overall failure
          // without duplicating the per-tube lines
          return ship.tubes.some((t) => t.reload > 0)
            ? "Tubes are still loading, Captain."
            : "Magazine dry, Captain.";
        }
        // v4.5: a locked target inside arming distance means these birds
        // never fuse on the first pass — warn, once per salvo. Blind fire
        // gets no warning (no known target).
        if (!blind && !ship.isDrone) {
          const tgt = this.enemyOf(ship.id);
          if (tgt && dist(ship.x, ship.y, tgt.x, tgt.y) < C.MISSILE_ARMING_DIST_M) {
            events.push({
              kind: "notice",
              ship: ship.id,
              text: "He's inside arming distance, Captain.",
              alert: true,
            });
          }
        }
        return null;
      }
      case "reload_tubes": {
        if (C.AUTO_RELOAD) return null; // harmless no-op — "Already on it"
        // Manual-reload doctrine is out of scope while AUTO_RELOAD is true;
        // the verb exists so the command vocabulary survives a future flip.
        return null;
      }
      case "deploy_decoy": {
        if (ship.decoys <= 0) return "No decoys left, Captain.";
        ship.decoys--;
        const driftAngle = Math.random() * Math.PI * 2;
        this.decoys.push({
          id: this.nextId++,
          owner: ship.id,
          x: ship.x,
          y: ship.y,
          vx: ship.vx + Math.cos(driftAngle) * C.DECOY_DRIFT_MPS,
          vy: ship.vy + Math.sin(driftAngle) * C.DECOY_DRIFT_MPS,
          age: 0,
        });
        return null;
      }
      case "set_standing_order": {
        const p = cmd.params;

        // cancellation form
        if (typeof p.cancel_label === "string" && !p.condition && !p.actions) {
          if (p.cancel_label.toLowerCase() === "all") {
            if (ship.standingOrders.length === 0)
              return "No standing orders on the books, Captain.";
            ship.standingOrders = [];
            return null;
          }
          const idx = ship.standingOrders.findIndex(
            (o) => o.label.toLowerCase() === String(p.cancel_label).toLowerCase()
          );
          if (idx === -1)
            return `No standing order named '${p.cancel_label}', Captain.`;
          ship.standingOrders.splice(idx, 1);
          return null;
        }

        // creation form — validate defensively (the dev harness bypasses the
        // translator's validator)
        if (!p.condition || !Array.isArray(p.actions) || p.actions.length < 1)
          return "That standing order didn't parse, Captain.";
        const actions = p.actions as Command[];
        if (actions.length > 3 || actions.some((a) => !a || typeof a.verb !== "string"))
          return "That standing order didn't parse, Captain.";
        if (actions.some((a) => a.verb === "set_standing_order"))
          return "Can't nest standing orders, Captain.";

        const label =
          typeof p.label === "string" && p.label.trim()
            ? p.label.trim()
            : `order ${++ship.orderCounter}`;
        const order: StandingOrder = {
          label,
          condition: p.condition as Condition,
          actions,
          repeat: p.repeat === true,
          cooldown: 0,
        };
        // re-issuing an existing label replaces it; otherwise enforce the cap
        const existing = ship.standingOrders.findIndex(
          (o) => o.label.toLowerCase() === label.toLowerCase()
        );
        if (existing >= 0) {
          ship.standingOrders[existing] = order;
        } else {
          if (ship.standingOrders.length >= C.STANDING_ORDER_MAX)
            return `Standing order book is full (${C.STANDING_ORDER_MAX}), Captain. Belay one first.`;
          ship.standingOrders.push(order);
        }
        return null;
      }
      case "query":
        return null; // handled outside the sim
      default:
        return "Unknown order.";
    }
  }

  // Fire one missile out of tube `tubeNo` (1-based; caller checked loaded).
  // Model (b): guidance steers the velocity vector; speed ramps from the
  // ship's forward momentum at launch up to MISSILE_MAX_SPEED_MPS. Course
  // starts along the ship's facing (nose-launched); a blind bird then
  // steers itself onto its commanded bearing.
  private launchMissile(
    ship: Ship,
    tubeNo: number,
    events: SimEvent[],
    blind = false,
    cmdBearing: number | null = null
  ): void {
    const tube = ship.tubes[tubeNo - 1];
    tube.loaded = false;
    const [fx, fy] = headingVec(ship.facing);
    const inherited = clamp(ship.vx * fx + ship.vy * fy, 0, C.MISSILE_MAX_SPEED_MPS);
    const enemyId: ShipId = ship.id === "A" ? "B" : "A";
    this.missiles.push({
      id: this.nextId++,
      owner: ship.id,
      x: ship.x,
      y: ship.y,
      prevX: ship.x,
      prevY: ship.y,
      launchX: ship.x,
      launchY: ship.y,
      course: ship.facing,
      speed: inherited,
      vx: fx * inherited,
      vy: fy * inherited,
      age: 0,
      fuel: C.MISSILE_PROPELLANT_S,
      burning: true,
      guidance: blind ? "autonomous" : "uplinked",
      cmdBearing: blind ? cmdBearing : null,
      lock: blind ? null : { type: "ship", id: enemyId },
    });
    if (blind && !ship.isDrone) {
      events.push({ kind: "notice", ship: ship.id, text: "Bird away, running blind." });
    }

    // Launch flash: a +SIG_SPIKE_LAUNCH signature spike. The distinct XO
    // notice fires iff the spike actually makes the launcher detectable
    // (LOS and range willing) to the victim right now.
    ship.sigSpikeLaunch = C.SIG_SPIKE_LAUNCH_S;
    const enemy = this.enemyOf(ship.id);
    if (enemy && !enemy.isDrone && this.contactTierFor(enemy, ship) >= 1) {
      events.push({
        kind: "notice",
        ship: enemy.id,
        text: `Launch flash detected — bearing ${fmtBearing(bearingTo(enemy.x, enemy.y, ship.x, ship.y))}!`,
        alert: true,
      });
    }

    if (C.AUTO_RELOAD && ship.reserve > 0) {
      ship.reserve--;
      tube.reload = C.TUBE_RELOAD_S;
      if (!ship.isDrone) {
        events.push({
          kind: "notice",
          ship: ship.id,
          text: `Tube ${TUBE_NAMES[tubeNo - 1]} reloading.`,
        });
      }
    } else if (missilesAboard(ship) === 0 && !ship.isDrone) {
      events.push({ kind: "notice", ship: ship.id, text: "Magazine dry, Captain.", alert: true });
    }
  }

  // ---------- standing orders ----------

  // Metric value as THIS ship's sensors know it. null = unknowable through
  // the fog right now; comparisons on unknowable metrics are false.
  private metricValue(ship: Ship, metric: string): number | boolean | null {
    switch (metric) {
      case "enemy_range": {
        // range data is earned at TIER_TRACK; a faint contact is unknowable
        const e = this.enemyOf(ship.id);
        if (!e || ship.contactTier < 2) return null;
        return dist(ship.x, ship.y, e.x, e.y);
      }
      case "enemy_contact_tier":
        return ship.contactTier;
      case "in_dust":
        return this.inDust(ship);
      case "rumble_present":
        return this.rumblesFor(ship).length > 0;
      case "collision_warning":
        return ship.collisionWarnS !== null;
      case "missile_inbound":
        return this.visibleEnemyMissiles(ship).length > 0;
      case "nearest_missile_range": {
        const nearest = this.nearestOf(ship, this.visibleEnemyMissiles(ship));
        return nearest ? dist(ship.x, ship.y, nearest.x, nearest.y) : null;
      }
      case "own_hull_percent":
        return (ship.hull / (ship.isDrone ? C.DRONE_HULL_POINTS : C.HULL_POINTS)) * 100;
      case "own_speed":
        return this.speedOf(ship);
      case "own_missiles_remaining":
        return missilesAboard(ship);
      case "own_decoys_remaining":
        return ship.decoys;
      case "have_lock":
        return ship.lock.has;
      case "being_painted":
        return this.paintedState(ship) !== "none";
      case "propellant_percent":
        return (ship.propellant / C.PROPELLANT_MAX) * 100;
      case "pdc_ammo_seconds":
        return ship.pdcAmmoS;
      case "tubes_ready":
        return ship.tubes.filter((t) => t.loaded).length;
      case "enemy_bearing_off_nose": {
        const e = this.enemyOf(ship.id);
        if (!e || ship.contactTier < 2) return null;
        return Math.abs(angDiff(ship.facing, bearingTo(ship.x, ship.y, e.x, e.y)));
      }
      case "distance_from_zone_center":
        return dist(ship.x, ship.y, 0, 0);
      case "time_elapsed_seconds":
        return this.tickCount / C.TICK_RATE_HZ;
      default:
        return null;
    }
  }

  private evalComparison(ship: Ship, c: Comparison): boolean {
    if (!c || typeof c.metric !== "string") return false;
    const v = this.metricValue(ship, c.metric);
    if (v === null) return false;
    if (typeof v === "boolean") {
      return c.op === "eq" ? v === c.value : false;
    }
    if (typeof c.value !== "number") return false;
    switch (c.op) {
      case "lt": return v < c.value;
      case "lte": return v <= c.value;
      case "gt": return v > c.value;
      case "gte": return v >= c.value;
      case "eq": return v === c.value;
      default: return false;
    }
  }

  private evalCondition(ship: Ship, cond: Condition): boolean {
    if (!cond || typeof cond !== "object") return false;
    if ("all" in cond && Array.isArray(cond.all)) {
      return cond.all.length > 0 && cond.all.every((c) => this.evalComparison(ship, c));
    }
    if ("any" in cond && Array.isArray(cond.any)) {
      return cond.any.some((c) => this.evalComparison(ship, c));
    }
    return this.evalComparison(ship, cond as Comparison);
  }

  private evaluateStandingOrders(ship: Ship, events: SimEvent[], dt: number): void {
    for (const order of [...ship.standingOrders]) {
      if (order.cooldown > 0) {
        order.cooldown = Math.max(0, order.cooldown - dt);
        continue;
      }
      if (!this.evalCondition(ship, order.condition)) continue;
      events.push({
        kind: "notice",
        ship: ship.id,
        text: `Standing order '${order.label}' triggered.`,
      });
      // execute actions in sequence, exactly as if the captain issued them
      for (const action of order.actions) {
        const reason = this.applyCommand(ship, action, events);
        if (reason) {
          events.push({ kind: "reject", ship: ship.id, verb: action.verb, reason });
        } else if (action.acknowledgement) {
          events.push({ kind: "ack", ship: ship.id, text: action.acknowledgement });
        }
      }
      if (order.repeat) {
        order.cooldown = C.STANDING_ORDER_RETRIGGER_COOLDOWN_S;
      } else {
        const idx = ship.standingOrders.indexOf(order);
        if (idx >= 0) ship.standingOrders.splice(idx, 1);
      }
    }
  }

  // Automated point defense, evaluated per substep. While FREE (and fed):
  // (a) each inbound enemy missile within PDC_RANGE_M with LOS suffers a
  // substep-scaled kill probability; (b) an enemy SHIP within
  // PDC_SHIP_RANGE_M with LOS takes continuous hull damage. Never targets
  // decoys or terrain. Firing costs ammo (cumulative seconds) and spikes
  // signature. Weapon types are modular by design — v5 adds a railgun here.
  private stepPdc(ship: Ship, deadMissiles: Set<number>, events: SimEvent[], dt: number): void {
    if (ship.pdcPosture !== "free" || ship.pdcAmmoS <= 0 || this.winner) return;
    let firing = false;

    // (a) inbound missiles. SENSOR-SLAVED: the mount shares the ship's
    // sensor picture — it can only engage ordnance the ship currently
    // detects (signature detection range + LOS). A ballistic torpedo
    // arriving from sensor shadow may never be engaged. Intended.
    for (const m of this.missiles) {
      if (m.owner === ship.id || deadMissiles.has(m.id)) continue;
      const range = dist(ship.x, ship.y, m.x, m.y);
      if (range > C.PDC_RANGE_M) continue;
      if (range > this.detectionRange(this.missileSignature(m))) continue;
      if (!this.losClear(ship.x, ship.y, m.x, m.y)) continue;
      firing = true;
      this.fx.push({ type: "pdc", owner: ship.id, x1: ship.x, y1: ship.y, x2: m.x, y2: m.y });
      if (Math.random() < C.PDC_KILL_PROB_PER_S * dt) {
        deadMissiles.add(m.id);
        this.fx.push({ type: "boom", x: m.x, y: m.y });
        events.push({ kind: "notice", ship: ship.id, text: "PDC splash — missile destroyed." });
        events.push({ kind: "notice", ship: m.owner, text: "Their point defense got our missile." });
      }
    }

    // (b) enemy ship at knife range
    const enemy = this.enemyOf(ship.id);
    if (
      enemy &&
      dist(ship.x, ship.y, enemy.x, enemy.y) <= C.PDC_SHIP_RANGE_M &&
      this.losClear(ship.x, ship.y, enemy.x, enemy.y)
    ) {
      firing = true;
      this.fx.push({ type: "pdc", owner: ship.id, x1: ship.x, y1: ship.y, x2: enemy.x, y2: enemy.y });
      if (!enemy.underPdcFire) {
        enemy.underPdcFire = true;
        if (!enemy.isDrone) {
          events.push({
            kind: "notice",
            ship: enemy.id,
            text: "We're inside their PDC envelope — taking fire!",
            alert: true,
          });
        }
        if (!ship.isDrone) {
          events.push({ kind: "notice", ship: ship.id, text: "PDCs are chewing on their hull, Captain." });
        }
      }
      enemy.hull = Math.max(0, enemy.hull - C.PDC_SHIP_DPS * dt);
      if (enemy.hull <= 0 && !this.winner) {
        this.winner = ship.id;
        events.push({ kind: "gameover", winner: ship.id });
      }
    } else if (enemy && enemy.underPdcFire) {
      // our guns stopped bearing on them; re-arm the edge notice
      enemy.underPdcFire = false;
    }

    if (firing) {
      ship.pdcAmmoS = Math.max(0, ship.pdcAmmoS - dt);
      ship.sigSpikePdc = C.SIG_SPIKE_PDC_S;
      this.announcePdcAmmo(ship, events);
    }
  }

  // Ammo warnings at falling 50/25/10/0 percent, re-armed never (no regen).
  private announcePdcAmmo(ship: Ship, events: SimEvent[]): void {
    if (ship.isDrone) return;
    const pct = (ship.pdcAmmoS / C.PDC_AMMO_S) * 100;
    const tier = pct <= 0 ? 0 : pct <= 10 ? 10 : pct <= 25 ? 25 : pct <= 50 ? 50 : 100;
    if (tier < ship.pdcAmmoTier) {
      const lines: Record<number, [string, boolean]> = {
        50: ["PDC ammunition at one-half.", false],
        25: ["PDC ammunition at one-quarter, Captain.", false],
        10: ["PDC ammunition critical — ten percent.", true],
        0: ["PDC magazines dry, Captain.", true],
      };
      const [text, alert] = lines[tier];
      events.push({ kind: "notice", ship: ship.id, text, alert });
    }
    ship.pdcAmmoTier = tier;
  }

  private damageShip(
    target: Ship,
    amount: number,
    source: "missile" | "rock",
    events: SimEvent[]
  ): void {
    if (this.winner) return;
    target.hull = Math.max(0, target.hull - amount);
    const attackerId: ShipId = target.id === "A" ? "B" : "A";
    if (source !== "rock") {
      // terrain kills credit the survivor, but nobody "scored" the hit
      events.push({
        kind: "notice",
        ship: attackerId,
        text: "Missile strike on the enemy ship!",
      });
    }
    const word = source === "missile" ? "Missile strike" : "Collision";
    events.push({
      kind: "notice",
      ship: target.id,
      text: `${word} — hull at ${target.hull}!`,
      alert: true,
    });
    if (target.hull <= 0) {
      this.winner = attackerId;
      events.push({ kind: "gameover", winner: attackerId });
    }
  }

  // The heading the helm is steering toward (turn goals report their
  // end-point). Used for state summaries; the physics loop steps the two
  // goal modes itself.
  private resolveGoal(ship: Ship): number | null {
    if (!ship.goal) return null;
    if (ship.goal.mode === "turn") return norm360(ship.facing + ship.goal.remaining);
    return ship.goal.degrees;
  }

  // Enemy ordnance uses the same detection math as ships, via its own
  // signature (no flat ordnance radius). A burning torpedo is visible far
  // out; a coasting one (§5) nearly vanishes. LOS gates as always.
  private visibleEnemyMissiles(ship: Ship): Missile[] {
    return this.missiles.filter(
      (m) =>
        m.owner !== ship.id &&
        ((ship.pingGrantS > 0 && ship.pingGrantMissiles.has(m.id)) || // pinged: a coasting bird shows for the window
          (dist(ship.x, ship.y, m.x, m.y) <= this.detectionRange(this.missileSignature(m)) &&
            this.losClear(ship.x, ship.y, m.x, m.y)))
    );
  }

  // Contact tier this viewer earns on an enemy decoy. At faint/track a
  // decoy is an ordinary unresolved contact — indistinguishable from a
  // quietly cruising ship; only at ID does it resolve as a decoy.
  decoyTierFor(viewer: Ship, d: Decoy): 0 | 1 | 2 | 3 {
    // a ping grant holds decoys at TRACK too — where they still read as
    // ordinary contacts (a ping never resolves a decoy; that stays ID-only)
    const granted =
      viewer.pingGrantS > 0 && viewer.pingGrantDecoys.has(d.id) ? 2 : 0;
    if (!this.losClear(viewer.x, viewer.y, d.x, d.y)) return granted as 0 | 2;
    const frac = dist(viewer.x, viewer.y, d.x, d.y) / this.detectionRange(C.DECOY_SIGNATURE);
    if (frac <= C.TIER_ID_FRAC) return 3;
    if (frac <= C.TIER_TRACK_FRAC) return 2;
    if (frac <= C.TIER_FAINT_FRAC) return Math.max(1, granted) as 1 | 2;
    return granted as 0 | 2;
  }

  // v4.5 hearing channel: emitters this ship HEARS but cannot see — beyond
  // detection (or LOS-blocked) yet inside hearing_range = detection x
  // HEARING_RANGE_MULT. Terrain does NOT block hearing (the shroud carries
  // drive rumble the way water carries sound); only distance vs signature
  // matters, and the system is CONTINUOUS — no thresholds anywhere (design
  // law: a threshold becomes a throttle policy). Fog invariant, strictly:
  // a rumble carries bearing (+ a loudness scalar for the client's audio,
  // which is signature-derived, never range-derived) — NO position, NO
  // range, NO vector, NO tier. Decoys rumble exactly like ships (invariant
  // 11: nothing may unmask a decoy below ID tier — a silent "contact"
  // would).
  rumblesFor(ship: Ship): { cid: string; bearing: number; loud: number }[] {
    const out: { cid: string; bearing: number; loud: number }[] = [];
    const hear = (x: number, y: number, sig: number, cid: string) => {
      if (dist(ship.x, ship.y, x, y) <= this.detectionRange(sig) * C.HEARING_RANGE_MULT) {
        out.push({
          cid,
          bearing: Math.round(norm360(bearingTo(ship.x, ship.y, x, y))) % 360, // 359.6 rounds to 360 -> wrap to 000
          loud: Math.min(1, sig / 150),
        });
      }
    };
    const enemy = this.enemyOf(ship.id);
    if (enemy && ship.contactTier === 0) {
      hear(enemy.x, enemy.y, this.signatureOf(enemy), "s1");
    }
    for (const d of this.decoys) {
      if (d.owner === ship.id) continue;
      if (this.decoyTierFor(ship, d) === 0) hear(d.x, d.y, C.DECOY_SIGNATURE, `d${d.id}`);
    }
    return out;
  }

  // XO rumble announcements: new rumbles, bearing drifts past
  // RUMBLE_SHIFT_ANNOUNCE_DEG, and fades — rate-limited per emitter. A
  // rumble that hardens into a CONTACT fades silently (the tier notice is
  // the announcement — seamless handoff, never a double contact).
  private updateRumbles(ship: Ship, events: SimEvent[]): void {
    if (ship.isDrone) return;
    const state = this.rumbleState.get(ship.id)!;
    for (const st of state.values()) st.cooldown = Math.max(0, st.cooldown - 1 / C.TICK_RATE_HZ);
    const current = this.rumblesFor(ship);
    const liveIds = new Set(current.map((r) => r.cid));

    // Spoken bearings quantize to 10° — a rumble is vague by nature, and
    // exact bearings made every announcement a UNIQUE string, each one a
    // fresh ElevenLabs synthesis (the playtest burned the whole TTS quota
    // in a day). 36 buckets x 2 line shapes cache to disk once, forever.
    // Internal drift tracking stays exact; the chevron shows the true bearing.
    const spoken = (b: number) => fmtBearing((Math.round(b / 10) * 10) % 360);
    for (const r of current) {
      const st = state.get(r.cid);
      if (!st || (!st.live && st.cooldown <= 0)) {
        state.set(r.cid, { bearing: r.bearing, cooldown: C.RUMBLE_ANNOUNCE_COOLDOWN_S, live: true });
        events.push({
          kind: "notice",
          ship: ship.id,
          text: `Drive rumble, bearing ${spoken(r.bearing)}.`,
        });
      } else if (
        st.live &&
        st.cooldown <= 0 &&
        Math.abs(angDiff(st.bearing, r.bearing)) > C.RUMBLE_SHIFT_ANNOUNCE_DEG
      ) {
        st.bearing = r.bearing;
        st.cooldown = C.RUMBLE_ANNOUNCE_COOLDOWN_S;
        events.push({
          kind: "notice",
          ship: ship.id,
          text: `That rumble's drifted to ${spoken(r.bearing)}.`,
        });
      } else if (!st.live) {
        st.live = true; // back within cooldown: resume silently
        st.bearing = r.bearing;
      }
    }

    for (const [cid, st] of state) {
      if (liveIds.has(cid)) continue;
      if (!st.live) {
        if (st.cooldown <= 0) state.delete(cid); // expired ghost entry
        continue;
      }
      st.live = false;
      // silent when it hardened into a contact (rumble -> faint handoff)
      const becameContact =
        cid === "s1"
          ? ship.contactTier >= 1
          : this.decoys.some(
              (d) => `d${d.id}` === cid && this.decoyTierFor(ship, d) >= 1
            );
      if (!becameContact) {
        st.cooldown = C.RUMBLE_ANNOUNCE_COOLDOWN_S;
        events.push({ kind: "notice", ship: ship.id, text: "Lost the rumble." });
      }
    }
  }

  // Enemy decoys RESOLVED as decoys (ID tier) — what the helm may point at
  // and what the snapshot labels as a decoy.
  private visibleEnemyDecoys(ship: Ship): Decoy[] {
    return this.decoys.filter(
      (d) => d.owner !== ship.id && this.decoyTierFor(ship, d) === 3
    );
  }

  // Refresh this viewer's noisy faint fixes for unresolved enemy decoys
  // (sensor phase, 1 Hz — same cadence and noise as ship faint contacts).
  private updateDecoyContacts(ship: Ship): void {
    const cache = this.decoyFaint.get(ship.id)!;
    const live = new Set<number>();
    for (const d of this.decoys) {
      if (d.owner === ship.id) continue;
      if (this.decoyTierFor(ship, d) !== 1) continue;
      live.add(d.id);
      const fix = cache.get(d.id);
      if (!fix || this.tickCount - fix.t >= C.FAINT_UPDATE_INTERVAL_S * C.TICK_RATE_HZ) {
        const ang = Math.random() * Math.PI * 2;
        const noise = Math.random() * C.FAINT_POS_NOISE_M;
        cache.set(d.id, {
          x: d.x + Math.cos(ang) * noise,
          y: d.y + Math.sin(ang) * noise,
          t: this.tickCount,
        });
      }
    }
    for (const id of cache.keys()) {
      if (!live.has(id)) cache.delete(id);
    }
  }

  private nearestOf<T extends { x: number; y: number }>(ship: Ship, list: T[]): T | null {
    let best: T | null = null;
    let bestD = Infinity;
    for (const o of list) {
      const d = dist(ship.x, ship.y, o.x, o.y);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  // Fog-aware: the helm steers by what the sensors show — true position at
  // track or better, the noisy faint fix at tier 1, last-known otherwise.
  protected resolveTargetPos(
    ship: Ship,
    target: TargetKind
  ): { x: number; y: number } | null {
    const enemyShipPos = (): { x: number; y: number } | null => {
      const enemy = this.enemyOf(ship.id);
      if (enemy && ship.contactTier >= 2) return { x: enemy.x, y: enemy.y };
      if (ship.contactTier === 1 && ship.faintContact) {
        return { x: ship.faintContact.x, y: ship.faintContact.y };
      }
      if (ship.lastKnownEnemy) {
        return { x: ship.lastKnownEnemy.x, y: ship.lastKnownEnemy.y };
      }
      return null;
    };
    switch (target) {
      case "enemy_ship":
        return enemyShipPos();
      case "nearest_missile":
        return this.nearestOf(ship, this.visibleEnemyMissiles(ship));
      case "nearest_decoy":
        return this.nearestOf(ship, this.visibleEnemyDecoys(ship));
      case "nearest_contact": {
        // the enemy ship if we hold any live contact, else nearest visible
        // ordnance, else last-known ship position
        if (ship.contactTier >= 1) return enemyShipPos();
        const ordnance = this.nearestOf(ship, [
          ...this.visibleEnemyMissiles(ship),
          ...this.visibleEnemyDecoys(ship),
        ]);
        return ordnance ?? enemyShipPos();
      }
    }
  }

  // One full command tick (1 second of game time). Tests and any turn-based
  // caller use this; the live match drives step() directly at substep rate.
  tick(): SimEvent[] {
    const events: SimEvent[] = [];
    for (let i = 0; i < C.PHYSICS_SUBSTEPS; i++) this.step(events);
    return events;
  }

  // Substep phase within the current command tick: 0 runs the command phase
  // first; wrapping back to 0 runs the sensor phase last.
  private phase = 0;

  // One physics substep (1 / (TICK_RATE_HZ * PHYSICS_SUBSTEPS) seconds).
  // Commands, standing orders, and drone decisions run at TICK_RATE_HZ on
  // the first substep of each tick; physics and weapon resolution run every
  // substep (swept-segment fuses need fine-grained motion at v4 speeds);
  // sensors/locks/painted re-evaluate at TICK_RATE_HZ on the last.
  step(events: SimEvent[]): void {
    const tickDt = 1 / C.TICK_RATE_HZ;
    const dt = tickDt / C.PHYSICS_SUBSTEPS;

    if (this.phase === 0) {
      this.tickCount++;

      // 1. drone behavior (fires on last tick's lock state), then standing
      // orders against each player's sensor picture
      for (const ship of this.ships.values()) {
        this.droneAct(ship, events, tickDt);
        this.evaluateStandingOrders(ship, events, tickDt);
      }

      // 2. execute queued commands (missiles/decoys spawn here)
      for (const [id, queue] of this.queues) {
        const ship = this.ships.get(id);
        if (!ship) continue;
        for (const cmd of queue.splice(0)) {
          const reason = this.applyCommand(ship, cmd, events);
          if (reason) {
            events.push({ kind: "reject", ship: id, verb: cmd.verb, reason });
          } else if (cmd.acknowledgement) {
            // acknowledgements go out only for commands that actually executed
            events.push({ kind: "ack", ship: id, text: cmd.acknowledgement });
          }
        }
      }
    }

    // 3. step physics (also: propellant, tube reloads, flash countdown)
    for (const ship of this.ships.values()) {
      this.stepShip(ship, events, dt);
      this.applyBounds(ship, events, dt);
    }
    for (const m of this.missiles) {
      this.stepMissile(m, dt);
    }
    for (const d of this.decoys) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.age += dt;
    }

    // 4. resolve weapons: proximity fuses, expiry, seeker locks
    this.resolveWeapons(events, dt);

    this.phase = (this.phase + 1) % C.PHYSICS_SUBSTEPS;
    if (this.phase !== 0) return;

    // 5. sensors: per-viewer enemy visibility, last-known tracking, contact
    // notices; then ship-to-ship missile locks (needs fresh visibility) and
    // painted warnings (needs both locks updated)
    for (const ship of this.ships.values()) {
      this.updateSensors(ship, events);
      this.updateDecoyContacts(ship);
      this.updateRumbles(ship, events); // after tiers refresh: handoff needs fresh contactTier
      this.announceInboundMissiles(ship, events);
      this.updateCollisionWarning(ship, events);
      this.announceDust(ship, events);
    }
    for (const ship of this.ships.values()) {
      this.updateLock(ship, events, tickDt);
    }
    for (const ship of this.ships.values()) {
      this.announcePainted(ship, events);
    }
  }

  // Drone patrol steering: degrees-per-second to apply this substep.
  // Waypoints cycle through the terrain features (rocks, dust centers,
  // region center); a projected rock impact overrides with a hard dodge.
  private droneSteer(ship: Ship): number {
    if (this.terrain.rocks.length === 0) return C.DRONE_TURN_RATE_DPS; // legacy circle

    // rock-aware: dodge first, with a padded hit test (the ray is the
    // drone's center line; grazing arcs clip rocks the raw ray misses).
    // The dodge direction COMMITS until the path clears (hysteresis) —
    // re-picking per substep oscillates and wedges the drone on a face.
    const lookX = ship.x + ship.vx * C.DRONE_AVOID_LOOKAHEAD_S;
    const lookY = ship.y + ship.vy * C.DRONE_AVOID_LOOKAHEAD_S;
    let aheadRock: Rock | null = null;
    let aheadT = Infinity;
    for (const rock of this.terrain.rocks) {
      const t = segCircleHitT(ship.x, ship.y, lookX, lookY, rock.x, rock.y, rock.r + 1500);
      if (t !== null && t < aheadT) {
        aheadT = t;
        aheadRock = rock;
      }
    }
    if (aheadRock) {
      if (ship.droneDodge === 0) {
        const away = angDiff(ship.facing, bearingTo(ship.x, ship.y, aheadRock.x, aheadRock.y));
        ship.droneDodge = away >= 0 ? -1 : 1;
      }
      return ship.droneDodge * 2 * C.DRONE_PATROL_TURN_DPS;
    }
    ship.droneDodge = 0;

    // Waypoint route: a SKIM POINT off each rock's flank (never the rock
    // body itself — the patrol weaves the field close enough that pursuers
    // lose LOS behind it), the dust centers, then the region center.
    const skim = (r: Rock, i: number): { x: number; y: number; arrive: number } => {
      const side = i % 2 === 0 ? Math.PI / 2 : -Math.PI / 2;
      const ang = Math.atan2(r.y, r.x) + side;
      return {
        x: r.x + Math.cos(ang) * (r.r + C.DRONE_ROCK_SKIM_M),
        y: r.y + Math.sin(ang) * (r.r + C.DRONE_ROCK_SKIM_M),
        arrive: C.DRONE_ROCK_SKIM_M * 1.5,
      };
    };
    const route: { x: number; y: number; arrive: number }[] = [
      ...this.terrain.rocks.map(skim),
      ...this.terrain.dust.map((d) => ({ x: d.x, y: d.y, arrive: C.DRONE_WAYPOINT_RADIUS_M })),
      { x: 0, y: 0, arrive: C.DRONE_WAYPOINT_RADIUS_M },
    ];
    const wp = route[ship.droneWaypoint % route.length];
    if (dist(ship.x, ship.y, wp.x, wp.y) < wp.arrive) {
      // seeded-enough hop: stride by a prime so the tour mixes
      ship.droneWaypoint = (ship.droneWaypoint + 7) % route.length;
    }
    const want = bearingTo(ship.x, ship.y, wp.x, wp.y);
    return clamp(angDiff(ship.facing, want), -C.DRONE_PATROL_TURN_DPS, C.DRONE_PATROL_TURN_DPS);
  }

  // Practice drone offense: with a held lock, a loaded tube, and its
  // cooldown elapsed, it fires ONE missile (reduced aggression).
  private droneAct(ship: Ship, events: SimEvent[], dt: number): void {
    if (!ship.isDrone || !C.DRONE_FIRES_BACK || this.winner) return;
    ship.droneCooldown = Math.max(0, ship.droneCooldown - dt);
    if (ship.droneCooldown > 0) return;
    if (!ship.lock.has || !ship.tubes.some((t) => t.loaded)) return;
    const reason = this.applyCommand(ship, { verb: "fire_missile", params: {} }, events);
    if (!reason) ship.droneCooldown = C.DRONE_MISSILE_COOLDOWN_S;
  }

  // Burn-and-coast: while fuel remains, guidance steers the course (clamped
  // to MISSILE_TURN_RATE) and the engine pushes toward max speed. The engine
  // is ON iff fuel > 0 AND (below max speed OR turning); engine-on drains
  // fuel at 1/s. Dry = ballistic: no acceleration, no turning — it flies its
  // line, still lethal on prox.
  //
  // What the guidance steers at:
  //  - UPLINKED: an intercept point led off the mother ship's live track
  //    (position + velocity), regardless of the bird's own seeker.
  //  - AUTONOMOUS with a seeker target: direct pursuit of that target.
  //  - AUTONOMOUS with no target: the commanded blind-fire bearing, if any
  //    (a target-less bird holds course — it may still acquire later).
  private stepMissile(m: Missile, dt: number): void {
    m.prevX = m.x;
    m.prevY = m.y;

    let turning = false;
    if (m.fuel > 0 && m.age >= C.MISSILE_LAUNCH_DELAY_TICKS / C.TICK_RATE_HZ) {
      let want: number | null = null;
      if (m.guidance === "uplinked") {
        const target = this.ships.get(m.owner === "A" ? "B" : "A");
        if (target) want = this.interceptBearing(m, target);
      } else if (m.lock) {
        const target = this.lockPos(m.lock);
        if (target) want = bearingTo(m.x, m.y, target.x, target.y);
      } else if (m.cmdBearing !== null) {
        want = m.cmdBearing;
      }
      if (want !== null) {
        const diff = angDiff(m.course, want);
        if (Math.abs(diff) > 0.1) turning = true;
        const step = clamp(diff, -C.MISSILE_TURN_RATE_DPS * dt, C.MISSILE_TURN_RATE_DPS * dt);
        m.course = norm360(m.course + step);
      }
    }

    m.burning = m.fuel > 0 && (m.speed < C.MISSILE_MAX_SPEED_MPS || turning);
    if (m.burning) {
      m.speed = Math.min(m.speed + C.MISSILE_ACCEL_MPS2 * dt, C.MISSILE_MAX_SPEED_MPS);
      m.fuel = Math.max(0, m.fuel - dt);
    }

    const [nx, ny] = headingVec(m.course);
    m.vx = nx * m.speed;
    m.vy = ny * m.speed;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    m.age += dt;
  }

  // Lead pursuit: bearing to the point where target and missile meet,
  // assuming both hold velocity. Falls back to direct pursuit when no
  // positive-time solution exists.
  private interceptBearing(m: Missile, target: Ship): number {
    const rx = target.x - m.x;
    const ry = target.y - m.y;
    const s = Math.max(m.speed, C.MISSILE_ACCEL_MPS2); // ramping birds still lead
    const a = target.vx * target.vx + target.vy * target.vy - s * s;
    const b = 2 * (rx * target.vx + ry * target.vy);
    const c = rx * rx + ry * ry;
    let t: number | null = null;
    if (Math.abs(a) < 1e-6) {
      if (Math.abs(b) > 1e-9) {
        const t0 = -c / b;
        if (t0 > 0) t = t0;
      }
    } else {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        const roots = [(-b - sq) / (2 * a), (-b + sq) / (2 * a)].filter((r) => r > 0);
        if (roots.length > 0) t = Math.min(...roots);
      }
    }
    if (t === null || t > C.MISSILE_LIFETIME_S) {
      return bearingTo(m.x, m.y, target.x, target.y);
    }
    return bearingTo(m.x, m.y, target.x + target.vx * t, target.y + target.vy * t);
  }

  // ---------- ship-to-ship missile lock ----------

  // My lock on the enemy: needs cone + range + TIER_TRACK OR BETTER held for
  // LOCK_TIME_S continuous seconds; LOCK_GRACE_S forgives brief breaks.
  // (A faint contact cannot be locked — close in or provoke a burn first.)
  private updateLock(ship: Ship, events: SimEvent[], dt: number): void {
    const enemy = this.enemyOf(ship.id);
    const L = ship.lock;
    let holding = false;
    if (enemy && ship.contactTier >= 2) {
      const range = dist(ship.x, ship.y, enemy.x, enemy.y);
      const off = Math.abs(angDiff(ship.facing, bearingTo(ship.x, ship.y, enemy.x, enemy.y)));
      holding = range <= C.LOCK_RANGE_M && off <= C.LOCK_CONE_HALF_ANGLE_DEG;
    }

    if (holding) {
      L.grace = C.LOCK_GRACE_S;
      if (!L.has) {
        if (L.progress === 0 && !ship.isDrone) {
          events.push({ kind: "notice", ship: ship.id, text: "Acquiring missile lock..." });
        }
        L.progress += dt;
        if (L.progress >= C.LOCK_TIME_S) {
          L.has = true;
          if (!ship.isDrone) {
            events.push({ kind: "notice", ship: ship.id, text: "Lock acquired." });
          }
        }
      }
    } else if (L.has || L.progress > 0) {
      L.grace -= dt;
      if (L.grace <= 0) {
        if (!ship.isDrone) {
          events.push({ kind: "notice", ship: ship.id, text: "Lock lost.", alert: L.has });
        }
        L.has = false;
        L.progress = 0;
        L.grace = 0;
      }
    }
  }

  // The enemy's lock state as it bears on THIS ship (RWR fiction: you feel
  // their targeting radiation even if you can't see them).
  paintedState(ship: Ship): PaintedState {
    const enemy = this.enemyOf(ship.id);
    if (!enemy) return "none";
    if (enemy.lock.has) return "locked";
    if (enemy.lock.progress > 0) return "acquiring";
    return "none";
  }

  private announcePainted(ship: Ship, events: SimEvent[]): void {
    if (ship.isDrone) return;
    const now = this.paintedState(ship);
    const was = ship.prevPainted;
    ship.prevPainted = now;
    if (now === was) return;
    if (now === "acquiring" && was === "none") {
      events.push({
        kind: "notice",
        ship: ship.id,
        text: "Captain, we're being painted — missile lock in progress!",
        alert: true,
      });
    } else if (now === "locked") {
      events.push({ kind: "notice", ship: ship.id, text: "They have lock!", alert: true });
    } else if (now === "none") {
      events.push({ kind: "notice", ship: ship.id, text: "Enemy lock is off us." });
    }
  }

  private lockPos(lock: NonNullable<Missile["lock"]>): { x: number; y: number } | null {
    if (lock.type === "ship") {
      const s = this.ships.get(lock.id);
      return s ? { x: s.x, y: s.y } : null;
    }
    const d = this.decoys.find((d) => d.id === lock.id);
    return d ? { x: d.x, y: d.y } : null;
  }

  private resolveWeapons(events: SimEvent[], dt: number): void {
    // --- proximity fuses (segment-based closest approach over the tick,
    // so a 450 m/s missile can't tunnel past a 150 m fuse between ticks)
    const deadMissiles = new Set<number>();
    const deadDecoys = new Set<number>();

    // --- point defense fires before fuses resolve (defense gets the last word)
    for (const ship of this.ships.values()) {
      this.stepPdc(ship, deadMissiles, events, dt);
    }

    // --- terrain: rocks are solid; ordnance impacting one is destroyed
    // (missiles detonate harmlessly)
    if (this.terrain.rocks.length > 0) {
      for (const m of this.missiles) {
        const hit = firstRockHit(m.prevX, m.prevY, m.x, m.y, this.terrain);
        if (hit) {
          deadMissiles.add(m.id);
          this.fx.push({ type: "boom", x: m.x, y: m.y });
        }
      }
      for (const d of this.decoys) {
        if (firstRockHit(d.x - d.vx * dt, d.y - d.vy * dt, d.x, d.y, this.terrain)) {
          deadDecoys.add(d.id);
        }
      }
    }

    for (const m of this.missiles) {
      if (deadMissiles.has(m.id)) continue;
      if (m.age < C.MISSILE_LAUNCH_DELAY_TICKS / C.TICK_RATE_HZ) continue; // still in launch delay
      // v4.5 arming distance: the fuse is inert until the bird has traveled
      // MISSILE_ARMING_DIST_M from its launch point — a point-blank launch
      // duds straight past the target (standoff is part of the weapon)
      if (dist(m.x, m.y, m.launchX, m.launchY) < C.MISSILE_ARMING_DIST_M) continue;
      const enemy = this.ships.get(m.owner === "A" ? "B" : "A");

      // enemy ship
      if (enemy) {
        const dMin = segmentMinDist(
          m.prevX, m.prevY, m.x, m.y,
          enemy.x - enemy.vx * dt, enemy.y - enemy.vy * dt, enemy.x, enemy.y
        );
        if (dMin <= C.MISSILE_PROX_FUSE_M) {
          deadMissiles.add(m.id);
          this.fx.push({ type: "boom", x: m.x, y: m.y });
          this.damageShip(enemy, C.MISSILE_DAMAGE, "missile", events);
          continue;
        }
      }
      // enemy decoys
      for (const d of this.decoys) {
        if (d.owner === m.owner || deadDecoys.has(d.id)) continue;
        const dMin = segmentMinDist(
          m.prevX, m.prevY, m.x, m.y,
          d.x - d.vx * dt, d.y - d.vy * dt, d.x, d.y
        );
        if (dMin <= C.MISSILE_PROX_FUSE_M) {
          deadMissiles.add(m.id);
          deadDecoys.add(d.id);
          this.fx.push({ type: "boom", x: m.x, y: m.y });
          events.push({ kind: "notice", ship: d.owner, text: "Their missile took the decoy." });
          events.push({ kind: "notice", ship: m.owner, text: "Missile detonated — it was a decoy." });
          break;
        }
      }
      if (deadMissiles.has(m.id)) continue;
      // enemy missiles ("any enemy object" per the handoff)
      for (const other of this.missiles) {
        if (other.owner === m.owner || deadMissiles.has(other.id)) continue;
        const dMin = segmentMinDist(
          m.prevX, m.prevY, m.x, m.y,
          other.prevX, other.prevY, other.x, other.y
        );
        if (dMin <= C.MISSILE_PROX_FUSE_M) {
          deadMissiles.add(m.id);
          deadMissiles.add(other.id);
          this.fx.push({ type: "boom", x: m.x, y: m.y });
          break;
        }
      }
    }

    // --- lifetime expiry
    for (const m of this.missiles) {
      if (!deadMissiles.has(m.id) && m.age >= C.MISSILE_LIFETIME_S) {
        deadMissiles.add(m.id);
        this.fx.push({ type: "boom", x: m.x, y: m.y });
      }
    }
    for (const d of this.decoys) {
      if (d.age >= C.DECOY_LIFETIME_S) deadDecoys.add(d.id);
    }
    this.missiles = this.missiles.filter((m) => !deadMissiles.has(m.id));
    this.decoys = this.decoys.filter((d) => !deadDecoys.has(d.id));

    // --- guidance upkeep for surviving missiles (post-move, so the next
    // substep's turn uses fresh data)
    for (const m of this.missiles) {
      if (deadMissiles.has(m.id)) continue;

      // uplink severance: the mother ship must live and still hold lock.
      // One-way — a re-acquired lock does NOT re-uplink a bird in flight.
      if (m.guidance === "uplinked") {
        const owner = this.ships.get(m.owner);
        if (!owner || owner.hull <= 0 || !owner.lock.has) {
          m.guidance = "autonomous";
          if (owner && !owner.isDrone) {
            events.push({
              kind: "notice",
              ship: m.owner,
              text: "Uplink lost — bird is autonomous.",
              alert: true,
            });
          }
        }
      }

      if (m.age < C.MISSILE_LAUNCH_DELAY_TICKS / C.TICK_RATE_HZ) continue;
      if (m.guidance === "uplinked") {
        // the bird trusts the track: target is the ship, decoys ignored
        m.lock = { type: "ship", id: m.owner === "A" ? "B" : "A" };
        continue;
      }

      // AUTONOMOUS seeker: strongest signature it can DETECT in the cone
      // (seeker detection = MISSILE_SEEKER_BASE_M x sig / 100, LOS
      // required). Fully decoy-susceptible. No candidate = hold course;
      // it may acquire later (only dry fuel ends steering for good).
      const course = m.course;
      const enemy = this.ships.get(m.owner === "A" ? "B" : "A");
      type Cand = { lock: NonNullable<Missile["lock"]>; sig: number };
      const cands: Cand[] = [];
      const seekerSees = (x: number, y: number, sig: number): boolean =>
        dist(m.x, m.y, x, y) <= C.MISSILE_SEEKER_BASE_M * (sig / 100) &&
        Math.abs(angDiff(course, bearingTo(m.x, m.y, x, y))) <= C.MISSILE_ACQ_CONE_DEG &&
        this.losClear(m.x, m.y, x, y);
      if (enemy) {
        const sig = this.signatureOf(enemy);
        if (seekerSees(enemy.x, enemy.y, sig)) {
          cands.push({ lock: { type: "ship", id: enemy.id }, sig });
        }
      }
      for (const d of this.decoys) {
        if (d.owner === m.owner || deadDecoys.has(d.id)) continue;
        if (seekerSees(d.x, d.y, C.DECOY_SIGNATURE)) {
          cands.push({ lock: { type: "decoy", id: d.id }, sig: C.DECOY_SIGNATURE });
        }
      }
      cands.sort((a, b) => b.sig - a.sig);
      m.lock = cands.length > 0 ? cands[0].lock : null;
    }
  }

  // Alert the captain the first time each enemy missile shows up on
  // sensors; report when a watched torpedo's engine cuts and it fades
  // (coasting sig 8 usually means instant sensor loss — that's the terror).
  private announceInboundMissiles(ship: Ship, events: SimEvent[]): void {
    if (ship.isDrone) return;
    const seen = this.announcedMissiles.get(ship.id)!;
    const visible = this.visibleEnemyMissiles(ship);
    const visibleIds = new Set(visible.map((m) => m.id));
    for (const m of visible) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      // first detected already inside the PDC envelope = it came out of
      // sensor shadow on top of us: urgent bark
      if (dist(ship.x, ship.y, m.x, m.y) <= C.PDC_RANGE_M) {
        events.push({ kind: "notice", ship: ship.id, text: "Ballistic inbound, close!", alert: true });
      } else {
        const brg = bearingTo(ship.x, ship.y, m.x, m.y);
        events.push({
          kind: "notice",
          ship: ship.id,
          text: `Missile inbound — bearing ${fmtBearing(brg)}!`,
          alert: true,
        });
      }
    }
    const prev = this.prevVisibleMissiles.get(ship.id)!;
    for (const id of prev) {
      if (visibleIds.has(id)) continue;
      const m = this.missiles.find((mm) => mm.id === id);
      if (m && !m.burning) {
        events.push({
          kind: "notice",
          ship: ship.id,
          text: "Torpedo has gone ballistic — I've lost it.",
          alert: true,
        });
      }
    }
    this.prevVisibleMissiles.set(ship.id, visibleIds);
  }

  // Project own velocity COLLISION_WARNING_S ahead; if the path crosses a
  // rock, keep a countdown for the HUD and announce at coarse steps
  // (20/15/10/5). Re-arms when the vector clears.
  private updateCollisionWarning(ship: Ship, events: SimEvent[]): void {
    let secs: number | null = null;
    if (this.terrain.rocks.length > 0) {
      const hit = firstRockHit(
        ship.x,
        ship.y,
        ship.x + ship.vx * C.COLLISION_WARNING_S,
        ship.y + ship.vy * C.COLLISION_WARNING_S,
        this.terrain
      );
      if (hit) secs = hit.t * C.COLLISION_WARNING_S;
    }
    const tier = secs === null ? null : secs > 15 ? 20 : secs > 10 ? 15 : secs > 5 ? 10 : 5;
    if (
      tier !== null &&
      (ship.collisionTier === null || tier < ship.collisionTier) &&
      !ship.isDrone
    ) {
      const words: Record<number, string> = { 20: "twenty", 15: "fifteen", 10: "ten", 5: "five" };
      events.push({
        kind: "notice",
        ship: ship.id,
        text: `Rock on our vector — impact in ${words[tier]} seconds!`,
        alert: tier <= 10,
      });
    }
    ship.collisionTier = tier;
    ship.collisionWarnS = secs;
  }

  // Inside a dust cloud you are blind and unseen (both directions).
  inDust(ship: Ship): boolean {
    return insideDust(ship.x, ship.y, this.terrain);
  }

  // Edge-triggered dust entry/exit lines.
  private announceDust(ship: Ship, events: SimEvent[]): void {
    const now = this.inDust(ship);
    if (!ship.isDrone && now !== ship.wasInDust) {
      events.push({
        kind: "notice",
        ship: ship.id,
        text: now
          ? "We're in the cloud — sensors are blind, but so are theirs."
          : "Clear of the cloud — sensors are back.",
      });
    }
    ship.wasInDust = now;
  }


  // Re-evaluate this viewer's contact tier on the enemy: refresh the faint
  // cache and last-known ghost, and speak the tier transitions.
  private updateSensors(ship: Ship, events: SimEvent[]): void {
    const enemy = this.enemyOf(ship.id);
    if (!enemy) return;
    const was = ship.contactTier;
    const tier = this.contactTierFor(ship, enemy);
    ship.contactTier = tier;

    if (tier === 1) {
      // approximate position only, refreshed every FAINT_UPDATE_INTERVAL_S
      if (
        !ship.faintContact ||
        this.tickCount - ship.faintContact.t >= C.FAINT_UPDATE_INTERVAL_S * C.TICK_RATE_HZ
      ) {
        const ang = Math.random() * Math.PI * 2;
        const noise = Math.random() * C.FAINT_POS_NOISE_M;
        ship.faintContact = {
          x: enemy.x + Math.cos(ang) * noise,
          y: enemy.y + Math.sin(ang) * noise,
          t: this.tickCount,
        };
      }
      ship.lastKnownEnemy = {
        x: ship.faintContact.x,
        y: ship.faintContact.y,
        facing: 0, // no vector data at faint
        t: ship.faintContact.t,
      };
    } else {
      ship.faintContact = null;
      if (tier >= 2) {
        ship.lastKnownEnemy = { x: enemy.x, y: enemy.y, facing: enemy.facing, t: this.tickCount };
      }
    }

    if (tier === was || ship.isDrone) return;
    const brg = fmtBearing(bearingTo(ship.x, ship.y, enemy.x, enemy.y));
    const rangeKm = Math.round(dist(ship.x, ship.y, enemy.x, enemy.y) / 1000);
    if (tier === 0) {
      const lk = ship.lastKnownEnemy;
      const lkBrg = lk ? fmtBearing(bearingTo(ship.x, ship.y, lk.x, lk.y)) : brg;
      events.push({
        kind: "notice",
        ship: ship.id,
        text:
          was >= 2
            ? `Track lost — last known bearing ${lkBrg}.`
            : `Contact faded — last known bearing ${lkBrg}.`,
        alert: was >= 2,
      });
    } else if (tier === 1) {
      events.push({
        kind: "notice",
        ship: ship.id,
        text:
          was === 0
            ? `Faint contact — bearing ${brg}, range approximately ${rangeKm} km.`
            : "Losing resolution — contact's gone faint.",
      });
    } else if (tier === 2) {
      events.push({
        kind: "notice",
        ship: ship.id,
        text:
          was < 2
            ? `Contact firming up — I have a track. Bearing ${brg}, range ${rangeKm} km.`
            : "Lost the detail readout — still holding the track.",
      });
    } else {
      events.push({
        kind: "notice",
        ship: ship.id,
        text: "Close-range ID, Captain — full readout on the contact.",
      });
    }
  }

  private stepShip(ship: Ship, events: SimEvent[], dt: number): void {
    // Housekeeping shared by drones and players: cooldowns, launch flash,
    // tube reloads.
    ship.sigSpikeLaunch = Math.max(0, ship.sigSpikeLaunch - dt);
    ship.sigSpikePdc = Math.max(0, ship.sigSpikePdc - dt);
    // ping timers snap to zero below float dust: 0.1-substep decrements
    // leave ~1e-14 residues, and a residue on pingGrantS would buy a fifth
    // track-tick — exactly enough to complete the lock the design forbids
    const tickDown = (v: number) => (v - dt < 1e-9 ? 0 : v - dt);
    ship.pingCooldownS = tickDown(ship.pingCooldownS);
    ship.pingRevealS = tickDown(ship.pingRevealS);
    ship.pingGrantS = tickDown(ship.pingGrantS);
    for (let i = 0; i < ship.tubes.length; i++) {
      const t = ship.tubes[i];
      if (!t.loaded && t.reload > 0) {
        t.reload = Math.max(0, t.reload - dt);
        if (t.reload === 0) {
          t.loaded = true;
          if (!ship.isDrone) {
            events.push({ kind: "notice", ship: ship.id, text: `Tube ${TUBE_NAMES[i]} ready.` });
          }
        }
      }
    }

    // Practice drone: fixed-speed cruiser, ignores thrust physics and
    // propellant (thrust is set only so its signature reads as a ship).
    // With terrain it patrols waypoints among the rocks/dust and dodges
    // collisions; with no terrain it flies the old gentle circle.
    if (ship.isDrone) {
      ship.facing = norm360(ship.facing + this.droneSteer(ship) * dt);
      const [fx, fy] = headingVec(ship.facing);
      const ox = ship.x;
      const oy = ship.y;
      ship.vx = fx * C.DRONE_SPEED_MPS;
      ship.vy = fy * C.DRONE_SPEED_MPS;
      ship.x += ship.vx * dt;
      ship.y += ship.vy * dt;
      this.resolveRockCollision(ship, ox, oy, events);
      return;
    }
    this.stepManeuver(ship, events, dt);

    // rotate toward goal at fixed turn rate, clamped (no overshoot).
    // Turning is free (reaction wheels) — no propellant cost.
    if (ship.goal?.mode === "turn") {
      // relative turn: burn down the signed remaining degrees in the
      // commanded direction — never re-shortened through angDiff
      const maxStep = C.TURN_RATE_DEG_PER_SEC * dt;
      const step = clamp(ship.goal.remaining, -maxStep, maxStep);
      ship.facing = norm360(ship.facing + step);
      ship.goal.remaining -= step; // exact: final step equals the remainder
      if (ship.goal.remaining === 0) ship.goal = null;
    } else {
      const goalDeg = this.resolveGoal(ship);
      if (goalDeg !== null) {
        const diff = angDiff(ship.facing, goalDeg);
        const maxStep = C.TURN_RATE_DEG_PER_SEC * dt;
        ship.facing = norm360(ship.facing + clamp(diff, -maxStep, maxStep));
      }
    }

    // accelerate along facing; rotation does NOT change velocity (drift).
    // Output thrust dies with the tank; the throttle SETTING is remembered.
    const effective = effectiveThrust(ship);
    const accel = (effective / 100) * C.ACCEL_FULL_THRUST_MPS2;
    const [fx, fy] = headingVec(ship.facing);
    ship.vx += fx * accel * dt;
    ship.vy += fy * accel * dt;

    // clamp speed by scaling the velocity vector ("drive saturation")
    const speed = Math.hypot(ship.vx, ship.vy);
    if (speed > C.MAX_SPEED_MPS) {
      const k = C.MAX_SPEED_MPS / speed;
      ship.vx *= k;
      ship.vy *= k;
    }

    const ox = ship.x;
    const oy = ship.y;
    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;
    this.resolveRockCollision(ship, ox, oy, events);

    this.stepPropellant(ship, effective, events, dt);
  }

  // Any explicit thrust/heading order takes the conn back from an active
  // autopilot macro ("belay that" arrives as one of those).
  private cancelManeuver(ship: Ship, events: SimEvent[]): void {
    if (!ship.maneuver) return;
    ship.maneuver = null;
    if (!ship.isDrone) {
      events.push({ kind: "notice", ship: ship.id, text: "Full stop belayed — you have the conn." });
    }
  }

  // Autopilot executor, one substep. full_stop: turn to retrograde, burn at
  // an appropriate throttle, cut thrust when speed < 5 m/s. Future macros
  // switch on maneuver.type here.
  private stepManeuver(ship: Ship, events: SimEvent[], dt: number): void {
    if (!ship.maneuver) return;
    if (ship.maneuver.type === "full_stop") {
      const speed = this.speedOf(ship);
      if (speed < 5) {
        ship.maneuver = null;
        ship.thrust = 0;
        ship.goal = null;
        ship.vx = 0; // kill the last crawl — "all stop" means stopped
        ship.vy = 0;
        events.push({ kind: "notice", ship: ship.id, text: "Answering all stop." });
        return;
      }
      if (ship.propellant <= 0) {
        ship.maneuver = null;
        ship.thrust = 0;
        events.push({
          kind: "notice",
          ship: ship.id,
          text: "Tanks dry — I can't finish the stop, Captain.",
          alert: true,
        });
        return;
      }
      const retro = norm360(bearingTo(0, 0, -ship.vx, -ship.vy));
      ship.goal = { mode: "absolute", degrees: retro };
      const off = Math.abs(angDiff(ship.facing, retro));
      if (off <= 15) {
        // full burn until one second from stopped, then feather the throttle
        ship.thrust = clamp(Math.round((speed / C.ACCEL_FULL_THRUST_MPS2) * 100), 5, 100);
      } else {
        ship.thrust = 0; // still flipping; don't burn off-axis
      }
    }
  }

  // Rocks are solid. Swept check over the substep movement; on impact the
  // ship is placed at the surface, the normal velocity component reflects
  // and dampens (tangential survives), and hull damage scales with how hard
  // the ship drove into the surface.
  private resolveRockCollision(ship: Ship, ox: number, oy: number, events: SimEvent[]): void {
    const hit = firstRockHit(ox, oy, ship.x, ship.y, this.terrain);
    if (!hit) return;
    const rock = hit.rock;
    const ix = ox + (ship.x - ox) * hit.t;
    const iy = oy + (ship.y - oy) * hit.t;
    let nx = ix - rock.x;
    let ny = iy - rock.y;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;

    const vN = ship.vx * nx + ship.vy * ny; // negative = driving into the rock
    const impactSpeed = Math.max(0, -vN);
    ship.vx -= (1 + C.COLLISION_RESTITUTION) * Math.min(0, vN) * nx;
    ship.vy -= (1 + C.COLLISION_RESTITUTION) * Math.min(0, vN) * ny;
    ship.x = rock.x + nx * (rock.r + 1);
    ship.y = rock.y + ny * (rock.r + 1);

    // Drones bounce without hull damage: a practice drone suiciding on a
    // rock would end the match with no shot fired (degenerate win).
    if (impactSpeed > C.COLLISION_HARMLESS_BELOW_MPS && !ship.isDrone) {
      const f =
        (impactSpeed - C.COLLISION_HARMLESS_BELOW_MPS) /
        (C.COLLISION_LETHAL_AT_MPS - C.COLLISION_HARMLESS_BELOW_MPS);
      const dmg = Math.round(100 * f * f);
      this.fx.push({ type: "boom", x: ix, y: iy });
      if (dmg > 0) this.damageShip(ship, dmg, "rock", events);
    }
  }

  // Burn scales linearly with EFFECTIVE thrust; the ramscoop regenerates
  // only inside the zone with the throttle SETTING at or below the regen
  // ceiling (the captain must actually order low thrust to harvest).
  private stepPropellant(ship: Ship, effective: number, events: SimEvent[], dt: number): void {
    ship.propellant = Math.max(
      0,
      ship.propellant - (effective / 100) * C.PROPELLANT_BURN_AT_FULL * dt
    );
    if (this.insideZone(ship) && ship.thrust <= C.REGEN_MAX_THRUST_PCT) {
      ship.propellant = Math.min(C.PROPELLANT_MAX, ship.propellant + C.PROPELLANT_REGEN_PER_S * dt);
    }

    // warnings at falling 50/25/10/0 thresholds, re-armed on recovery
    const p = ship.propellant;
    const tier = p <= 0 ? 0 : p <= 10 ? 10 : p <= 25 ? 25 : p <= 50 ? 50 : 100;
    if (tier < ship.propellantTier) {
      const lines: Record<number, [string, boolean]> = {
        50: ["Propellant at one-half.", false],
        25: ["Propellant at one-quarter, Captain.", false],
        10: ["Propellant critical — ten percent.", true],
        0: ["Tanks dry — we're adrift.", true],
      };
      const [text, alert] = lines[tier];
      events.push({ kind: "notice", ship: ship.id, text, alert });
    }
    ship.propellantTier = tier;
  }

  // Region edge: gravity, not walls. Beyond the ring a restoring current
  // accelerates the ship back toward center — it grows with distance and no
  // derelict can be stranded. Crossing announcements are edge-triggered.
  private applyBounds(ship: Ship, events: SimEvent[], dt: number): void {
    const r = dist(ship.x, ship.y, 0, 0);

    if (r > C.REGION_RADIUS_M) {
      const beyond = r - C.REGION_RADIUS_M;
      const pull = Math.min(
        C.EDGE_PULL_CAP_MPS2,
        C.EDGE_PULL_MPS2_PER_50KM * (beyond / 50000)
      );
      ship.vx += (-ship.x / r) * pull * dt;
      ship.vy += (-ship.y / r) * pull * dt;
    }

    const inside = this.insideZone(ship);
    if (!ship.isDrone) {
      if (ship.wasInsideZone && !inside) {
        events.push({
          kind: "notice",
          ship: ship.id,
          text: "We've left the shroud — we're lit up and the current's against us, Captain.",
          alert: true,
        });
      } else if (!ship.wasInsideZone && inside) {
        events.push({
          kind: "notice",
          ship: ship.id,
          text: "Back inside the shroud, Captain. We're under cover again.",
        });
      }
    }
    ship.wasInsideZone = inside;
  }

  speedOf(ship: Ship): number {
    return Math.hypot(ship.vx, ship.vy);
  }

  insideZone(ship: Ship): boolean {
    return dist(ship.x, ship.y, 0, 0) <= C.REGION_RADIUS_M;
  }

  // Fog-scoped enemy info as this ship's sensors know it (for prompts,
  // queries, and standing-order metrics — never from ground truth).
  // Data texture follows the contact tier: faint = approximate position
  // only; track = true position + vector; id = + status detail.
  private enemyIntel(ship: Ship): Record<string, unknown> {
    const enemy = this.enemyOf(ship.id);
    const tier = ship.contactTier;
    if (enemy && tier >= 2) {
      const range = dist(ship.x, ship.y, enemy.x, enemy.y);
      const brg = bearingTo(ship.x, ship.y, enemy.x, enemy.y);
      return {
        contact_tier: tier === 3 ? "id" : "track",
        bearing: Math.round(brg),
        bearing_off_nose: Math.round(Math.abs(angDiff(ship.facing, brg))),
        range_m: Math.round(range),
        their_heading: Math.round(enemy.facing),
        their_speed_mps: Math.round(Math.hypot(enemy.vx, enemy.vy)),
        ...(tier === 3
          ? { their_hull: `${enemy.hull}/${enemy.isDrone ? C.DRONE_HULL_POINTS : C.HULL_POINTS}` }
          : {}),
      };
    }
    if (enemy && tier === 1 && ship.faintContact) {
      const brg = bearingTo(ship.x, ship.y, ship.faintContact.x, ship.faintContact.y);
      return {
        contact_tier: "faint",
        approx_bearing: Math.round(brg),
        approx_range_m: Math.round(dist(ship.x, ship.y, ship.faintContact.x, ship.faintContact.y)),
        note: "faint contact: approximate position only, NO vector, no lock possible",
      };
    }
    if (ship.lastKnownEnemy) {
      const lk = ship.lastKnownEnemy;
      return {
        contact_tier: "none",
        last_seen_seconds_ago: this.tickCount - lk.t,
        last_known_bearing: Math.round(bearingTo(ship.x, ship.y, lk.x, lk.y)),
        last_known_range_m: Math.round(dist(ship.x, ship.y, lk.x, lk.y)),
      };
    }
    return { contact_tier: "none", never_seen: true };
  }

  // Compact live-state summary injected into the translator prompt.
  stateSummaryFor(id: ShipId): string {
    const ship = this.ships.get(id);
    if (!ship) return "(no ship)";
    const lines: string[] = [];
    const zoneDist = dist(ship.x, ship.y, 0, 0);
    lines.push(
      `Own ship: heading ${fmtBearing(ship.facing)}, speed ${Math.round(this.speedOf(ship))} m/s, thrust ${Math.round(ship.thrust)}%${effectiveThrust(ship) < ship.thrust ? " (NO output — tanks dry)" : ""}, hull ${ship.hull}/${C.HULL_POINTS}, propellant ${Math.round(ship.propellant)}/${C.PROPELLANT_MAX}.`
    );
    lines.push(
      `Position: ${(zoneDist / 1000).toFixed(1)} km from zone center (${this.insideZone(ship) ? "inside" : "OUTSIDE"} the zone)${this.inDust(ship) ? " — INSIDE A DUST CLOUD: sensors blind both ways, no locks" : ""}. Own signature ${Math.round(this.signatureOf(ship))} (detection range others get on us scales with it).`
    );
    if (ship.collisionWarnS !== null) {
      lines.push(
        `COLLISION WARNING: rock on our vector, impact in ~${Math.round(ship.collisionWarnS)}s at current velocity.`
      );
    }
    lines.push(
      `Weapons: PDC posture ${ship.pdcPosture.toUpperCase()} (ammo ${Math.round(ship.pdcAmmoS)}s of fire left), ${this.tubeSummary(ship)}, missiles aboard ${missilesAboard(ship)}/${C.MISSILE_MAGAZINE}, decoys ${ship.decoys}/${C.DECOY_SUPPLY}. Active ping: ${ship.pingCooldownS <= 0 ? "READY (reveals us map-wide for " + C.PING_REVEAL_S + "s)" : `recharging (${Math.ceil(ship.pingCooldownS)}s)`}.`
    );
    const painted = this.paintedState(ship);
    lines.push(
      `Missile lock: ${
        ship.lock.has
          ? "HELD on enemy (can fire)"
          : ship.lock.progress > 0
            ? `acquiring (${ship.lock.progress.toFixed(0)}/${C.LOCK_TIME_S}s)`
            : "none (need enemy within " + C.LOCK_RANGE_M / 1000 + " km and " + C.LOCK_CONE_HALF_ANGLE_DEG + " deg of our nose for " + C.LOCK_TIME_S + "s to fire missiles)"
      }. Enemy lock on us: ${painted === "none" ? "none detected" : painted === "acquiring" ? "PAINTING US (lock in progress)" : "THEY HAVE LOCK"}.`
    );
    const intel = this.enemyIntel(ship);
    if (intel.contact_tier === "track" || intel.contact_tier === "id") {
      lines.push(
        `Enemy contact (${(intel.contact_tier as string).toUpperCase()}): bearing ${fmtBearing(intel.bearing as number)} (${intel.bearing_off_nose} deg off our nose), range ${(((intel.range_m as number) / 1000)).toFixed(1)} km, their heading ${fmtBearing(intel.their_heading as number)} at ${intel.their_speed_mps} m/s${intel.their_hull ? `, their hull ${intel.their_hull}` : ""}.`
      );
    } else if (intel.contact_tier === "faint") {
      lines.push(
        `Enemy contact (FAINT): approximate bearing ${fmtBearing(intel.approx_bearing as number)}, range roughly ${(((intel.approx_range_m as number) / 1000)).toFixed(0)} km. No vector data — cannot lock a faint contact.`
      );
    } else if (intel.never_seen) {
      lines.push("Enemy: no contact yet this match.");
    } else {
      lines.push(
        `Enemy: NO contact. Last seen ${intel.last_seen_seconds_ago}s ago, bearing ${fmtBearing(intel.last_known_bearing as number)}, range ${(((intel.last_known_range_m as number) / 1000)).toFixed(1)} km.`
      );
    }
    const rumbles = this.rumblesFor(ship);
    if (rumbles.length > 0) {
      lines.push(
        `Hearing: drive rumble${rumbles.length > 1 ? "s" : ""} bearing ${rumbles
          .map((r) => fmtBearing(r.bearing))
          .join(", ")} — bearing ONLY, no range or position (something is running its drive out there).`
      );
    }
    const inbound = this.visibleEnemyMissiles(ship);
    if (inbound.length > 0) {
      const nearest = this.nearestOf(ship, inbound)!;
      lines.push(
        `MISSILES INBOUND: ${inbound.length}, nearest ${(dist(ship.x, ship.y, nearest.x, nearest.y) / 1000).toFixed(1)} km, bearing ${fmtBearing(bearingTo(ship.x, ship.y, nearest.x, nearest.y))}.`
      );
    } else {
      lines.push("Missiles inbound: none detected.");
    }
    const ownBirds = this.missiles.filter((m) => m.owner === id);
    if (ownBirds.length > 0) {
      lines.push(
        `Own birds in flight: ${ownBirds
          .map((m) => (m.fuel <= 0 ? "ballistic" : m.guidance))
          .join(", ")} (uplinked = flying our track, decoy-immune; autonomous = own seeker; ballistic = dry, no steering).`
      );
    }
    if (ship.standingOrders.length > 0) {
      lines.push(
        `Active standing orders (${ship.standingOrders.length}/${C.STANDING_ORDER_MAX}): ${ship.standingOrders
          .map((o) => `'${o.label}'${o.repeat ? " (repeating)" : ""}`)
          .join(", ")}.`
      );
    } else {
      lines.push("Active standing orders: none.");
    }
    return lines.join("\n");
  }

  // One-line human tube status, shared by prompts and query answers.
  tubeSummary(ship: Ship): string {
    return ship.tubes
      .map((t, i) =>
        t.loaded
          ? `tube ${TUBE_NAMES[i]} ready`
          : t.reload > 0
            ? `tube ${TUBE_NAMES[i]} reloading (${t.reload.toFixed(0)}s)`
            : `tube ${TUBE_NAMES[i]} empty`
      )
      .join(", ");
  }

  // Read-only query execution against sensor-visible state.
  queryData(id: ShipId, topic: string): Record<string, unknown> {
    const ship = this.ships.get(id);
    if (!ship) return {};
    const own = {
      heading: Math.round(ship.facing),
      speed_mps: Math.round(this.speedOf(ship)),
      thrust_percent: Math.round(ship.thrust),
      thrust_output: effectiveThrust(ship) < ship.thrust ? "ZERO — tanks dry" : "nominal",
      hull: `${ship.hull}/${ship.isDrone ? C.DRONE_HULL_POINTS : C.HULL_POINTS}`,
      course_over_ground:
        this.speedOf(ship) > 1
          ? Math.round(bearingTo(0, 0, ship.vx, ship.vy))
          : null,
    };
    const propellant = {
      propellant: `${Math.round(ship.propellant)}/${C.PROPELLANT_MAX}`,
      regenerating:
        this.insideZone(ship) && ship.thrust <= C.REGEN_MAX_THRUST_PCT,
      regen_requires: `inside the zone AND throttle setting <= ${C.REGEN_MAX_THRUST_PCT}%`,
    };
    const tubes = {
      tubes: this.tubeSummary(ship),
      tubes_ready: ship.tubes.filter((t) => t.loaded).length,
      reserve_missiles: ship.reserve,
      missiles_aboard: missilesAboard(ship),
      lock: ship.lock.has ? "held" : ship.lock.progress > 0 ? "acquiring" : "none",
    };
    const pdc = {
      pdc_posture: ship.pdcPosture,
      pdc_ammo_seconds_of_fire: Math.round(ship.pdcAmmoS),
      pdc_missile_range_m: C.PDC_RANGE_M,
      pdc_ship_range_m: C.PDC_SHIP_RANGE_M,
      pdc_note: "automated: engages inbound missiles and knife-range ships while posture=free; hold conserves ammo and stays dark",
    };
    const weapons = {
      ...pdc,
      missiles_remaining: missilesAboard(ship),
      ...tubes,
      own_birds_in_flight: this.missiles
        .filter((m) => m.owner === ship.id)
        .map((m) => (m.fuel <= 0 ? "ballistic" : m.guidance)),
      decoys_remaining: ship.decoys,
    };
    const zone = {
      distance_from_center_m: Math.round(dist(ship.x, ship.y, 0, 0)),
      zone_radius_m: C.REGION_RADIUS_M,
      inside_zone: this.insideZone(ship),
      own_signature: this.signatureOf(ship),
      sensor_base_m: C.SENSOR_BASE_M,
      detection_note: "detection range = sensor base x target signature / 100, line of sight permitting",
    };
    const inbound = this.visibleEnemyMissiles(ship);
    const nearestInbound = this.nearestOf(ship, inbound);
    const missilesInbound = {
      inbound_missiles_detected: inbound.length,
      nearest_missile_range_m: nearestInbound
        ? Math.round(dist(ship.x, ship.y, nearestInbound.x, nearestInbound.y))
        : null,
    };
    const standingOrders = {
      active_standing_orders: ship.standingOrders.map((o) => ({
        label: o.label,
        repeat: o.repeat,
        condition: o.condition,
        actions: o.actions.map((a) => a.verb),
      })),
      capacity: `${ship.standingOrders.length}/${C.STANDING_ORDER_MAX}`,
    };

    switch (topic) {
      case "enemy":
        return this.enemyIntel(ship);
      case "own_ship":
        return { ...own, ...propellant, ...zone };
      case "weapons":
        return weapons;
      case "propellant":
        return propellant;
      case "tubes":
        return tubes;
      case "damage_report":
        // answered by a server template in match.ts — no LLM call
        return {
          hull: ship.hull,
          hull_max: ship.isDrone ? C.DRONE_HULL_POINTS : C.HULL_POINTS,
          propellant: Math.round(ship.propellant),
          tube_summary: this.tubeSummary(ship),
          missiles_aboard: missilesAboard(ship),
          decoys: ship.decoys,
          pdc_ammo_s: Math.round(ship.pdcAmmoS),
          pdc_posture: ship.pdcPosture,
        };
      case "pdc":
        return pdc;
      case "contacts": {
        // tier list with bearings and ranges (one enemy today; array-shaped
        // for v5)
        const intel = this.enemyIntel(ship);
        const inboundList = this.visibleEnemyMissiles(ship).map((m) => ({
          type: "missile",
          bearing: Math.round(bearingTo(ship.x, ship.y, m.x, m.y)),
          range_m: Math.round(dist(ship.x, ship.y, m.x, m.y)),
          engine: m.burning ? "burning" : "coasting",
        }));
        return {
          ship_contact: intel,
          ordnance_contacts: inboundList,
          rumbles: this.rumblesFor(ship).map((r) => ({
            bearing: r.bearing,
            note: "hearing only — no range, no position",
          })),
        };
      }
      case "terrain": {
        const near = this.terrain.rocks
          .map((r) => ({
            range_m: Math.round(dist(ship.x, ship.y, r.x, r.y) - r.r),
            bearing: Math.round(bearingTo(ship.x, ship.y, r.x, r.y)),
            radius_m: Math.round(r.r),
            centerpiece: !!r.centerpiece,
          }))
          .sort((a, b) => a.range_m - b.range_m)
          .slice(0, 3);
        const nearDust = this.terrain.dust
          .map((d) => ({
            range_m: Math.round(dist(ship.x, ship.y, d.x, d.y)),
            bearing: Math.round(bearingTo(ship.x, ship.y, d.x, d.y)),
            size_km: Math.round((d.rx + d.ry) / 1000),
          }))
          .sort((a, b) => a.range_m - b.range_m);
        return {
          in_dust: this.inDust(ship),
          nearest_rocks: near,
          dust_clouds: nearDust,
          note: "rocks are solid and block sensors/locks/seekers; dust blocks sensors both ways (inside one you are blind and unseen)",
        };
      }
      case "missiles_inbound":
        return missilesInbound;
      case "standing_orders":
        return standingOrders;
      case "zone":
        return zone;
      case "full_report":
      default:
        return {
          own_ship: own,
          weapons,
          ...propellant,
          enemy: this.enemyIntel(ship),
          zone,
          ...missilesInbound,
          ...standingOrders,
        };
    }
  }

  // Per-player snapshot. Fog of war is enforced HERE, server-side: the
  // client is never sent information its sensors don't have.
  snapshotFor(id: ShipId): Record<string, unknown> {
    const ship = this.ships.get(id);
    if (!ship) return { tick: this.tickCount };

    // contacts[]: the fog-of-war invariant lives here — never send data
    // above the earned tier. (Single enemy today; the array shape is the
    // v5-ready contract.)
    const enemy = this.enemyOf(id);
    const contacts: Record<string, unknown>[] = [];
    if (enemy && ship.contactTier === 1 && ship.faintContact) {
      contacts.push({
        cid: "s1", // stable per-object contact id for client interpolation
        tier: 1,
        x: ship.faintContact.x,
        y: ship.faintContact.y,
        // no vector, no facing: a faint contact is a smudge
      });
    } else if (enemy && ship.contactTier >= 2) {
      contacts.push({
        cid: "s1",
        tier: ship.contactTier,
        x: enemy.x,
        y: enemy.y,
        vx: enemy.vx,
        vy: enemy.vy,
        facing: enemy.facing,
        // status detail is earned at TIER_ID (drives the enemy hull bar)
        ...(ship.contactTier === 3
          ? { hull: enemy.hull, hullMax: enemy.isDrone ? C.DRONE_HULL_POINTS : C.HULL_POINTS }
          : {}),
      });
    }
    // Enemy decoys at faint/track read as ordinary unresolved contacts —
    // deliberately indistinguishable from a quiet ship (a fake facing is
    // derived from drift so the sprite renders like any track). They only
    // resolve as decoys at ID tier (the decoys[] list below).
    const faintFixes = this.decoyFaint.get(id)!;
    for (const d of this.decoys) {
      if (d.owner === id) continue;
      const tier = this.decoyTierFor(ship, d);
      if (tier === 1) {
        const fix = faintFixes.get(d.id);
        if (fix) contacts.push({ cid: `d${d.id}`, tier: 1, x: fix.x, y: fix.y });
      } else if (tier === 2) {
        contacts.push({
          cid: `d${d.id}`,
          tier: 2,
          x: d.x,
          y: d.y,
          vx: d.vx,
          vy: d.vy,
          facing: Math.hypot(d.vx, d.vy) > 1 ? norm360(bearingTo(0, 0, d.vx, d.vy)) : 0,
        });
      }
    }
    // last-known ghost while we hold no live ship contact
    const ghost =
      !contacts.some((c) => c.cid === "s1") && ship.lastKnownEnemy ? ship.lastKnownEnemy : null;

    // v4.5 hearing: bearing-only rumbles (below faint). Strictly {cid,
    // bearing, loud} — the fog invariant forbids anything positional here.
    const rumbles = this.rumblesFor(ship);

    return {
      tick: this.tickCount,
      you: {
        x: ship.x,
        y: ship.y,
        vx: ship.vx,
        vy: ship.vy,
        facing: ship.facing,
        thrust: ship.thrust,
        thrustOut: effectiveThrust(ship),
        speed: Math.round(this.speedOf(ship)),
        hull: ship.hull,
        propellant: ship.propellant,
        missiles: missilesAboard(ship),
        tubes: ship.tubes.map((t) => ({
          state: t.loaded ? "ready" : t.reload > 0 ? "reloading" : "empty",
          t: Math.ceil(t.reload),
        })),
        lock: {
          has: ship.lock.has,
          progress: Math.min(1, ship.lock.progress / C.LOCK_TIME_S),
        },
        painted: this.paintedState(ship),
        decoys: ship.decoys,
        pdc: { posture: ship.pdcPosture, ammoS: Math.round(ship.pdcAmmoS) },
        ping: { ready: ship.pingCooldownS <= 0, cooldownS: Math.ceil(ship.pingCooldownS) },
        insideZone: this.insideZone(ship),
        inDust: this.inDust(ship),
        collisionWarning: ship.collisionWarnS === null ? null : Math.round(ship.collisionWarnS),
        signature: this.signatureOf(ship), // own signature: how loud we are
        standingOrders: ship.standingOrders.map((o) => ({
          label: o.label,
          repeat: o.repeat,
          armed: o.cooldown <= 0,
        })),
      },
      contacts,
      rumbles,
      ghost,
      // own ordnance always; enemy ordnance only within detect range
      missiles: [
        ...this.missiles
          .filter((m) => m.owner === id)
          .map((m) => ({
            id: m.id, x: m.x, y: m.y, vx: m.vx, vy: m.vy, burning: m.burning,
            guidance: m.guidance, own: true,
          })),
        ...this.visibleEnemyMissiles(ship).map((m) => ({
          id: m.id, x: m.x, y: m.y, vx: m.vx, vy: m.vy, burning: m.burning, own: false,
        })),
      ],
      decoys: [
        ...this.decoys
          .filter((d) => d.owner === id)
          .map((d) => ({ id: d.id, x: d.x, y: d.y, vx: d.vx, vy: d.vy, own: true })),
        ...this.visibleEnemyDecoys(ship).map((d) => ({
          id: d.id, x: d.x, y: d.y, vx: d.vx, vy: d.vy, own: false,
        })),
      ],
      fx: this.fx.filter((f) => {
        if (f.type === "pdc") return f.owner === id || ship.contactTier >= 1;
        // explosions are bright: visible anywhere the sensor base could
        // reach an average target, LOS permitting
        return (
          dist(ship.x, ship.y, f.x, f.y) <= C.SENSOR_BASE_M &&
          this.losClear(ship.x, ship.y, f.x, f.y)
        );
      }),
    };
  }

  // Omniscient referee view for spectators (v4.2): both ships in full
  // detail, all ordnance, all fx — fog of war deliberately does not apply.
  // Must NEVER be routed to a player socket (leak test in
  // tests/spectator.test.ts). Ordnance `own` here means "belongs to ship A"
  // so the client's existing two-color rendering maps A=own-tint, B=enemy.
  snapshotSpectator(): Record<string, unknown> {
    return {
      tick: this.tickCount,
      spectator: true,
      ships: [...this.ships.values()].map((s) => ({
        id: s.id,
        x: s.x,
        y: s.y,
        vx: s.vx,
        vy: s.vy,
        facing: s.facing,
        thrustOut: effectiveThrust(s),
        hull: s.hull,
        hullMax: s.isDrone ? C.DRONE_HULL_POINTS : C.HULL_POINTS,
        drone: s.isDrone,
      })),
      contacts: [],
      ghost: null,
      missiles: this.missiles.map((m) => ({
        id: m.id, x: m.x, y: m.y, vx: m.vx, vy: m.vy, burning: m.burning,
        own: m.owner === "A",
      })),
      decoys: this.decoys.map((d) => ({
        id: d.id, x: d.x, y: d.y, vx: d.vx, vy: d.vy, own: d.owner === "A",
      })),
      fx: this.fx,
    };
  }

  // Called by the match after all per-player snapshots are broadcast.
  clearFx(): void {
    this.fx = [];
  }
}
