// tick loop, physics, weapons, standing orders
import * as C from "./constants.js";

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
    | "fire_laser"
    | "fire_missile"
    | "reload_tubes"
    | "deploy_decoy"
    | "set_standing_order"
    | "query";
  params: Record<string, unknown>;
  acknowledgement?: string;
}

// Goal heading as stored: ALL orders resolve to an absolute bearing at apply
// time — target orders snapshot the target's bearing once (no continuous
// tracking; the captain flies the ship).
export type HeadingGoal = { mode: "absolute"; degrees: number };

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
  hull: number;
  reserve: number; // missiles in the magazine beyond what's loaded in tubes
  tubes: Tube[];
  decoys: number;
  laserCooldown: number; // seconds until ready (0 = ready)
  propellant: number; // 0..PROPELLANT_MAX (drones exempt: stays full)
  propellantTier: number; // lowest warning tier announced (100/50/25/10/0)
  lock: LockState; // my lock on the enemy
  prevPainted: PaintedState; // enemy's lock on me last tick (edge-triggered notices)
  launchFlash: number; // seconds this ship stays revealed to the enemy after firing
  contactWasFlashOnly: boolean; // current enemy visibility exists only via their launch flash
  droneCooldown: number; // drone-only: seconds until it may fire again
  isDrone: boolean;
  standingOrders: StandingOrder[];
  orderCounter: number; // for generated labels
  // zone transition tracking (edge-triggered transcript events)
  wasInsideZone: boolean;
  atHardLimit: boolean;
  // Fog of war, per viewer: is the enemy on MY sensors right now, and where
  // did I last see it.
  enemyVisible: boolean;
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
  // lock: what the seeker is steering at right now
  lock: { type: "ship"; id: ShipId } | { type: "decoy"; id: number } | null;
  seekTimer: number; // seconds spent unlocked while seeking (reacquire window)
  ballistic: boolean; // seeker gave up; flies straight until lifetime expiry
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
  | { type: "laser"; owner: ShipId; x1: number; y1: number; x2: number; y2: number; hit: boolean }
  | { type: "boom"; x: number; y: number };

export type SimEvent =
  | { kind: "reject"; ship: ShipId; verb: string; reason: string }
  | { kind: "ack"; ship: ShipId; text: string }
  | { kind: "notice"; ship: ShipId | "all"; text: string; alert?: boolean }
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
  tickCount = 0;
  winner: ShipId | null = null;
  private nextId = 1;
  private fx: Fx[] = [];
  private queues = new Map<ShipId, Command[]>();
  // per-viewer set of enemy missile ids already announced as inbound
  private announcedMissiles = new Map<ShipId, Set<number>>();

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
      hull: isDrone ? C.DRONE_HULL_POINTS : C.HULL_POINTS,
      // tubes start loaded from the magazine: 6 aboard = 2 loaded + 4 reserve
      reserve: Math.max(0, C.MISSILE_MAGAZINE - C.TUBE_COUNT),
      tubes: Array.from({ length: C.TUBE_COUNT }, () => ({ loaded: true, reload: 0 })),
      decoys: C.DECOY_SUPPLY,
      laserCooldown: 0,
      propellant: C.PROPELLANT_MAX,
      propellantTier: 100,
      lock: { progress: 0, has: false, grace: 0 },
      prevPainted: "none",
      launchFlash: 0,
      contactWasFlashOnly: false,
      droneCooldown: 0,
      isDrone,
      standingOrders: [],
      orderCounter: 0,
      wasInsideZone: true, // spawn is well inside the zone
      atHardLimit: false,
      enemyVisible: false,
      lastKnownEnemy: null,
    };
    if (isDrone) ship.thrust = C.DRONE_THRUST_PERCENT; // signature only
    this.ships.set(id, ship);
    this.queues.set(id, []);
    this.announcedMissiles.set(id, new Set());
    return ship;
  }

  // Signature follows EFFECTIVE thrust: a tanks-dry ship goes dim.
  signatureOf(obj: Ship | Decoy): number {
    if ("thrust" in obj) return C.SHIP_BASE_SIGNATURE + effectiveThrust(obj);
    return C.DECOY_SIGNATURE;
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
        ship.thrust = clamp(pct, 0, 100);
        return null;
      }
      case "set_heading": {
        const p = cmd.params as unknown as HeadingParams;
        if (p.mode === "relative") {
          const sign = p.direction === "port" ? -1 : 1; // port = CCW
          ship.goal = {
            mode: "absolute",
            degrees: norm360(ship.facing + sign * Math.abs(p.degrees)),
          };
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
      case "fire_laser": {
        if (ship.laserCooldown > 0)
          return `Laser's recharging, Captain — ${ship.laserCooldown.toFixed(0)}s.`;
        ship.laserCooldown = C.LASER_COOLDOWN_S;
        this.fireLaser(ship, events);
        return null;
      }
      case "fire_missile": {
        if (!ship.lock.has) return "No lock, Captain.";

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
          this.launchMissile(ship, n, events);
          fired++;
        }
        if (fired === 0) {
          // every requested tube was rejected above; report overall failure
          // without duplicating the per-tube lines
          return ship.tubes.some((t) => t.reload > 0)
            ? "Tubes are still loading, Captain."
            : "Magazine dry, Captain.";
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
  // starts along the ship's facing (nose-launched).
  private launchMissile(ship: Ship, tubeNo: number, events: SimEvent[]): void {
    const tube = ship.tubes[tubeNo - 1];
    tube.loaded = false;
    const [fx, fy] = headingVec(ship.facing);
    const inherited = clamp(ship.vx * fx + ship.vy * fy, 0, C.MISSILE_MAX_SPEED_MPS);
    this.missiles.push({
      id: this.nextId++,
      owner: ship.id,
      x: ship.x,
      y: ship.y,
      prevX: ship.x,
      prevY: ship.y,
      course: ship.facing,
      speed: inherited,
      vx: fx * inherited,
      vy: fy * inherited,
      age: 0,
      lock: null,
      seekTimer: 0,
      ballistic: false,
    });

    // Launch flash: firing reveals you to the enemy for a few seconds,
    // sensors or not. Distinct notice here; updateSensors suppresses the
    // generic contact gained/lost pair for flash-only visibility.
    ship.launchFlash = C.LAUNCH_FLASH_REVEAL_S;
    const enemy = this.enemyOf(ship.id);
    if (enemy && !enemy.isDrone) {
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
        const e = this.enemyOf(ship.id);
        if (!e || !ship.enemyVisible) return null;
        return dist(ship.x, ship.y, e.x, e.y);
      }
      case "enemy_on_sensors":
        return ship.enemyVisible;
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
      case "tubes_ready":
        return ship.tubes.filter((t) => t.loaded).length;
      case "enemy_bearing_off_nose": {
        const e = this.enemyOf(ship.id);
        if (!e || !ship.enemyVisible) return null;
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

  // Hitscan: first (nearest) enemy object within the beam wedge and range.
  // Friendly objects are transparent. A miss still shows a ray.
  private fireLaser(ship: Ship, events: SimEvent[]): void {
    const enemyId: ShipId = ship.id === "A" ? "B" : "A";
    const enemy = this.ships.get(enemyId);

    type Candidate =
      | { kind: "ship"; ship: Ship; range: number }
      | { kind: "missile"; missile: Missile; range: number }
      | { kind: "decoy"; decoy: Decoy; range: number };
    const candidates: Candidate[] = [];

    const inWedge = (x: number, y: number): number | null => {
      const range = dist(ship.x, ship.y, x, y);
      if (range > C.LASER_RANGE_M) return null;
      const off = Math.abs(angDiff(ship.facing, bearingTo(ship.x, ship.y, x, y)));
      return off <= C.LASER_BEAM_WIDTH_DEG ? range : null;
    };

    if (enemy) {
      const r = inWedge(enemy.x, enemy.y);
      if (r !== null) candidates.push({ kind: "ship", ship: enemy, range: r });
    }
    for (const m of this.missiles) {
      if (m.owner === ship.id) continue;
      const r = inWedge(m.x, m.y);
      if (r !== null) candidates.push({ kind: "missile", missile: m, range: r });
    }
    for (const d of this.decoys) {
      if (d.owner === ship.id) continue;
      const r = inWedge(d.x, d.y);
      if (r !== null) candidates.push({ kind: "decoy", decoy: d, range: r });
    }

    candidates.sort((a, b) => a.range - b.range);
    const hit = candidates[0];

    const [fx, fy] = headingVec(ship.facing);
    const reach = hit ? hit.range : C.LASER_RANGE_M;
    this.fx.push({
      type: "laser",
      owner: ship.id,
      x1: ship.x,
      y1: ship.y,
      x2: ship.x + fx * reach,
      y2: ship.y + fy * reach,
      hit: !!hit,
    });

    if (!hit) {
      events.push({ kind: "notice", ship: ship.id, text: "Laser fired — clean miss." });
      return;
    }
    if (hit.kind === "ship") {
      this.fx.push({ type: "boom", x: hit.ship.x, y: hit.ship.y });
      this.damageShip(hit.ship, C.LASER_DAMAGE, "laser", events);
    } else if (hit.kind === "missile") {
      this.missiles = this.missiles.filter((m) => m !== hit.missile);
      this.fx.push({ type: "boom", x: hit.missile.x, y: hit.missile.y });
      events.push({ kind: "notice", ship: ship.id, text: "Missile destroyed — good shooting." });
      events.push({ kind: "notice", ship: enemyId, text: "They've shot down our missile." });
    } else {
      this.decoys = this.decoys.filter((d) => d !== hit.decoy);
      this.fx.push({ type: "boom", x: hit.decoy.x, y: hit.decoy.y });
      events.push({ kind: "notice", ship: ship.id, text: "Decoy destroyed." });
      events.push({ kind: "notice", ship: enemyId, text: "They've burned down our decoy." });
    }
  }

  private damageShip(target: Ship, amount: number, source: "laser" | "missile", events: SimEvent[]): void {
    if (this.winner) return;
    target.hull = Math.max(0, target.hull - amount);
    const attackerId: ShipId = target.id === "A" ? "B" : "A";
    const word = source === "laser" ? "Laser hit" : "Missile strike";
    events.push({
      kind: "notice",
      ship: attackerId,
      text: source === "laser" ? "Direct hit on the enemy ship." : "Missile strike on the enemy ship!",
    });
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

  // Goal headings are always absolute now (target orders snapshot at apply).
  private resolveGoal(ship: Ship): number | null {
    return ship.goal ? ship.goal.degrees : null;
  }

  // Enemy ordnance this ship's sensors can see (within detect range).
  private visibleEnemyMissiles(ship: Ship): Missile[] {
    return this.missiles.filter(
      (m) =>
        m.owner !== ship.id &&
        dist(ship.x, ship.y, m.x, m.y) <= C.ORDNANCE_DETECT_RANGE_M
    );
  }

  private visibleEnemyDecoys(ship: Ship): Decoy[] {
    return this.decoys.filter(
      (d) =>
        d.owner !== ship.id &&
        dist(ship.x, ship.y, d.x, d.y) <= C.ORDNANCE_DETECT_RANGE_M
    );
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

  // Fog-aware: the helm steers by what the sensors show, falling back to
  // last-known position for the enemy ship.
  protected resolveTargetPos(
    ship: Ship,
    target: TargetKind
  ): { x: number; y: number } | null {
    const enemyShipPos = (): { x: number; y: number } | null => {
      const enemy = this.enemyOf(ship.id);
      if (enemy && ship.enemyVisible) return { x: enemy.x, y: enemy.y };
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
        // the enemy ship if we can see it, else nearest visible ordnance,
        // else last-known ship position
        const enemy = this.enemyOf(ship.id);
        if (enemy && ship.enemyVisible) return { x: enemy.x, y: enemy.y };
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

      // 2. execute queued commands (lasers resolve here; missiles/decoys spawn)
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
      this.applyBounds(ship, events);
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
      this.announceInboundMissiles(ship, events);
    }
    for (const ship of this.ships.values()) {
      this.updateLock(ship, events, tickDt);
    }
    for (const ship of this.ships.values()) {
      this.announcePainted(ship, events);
    }
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

  // Seeking missiles steer their course toward the lock (clamped to
  // MISSILE_TURN_RATE); speed ramps toward max; velocity follows course.
  private stepMissile(m: Missile, dt: number): void {
    m.prevX = m.x;
    m.prevY = m.y;
    if (m.lock && !m.ballistic && m.age >= C.MISSILE_LAUNCH_DELAY_TICKS / C.TICK_RATE_HZ) {
      const target = this.lockPos(m.lock);
      if (target) {
        const want = bearingTo(m.x, m.y, target.x, target.y);
        const step = clamp(angDiff(m.course, want), -C.MISSILE_TURN_RATE_DPS * dt, C.MISSILE_TURN_RATE_DPS * dt);
        m.course = norm360(m.course + step);
      }
    }
    m.speed = Math.min(m.speed + C.MISSILE_ACCEL_MPS2 * dt, C.MISSILE_MAX_SPEED_MPS);
    const [nx, ny] = headingVec(m.course);
    m.vx = nx * m.speed;
    m.vy = ny * m.speed;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    m.age += dt;
  }

  // ---------- ship-to-ship missile lock ----------

  // My lock on the enemy: needs cone + range + sensor visibility held for
  // LOCK_TIME_S continuous seconds; LOCK_GRACE_S forgives brief breaks.
  private updateLock(ship: Ship, events: SimEvent[], dt: number): void {
    const enemy = this.enemyOf(ship.id);
    const L = ship.lock;
    let holding = false;
    if (enemy && ship.enemyVisible) {
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

    for (const m of this.missiles) {
      if (m.age < C.MISSILE_LAUNCH_DELAY_TICKS / C.TICK_RATE_HZ) continue; // still in launch delay
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

    // --- seeker lock evaluation for surviving missiles (post-move, so next
    // tick's turn uses this lock)
    for (const m of this.missiles) {
      if (m.ballistic || m.age < C.MISSILE_LAUNCH_DELAY_TICKS / C.TICK_RATE_HZ) continue;
      const course = m.course;
      const enemy = this.ships.get(m.owner === "A" ? "B" : "A");

      // every-tick re-evaluation: highest signature wins, so a fresh decoy
      // can steal lock from a quiet ship (intended behavior)
      type Cand = { lock: NonNullable<Missile["lock"]>; sig: number };
      const cands: Cand[] = [];
      if (enemy) {
        const off = Math.abs(angDiff(course, bearingTo(m.x, m.y, enemy.x, enemy.y)));
        if (off <= C.MISSILE_ACQ_CONE_DEG) {
          cands.push({ lock: { type: "ship", id: enemy.id }, sig: this.signatureOf(enemy) });
        }
      }
      for (const d of this.decoys) {
        if (d.owner === m.owner) continue;
        const off = Math.abs(angDiff(course, bearingTo(m.x, m.y, d.x, d.y)));
        if (off <= C.MISSILE_ACQ_CONE_DEG) {
          cands.push({ lock: { type: "decoy", id: d.id }, sig: this.signatureOf(d) });
        }
      }
      cands.sort((a, b) => b.sig - a.sig);

      if (cands.length > 0) {
        m.lock = cands[0].lock;
        m.seekTimer = 0;
      } else {
        m.lock = null;
        m.seekTimer += dt;
        if (m.seekTimer > C.MISSILE_REACQUIRE_S) m.ballistic = true;
      }
    }
  }

  // Alert the captain the first time each enemy missile shows up in
  // ordnance-detect range.
  private announceInboundMissiles(ship: Ship, events: SimEvent[]): void {
    if (ship.isDrone) return;
    const seen = this.announcedMissiles.get(ship.id)!;
    for (const m of this.visibleEnemyMissiles(ship)) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const brg = bearingTo(ship.x, ship.y, m.x, m.y);
      events.push({
        kind: "notice",
        ship: ship.id,
        text: `Missile inbound — bearing ${fmtBearing(brg)}!`,
        alert: true,
      });
    }
  }

  sensorRangeOf(ship: Ship): number {
    return (
      C.SENSOR_RANGE_M * (this.insideZone(ship) ? 1 : C.OUTSIDE_ZONE_SENSOR_MULT)
    );
  }

  // You see the enemy iff (distance <= your current sensor range) OR (the
  // enemy is outside the zone) OR (their launch flash is still burning).
  // Flash-only visibility gets no generic contact gained/lost notices — the
  // distinct "Launch flash detected" line was sent at fire time.
  private updateSensors(ship: Ship, events: SimEvent[]): void {
    const enemy = this.enemyOf(ship.id);
    const wasVisible = ship.enemyVisible;
    const wasFlashOnly = ship.contactWasFlashOnly;
    let visible = false;
    let baseVisible = false;
    if (enemy) {
      const range = dist(ship.x, ship.y, enemy.x, enemy.y);
      baseVisible = range <= this.sensorRangeOf(ship) || !this.insideZone(enemy);
      visible = baseVisible || enemy.launchFlash > 0;
      if (visible) {
        ship.lastKnownEnemy = {
          x: enemy.x,
          y: enemy.y,
          facing: enemy.facing,
          t: this.tickCount,
        };
      }
      if (visible && !wasVisible && baseVisible && !ship.isDrone) {
        const brg = bearingTo(ship.x, ship.y, enemy.x, enemy.y);
        events.push({
          kind: "notice",
          ship: ship.id,
          text: `Contact on sensors — bearing ${fmtBearing(brg)}, range ${(range / 1000).toFixed(1)} km.`,
        });
      } else if (!visible && wasVisible && !wasFlashOnly && !ship.isDrone) {
        events.push({
          kind: "notice",
          ship: ship.id,
          text: "Contact lost — off sensors.",
        });
      }
    }
    ship.enemyVisible = visible;
    ship.contactWasFlashOnly = visible && !baseVisible;
  }

  private stepShip(ship: Ship, events: SimEvent[], dt: number): void {
    // Housekeeping shared by drones and players: cooldowns, launch flash,
    // tube reloads.
    ship.laserCooldown = Math.max(0, ship.laserCooldown - dt);
    ship.launchFlash = Math.max(0, ship.launchFlash - dt);
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

    // Practice drone: fixed-speed gentle circle, ignores thrust physics and
    // propellant (thrust is set only so its signature reads as a ship).
    if (ship.isDrone) {
      ship.facing = norm360(ship.facing + C.DRONE_TURN_RATE_DPS * dt);
      const [fx, fy] = headingVec(ship.facing);
      ship.vx = fx * C.DRONE_SPEED_MPS;
      ship.vy = fy * C.DRONE_SPEED_MPS;
      ship.x += ship.vx * dt;
      ship.y += ship.vy * dt;
      return;
    }
    // rotate toward goal at fixed turn rate, clamped (no overshoot).
    // Turning is free (reaction wheels) — no propellant cost.
    const goalDeg = this.resolveGoal(ship);
    if (goalDeg !== null) {
      const diff = angDiff(ship.facing, goalDeg);
      const maxStep = C.TURN_RATE_DEG_PER_SEC * dt;
      ship.facing = norm360(ship.facing + clamp(diff, -maxStep, maxStep));
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

    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;

    this.stepPropellant(ship, effective, events, dt);
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

  // Hard limit clamp + server-generated transcript events on zone
  // transitions (no LLM involved).
  private applyBounds(ship: Ship, events: SimEvent[]): void {
    const r = dist(ship.x, ship.y, 0, 0);

    // hard limit: clamp to the ring, zero the outward radial velocity
    // component (tangential survives) — fiction: drive failure
    if (r > C.HARD_LIMIT_RADIUS_M) {
      const k = C.HARD_LIMIT_RADIUS_M / r;
      ship.x *= k;
      ship.y *= k;
      const rn = C.HARD_LIMIT_RADIUS_M;
      const rx = ship.x / rn;
      const ry = ship.y / rn;
      const vRad = ship.vx * rx + ship.vy * ry;
      if (vRad > 0) {
        ship.vx -= rx * vRad;
        ship.vy -= ry * vRad;
      }
      if (!ship.atHardLimit && !ship.isDrone) {
        events.push({
          kind: "notice",
          ship: ship.id,
          text: "Drive failure at the shroud's absolute edge — we can't push any further out, Captain.",
          alert: true,
        });
      }
      ship.atHardLimit = true;
    } else {
      ship.atHardLimit = false;
    }

    // zone crossing announcements
    const inside = this.insideZone(ship);
    if (!ship.isDrone) {
      if (ship.wasInsideZone && !inside) {
        events.push({
          kind: "notice",
          ship: ship.id,
          text: "Captain, we've left the shroud — we're visible to the enemy and our sensors are degraded.",
          alert: true,
        });
      } else if (!ship.wasInsideZone && inside) {
        events.push({
          kind: "notice",
          ship: ship.id,
          text: "Back inside the shroud, Captain. Sensor cover restored.",
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
  private enemyIntel(ship: Ship): Record<string, unknown> {
    const enemy = this.enemyOf(ship.id);
    if (enemy && ship.enemyVisible) {
      const range = dist(ship.x, ship.y, enemy.x, enemy.y);
      const brg = bearingTo(ship.x, ship.y, enemy.x, enemy.y);
      return {
        on_sensors: true,
        bearing: Math.round(brg),
        bearing_off_nose: Math.round(Math.abs(angDiff(ship.facing, brg))),
        range_m: Math.round(range),
        their_heading: Math.round(enemy.facing),
      };
    }
    if (ship.lastKnownEnemy) {
      const lk = ship.lastKnownEnemy;
      return {
        on_sensors: false,
        last_seen_seconds_ago: this.tickCount - lk.t,
        last_known_bearing: Math.round(bearingTo(ship.x, ship.y, lk.x, lk.y)),
        last_known_range_m: Math.round(dist(ship.x, ship.y, lk.x, lk.y)),
      };
    }
    return { on_sensors: false, never_seen: true };
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
      `Position: ${(zoneDist / 1000).toFixed(1)} km from zone center (${this.insideZone(ship) ? "inside" : "OUTSIDE"} the zone).`
    );
    lines.push(
      `Weapons: laser ${ship.laserCooldown > 0 ? `recharging ${ship.laserCooldown.toFixed(0)}s` : "ready"}, ${this.tubeSummary(ship)}, missiles aboard ${missilesAboard(ship)}/${C.MISSILE_MAGAZINE}, decoys ${ship.decoys}/${C.DECOY_SUPPLY}.`
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
    if (intel.on_sensors) {
      lines.push(
        `Enemy: on sensors, bearing ${fmtBearing(intel.bearing as number)} (${intel.bearing_off_nose} deg off our nose), range ${(((intel.range_m as number) / 1000)).toFixed(1)} km, their heading ${fmtBearing(intel.their_heading as number)}.`
      );
    } else if (intel.never_seen) {
      lines.push("Enemy: no contact yet this match.");
    } else {
      lines.push(
        `Enemy: NOT on sensors. Last seen ${intel.last_seen_seconds_ago}s ago, bearing ${fmtBearing(intel.last_known_bearing as number)}, range ${(((intel.last_known_range_m as number) / 1000)).toFixed(1)} km.`
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
    const weapons = {
      laser: ship.laserCooldown > 0 ? `recharging, ready in ${ship.laserCooldown.toFixed(0)}s` : "ready",
      laser_range_m: C.LASER_RANGE_M,
      missiles_remaining: missilesAboard(ship),
      ...tubes,
      decoys_remaining: ship.decoys,
    };
    const zone = {
      distance_from_center_m: Math.round(dist(ship.x, ship.y, 0, 0)),
      zone_radius_m: C.REGION_RADIUS_M,
      inside_zone: this.insideZone(ship),
      current_sensor_range_m: this.sensorRangeOf(ship),
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
          laser_ready_in_s: Math.ceil(ship.laserCooldown),
        };
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

    const enemy = this.enemyOf(id);
    let enemyBlock: Record<string, unknown> | null = null;
    if (enemy && ship.enemyVisible) {
      enemyBlock = {
        visible: true,
        x: enemy.x,
        y: enemy.y,
        vx: enemy.vx,
        vy: enemy.vy,
        facing: enemy.facing,
        // hull readout on a visible contact (drives the enemy hull bar)
        hull: enemy.hull,
        hullMax: enemy.isDrone ? C.DRONE_HULL_POINTS : C.HULL_POINTS,
      };
    } else if (ship.lastKnownEnemy) {
      enemyBlock = {
        visible: false,
        lastKnown: ship.lastKnownEnemy, // {x, y, facing, t}
      };
    }

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
        laserCooldown: ship.laserCooldown,
        insideZone: this.insideZone(ship),
        sensorRange: this.sensorRangeOf(ship),
        standingOrders: ship.standingOrders.map((o) => ({
          label: o.label,
          repeat: o.repeat,
          armed: o.cooldown <= 0,
        })),
      },
      enemy: enemyBlock,
      // own ordnance always; enemy ordnance only within detect range
      missiles: [
        ...this.missiles
          .filter((m) => m.owner === id)
          .map((m) => ({ id: m.id, x: m.x, y: m.y, vx: m.vx, vy: m.vy, own: true })),
        ...this.visibleEnemyMissiles(ship).map((m) => ({
          id: m.id, x: m.x, y: m.y, vx: m.vx, vy: m.vy, own: false,
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
        if (f.type === "laser") return f.owner === id || ship.enemyVisible;
        return dist(ship.x, ship.y, f.x, f.y) <= this.sensorRangeOf(ship);
      }),
    };
  }

  // Called by the match after all per-player snapshots are broadcast.
  clearFx(): void {
    this.fx = [];
  }
}
