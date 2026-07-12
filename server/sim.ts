// tick loop, physics, weapons, standing orders
import * as C from "./constants.js";
import {
  type Terrain,
  type Rock,
  emptyTerrain,
  generateTerrain,
  firstRockHit,
  firstLosBreakT,
  segCircleHitT,
  losClear,
  insideDust,
} from "./terrain.js";
import { hunterDecide, initialHunterMem, type HunterIntel, type HunterMem, type HunterSnap } from "./hunter.js";

// v5 §2: N-player rooms. "A"/"B" remain the conventional ids in tests and
// practice mode; rooms hand out seat ids from their own scheme.
export type ShipId = string;

// The enum forms plus free-form CONTACT REFS (v5 §3): a designation letter
// ("Bravo", "contact bravo") or an identified callsign ("Kestrel"). Refs
// resolve against the ordering captain's own contact book — never against
// ground truth (asking for a callsign you haven't identified is a miss).
export type TargetKind =
  | "enemy_ship"
  | "nearest_missile"
  | "nearest_decoy"
  | "nearest_contact"
  | "nearest_rumble"
  | (string & {});

export type HeadingParams =
  | { mode: "relative"; direction: "port" | "starboard"; degrees: number }
  | { mode: "absolute"; degrees: number }
  | { mode: "target"; target: TargetKind };

export interface Command {
  verb:
    | "set_thrust"
    | "set_heading"
    | "set_pdc"
    | "set_lock_target"
    | "fire_missile"
    | "fire_railgun"
    | "launch_probe"
    | "transmit"
    | "reload_tubes"
    | "deploy_decoy"
    | "maneuver"
    | "salvage"
    | "show_vector"
    | "set_overlay"
    | "sensor_ping"
    | "set_standing_order"
    | "query";
  params: Record<string, unknown>;
  acknowledgement?: string;
}

export type PdcPosture = "free" | "hold";

// Autopilot macros: a maneuver has a DEFINED END STATE — it runs, finishes,
// announces. The executor switches on type so future macros (v5+) are
// additive. salvage (campaign §4): full-stop physics, then the sequential
// transfer runs while stopped alongside the wreck — any thrust/heading
// order aborts it (you keep what already landed).
export type Maneuver = { type: "full_stop" } | { type: "salvage"; wreckId: number };

// Goal heading as stored.
// absolute: steer shortest-arc to a compass heading. turn: a RELATIVE turn
// as signed degrees remaining (+ = starboard/CW, - = port/CCW) — honors the
// commanded direction even past 180 and makes a full 360 pirouette real
// instead of a silent no-op (v4.4 fix: norm360(facing + 360) used to
// collapse to "already there"). track: CONTINUOUS tracking (v5 §1, a
// deliberate reversal of the v4 snapshot rule) — the helm re-resolves the
// target's bearing every tick into `degrees` until the order is replaced;
// `lost` edge-flags the below-faint fallback to last-known so the XO
// announces it once, not every tick.
export type HeadingGoal =
  | { mode: "absolute"; degrees: number }
  | { mode: "turn"; remaining: number }
  | { mode: "track"; target: TargetKind; degrees: number; lost: boolean };

export interface Tube {
  loaded: boolean;
  reload: number; // seconds until loaded (0 while loaded or empty-with-no-reserve)
}

// This ship's missile lock on its DESIGNATED target (v5 §2: with several
// hostiles the lock is per-target — `target` defaults to the nearest tracked
// hostile in the cone and sticks while progress accrues; §9 adds explicit
// designation via set_lock_target). progress accumulates while the target is
// in cone+range+sensor-visible; grace keeps it alive through blips.
export interface LockState {
  target: ShipId | null; // whom the lock is building on (null = idle, auto-picks)
  progress: number; // seconds accumulated toward LOCK_TIME_S
  has: boolean;
  grace: number; // seconds of grace remaining once conditions break
}

// Per-viewer-per-target sensor bookkeeping (v5 §2). What one ship's sensors
// currently make of one hostile: earned tier, the noisy faint fix, and the
// last-known ghost. Lives in Sim.shipContacts, never in snapshots directly —
// fog is enforced when snapshotFor reads it.
export interface ContactState {
  tier: 0 | 1 | 2 | 3;
  // v5 §6: true when a probe relay (not the ship's own sensors) is what
  // sustains the current tier — the "via probe" provenance marker
  viaProbe: boolean;
  faint: { x: number; y: number; t: number } | null;
  lastKnown: { x: number; y: number; facing: number; t: number } | null;
}

// v5 §3: one per-observer DESIGNATION per tracked object (hostile ships AND
// unresolved enemy decoys — a decoy contact must be indistinguishable from
// a ship contact, so both draw letters from the same book and get the same
// XO ceremony; this deliberately reverses the v4.1 "decoys get no
// transition lines" call, which would unmask them by silence in a lettered
// world). The letter doubles as the snapshot contact id — the old
// object-keyed cids let a JSON-reading client correlate tracks the XO
// claims it cannot, and told ships from decoys by prefix.
export interface ContactRecord {
  letter: string; // "Alpha" — stable per observer unless correlation fails
  identified: boolean; // ID tier reached: ship -> callsign known; decoy -> resolved
  prevTier: 0 | 1 | 2 | 3; // last announced tier (drives transition lines)
  lostAt: number | null; // tickCount when the track dropped to tier 0
  lastKnown: { x: number; y: number; facing: number; t: number } | null;
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
  // v5 §3: permanent, server-assigned, never typed. An observer learns it
  // only at ID tier (or a §7 broadcast voiceprint). Tests default it to
  // the ship id.
  callsign: string;
  // v5 §4: stat block (numbers only — see ARCHETYPES). Tests default to
  // the frigate, which IS the v4 baseline. An observer learns a hull's
  // archetype only at ID tier.
  archetype: C.ArchetypeName;
  // v5 §2 teams: null = FFA (everyone hostile). Two ships are hostile iff
  // ids differ and either has no team or the teams differ.
  team: string | null;
  // v5 §2 disconnect: a GHOST drifts ballistic — thrust forced to 0,
  // standing orders suspended, PDCs on last posture — until reconnect or
  // the timer scuttles it quietly (no announcement to others: a ghost that
  // stops being a ghost is information nobody earned).
  ghost: boolean;
  ghostTimerS: number;
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
  lock: LockState; // my lock on the designated target
  // v5 §3: explicit lock designation — a contact-book KEY ("s<id>"/"d<id>")
  // chosen via set_lock_target. While set, the auto-picker stands down; a
  // designated decoy contact simply never completes (the fiction: no hard
  // return), which is fog-correct — rejecting it would unmask the decoy.
  lockDesignation: string | null;
  prevPainted: PaintedState; // enemy's lock on me last tick (edge-triggered notices)
  sigSpikeLaunch: number; // seconds of +SIG_SPIKE_LAUNCH remaining after firing
  // v5 §5 railgun (frigate/cruiser; corvette carries none)
  railSlugs: number;
  railCooldownS: number;
  // v5 §6 probes (per archetype; no reloads)
  probesLeft: number;
  probeCounter: number; // launch ordinal ("probe two")
  // v5 §7 comms: per-channel anti-spam cooldowns
  commsCooldownBroadcastS: number;
  commsCooldownTightbeamS: number;
  sigSpikeRail: number; // seconds of +RAIL_SIG_SPIKE remaining after firing
  droneCooldown: number; // drone-only: seconds until it may fire again
  droneWaypoint: number; // drone-only: index into the patrol route
  droneDodge: -1 | 0 | 1; // drone-only: committed dodge direction (hysteresis)
  isDrone: boolean;
  // Campaign (Deep Black): per-ship stat multipliers — mission difficulty
  // knobs on Hunters, §6 progression modules on the player. 1 on every
  // multiplayer hull. sigMult scales the TOTAL emitted signature in
  // signatureOf (deliberately also seeker/lock-relevant — see the
  // HUNTER_SIG_MULT comment in constants.ts); sensorMult scales this
  // viewer's sensor base in detectionRange; accelMult/hullMult scale the
  // archetype stats at their single read points.
  sensorMult: number;
  sigMult: number;
  accelMult: number;
  hullMult: number;
  // Campaign Hunter: when set, step() phase-0 feeds this ship's own fog
  // snapshot to hunterDecide (server/hunter.ts — the fog firewall).
  hunterAI: boolean;
  hunterMem: HunterMem;
  hunterSpec: C.HunterSpec | null; // ladder row entry (gateCamp lives here)
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
  // COMPAT/derived (v5 §2): the max stored tier this viewer holds on any
  // hostile — the 1v1 meaning when there is one enemy. Defined as a getter
  // in addShip; per-target state lives in Sim.shipContacts (contactOn).
  readonly contactTier: 0 | 1 | 2 | 3;
}

// Total missiles aboard: reserve + loaded tubes + missiles mid-reload (a
// reloading tube already contains its missile).
export function missilesAboard(ship: Ship): number {
  return ship.reserve + ship.tubes.filter((t) => t.loaded || t.reload > 0).length;
}

// v5 §4: a ship's stat block. All per-archetype numbers flow through here.
export function statsOf(ship: Ship): C.ArchetypeStats {
  return C.ARCHETYPES[ship.archetype];
}

export function hullMaxOf(ship: Ship): number {
  // hullMult: campaign §6 progression module (1 everywhere else)
  return ship.isDrone ? C.DRONE_HULL_POINTS : Math.round(statsOf(ship).hull * ship.hullMult);
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
  // uplink subject: the ship the mother's lock was on at launch (v5 §2 —
  // with several hostiles "the enemy" is no longer derivable from owner).
  // null for blind-fired birds.
  target: ShipId | null;
  // v5 §8 IFF: the launcher's team, stamped at launch (the transponder
  // outlives its owner — a dead teammate's bird still knows its friends)
  team: string | null;
  cmdBearing: number | null; // blind fire: absolute bearing to steer onto
  // lock: what the seeker is steering at right now (autonomous only; an
  // uplinked bird's target is the mother ship's track)
  lock:
    | { type: "ship"; id: ShipId }
    | { type: "decoy"; id: number }
    | { type: "probe"; id: number }
    | null;
}

export interface Decoy {
  id: number;
  owner: ShipId;
  team: string | null; // v5 §8 IFF stamp
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

// v5 §5: a rail slug — pure ballistics. Constant velocity (shooter's
// velocity inherited at launch + RAIL_SLUG_SPEED along the firing line),
// no guidance, no IFF, stopped by rocks and hulls, obliterates ordnance
// it grazes without stopping. Nothing engages it.
export interface Slug {
  id: number;
  owner: ShipId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  prevX: number;
  prevY: number;
  age: number;
}

// v5 §6: a sensor probe — burn-and-drift ballistics (PROBE_ACCEL along
// the fixed launch bearing for PROBE_BURN_S, then coast), a relay for its
// own fog-scoped sensor picture, and a legitimate target.
export interface Probe {
  id: number;
  owner: ShipId;
  team: string | null; // v5 §8 IFF stamp
  idx: number; // 1-based per owner: "probe two"
  bearing: number; // launch bearing; the burn never steers
  x: number;
  y: number;
  vx: number;
  vy: number;
  prevX: number;
  prevY: number;
  age: number;
}

// Transient render effects, cleared after each broadcast.
// ping (v4.7): the expanding ring + terrain shadow. mask[i] = range along
// bearing i*(360/PING_SHADOW_SAMPLES) where LOS from the origin first
// breaks (PING_RANGE_M if clear). Derivable entirely from terrain (public)
// + the pinger's position (public for PING_REVEAL_S as the ping's stated
// price) — it must NEVER grow contacts, grants, or ship state (fog test).
export type Fx =
  | { type: "pdc"; owner: ShipId; x1: number; y1: number; x2: number; y2: number }
  | { type: "boom"; x: number; y: number }
  | { type: "ping"; x: number; y: number; r: number; mask: number[] };

export type SimEvent =
  | { kind: "reject"; ship: ShipId; verb: string; reason: string }
  // verb rides along so the match can apply the v5.1 §1.3 ack rule: acks of
  // commands whose effect is instantly HUD-visible get no voice
  | { kind: "ack"; ship: ShipId; verb: string; text: string }
  // speak: optional TTS-safe variant (quantized digit-word bearings, no
  // abbreviations); the transcript displays `text`, the voice says `speak`.
  // silent: transcript-only — never synthesized (v5.1 §1.3: confirmations
  // of instantly-visible effects, e.g. the drift-marker toggle)
  | { kind: "notice"; ship: ShipId | "all"; text: string; alert?: boolean; speak?: string; silent?: boolean }
  | { kind: "ui"; ship: ShipId; what: "show_vector" } // client-side overlay triggers
  // persistent client-side overlay toggles (v4.7): pure ui, no sim state.
  // v5 adds ELEMENT values (probe markers, designations), not new events.
  | { kind: "ui"; ship: ShipId; what: "overlay"; element: string; state: "on" | "off" }
  // v5 §2: a ship's destruction is its own event (the match flows that
  // captain into spectator mode); gameover fires when hostilities are over.
  // placements: final standings, winner-first (survivors, then deaths in
  // reverse order). winner is a ship id in FFA, a team name in Teams;
  // winnerName/placementNames carry callsigns for banners (§3).
  | { kind: "death"; ship: ShipId; callsign: string; attacker: ShipId | null }
  // quiet ghost scuttle (v5 §2): the seat is freed but nobody is told
  | { kind: "scuttle"; ship: ShipId }
  // campaign (Stage 1): a NON-final gate crossing — the run continues.
  // The Match exports run state and stages the next system; deliberately
  // NOT a gameover (the Stage-0 coupling was stage-0-only).
  | { kind: "system_clear"; ship: ShipId; system: number }
  // v5 §7: a delivered transmission — the match routes it to the
  // recipient(s) as a comms transcript line their XO reads verbatim
  | { kind: "transmission"; from: ShipId; fromName: string; to: ShipId | "all"; text: string }
  | {
      kind: "gameover";
      winner: string;
      winnerName: string;
      placements: string[];
      placementNames: string[];
      // campaign (Stage 0): the player flew out through the gate
      gateCleared?: boolean;
    };

// Campaign salvage (§4): one item per SALVAGE_ITEM_S, worst -> best — a
// greed curve, not a progress bar. "upgrade" is the run-maker: a permanent
// per-run stat module (§6 — a multiplier, not a tech tree).
export interface SalvageItem {
  kind: "propellant" | "missiles" | "pdc_ammo" | "hull" | "decoys" | "upgrade";
  amount: number;
  upgrade?: "sig" | "sensor" | "accel" | "hull";
}
// A wreck: a known location where a ship will predictably be, stationary,
// for thirty seconds (§4.3). marked = public knowledge, WATCHED by the
// Hunter; rumored = the player's private lead — the Hunter never learns it.
// checked: the player has been close enough to eyeball a rumor (contents
// revealed, or the dry hole discovered and struck off the map).
export interface Wreck {
  id: number;
  x: number;
  y: number;
  marked: boolean;
  checked: boolean;
  items: SalvageItem[];
}

// Campaign "Deep Black" (HANDOFF-CAMPAIGN-v1.md). Set by Match on a
// campaign sim, absent on every multiplayer sim — the presence of this
// object is the ONLY gate to any campaign behavior in here.
export interface Mission {
  playerId: ShipId;
  system: number; // 1-based ladder row (CAMPAIGN_LADDER[system - 1])
  systemName: string; // "The Drifter" ... "The Wolfpack" — the XO names it
  // gate center sits ON the region rim; the aperture segment is the rim
  // tangent through it (perpendicular to the outward radial). Pylons are
  // ordinary terrain rocks appended by the Match.
  gate: { x: number; y: number; apertureW: number };
  hunterSpawnS: number; // FIXED per system (spec §1/§3 — the clock never shrinks; pinned)
  hunterSpawned: boolean;
  hunterIds: ShipId[];
  // difficulty is numbers only (spec §2.1) — one ladder row's hunter specs;
  // the dev harness sweeps the multipliers live
  hunters: C.HunterSpec[];
  spawnLine: string; // clock-zero XO line; NEVER carries a bearing (§7.1)
  wrecks: Wreck[];
  salvaging: { wreckId: number; t: number } | null; // active transfer clock
  cleared: boolean; // aperture crossed — the system is over (transition or final win)
  // run bookkeeping for the §9 summary + §6 progression export
  stats: { huntersKilled: number; salvaged: number; pingsFired: number; upgrades: number };
  // everything that came aboard THIS system, in landing order — the run
  // map's manifest (playtest: "the end screen didn't tell me what I got")
  haul: SalvageItem[];
  // the decoy doctrine line fires at most once per system (teach, don't nag)
  decoyTaught: boolean;
  // modules collected THIS system, by kind — the Match folds them into the
  // run state at system clear (counts, not multipliers: the client's
  // localStorage carries counts and the server re-derives the multipliers)
  upgradeCounts: { sig: number; sensor: number; accel: number; hull: number };
  // gate-solution XO bookkeeping (edge-triggered, rate-limited)
  solGood: boolean;
  solCooldownS: number;
}

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

// Proper segment-segment crossing (strict — collinear touches don't count;
// at float precision a gate crossing is never exactly collinear). Used by
// the campaign gate aperture test each physics substep (invariant 6: fast
// objects are swept, never point-tested).
export function segsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number
): boolean {
  const orient = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

export function fmtBearing(deg: number): string {
  return String(Math.round(norm360(deg)) % 360).padStart(3, "0");
}

// Spoken form of a bearing: 10°-quantized digit words ("three three zero").
// Two problems, one fix (v4.7.1): ElevenLabs reads numerals like "331" and
// trailing "km." unpredictably (playtest: "totally garbled"), and every
// unique numeral string is a fresh synthesis — digit words at 10° cap each
// line shape at 36 cached variants (the v4.6 rumble lesson, applied to the
// rest of the XO's bearing calls). Display text keeps the exact numbers;
// this is only what the voice says.
const DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
export function spokenBearing(deg: number): string {
  const q = (Math.round(norm360(deg) / 10) * 10) % 360;
  return String(q)
    .padStart(3, "0")
    .split("")
    .map((d) => DIGIT_WORDS[Number(d)])
    .join(" ");
}

const TUBE_NAMES = ["one", "two", "three", "four"];
const PROBE_NAMES = ["one", "two", "three", "four", "five", "six"];
// v5.1 §3.2 aggregated rumble lines ("Three drives out there, Captain")
const COUNT_WORDS: Record<number, string> = {
  2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight",
};

// v5.1 §3.4: the XO gets terser as the board gets busier — the spoken-
// announcement range shrinks with the contact count. 1 contact -> 60 km
// (tell me everything); 3+ -> floored at 20 km (only what can hurt me).
export function contactAnnounceRange(boardCount: number): number {
  return clamp(
    C.CONTACT_ANNOUNCE_RANGE_BASE_M / Math.max(1, boardCount),
    C.CONTACT_ANNOUNCE_RANGE_MIN_M,
    C.CONTACT_ANNOUNCE_RANGE_BASE_M
  );
}

// ---------- sim ----------

export class Sim {
  ships = new Map<ShipId, Ship>();
  missiles: Missile[] = [];
  decoys: Decoy[] = [];
  slugs: Slug[] = [];
  probes: Probe[] = [];
  // v5 §7: live broadcast spikes — a transmitting hull is a flare for
  // COMMS_SPIKE_S, callsign attached (voiceprint). Position frozen at
  // transmit time; every viewer computes their own bearing chevron.
  private commsSpikes: { x: number; y: number; from: ShipId; callsign: string; expiresAtTick: number }[] = [];
  terrain: Terrain;
  tickCount = 0;
  // Campaign (Deep Black): null on every multiplayer sim.
  mission: Mission | null = null;
  // Ship id in FFA, team name in Teams mode; set when hostilities end.
  winner: string | null = null;
  // Death order (first element died first). Ghost scuttles count as deaths.
  placements: ShipId[] = [];
  private nextId = 1;
  // v5 §2: per-viewer-per-target sensor state (see ContactState).
  private shipContacts = new Map<ShipId, Map<ShipId, ContactState>>();
  // v5 §3: per-viewer designation books. Records keyed "s<shipId>" /
  // "d<decoyId>"; tombstones are ghosts orphaned by failed correlation
  // (the old letter's last-known fix stays on the map — deleting it would
  // leak that the new letter is the same hull).
  private contactBooks = new Map<
    ShipId,
    {
      records: Map<string, ContactRecord>;
      counter: number;
      tombstones: { letter: string; lastKnown: { x: number; y: number; facing: number; t: number } }[];
    }
  >();
  // v5 §3: per-viewer opaque rumble aliases ("r1", "r2", ...) — the wire
  // must not let a client correlate rumbles across time by object id, nor
  // tell a ship rumble from a decoy rumble by prefix (invariants 11/13).
  private rumbleAliases = new Map<ShipId, Map<string, string>>();
  // Callsigns survive ship removal (placements/banners name the fallen).
  private callsigns = new Map<ShipId, string>();
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
  // v5.1 §3.1: per-VIEWER announcement budget + pending-change flags — one
  // aggregated line per RUMBLE_ANNOUNCE_COOLDOWN_S window, however many
  // emitters are out there. Dirty flags persist across gapped ticks so a
  // change that arrives mid-cooldown still gets told when the window opens.
  private rumbleBudget = new Map<ShipId, { cooldown: number; fresh: boolean; drifted: boolean; lost: boolean }>();

  // No seed = empty terrain (headless tests build exact fields by hand);
  // matches always pass one.
  constructor(seed: string | null = null) {
    this.terrain = seed ? generateTerrain(seed) : emptyTerrain();
  }

  // A sensor/lock/seeker ray between two points, blocked by rocks and dust.
  losClear(x1: number, y1: number, x2: number, y2: number): boolean {
    return losClear(x1, y1, x2, y2, this.terrain);
  }

  addShip(
    id: ShipId,
    x: number,
    y: number,
    facing: number,
    isDrone = false,
    team: string | null = null,
    callsign: string = id,
    archetype: C.ArchetypeName = "frigate"
  ): Ship {
    const stats = C.ARCHETYPES[archetype];
    const ship: Ship = {
      id,
      callsign,
      archetype,
      team,
      ghost: false,
      ghostTimerS: 0,
      x,
      y,
      vx: 0,
      vy: 0,
      facing: norm360(facing),
      thrust: 0,
      goal: null,
      maneuver: null,
      hull: isDrone ? C.DRONE_HULL_POINTS : stats.hull,
      // tubes start loaded from the magazine: frigate = 2 loaded + 4 reserve
      reserve: Math.max(0, stats.magazine - stats.tubes),
      tubes: Array.from({ length: stats.tubes }, () => ({ loaded: true, reload: 0 })),
      decoys: stats.decoys,
      pdcPosture: "free", // default at spawn
      pdcAmmoS: stats.pdcAmmoS,
      pdcAmmoTier: 100,
      sigSpikePdc: 0,
      underPdcFire: false,
      propellant: C.PROPELLANT_MAX,
      propellantTier: 100,
      lock: { target: null, progress: 0, has: false, grace: 0 },
      lockDesignation: null,
      railSlugs: stats.railSlugs,
      railCooldownS: 0,
      probesLeft: stats.probes,
      probeCounter: 0,
      commsCooldownBroadcastS: 0,
      commsCooldownTightbeamS: 0,
      sigSpikeRail: 0,
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
      sensorMult: 1,
      sigMult: 1,
      accelMult: 1,
      hullMult: 1,
      hunterAI: false,
      hunterMem: initialHunterMem(),
      hunterSpec: null,
      standingOrders: [],
      orderCounter: 0,
      wasInsideZone: true, // spawn is well inside the zone
      wasInDust: false,
      collisionWarnS: null,
      collisionTier: null,
      contactTier: 0,
    };
    // contactTier is DERIVED (max stored tier over hostiles — the 1v1
    // meaning with a single enemy); per-target state is in shipContacts.
    Object.defineProperty(ship, "contactTier", {
      get: (): 0 | 1 | 2 | 3 => {
        let t: 0 | 1 | 2 | 3 = 0;
        for (const h of this.hostilesOf(ship)) {
          const st = this.shipContacts.get(ship.id)?.get(h.id);
          if (st && st.tier > t) t = st.tier;
        }
        return t;
      },
    });
    if (isDrone) ship.thrust = C.DRONE_THRUST_PERCENT; // signature only
    this.ships.set(id, ship);
    this.callsigns.set(id, callsign);
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
    let sig = statsOf(obj).sigBase + effectiveThrust(obj);
    if (obj.sigSpikeLaunch > 0) sig += C.SIG_SPIKE_LAUNCH;
    if (obj.sigSpikePdc > 0) sig += C.SIG_SPIKE_PDC;
    if (obj.sigSpikeRail > 0) sig += C.RAIL_SIG_SPIKE;
    // campaign sigMult scales the TOTAL (base + thrust + spikes) — "engine
    // baffling". 1 for every multiplayer hull. Every detection consumer
    // (tiers, hearing, seekers, PDC slaving) flows through here, which is
    // the point — see HUNTER_SIG_MULT in constants.ts.
    return sig * obj.sigMult;
  }

  // Signature follows the engine: a coasting torpedo nearly vanishes.
  missileSignature(m: Missile): number {
    return m.burning ? C.MISSILE_SIG_BURNING : C.MISSILE_SIG_COASTING;
  }

  // How far away a target of this signature can be seen (LOS permitting).
  // v5 §4: the viewer's sensor suite sets the base — pass the viewer
  // whenever there is one (the bare form keeps the frigate baseline for
  // formula notes).
  detectionRange(signature: number, viewer?: Ship): number {
    // campaign sensorMult: the viewer's suite quality (1 in multiplayer)
    return (viewer ? statsOf(viewer).sensorBase * viewer.sensorMult : C.SENSOR_BASE_M) * (signature / 100);
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
    const detect = this.detectionRange(this.signatureOf(enemy), viewer);
    if (detect <= 0) return granted as 0 | 2;
    const frac = range / detect;
    if (frac <= C.TIER_ID_FRAC) return 3;
    if (frac <= C.TIER_TRACK_FRAC) return 2;
    if (frac <= C.TIER_FAINT_FRAC) return Math.max(1, granted) as 1 | 2;
    return granted as 0 | 2;
  }

  // v5 §6: the tier a PROBE earns on an emitter — the same band math from
  // the probe's own position with its reduced PROBE_SENSOR_BASE_M eyes.
  // All fog rules apply from there: LOS from the probe, ping reveals and
  // outside-the-region signature-max included.
  private probeTierOn(
    pr: Probe,
    x: number,
    y: number,
    sig: number,
    revealed = false,
    outsideZone = false
  ): 0 | 1 | 2 | 3 {
    if (revealed) return 3;
    if (!this.losClear(pr.x, pr.y, x, y)) return 0;
    if (outsideZone) return 3;
    const detect = C.PROBE_SENSOR_BASE_M * (sig / 100);
    if (detect <= 0) return 0;
    const frac = dist(pr.x, pr.y, x, y) / detect;
    if (frac <= C.TIER_ID_FRAC) return 3;
    if (frac <= C.TIER_TRACK_FRAC) return 2;
    if (frac <= C.TIER_FAINT_FRAC) return 1;
    return 0;
  }

  private probesOf(id: ShipId): Probe[] {
    return this.probes.filter((pr) => pr.owner === id);
  }

  // v5 §8 IFF for GUIDED systems: same owner or same stamped team. Rail
  // slugs and collisions deliberately never consult this — physics doesn't
  // read transponders.
  private sameSide(
    aOwner: ShipId,
    aTeam: string | null,
    bOwner: ShipId,
    bTeam: string | null
  ): boolean {
    // != null (not !==): hand-built test ordnance may omit the stamp, and
    // undefined === undefined must not read as "same team"
    return aOwner === bOwner || (aTeam != null && aTeam === bTeam);
  }

  // v5 §2 hostility: everyone in FFA (team null); teammates never.
  isHostile(a: Ship, b: Ship): boolean {
    return a.id !== b.id && (a.team === null || b.team === null || a.team !== b.team);
  }

  // v5 §8 transponders: teammates are permanently on each other's maps at
  // full state. NOTHING else is shared — no fused contacts, no rumbles,
  // no probe feeds; intel moves by TALKING (deliberate and load-bearing).
  alliesOf(ship: Ship): Ship[] {
    const out: Ship[] = [];
    for (const s of this.ships.values()) {
      if (s.id !== ship.id && !this.isHostile(ship, s)) out.push(s);
    }
    return out;
  }

  hostilesOf(ship: Ship): Ship[] {
    const out: Ship[] = [];
    for (const s of this.ships.values()) {
      if (this.isHostile(ship, s)) out.push(s);
    }
    return out;
  }

  // The viewer's stored sensor state on one target (created lazily).
  contactOn(viewerId: ShipId, targetId: ShipId): ContactState {
    let m = this.shipContacts.get(viewerId);
    if (!m) {
      m = new Map();
      this.shipContacts.set(viewerId, m);
    }
    let st = m.get(targetId);
    if (!st) {
      st = { tier: 0, viaProbe: false, faint: null, lastKnown: null };
      m.set(targetId, st);
    }
    return st;
  }

  // ---------- v5 §3: designations ----------

  private bookOf(viewerId: ShipId) {
    let book = this.contactBooks.get(viewerId);
    if (!book) {
      book = { records: new Map(), counter: 0, tombstones: [] };
      this.contactBooks.set(viewerId, book);
    }
    return book;
  }

  private nextLetter(book: { counter: number }): string {
    const n = book.counter++;
    const base = C.DESIGNATION_LETTERS[n % C.DESIGNATION_LETTERS.length];
    const round = Math.floor(n / C.DESIGNATION_LETTERS.length);
    return round === 0 ? base : `${base}-${round + 1}`;
  }

  // The record an observer keeps on one trackable object ("s<shipId>" or
  // "d<decoyId>"), if any. Records are created by updateDesignations when
  // a contact is first acquired.
  recordOn(viewerId: ShipId, key: string): ContactRecord | undefined {
    return this.contactBooks.get(viewerId)?.records.get(key);
  }

  // What this viewer's XO calls a tracked ship: the callsign once
  // identified, the letter designation otherwise, and a generic word if
  // it was never designated at all (e.g. an unseen attacker).
  labelFor(viewerId: ShipId, targetId: ShipId): string {
    const rec = this.recordOn(viewerId, `s${targetId}`);
    if (!rec) return "the contact";
    if (rec.identified) return this.callsigns.get(targetId) ?? "the contact";
    return `Contact ${rec.letter}`;
  }

  // Resolve a spoken contact reference against this viewer's book: a
  // designation letter ("bravo", "Contact Bravo", "bravo-2") or an
  // IDENTIFIED callsign ("kestrel" — asking for one you haven't earned is
  // a miss, never a leak). Tombstoned letters resolve too ("t:<letter>").
  resolveContactRef(viewerId: ShipId, ref: string): string | null {
    const book = this.contactBooks.get(viewerId);
    if (!book) return null;
    const norm = ref.trim().toLowerCase().replace(/^contact\s+/, "");
    for (const [key, rec] of book.records) {
      if (rec.letter.toLowerCase() === norm) return key;
    }
    for (const [key, rec] of book.records) {
      if (!rec.identified || !key.startsWith("s")) continue;
      const cs = this.callsigns.get(key.slice(1));
      if (cs && cs.toLowerCase() === norm) return key;
    }
    for (const t of book.tombstones) {
      if (t.letter.toLowerCase() === norm) return `t:${t.letter}`;
    }
    // v5 §8: teammates resolve by callsign (transponders — always known)
    const viewer = this.ships.get(viewerId);
    if (viewer) {
      for (const t of this.alliesOf(viewer)) {
        if (t.callsign.toLowerCase() === norm) return `a${t.id}`;
      }
    }
    return null;
  }

  // Fog-aware position of one contact-book entry: live sensor data at the
  // earned tier, else the record's last-known fix (live:false drives the
  // helm's "lost him" line).
  private recordPos(
    viewer: Ship,
    key: string
  ): { x: number; y: number; live: boolean } | null {
    const book = this.contactBooks.get(viewer.id);
    if (key.startsWith("t:")) {
      const t = book?.tombstones.find((k) => `t:${k.letter}` === key);
      return t ? { x: t.lastKnown.x, y: t.lastKnown.y, live: false } : null;
    }
    if (key.startsWith("a")) {
      // a teammate: transponder truth, always live (v5 §8)
      const t = this.ships.get(key.slice(1));
      return t ? { x: t.x, y: t.y, live: true } : null;
    }
    const rec = book?.records.get(key);
    if (!rec) return null;
    if (key.startsWith("s")) {
      const target = this.ships.get(key.slice(1));
      const st = target ? this.contactOn(viewer.id, target.id) : null;
      if (target && st && st.tier >= 2) return { x: target.x, y: target.y, live: true };
      if (st && st.tier === 1 && st.faint) return { x: st.faint.x, y: st.faint.y, live: true };
    } else {
      const did = Number(key.slice(1));
      const d = this.decoys.find((k) => k.id === did);
      if (d) {
        const tier = this.decoyTierFor(viewer, d);
        if (tier >= 2) return { x: d.x, y: d.y, live: true };
        if (tier === 1) {
          const fix = this.decoyFaint.get(viewer.id)?.get(did);
          if (fix) return { x: fix.x, y: fix.y, live: true };
        }
      }
    }
    if (rec.lastKnown) return { x: rec.lastKnown.x, y: rec.lastKnown.y, live: false };
    return null;
  }

  // Nearest hostile this viewer holds at TRACK or better — the subject of
  // the nearest-hostile standing-order metrics (v5 §3 spec change).
  private nearestTrackedHostile(ship: Ship): Ship | null {
    return this.nearestOf(
      ship,
      this.hostilesOf(ship).filter((h) => this.contactOn(ship.id, h.id).tier >= 2)
    );
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
          // v5 §1: CONTINUOUS tracking — the helm re-resolves the target's
          // bearing every tick (refreshTrackGoals) until a new heading or
          // maneuver order replaces this goal.
          const pos = this.resolveTargetPos(ship, p.target);
          if (!pos) {
            if (p.target === "nearest_rumble") return "No rumble to steer on, Captain.";
            if (
              !["enemy_ship", "nearest_missile", "nearest_decoy", "nearest_contact"].includes(
                p.target
              )
            ) {
              return "No contact by that name on the board, Captain.";
            }
            return "No contact to point at, Captain.";
          }
          ship.goal = {
            mode: "track",
            target: p.target,
            degrees: bearingTo(ship.x, ship.y, pos.x, pos.y),
            lost: !pos.live,
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
      case "salvage": {
        // Campaign §4.1: one verb, and it is a maneuver. The XO handles the
        // velocity-matching; getting alongside is the captain's flying.
        // Resolution is BY PROXIMITY (nearest wreck with anything left) —
        // wrecks are landmarks, not fog contacts, so a contact-ref grammar
        // would be theater. Any thrust/heading order aborts the transfer.
        const m = this.mission;
        if (!m || ship.id !== m.playerId) return "Nothing to salvage out here, Captain.";
        const cand = m.wrecks
          .filter((w) => w.items.length > 0)
          .map((w) => ({ w, d: dist(ship.x, ship.y, w.x, w.y) }))
          .sort((a, b) => a.d - b.d)[0];
        if (!cand) return "No wrecks left with anything in them, Captain.";
        if (cand.d > C.SALVAGE_DOCK_RANGE_M * 3) {
          return "No wreck in docking range, Captain — get us alongside first.";
        }
        ship.maneuver = { type: "salvage", wreckId: cand.w.id };
        events.push({ kind: "notice", ship: ship.id, text: "Coming alongside, Captain." });
        // the stock notice is the whole confirmation (set_overlay precedent)
        delete cmd.acknowledgement;
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
          events.push({ kind: "notice", ship: ship.id, text, silent: true });
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
        // campaign §9: "pings fired" is a run-summary stat (a confession)
        if (this.mission && ship.id === this.mission.playerId) this.mission.stats.pingsFired += 1;
        ship.pingGrantShips = new Set();
        ship.pingGrantDecoys = new Set();
        ship.pingGrantMissiles = new Set();
        const insonified = (x: number, y: number) =>
          dist(ship.x, ship.y, x, y) <= C.PING_RANGE_M && this.losClear(ship.x, ship.y, x, y);
        for (const h of this.hostilesOf(ship)) {
          if (insonified(h.x, h.y)) ship.pingGrantShips.add(h.id);
        }
        for (const d of this.decoys) {
          if (d.owner !== ship.id && insonified(d.x, d.y)) ship.pingGrantDecoys.add(d.id);
        }
        for (const m of this.missiles) {
          if (m.owner !== ship.id && insonified(m.x, m.y)) ship.pingGrantMissiles.add(m.id);
        }
        // v4.7: the ring the captain sees IS the area of effect — each mask
        // entry is where this bearing's LOS first breaks (rock or dust)
        const mask: number[] = [];
        for (let i = 0; i < C.PING_SHADOW_SAMPLES; i++) {
          const [dx, dy] = headingVec((i * 360) / C.PING_SHADOW_SAMPLES);
          const t = firstLosBreakT(
            ship.x, ship.y,
            ship.x + dx * C.PING_RANGE_M, ship.y + dy * C.PING_RANGE_M,
            this.terrain
          );
          mask.push(t === null ? C.PING_RANGE_M : t * C.PING_RANGE_M);
        }
        this.fx.push({ type: "ping", x: ship.x, y: ship.y, r: C.PING_RANGE_M, mask });
        // the scream is heard by everyone, terrain or not
        for (const other of this.ships.values()) {
          if (other.id === ship.id || other.isDrone) continue;
          events.push({
            kind: "notice",
            ship: other.id,
            text: `Active ping — he's lit himself up. Bearing ${fmtBearing(bearingTo(other.x, other.y, ship.x, ship.y))}.`,
            speak: `Active ping — he's lit himself up. Bearing ${spokenBearing(bearingTo(other.x, other.y, ship.x, ship.y))}.`,
            alert: true,
          });
        }
        return null;
      }
      case "set_lock_target": {
        // v5 §3: explicit lock designation by contact ref. Designating an
        // unresolved DECOY contact is accepted (the captain can't know) —
        // the lock just never completes. Rejecting would unmask the decoy.
        const ref = String(cmd.params.contact ?? "");
        const key = this.resolveContactRef(ship.id, ref);
        if (!key || key.startsWith("t:")) {
          return "No contact by that name on the board, Captain.";
        }
        if (key.startsWith("a")) return "They're squawking friendly, Captain.";
        ship.lockDesignation = key;
        const shipTarget = key.startsWith("s") ? key.slice(1) : null;
        if (ship.lock.target !== shipTarget || shipTarget === null) {
          // new subject: any progress on the old one is void
          ship.lock = { target: shipTarget, progress: 0, has: false, grace: 0 };
        }
        return null;
      }
      case "fire_railgun": {
        // v5 §5. SOLUTION: constant-velocity lead on a TRACK-or-better
        // contact, fired immediately (nothing to hold — slugs can't be
        // guided). Any thrust during flight breaks the assumption; that's
        // the weapon. BEARING: manual skill shot, no requirements.
        const stats = statsOf(ship);
        if (stats.railguns === 0) return "This boat doesn't mount a railgun, Captain.";
        if (ship.railCooldownS > 0) return "Rail's recharging.";
        if (ship.railSlugs <= 0) return "Slugs are out.";
        const mode = cmd.params.mode === "bearing" ? "bearing" : "solution";
        let dir: number;
        if (mode === "bearing") {
          const raw = cmd.params.bearing_degrees;
          dir =
            typeof raw === "number" && Number.isFinite(raw) ? norm360(raw) : ship.facing;
        } else {
          // pick the solution subject: an explicit contact ref, else the
          // nearest tracked hostile. Decoy contacts are legal subjects at
          // track tier (they show a vector; refusing would unmask them).
          let tgt: { x: number; y: number; vx: number; vy: number } | null = null;
          const ref = typeof cmd.params.target === "string" ? cmd.params.target : null;
          if (ref) {
            const key = this.resolveContactRef(ship.id, ref);
            if (!key || key.startsWith("t:")) return "No contact by that name on the board, Captain.";
            if (key.startsWith("a")) return "They're squawking friendly, Captain.";
            if (key.startsWith("s")) {
              const t = this.ships.get(key.slice(1));
              if (t && this.contactOn(ship.id, t.id).tier >= 2) tgt = t;
            } else {
              const d = this.decoys.find((k) => `d${k.id}` === key);
              if (d && this.decoyTierFor(ship, d) >= 2) tgt = d;
            }
          } else {
            tgt = this.nearestTrackedHostile(ship);
          }
          if (!tgt) return "No track for a solution, Captain — I can fire on a bearing.";
          dir = this.railSolutionBearing(ship, tgt.x, tgt.y, tgt.vx, tgt.vy);
        }
        const [dx, dy] = headingVec(dir);
        this.slugs.push({
          id: this.nextId++,
          owner: ship.id,
          x: ship.x,
          y: ship.y,
          prevX: ship.x,
          prevY: ship.y,
          vx: ship.vx + dx * C.RAIL_SLUG_SPEED_MPS, // inherits shooter velocity
          vy: ship.vy + dy * C.RAIL_SLUG_SPEED_MPS,
          age: 0,
        });
        ship.railSlugs--;
        ship.railCooldownS = C.RAIL_COOLDOWN_S;
        ship.sigSpikeRail = C.RAIL_SIG_SPIKE_S;
        // the ship owns this voice (stock lines); a translator ack would
        // double-speak
        delete cmd.acknowledgement;
        if (!ship.isDrone) {
          events.push({
            kind: "notice",
            ship: ship.id,
            text: mode === "solution" ? "Solution ready — firing." : "Slug away.",
          });
        }
        // rail fire is HEARD (no LOS — hearing law): every listener whose
        // hearing reaches the SPIKED signature gets the bearing call
        for (const other of this.ships.values()) {
          if (other.id === ship.id || other.isDrone) continue;
          const hearing =
            this.detectionRange(this.signatureOf(ship), other) * C.HEARING_RANGE_MULT;
          if (dist(other.x, other.y, ship.x, ship.y) > hearing) continue;
          const brg = bearingTo(other.x, other.y, ship.x, ship.y);
          const q = fmtBearing((Math.round(brg / 10) * 10) % 360);
          events.push({
            kind: "notice",
            ship: other.id,
            text: `Rail fire, bearing ${q}.`,
            speak: `Rail fire, bearing ${spokenBearing(brg)}.`,
            alert: true,
          });
        }
        return null;
      }
      case "launch_probe": {
        // v5 §6: fire-and-drift remote sensors. Nose launch unless a
        // bearing is named; the burn never steers.
        if (ship.probesLeft <= 0) return "No probes left, Captain.";
        const raw = cmd.params.bearing_degrees;
        const brg =
          typeof raw === "number" && Number.isFinite(raw) ? norm360(raw) : ship.facing;
        ship.probesLeft--;
        ship.probeCounter++;
        this.probes.push({
          id: this.nextId++,
          owner: ship.id,
          team: ship.team,
          idx: ship.probeCounter,
          bearing: brg,
          x: ship.x,
          y: ship.y,
          prevX: ship.x,
          prevY: ship.y,
          vx: ship.vx,
          vy: ship.vy,
          age: 0,
        });
        delete cmd.acknowledgement; // the ship owns this voice
        if (!ship.isDrone) {
          events.push({
            kind: "notice",
            ship: ship.id,
            text: `Probe ${PROBE_NAMES[ship.probeCounter - 1] ?? ship.probeCounter} away — bearing ${fmtBearing(brg)}.`,
            speak: `Probe away — bearing ${spokenBearing(brg)}.`,
          });
        }
        return null;
      }
      case "transmit": {
        // v5 §7. Verbatim delivery — the message is the captain's words,
        // trimmed and capped, never paraphrased.
        const channel = cmd.params.channel === "tightbeam" ? "tightbeam" : "broadcast";
        const rawMsg = typeof cmd.params.message === "string" ? cmd.params.message.trim() : "";
        if (!rawMsg) return "Nothing to send, Captain.";
        const message = rawMsg.slice(0, C.MESSAGE_MAX_CHARS);
        if (channel === "broadcast") {
          if (ship.commsCooldownBroadcastS > 0) return "Broadcast array is recycling, Captain.";
          ship.commsCooldownBroadcastS = C.COMMS_COOLDOWN_S;
          // the spike IS the price: every captain gets a bearing chevron
          // with our callsign on it (voiceprint) for COMMS_SPIKE_S
          this.commsSpikes.push({
            x: ship.x,
            y: ship.y,
            from: ship.id,
            callsign: ship.callsign,
            expiresAtTick: this.tickCount + C.COMMS_SPIKE_S * C.TICK_RATE_HZ,
          });
          events.push({
            kind: "transmission",
            from: ship.id,
            fromName: ship.callsign,
            to: "all",
            text: message,
          });
        } else {
          if (ship.commsCooldownTightbeamS > 0) return "Tightbeam dish is recycling, Captain.";
          const ref = typeof cmd.params.recipient === "string" ? cmd.params.recipient : "";
          if (!ref) return "Tightbeam to whom, Captain?";
          // teammates first: always reachable by name/callsign, no track
          // needed (fleet encryption)
          const mate = [...this.ships.values()].find(
            (t) =>
              t.id !== ship.id &&
              !this.isHostile(ship, t) &&
              t.callsign.toLowerCase() === ref.trim().toLowerCase()
          );
          let target: Ship | null = mate ?? null;
          let decoyDish = false;
          if (!target) {
            const key = this.resolveContactRef(ship.id, ref);
            if (!key || key.startsWith("t:")) return "No contact by that name on the board, Captain.";
            if (key.startsWith("d")) {
              // the dish is pointed at a decoy: fog-correct behavior is a
              // confident transmission into the void — rejecting would
              // unmask it
              const d = this.decoys.find((k) => `d${k.id}` === key);
              if (!d || this.decoyTierFor(ship, d) < 2) {
                return "No track on them — I can't point the dish, Captain.";
              }
              decoyDish = true;
            } else {
              const t = this.ships.get(key.slice(1));
              if (!t) return "No contact by that name on the board, Captain.";
              // a current TRACK (fused map picture counts: a via-probe
              // track tells the dish where to point)
              if (!this.isHostile(ship, t)) {
                target = t; // teammate referenced by letter (pre-§8 edge)
              } else if (this.contactOn(ship.id, t.id).tier >= 2) {
                target = t;
              } else {
                return "No track on them — I can't point the dish, Captain.";
              }
            }
          }
          ship.commsCooldownTightbeamS = C.COMMS_COOLDOWN_S;
          if (!decoyDish && target) {
            events.push({
              kind: "transmission",
              from: ship.id,
              fromName: ship.callsign,
              to: target.id,
              text: message,
            });
          }
          // decoyDish: the beam goes out, nobody is home — silence is the
          // decoy doing its job
        }
        delete cmd.acknowledgement; // the ship confirms with its own line
        if (!ship.isDrone) {
          events.push({ kind: "notice", ship: ship.id, text: "Transmission away." });
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
            (n) => Number.isInteger(n) && n >= 1 && n <= ship.tubes.length
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
          const tgt = ship.lock.target ? this.ships.get(ship.lock.target) : undefined;
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
        // campaign doctrine moment (once per system, only when it matters):
        // a decoy dropped mid-burn holds your OLD course — the lie only
        // works if you then change yours. Teach, don't nag.
        if (
          this.mission &&
          ship.id === this.mission.playerId &&
          !this.mission.decoyTaught &&
          effectiveThrust(ship) >= 60
        ) {
          this.mission.decoyTaught = true;
          events.push({
            kind: "notice",
            ship: ship.id,
            text: "Decoy's away — it holds our old course. We should change ours, Captain.",
          });
        }
        ship.decoys--;
        const driftAngle = Math.random() * Math.PI * 2;
        this.decoys.push({
          id: this.nextId++,
          owner: ship.id,
          team: ship.team,
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
    // Uplink subject: the ship our lock is on (a locked fire requires a held
    // lock; the auto-designator always fills lock.target with it). Fallback
    // to the nearest hostile covers tests that force lock.has by hand.
    const uplinkTo = blind
      ? null
      : (ship.lock.target ?? this.nearestOf(ship, this.hostilesOf(ship))?.id ?? null);
    // firing a locked bird BINDS the lock to its subject (covers tests and
    // dev-harness states that force lock.has without a designated target —
    // the uplink severance check compares lock.target against m.target)
    if (!blind && uplinkTo && ship.lock.target == null) ship.lock.target = uplinkTo;
    this.missiles.push({
      id: this.nextId++,
      owner: ship.id,
      team: ship.team,
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
      target: uplinkTo,
      cmdBearing: blind ? cmdBearing : null,
      lock: uplinkTo ? { type: "ship", id: uplinkTo } : null,
    });
    if (blind && !ship.isDrone) {
      events.push({ kind: "notice", ship: ship.id, text: "Bird away, running blind." });
    }

    // Launch flash: a +SIG_SPIKE_LAUNCH signature spike. The distinct XO
    // notice fires iff the spike actually makes the launcher detectable
    // (LOS and range willing) to that viewer right now.
    ship.sigSpikeLaunch = C.SIG_SPIKE_LAUNCH_S;
    for (const viewer of this.hostilesOf(ship)) {
      if (viewer.isDrone || this.contactTierFor(viewer, ship) < 1) continue;
      events.push({
        kind: "notice",
        ship: viewer.id,
        text: `Launch flash detected — bearing ${fmtBearing(bearingTo(viewer.x, viewer.y, ship.x, ship.y))}!`,
        speak: `Launch flash detected — bearing ${spokenBearing(bearingTo(viewer.x, viewer.y, ship.x, ship.y))}!`,
        alert: true,
      });
    }

    if (C.AUTO_RELOAD && ship.reserve > 0) {
      ship.reserve--;
      tube.reload = statsOf(ship).tubeReload;
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
  // v5 §3 multi-enemy semantics: enemy_range / enemy_bearing_off_nose refer
  // to the NEAREST TRACKED hostile; enemy_contact_tier is the best tier held
  // on any hostile; missile_inbound / being_painted are ANY-source.
  private metricValue(ship: Ship, metric: string): number | boolean | null {
    switch (metric) {
      case "enemy_range": {
        // range data is earned at TIER_TRACK; a faint contact is unknowable
        const e = this.nearestTrackedHostile(ship);
        if (!e) return null;
        return dist(ship.x, ship.y, e.x, e.y);
      }
      case "enemy_contact_tier": {
        let t = 0;
        for (const h of this.hostilesOf(ship)) {
          t = Math.max(t, this.contactOn(ship.id, h.id).tier);
        }
        return t;
      }
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
        return (ship.hull / hullMaxOf(ship)) * 100;
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
        const e = this.nearestTrackedHostile(ship);
        if (!e) return null;
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
          events.push({ kind: "ack", ship: ship.id, verb: action.verb, text: action.acknowledgement });
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
  private stepPdc(
    ship: Ship,
    deadMissiles: Set<number>,
    deadProbes: Set<number>,
    pdcVictims: Map<ShipId, ShipId>, // victim -> one shooter (edge notices resolved after all mounts fire)
    events: SimEvent[],
    dt: number
  ): void {
    if (ship.pdcPosture !== "free" || ship.pdcAmmoS <= 0 || this.winner) return;
    let firing = false;

    // (a) inbound missiles. SENSOR-SLAVED: the mount shares the ship's
    // sensor picture — it can only engage ordnance the ship currently
    // detects (signature detection range + LOS). A ballistic torpedo
    // arriving from sensor shadow may never be engaged. Intended.
    for (const m of this.missiles) {
      // v5 §8 IFF: the mounts ignore friendly ordnance
      if (this.sameSide(ship.id, ship.team, m.owner, m.team) || deadMissiles.has(m.id)) continue;
      const range = dist(ship.x, ship.y, m.x, m.y);
      if (range > C.PDC_RANGE_M) continue;
      if (range > this.detectionRange(this.missileSignature(m), ship)) continue;
      if (!this.losClear(ship.x, ship.y, m.x, m.y)) continue;
      firing = true;
      this.fx.push({ type: "pdc", owner: ship.id, x1: ship.x, y1: ship.y, x2: m.x, y2: m.y });
      if (Math.random() < C.PDC_KILL_PROB_PER_S * dt) {
        deadMissiles.add(m.id);
        this.fx.push({ type: "boom", x: m.x, y: m.y });
        events.push({ kind: "notice", ship: ship.id, text: "PDC splash — missile destroyed." });
        // the shooter only learns the bird's fate if they could watch it die
        const shooter = this.ships.get(m.owner);
        if (shooter && this.canObserve(shooter, m.x, m.y)) {
          events.push({ kind: "notice", ship: m.owner, text: "Their point defense got our missile." });
        }
      }
    }

    // (a2) enemy probes (v5 §6): fair game for the mount, same rules —
    // sensor-slaved (probe sig ${C.PROBE_SIGNATURE} is visible far beyond
    // PDC range, so in practice: in envelope = engaged)
    for (const pr of this.probes) {
      if (this.sameSide(ship.id, ship.team, pr.owner, pr.team) || deadProbes.has(pr.id)) continue;
      const range = dist(ship.x, ship.y, pr.x, pr.y);
      if (range > C.PDC_RANGE_M) continue;
      if (range > this.detectionRange(C.PROBE_SIGNATURE, ship)) continue;
      if (!this.losClear(ship.x, ship.y, pr.x, pr.y)) continue;
      firing = true;
      this.fx.push({ type: "pdc", owner: ship.id, x1: ship.x, y1: ship.y, x2: pr.x, y2: pr.y });
      if (Math.random() < C.PDC_KILL_PROB_PER_S * dt) {
        deadProbes.add(pr.id);
        this.fx.push({ type: "boom", x: pr.x, y: pr.y });
      }
    }

    // (b) hostile ship at knife range: the mount tracks ONE hull — the
    // nearest hostile in range with LOS (v5 §2: several may qualify).
    const enemy = this.nearestOf(
      ship,
      this.hostilesOf(ship).filter(
        (h) =>
          dist(ship.x, ship.y, h.x, h.y) <= C.PDC_SHIP_RANGE_M &&
          this.losClear(ship.x, ship.y, h.x, h.y)
      )
    );
    if (enemy) {
      firing = true;
      this.fx.push({ type: "pdc", owner: ship.id, x1: ship.x, y1: ship.y, x2: enemy.x, y2: enemy.y });
      if (!pdcVictims.has(enemy.id)) pdcVictims.set(enemy.id, ship.id);
      enemy.hull = Math.max(0, enemy.hull - C.PDC_SHIP_DPS * dt);
      if (enemy.hull <= 0 && !this.winner) {
        this.destroyShip(enemy, ship.id, events);
      }
    }

    if (firing) {
      ship.pdcAmmoS = Math.max(0, ship.pdcAmmoS - dt);
      ship.sigSpikePdc = C.SIG_SPIKE_PDC_S;
      this.announcePdcAmmo(ship, events);
    }
  }

  // Edge-triggered PDC ship-fire notices, resolved once per substep after
  // every mount has fired (with several shooters the per-shooter edge would
  // spam or double-clear the flag).
  private announcePdcShipFire(pdcVictims: Map<ShipId, ShipId>, events: SimEvent[]): void {
    for (const ship of this.ships.values()) {
      const shooterId = pdcVictims.get(ship.id);
      if (shooterId !== undefined && !ship.underPdcFire) {
        ship.underPdcFire = true;
        if (!ship.isDrone) {
          events.push({
            kind: "notice",
            ship: ship.id,
            text: "We're inside their PDC envelope — taking fire!",
            alert: true,
          });
        }
        const shooter = this.ships.get(shooterId);
        if (shooter && !shooter.isDrone) {
          events.push({ kind: "notice", ship: shooterId, text: "PDCs are chewing on their hull, Captain." });
        }
      } else if (shooterId === undefined && ship.underPdcFire) {
        // no guns bearing on them anymore; re-arm the edge notice
        ship.underPdcFire = false;
      }
    }
  }

  // Ammo warnings at falling 50/25/10/0 percent, re-armed never (no regen).
  private announcePdcAmmo(ship: Ship, events: SimEvent[]): void {
    if (ship.isDrone) return;
    const pct = (ship.pdcAmmoS / statsOf(ship).pdcAmmoS) * 100;
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

  // Could this ship have WATCHED something happen at (x, y)? Same rule the
  // explosion fx use in snapshotFor (SENSOR_BASE_M + LOS). XO reports about
  // our own distant ordnance are gated on this: an autonomous bird is
  // one-way (HANDOFF-v4.1 §3) — if we couldn't see it die, nobody tells us
  // it died. (An uplinked bird's death is near a locked target, which lock
  // rules already require us to see — the gate passes there by construction.)
  private canObserve(viewer: Ship, x: number, y: number): boolean {
    return (
      dist(viewer.x, viewer.y, x, y) <= statsOf(viewer).sensorBase &&
      this.losClear(viewer.x, viewer.y, x, y)
    );
  }

  private damageShip(
    target: Ship,
    amount: number,
    source: "missile" | "rock" | "rail",
    events: SimEvent[],
    attackerId: ShipId | null
  ): void {
    if (this.winner) return;
    target.hull = Math.max(0, target.hull - amount);
    const attacker = attackerId ? this.ships.get(attackerId) : undefined;
    if (source !== "rock" && attacker && this.canObserve(attacker, target.x, target.y)) {
      // terrain kills have no attacker to credit; and a strike we couldn't
      // see is a strike we don't get told about
      events.push({
        kind: "notice",
        ship: attacker.id,
        text: source === "rail" ? "Rail slug connected." : "Missile strike on the enemy ship!",
      });
    }
    const word =
      source === "missile" ? "Missile strike" : source === "rail" ? "Rail slug hit" : "Collision";
    events.push({
      kind: "notice",
      ship: target.id,
      text: `${word} — hull at ${target.hull}!`,
      alert: true,
    });
    if (target.hull <= 0) {
      this.destroyShip(target, attackerId, events);
    }
  }

  // A ship dies: record the placement, take it off the board, tell the
  // match (death event drives the captain->spectator flow), and end the
  // match if no hostilities remain. Ghost scuttles skip the event fanfare
  // (see scuttleShip).
  private destroyShip(target: Ship, attackerId: ShipId | null, events: SimEvent[]): void {
    if (!this.ships.has(target.id)) return; // already gone (same-substep double kill)
    this.fx.push({ type: "boom", x: target.x, y: target.y });
    // v5 §3: whoever could WATCH it die closes the book on that track (no
    // ghost, and the killer's XO names the kill); everyone else keeps a
    // last-known ghost of a contact that simply went dark — an unseen
    // death is information nobody earned.
    for (const viewer of this.ships.values()) {
      if (viewer.id === target.id || !this.canObserve(viewer, target.x, target.y)) continue;
      const label = this.labelFor(viewer.id, target.id);
      this.contactBooks.get(viewer.id)?.records.delete(`s${target.id}`);
      // kill line to the INVOLVED party only (§10: no global kill feed) —
      // other observers get the boom fx and a track that simply ends
      if (viewer.id === attackerId && !viewer.isDrone && label !== "the contact") {
        events.push({
          kind: "notice",
          ship: viewer.id,
          text: `${label} is destroyed.`,
        });
      }
    }
    // Campaign §2.3: the Hunter carries the best salvage in the system —
    // "run for the gate, or turn and set a trap" is a real decision only
    // because the trap PAYS. Its wreck is marked (you watched it die; in
    // pack systems the surviving partner will patrol it, which is correct).
    if (this.mission && target.hunterAI) {
      this.mission.stats.huntersKilled += 1;
      const cycle: ("sig" | "sensor" | "accel" | "hull")[] = ["sig", "sensor", "accel", "hull"];
      this.mission.wrecks.push({
        id: this.nextId++,
        x: target.x,
        y: target.y,
        marked: true,
        checked: false,
        items: [
          { kind: "pdc_ammo", amount: 30 },
          { kind: "propellant", amount: 40 },
          { kind: "missiles", amount: 2 },
          { kind: "upgrade", amount: 1, upgrade: cycle[(this.mission.stats.huntersKilled - 1) % 4] },
        ],
      });
    }
    this.removeShip(target.id);
    this.placements.push(target.id);
    events.push({
      kind: "death",
      ship: target.id,
      callsign: this.callsigns.get(target.id) ?? target.id,
      attacker: attackerId,
    });
    this.checkVictory(events);
  }

  // v5 §2 disconnect handling, driven by the match. A ghost drifts
  // ballistic: thrust 0, helm idle, standing orders suspended (they stay on
  // the books for the reconnect), PDCs on last posture. Reconnect turns it
  // back into a ship; the timer running out scuttles it QUIETLY.
  setGhost(id: ShipId, on: boolean): void {
    const ship = this.ships.get(id);
    if (!ship) return;
    ship.ghost = on;
    if (on) {
      ship.ghostTimerS = C.DISCONNECT_FORFEIT_S;
      ship.thrust = 0;
      ship.goal = null;
      ship.maneuver = null;
    }
  }

  // The quiet forfeit: no fx, no notices — other captains just lose the
  // contact (a ghost that stops being a ghost is information nobody
  // earned). The scuttle event lets the match free the seat; checkVictory
  // may still end the match (that IS public).
  private scuttleShip(ship: Ship, events: SimEvent[]): void {
    if (!this.ships.has(ship.id)) return;
    this.removeShip(ship.id);
    this.placements.push(ship.id);
    events.push({ kind: "scuttle", ship: ship.id });
    this.checkVictory(events);
  }

  // Quiet removal shared by deaths and scuttles: every per-viewer trace of
  // the ship goes with it (contact states, rumble entries) — a ghost of a
  // dead ship on someone's map would be a fog leak in reverse.
  private removeShip(id: ShipId): void {
    this.ships.delete(id);
    this.queues.delete(id);
    this.shipContacts.delete(id);
    for (const m of this.shipContacts.values()) m.delete(id);
    this.announcedMissiles.delete(id);
    this.prevVisibleMissiles.delete(id);
    this.decoyFaint.delete(id);
    this.rumbleState.delete(id);
    this.rumbleBudget.delete(id);
    this.rumbleAliases.delete(id);
    this.contactBooks.delete(id);
    for (const state of this.rumbleState.values()) state.delete(`s${id}`);
  }

  // Hostilities are over when no surviving ship has a hostile left: last
  // ship alive in FFA, last team with a ship alive in Teams — one rule.
  private checkVictory(events: SimEvent[]): void {
    if (this.winner) return;
    // Campaign (Stage 0): the GATE is the only victory. Killing the Hunter
    // buys the system, not the match (spec §2.3) — the quiet line is the
    // reward, and the player still has to fly out. Player death loses.
    if (this.mission) {
      const player = this.ships.get(this.mission.playerId);
      if (player) {
        if (this.mission.hunterSpawned && this.hostilesOf(player).length === 0) {
          events.push({
            kind: "notice",
            ship: player.id,
            text: "It's gone quiet, Captain. The system is ours.",
          });
        }
        return;
      }
      // the player is dead: the system wins
      const hunter = this.mission.hunterIds.map((id) => this.ships.get(id)).find(Boolean);
      this.winner = hunter?.id ?? "nobody";
      const placements = [...(hunter ? [hunter.id] : []), ...[...this.placements].reverse()];
      events.push({
        kind: "gameover",
        winner: this.winner,
        winnerName: hunter?.callsign ?? "the deep black",
        placements,
        placementNames: placements.map((id) => this.callsigns.get(id) ?? id),
      });
      return;
    }
    const alive = [...this.ships.values()];
    if (alive.some((s) => this.hostilesOf(s).length > 0)) return;
    const first = alive[0];
    this.winner = first ? (first.team ?? first.id) : (this.placements[this.placements.length - 1] ?? "nobody");
    // standings, winner-first: survivors, then the fallen in reverse
    // death order
    const placements = [...alive.map((s) => s.id), ...[...this.placements].reverse()];
    events.push({
      kind: "gameover",
      winner: this.winner,
      winnerName: first?.team ?? this.callsigns.get(this.winner) ?? this.winner,
      placements,
      placementNames: placements.map((id) => this.callsigns.get(id) ?? id),
    });
  }

  // The heading the helm is steering toward (turn goals report their
  // end-point; track goals report the last resolved bearing). Used for
  // state summaries and the shortest-arc steering branch in stepShip.
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
        !this.sameSide(ship.id, ship.team, m.owner, m.team) &&
        ((ship.pingGrantS > 0 && ship.pingGrantMissiles.has(m.id)) || // pinged: a coasting bird shows for the window
          (dist(ship.x, ship.y, m.x, m.y) <= this.detectionRange(this.missileSignature(m), ship) &&
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
    // v5 §6: probe relays fuse here too — a close probe can even RESOLVE
    // a decoy remotely (tier 3 from the probe's position is earned)
    let probeTier: 0 | 1 | 2 | 3 = 0;
    for (const pr of this.probesOf(viewer.id)) {
      const t = this.probeTierOn(pr, d.x, d.y, C.DECOY_SIGNATURE);
      if (t > probeTier) probeTier = t;
    }
    let own: 0 | 1 | 2 | 3;
    if (!this.losClear(viewer.x, viewer.y, d.x, d.y)) {
      own = granted as 0 | 2;
    } else {
      const frac = dist(viewer.x, viewer.y, d.x, d.y) / this.detectionRange(C.DECOY_SIGNATURE, viewer);
      own =
        frac <= C.TIER_ID_FRAC ? 3
        : frac <= C.TIER_TRACK_FRAC ? 2
        : frac <= C.TIER_FAINT_FRAC ? (Math.max(1, granted) as 1 | 2)
        : (granted as 0 | 2);
    }
    return Math.max(own, probeTier) as 0 | 1 | 2 | 3;
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
  // `key` is the real emitter id (internal bookkeeping only); `cid` is a
  // per-viewer opaque alias ("r1", "r2", ...) — the wire must not let a
  // client correlate rumbles by object identity or tell ships from decoys
  // by prefix (invariants 11/13; v5 §3 hardening).
  rumblesFor(ship: Ship): {
    key: string;
    cid: string;
    bearing: number;
    loud: number;
    probe?: number; // launch ordinal of the relaying probe (v5 §6)
    ox?: number; // chevron origin = the probe's position (own equipment)
    oy?: number;
  }[] {
    let aliases = this.rumbleAliases.get(ship.id);
    if (!aliases) {
      aliases = new Map();
      this.rumbleAliases.set(ship.id, aliases);
    }
    const out: ReturnType<Sim["rumblesFor"]> = [];
    const alias = (key: string): string => {
      let cid = aliases.get(key);
      if (!cid) {
        cid = `r${aliases.size + 1}`;
        aliases.set(key, cid);
      }
      return cid;
    };
    const hear = (x: number, y: number, sig: number, key: string) => {
      if (dist(ship.x, ship.y, x, y) <= this.detectionRange(sig, ship) * C.HEARING_RANGE_MULT) {
        out.push({
          key,
          cid: alias(key),
          bearing: Math.round(norm360(bearingTo(ship.x, ship.y, x, y))) % 360, // 359.6 rounds to 360 -> wrap to 000
          loud: Math.min(1, sig / 150),
        });
      }
    };
    for (const h of this.hostilesOf(ship)) {
      if (this.contactOn(ship.id, h.id).tier === 0) {
        hear(h.x, h.y, this.signatureOf(h), `s${h.id}`);
      }
    }
    for (const d of this.decoys) {
      if (d.owner === ship.id) continue;
      if (this.decoyTierFor(ship, d) === 0) hear(d.x, d.y, C.DECOY_SIGNATURE, `d${d.id}`);
    }
    // v5 §6: probe-relayed rumbles — the probe's FULL hearing (same
    // multiplier on its reduced sensor base), bearing FROM THE PROBE.
    // A second bearing on the same emitter is the whole point: two
    // chevrons cross into a human-made fix. The XO never crosses them.
    for (const pr of this.probesOf(ship.id)) {
      const probeHear = (x: number, y: number, sig: number, key: string) => {
        const hearing = C.PROBE_SENSOR_BASE_M * (sig / 100) * C.HEARING_RANGE_MULT;
        if (dist(pr.x, pr.y, x, y) <= hearing) {
          out.push({
            key,
            cid: alias(key),
            bearing: Math.round(norm360(bearingTo(pr.x, pr.y, x, y))) % 360,
            loud: Math.min(1, sig / 150),
            probe: pr.idx,
            ox: pr.x,
            oy: pr.y,
          });
        }
      };
      for (const h of this.hostilesOf(ship)) {
        if (this.contactOn(ship.id, h.id).tier === 0) {
          probeHear(h.x, h.y, this.signatureOf(h), `p${pr.id}:s${h.id}`);
        }
      }
      for (const d of this.decoys) {
        if (d.owner === ship.id) continue;
        if (this.decoyTierFor(ship, d) === 0) {
          probeHear(d.x, d.y, C.DECOY_SIGNATURE, `p${pr.id}:d${d.id}`);
        }
      }
    }
    return out;
  }

  // XO rumble announcements (v5.1 §3.1-3.2): new rumbles, bearing drifts
  // past RUMBLE_SHIFT_ANNOUNCE_DEG, and fades — against a GLOBAL per-viewer
  // budget of one line per RUMBLE_ANNOUNCE_COOLDOWN_S. Multiple changes
  // aggregate into a single line (loudest first, at most
  // RUMBLE_ANNOUNCE_MAX_BEARINGS bearings) instead of enumerating. A
  // rumble that hardens into a CONTACT fades silently (the tier notice is
  // the announcement — seamless handoff, never a double contact).
  private updateRumbles(ship: Ship, events: SimEvent[]): void {
    if (ship.isDrone) return;
    const state = this.rumbleState.get(ship.id)!;
    let budget = this.rumbleBudget.get(ship.id);
    if (!budget) {
      budget = { cooldown: 0, fresh: false, drifted: false, lost: false };
      this.rumbleBudget.set(ship.id, budget);
    }
    budget.cooldown = Math.max(0, budget.cooldown - 1 / C.TICK_RATE_HZ);
    // per-key cooldowns now serve only flicker suppression: a rumble that
    // fades and reappears inside the window resumes silently
    for (const st of state.values()) st.cooldown = Math.max(0, st.cooldown - 1 / C.TICK_RATE_HZ);
    const current = this.rumblesFor(ship);
    const liveIds = new Set(current.map((r) => r.key)); // real keys internally

    for (const r of current) {
      const st = state.get(r.key);
      if (!st || (!st.live && st.cooldown <= 0)) {
        state.set(r.key, { bearing: r.bearing, cooldown: 0, live: true });
        budget.fresh = true;
      } else if (st.live && Math.abs(angDiff(st.bearing, r.bearing)) > C.RUMBLE_SHIFT_ANNOUNCE_DEG) {
        budget.drifted = true; // bearing updates when the line goes out
      } else if (!st.live) {
        st.live = true; // back within the flicker window: resume silently
        st.bearing = r.bearing;
      }
    }

    for (const [key, st] of state) {
      if (liveIds.has(key)) continue;
      if (!st.live) {
        if (st.cooldown <= 0) state.delete(key); // expired ghost entry
        continue;
      }
      st.live = false;
      st.cooldown = C.RUMBLE_ANNOUNCE_COOLDOWN_S; // flicker window
      // silent when it hardened into a contact (rumble -> faint handoff);
      // probe-relayed keys look through to their emitter
      const emitter = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
      const becameContact = emitter.startsWith("s")
        ? this.contactOn(ship.id, emitter.slice(1)).tier >= 1
        : this.decoys.some(
            (d) => `d${d.id}` === emitter && this.decoyTierFor(ship, d) >= 1
          );
      if (!becameContact) budget.lost = true;
    }

    if (budget.cooldown > 0 || (!budget.fresh && !budget.drifted && !budget.lost)) return;

    // The window is open and something changed: say the CURRENT picture,
    // once. Spoken bearings quantize to 10° — exact bearings made every
    // announcement a unique ElevenLabs synthesis and burned the TTS quota
    // in a day (v4.6). Aggregated multi-bearing lines are dynamic synths,
    // acceptable at one per 15 s (§3.2) — never at one per 2 s.
    const spoken = (b: number) => fmtBearing((Math.round(b / 10) * 10) % 360);
    const loudest = [...current].sort((a, b) => b.loud - a.loud);
    if (current.length === 0) {
      if (budget.lost) {
        events.push({ kind: "notice", ship: ship.id, text: "Lost the rumble." });
      }
    } else if (current.length === 1) {
      // single-emitter picture: keep the classic (fully cached) line shapes
      const r = current[0];
      const viaProbe = r.probe !== undefined ? ` — probe ${PROBE_NAMES[r.probe - 1] ?? r.probe}'s bearing` : "";
      const drifted = budget.drifted && !budget.fresh;
      events.push({
        kind: "notice",
        ship: ship.id,
        text: drifted
          ? `That rumble's drifted to ${spoken(r.bearing)}.`
          : `Drive rumble, bearing ${spoken(r.bearing)}${viaProbe}.`,
        speak: drifted
          ? `That rumble's drifted to ${spokenBearing(r.bearing)}.`
          : r.probe !== undefined
            ? `Probe rumble, bearing ${spokenBearing(r.bearing)}.`
            : `Drive rumble, bearing ${spokenBearing(r.bearing)}.`,
      });
    } else {
      const named = loudest.slice(0, C.RUMBLE_ANNOUNCE_MAX_BEARINGS);
      const listText = named.map((r) => spoken(r.bearing));
      const listSpoken = named.map((r) => spokenBearing(r.bearing));
      const joinList = (parts: string[]) =>
        parts.length === 2 ? `${parts[0]} and ${parts[1]}` : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
      const count = COUNT_WORDS[current.length] ?? String(current.length);
      const loudestNote = current.length > named.length ? " Loudest" : "";
      events.push({
        kind: "notice",
        ship: ship.id,
        text: `${count} drives out there, Captain —${loudestNote.toLowerCase()} bearings ${joinList(listText)}.`,
        speak: `${count} drives out there, Captain.${loudestNote ? " Loudest bearings" : " Bearings"} ${joinList(listSpoken)}.`,
      });
    }
    // everything on the board counts as told
    for (const r of current) {
      const st = state.get(r.key);
      if (st) st.bearing = r.bearing;
    }
    budget.fresh = budget.drifted = budget.lost = false;
    budget.cooldown = C.RUMBLE_ANNOUNCE_COOLDOWN_S;
  }

  // Enemy decoys RESOLVED as decoys (ID tier) — what the helm may point at
  // and what the snapshot labels as a decoy.
  private visibleEnemyDecoys(ship: Ship): Decoy[] {
    return this.decoys.filter(
      (d) =>
        !this.sameSide(ship.id, ship.team, d.owner, d.team) &&
        this.decoyTierFor(ship, d) === 3
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
  // `live` is false only on the last-known fallback (drives the tracking
  // XO's "lost him" line); a rumble is bearing-only but live while heard.
  protected resolveTargetPos(
    ship: Ship,
    target: TargetKind
  ): { x: number; y: number; live: boolean } | null {
    // v5 §2: "the enemy" is the best hostile knowledge we hold — nearest
    // tracked hostile, else the nearest faint fix, else the freshest
    // last-known ghost.
    const enemyShipPos = (): { x: number; y: number; live: boolean } | null => {
      const tracked = this.nearestTrackedHostile(ship);
      if (tracked) return { x: tracked.x, y: tracked.y, live: true };
      const faints = this.hostilesOf(ship)
        .map((h) => this.contactOn(ship.id, h.id).faint)
        .filter((f): f is NonNullable<typeof f> => f !== null);
      const faint = this.nearestOf(ship, faints);
      if (faint) return { x: faint.x, y: faint.y, live: true };
      let freshest: { x: number; y: number; t: number } | null = null;
      for (const h of this.hostilesOf(ship)) {
        const lk = this.contactOn(ship.id, h.id).lastKnown;
        if (lk && (!freshest || lk.t > freshest.t)) freshest = lk;
      }
      if (freshest) return { x: freshest.x, y: freshest.y, live: false };
      return null;
    };
    const asLive = (o: { x: number; y: number } | null) =>
      o ? { x: o.x, y: o.y, live: true } : null;
    switch (target) {
      case "enemy_ship":
        return enemyShipPos();
      case "nearest_missile":
        return asLive(this.nearestOf(ship, this.visibleEnemyMissiles(ship)));
      case "nearest_decoy":
        return asLive(this.nearestOf(ship, this.visibleEnemyDecoys(ship)));
      case "nearest_contact": {
        // the enemy ship if we hold any live contact, else nearest visible
        // ordnance, else last-known ship position
        if (ship.contactTier >= 1) return enemyShipPos();
        const ordnance = this.nearestOf(ship, [
          ...this.visibleEnemyMissiles(ship),
          ...this.visibleEnemyDecoys(ship),
        ]);
        return asLive(ordnance) ?? enemyShipPos();
      }
      case "nearest_rumble": {
        // Bearing-only: "nearest" is unknowable below faint (a rumble has
        // no range), so LOUDEST stands in as the captain's best proxy. The
        // resolved point sits far down the bearing — steering only ever
        // reads the direction.
        const rumbles = this.rumblesFor(ship);
        if (rumbles.length === 0) return null;
        const r = rumbles.reduce((a, b) => (b.loud > a.loud ? b : a));
        const [dx, dy] = headingVec(r.bearing);
        return {
          x: ship.x + dx * C.REGION_RADIUS_M * 2,
          y: ship.y + dy * C.REGION_RADIUS_M * 2,
          live: true,
        };
      }
      default: {
        // v5 §3: a contact ref — designation letter or identified callsign,
        // resolved against this captain's own book
        const key = this.resolveContactRef(ship.id, target);
        if (!key) return null;
        return this.recordPos(ship, key);
      }
    }
  }

  // v5 §1: continuous tracking — once per tick, refresh every track goal
  // against the live sensor picture. A ship-shaped target that drops below
  // faint falls back to last-known position and the XO says so ONCE (edge,
  // not spam); reacquisition is announced the same way. A bearing-only or
  // ordnance target that vanishes outright just holds the last resolved
  // bearing (missiles die in seconds; a faded rumble leaves nothing better
  // to steer by).
  private refreshTrackGoals(ship: Ship, events: SimEvent[]): void {
    const g = ship.goal;
    if (!g || g.mode !== "track") return;
    const pos = this.resolveTargetPos(ship, g.target);
    if (pos) g.degrees = bearingTo(ship.x, ship.y, pos.x, pos.y);
    const live = pos !== null && pos.live;
    const bearingOnly =
      g.target === "nearest_missile" ||
      g.target === "nearest_decoy" ||
      g.target === "nearest_rumble";
    if (!bearingOnly) {
      if (!live && !g.lost) {
        g.lost = true;
        if (!ship.isDrone) {
          events.push({
            kind: "notice",
            ship: ship.id,
            text: "Lost him — helm's holding his last known position.",
          });
        }
      } else if (live && g.lost) {
        g.lost = false;
        if (!ship.isDrone) {
          events.push({
            kind: "notice",
            ship: ship.id,
            text: "Contact regained — helm's tracking him again.",
          });
        }
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

      // campaign: the clock is a budget — at zero, the Hunter enters the
      // system (spec §1: phase 1 races, phase 2 hides; everything inverts)
      if (this.mission && !this.mission.hunterSpawned && this.tickCount >= this.mission.hunterSpawnS) {
        this.spawnHunter(events);
      }

      // 1. drone behavior (fires on last tick's lock state), then standing
      // orders against each player's sensor picture. Ghost ships (v5 §2:
      // disconnected captains) have their standing orders SUSPENDED and
      // their scuttle timer running.
      for (const ship of this.ships.values()) {
        if (ship.ghost) {
          ship.ghostTimerS -= tickDt;
          if (ship.ghostTimerS <= 0) this.scuttleShip(ship, events);
          continue;
        }
        this.droneAct(ship, events, tickDt);
        this.hunterAct(ship, events);
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
            events.push({ kind: "ack", ship: id, verb: cmd.verb, text: cmd.acknowledgement });
          }
        }
      }

      // 3. continuous tracking: refresh track goals against this tick's
      // sensor picture (sensors re-evaluated on the previous tick's last
      // substep, so the picture is current as of the tick boundary)
      for (const ship of this.ships.values()) {
        this.refreshTrackGoals(ship, events);
      }

      // campaign: gate-solution XO lines (edge-triggered, rate-limited)
      // + rumor resolution by presence + the salvage transfer clock (§4.2)
      if (this.mission) {
        this.updateGateXO(events);
        this.stepRumors(events);
        this.stepSalvage(events);
      }
    }

    // 4. step physics (also: propellant, tube reloads, flash countdown)
    for (const ship of this.ships.values()) {
      const preX = ship.x;
      const preY = ship.y;
      this.stepShip(ship, events, dt);
      // campaign gate: swept aperture crossing every substep (invariant 6).
      // BEFORE applyBounds on purpose: the gate sits ON the rim, so the
      // crossing and the zone exit land in the same substep — `cleared`
      // must be set first or the shroud line doubles the exit call.
      if (this.mission && ship.id === this.mission.playerId) {
        this.checkGateCrossing(ship, preX, preY, events);
      }
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
    for (const sl of this.slugs) {
      sl.prevX = sl.x;
      sl.prevY = sl.y;
      sl.x += sl.vx * dt;
      sl.y += sl.vy * dt;
      sl.age += dt;
    }
    for (const pr of this.probes) {
      pr.prevX = pr.x;
      pr.prevY = pr.y;
      if (pr.age < C.PROBE_BURN_S) {
        const [dx, dy] = headingVec(pr.bearing);
        pr.vx += dx * C.PROBE_ACCEL_MPS2 * dt;
        pr.vy += dy * C.PROBE_ACCEL_MPS2 * dt;
      }
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.age += dt;
    }

    // 5. resolve weapons: proximity fuses, expiry, seeker locks
    this.resolveWeapons(events, dt);

    this.phase = (this.phase + 1) % C.PHYSICS_SUBSTEPS;
    if (this.phase !== 0) return;

    // campaign: once the crossing has registered, "We're through" is the
    // last word — the system is over, and a tier-demotion ceremony on a
    // Hunter receding behind you is noise (playtest 2026-07-12)
    if (this.mission?.cleared) return;

    // 6. sensors: per-viewer enemy visibility, last-known tracking, contact
    // notices; then ship-to-ship missile locks (needs fresh visibility) and
    // painted warnings (needs both locks updated)
    for (const ship of this.ships.values()) {
      this.updateSensors(ship);
      this.updateDecoyContacts(ship);
      this.updateDesignations(ship, events); // after tiers + decoy fixes refresh
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
        const target = m.target ? this.ships.get(m.target) : undefined;
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

  // v5 §5: firing solution — the compass bearing whose slug (shooter
  // velocity inherited + RAIL_SLUG_SPEED along the line) meets a target
  // holding constant velocity. Relative frame: solve |Δp + Δv·t| = S·t.
  // No positive-time solution (impossibly fast crosser) = direct bearing.
  private railSolutionBearing(
    ship: Ship,
    tx: number,
    ty: number,
    tvx: number,
    tvy: number
  ): number {
    const px = tx - ship.x;
    const py = ty - ship.y;
    const dvx = tvx - ship.vx;
    const dvy = tvy - ship.vy;
    const S = C.RAIL_SLUG_SPEED_MPS;
    const a = dvx * dvx + dvy * dvy - S * S;
    const b = 2 * (px * dvx + py * dvy);
    const c = px * px + py * py;
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
    if (t === null) return bearingTo(ship.x, ship.y, tx, ty);
    return norm360(bearingTo(0, 0, px + dvx * t, py + dvy * t));
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

  // My lock on my designated target: needs cone + range + TIER_TRACK OR
  // BETTER held for LOCK_TIME_S continuous seconds; LOCK_GRACE_S forgives
  // brief breaks. (A faint contact cannot be locked — close in or provoke a
  // burn first.) v5 §2: the lock is per-target — while idle it auto-picks
  // the nearest eligible hostile and STICKS to it once progress accrues
  // (grace applies to that target, not whoever wanders into the cone); §9
  // adds explicit designation.
  private updateLock(ship: Ship, events: SimEvent[], dt: number): void {
    const L = ship.lock;
    const eligible = (h: Ship): boolean => {
      // OWN sensors only (live) — a probe-relayed track deliberately
      // cannot feed a lock (v5 §6: probes FIND ships, they don't shoot
      // them; a fused tier here would let you lock through a rock)
      if (this.contactTierFor(ship, h) < 2) return false;
      const range = dist(ship.x, ship.y, h.x, h.y);
      const off = Math.abs(angDiff(ship.facing, bearingTo(ship.x, ship.y, h.x, h.y)));
      return range <= C.LOCK_RANGE_M && off <= C.LOCK_CONE_HALF_ANGLE_DEG;
    };

    // target destroyed/scuttled: the lock dies with it — progress never
    // transfers to another hull
    if (L.target && !this.ships.has(L.target)) {
      if ((L.has || L.progress > 0) && !ship.isDrone) {
        events.push({ kind: "notice", ship: ship.id, text: "Lock lost.", alert: L.has });
      }
      L.has = false;
      L.progress = 0;
      L.grace = 0;
      L.target = null;
      if (ship.lockDesignation?.startsWith("s")) ship.lockDesignation = null;
    }

    // v5 §3: an explicit designation stands until replaced or its object
    // leaves the board; a designated decoy contact keeps L.target null —
    // the seeker never gets a hard return, so nothing accrues (fog-safe)
    if (ship.lockDesignation) {
      const key = ship.lockDesignation;
      const gone = key.startsWith("s")
        ? !this.ships.has(key.slice(1))
        : !this.decoys.some((d) => `d${d.id}` === key);
      if (gone) {
        ship.lockDesignation = null; // book already announced the fade
      } else if (key.startsWith("s")) {
        L.target = key.slice(1);
      }
    }

    // idle (nothing accrued) and undesignated: auto-pick nearest eligible
    if (!L.has && L.progress === 0 && !ship.lockDesignation) {
      const pick = this.nearestOf(ship, this.hostilesOf(ship).filter(eligible));
      if (pick) L.target = pick.id;
    }

    const target = L.target ? this.ships.get(L.target) : undefined;
    const holding = !!target && this.isHostile(ship, target) && eligible(target);

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
        L.target = null; // free to auto-pick afresh next tick
      }
    }
  }

  // Hostile lock state as it bears on THIS ship (RWR fiction: you feel
  // their targeting radiation even if you can't see them). v5 §3:
  // ANY-source — the worst state across every hostile painting us.
  // v5.1 §2.2: hostiles currently HOLDING a lock on this ship
  lockersOn(ship: Ship): number {
    let n = 0;
    for (const h of this.hostilesOf(ship)) {
      if (h.lock.has && h.lock.target === ship.id) n++;
    }
    return n;
  }

  paintedState(ship: Ship): PaintedState {
    let state: PaintedState = "none";
    for (const h of this.hostilesOf(ship)) {
      if (h.lock.target !== ship.id) continue;
      if (h.lock.has) return "locked";
      if (h.lock.progress > 0) state = "acquiring";
    }
    return state;
  }

  private announcePainted(ship: Ship, events: SimEvent[]): void {
    if (ship.isDrone) return;
    const now = this.paintedState(ship);
    const was = ship.prevPainted;
    ship.prevPainted = now;
    if (now === was) return;
    // v5 §3: with several hostiles the source is ambiguous — the RWR names
    // the emitter's bearing ("We're being painted — bearing 190"). In a
    // 1v1 the classic lines stand (and the TTS cache keeps its stock hits).
    const painter = this.hostilesOf(ship)
      .filter((h) => h.lock.target === ship.id && (h.lock.has || h.lock.progress > 0))
      .sort((a, b) => Number(b.lock.has) - Number(a.lock.has))[0];
    const ambiguous = this.hostilesOf(ship).length > 1 && painter;
    const brgDeg = painter ? bearingTo(ship.x, ship.y, painter.x, painter.y) : 0;
    if (now === "acquiring" && was === "none") {
      events.push({
        kind: "notice",
        ship: ship.id,
        text: ambiguous
          ? `Captain, we're being painted — bearing ${fmtBearing(brgDeg)}!`
          : "Captain, we're being painted — missile lock in progress!",
        ...(ambiguous
          ? { speak: `Captain, we're being painted — bearing ${spokenBearing(brgDeg)}!` }
          : {}),
        alert: true,
      });
    } else if (now === "locked") {
      events.push({
        kind: "notice",
        ship: ship.id,
        text: ambiguous ? `They have lock — bearing ${fmtBearing(brgDeg)}!` : "They have lock!",
        ...(ambiguous ? { speak: `They have lock — bearing ${spokenBearing(brgDeg)}!` } : {}),
        alert: true,
      });
    } else if (now === "none") {
      events.push({ kind: "notice", ship: ship.id, text: "Enemy lock is off us." });
    }
  }

  private lockPos(lock: NonNullable<Missile["lock"]>): { x: number; y: number } | null {
    if (lock.type === "ship") {
      const s = this.ships.get(lock.id);
      return s ? { x: s.x, y: s.y } : null;
    }
    if (lock.type === "probe") {
      const pr = this.probes.find((p) => p.id === lock.id);
      return pr ? { x: pr.x, y: pr.y } : null;
    }
    const d = this.decoys.find((d) => d.id === lock.id);
    return d ? { x: d.x, y: d.y } : null;
  }

  private resolveWeapons(events: SimEvent[], dt: number): void {
    // --- proximity fuses (segment-based closest approach over the tick,
    // so a 450 m/s missile can't tunnel past a 150 m fuse between ticks)
    const deadMissiles = new Set<number>();
    const deadDecoys = new Set<number>();
    const deadProbes = new Set<number>();

    // --- point defense fires before fuses resolve (defense gets the last word)
    const pdcVictims = new Map<ShipId, ShipId>();
    for (const ship of this.ships.values()) {
      this.stepPdc(ship, deadMissiles, deadProbes, pdcVictims, events, dt);
    }
    this.announcePdcShipFire(pdcVictims, events);

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

    // --- v5 §5 rail slugs: pure physics, NO IFF (the game's only
    // friendly-fire vector — a slug does not read transponders). Rocks and
    // hulls stop a slug; ordnance it grazes is obliterated without
    // stopping it (rare, glorious). PDCs never engage slugs.
    const deadSlugs = new Set<number>();
    for (const sl of this.slugs) {
      if (sl.age >= C.RAIL_SLUG_LIFETIME_S) {
        deadSlugs.add(sl.id);
        continue;
      }
      if (this.terrain.rocks.length > 0) {
        const hit = firstRockHit(sl.prevX, sl.prevY, sl.x, sl.y, this.terrain);
        if (hit) {
          deadSlugs.add(sl.id);
          this.fx.push({ type: "boom", x: sl.prevX + (sl.x - sl.prevX) * hit.t, y: sl.prevY + (sl.y - sl.prevY) * hit.t });
          continue;
        }
      }
      for (const target of this.ships.values()) {
        // the OWNER is exempt: the slug is born inside the shooter's own
        // hit radius, and at 2x max ship speed the shooter can never
        // re-enter its line afterwards — this is muzzle geometry, not IFF
        if (target.id === sl.owner) continue;
        const dMin = segmentMinDist(
          sl.prevX, sl.prevY, sl.x, sl.y,
          target.x - target.vx * dt, target.y - target.vy * dt, target.x, target.y
        );
        if (dMin <= C.RAIL_HIT_RADIUS_M) {
          deadSlugs.add(sl.id);
          this.fx.push({ type: "boom", x: target.x, y: target.y });
          this.damageShip(target, C.RAIL_DAMAGE, "rail", events, sl.owner);
          break;
        }
      }
      if (deadSlugs.has(sl.id)) continue;
      // muzzle guard: same-owner ordnance is exempt for the slug's first
      // second — anything launched the same tick co-spawns at the ship's
      // position and would be swatted at range zero. Downrange (6+ km
      // out), your own decoy/probe is honestly hittable — no IFF.
      const muzzle = (owner: ShipId) => sl.age < 1 && owner === sl.owner;
      for (const m of this.missiles) {
        if (deadMissiles.has(m.id) || muzzle(m.owner)) continue;
        const dMin = segmentMinDist(
          sl.prevX, sl.prevY, sl.x, sl.y,
          m.prevX, m.prevY, m.x, m.y
        );
        if (dMin <= C.RAIL_HIT_RADIUS_M) {
          deadMissiles.add(m.id);
          this.fx.push({ type: "boom", x: m.x, y: m.y });
        }
      }
      for (const d of this.decoys) {
        if (deadDecoys.has(d.id) || muzzle(d.owner)) continue;
        const dMin = segmentMinDist(
          sl.prevX, sl.prevY, sl.x, sl.y,
          d.x - d.vx * dt, d.y - d.vy * dt, d.x, d.y
        );
        if (dMin <= C.RAIL_HIT_RADIUS_M) {
          deadDecoys.add(d.id);
          this.fx.push({ type: "boom", x: d.x, y: d.y });
          // own equipment: the decoy's owner always learns (v4.7.1 rule)
          events.push({ kind: "notice", ship: d.owner, text: "We just lost a decoy." });
        }
      }
      for (const pr of this.probes) {
        if (deadProbes.has(pr.id) || muzzle(pr.owner)) continue;
        const dMin = segmentMinDist(
          sl.prevX, sl.prevY, sl.x, sl.y,
          pr.prevX, pr.prevY, pr.x, pr.y
        );
        if (dMin <= C.RAIL_HIT_RADIUS_M) {
          deadProbes.add(pr.id);
          this.fx.push({ type: "boom", x: pr.x, y: pr.y });
        }
      }
    }
    this.slugs = this.slugs.filter((sl) => !deadSlugs.has(sl.id));

    // --- v5 §6 probes: rocks, lifetime; deaths announce to the owner
    // (own equipment — the v4.7.1 decoy rule)
    for (const pr of this.probes) {
      if (deadProbes.has(pr.id)) continue;
      if (this.terrain.rocks.length > 0 && firstRockHit(pr.prevX, pr.prevY, pr.x, pr.y, this.terrain)) {
        deadProbes.add(pr.id);
        this.fx.push({ type: "boom", x: pr.x, y: pr.y });
      } else if (pr.age >= C.PROBE_LIFETIME_S) {
        deadProbes.add(pr.id);
        const owner = this.ships.get(pr.owner);
        if (owner && !owner.isDrone) {
          events.push({
            kind: "notice",
            ship: pr.owner,
            text: `Probe ${PROBE_NAMES[pr.idx - 1] ?? pr.idx} is spent.`,
          });
        }
      }
    }
    for (const pr of this.probes) {
      if (!deadProbes.has(pr.id) || pr.age >= C.PROBE_LIFETIME_S) continue;
      const owner = this.ships.get(pr.owner);
      if (owner && !owner.isDrone) {
        events.push({
          kind: "notice",
          ship: pr.owner,
          text: `We just lost probe ${PROBE_NAMES[pr.idx - 1] ?? pr.idx}.`,
          alert: true,
        });
      }
    }
    this.probes = this.probes.filter((pr) => !deadProbes.has(pr.id));

    for (const m of this.missiles) {
      if (deadMissiles.has(m.id)) continue;
      if (m.age < C.MISSILE_LAUNCH_DELAY_TICKS / C.TICK_RATE_HZ) continue; // still in launch delay
      // v4.5 arming distance: the fuse is inert until the bird has traveled
      // MISSILE_ARMING_DIST_M from its launch point — a point-blank launch
      // duds straight past the target (standoff is part of the weapon)
      if (dist(m.x, m.y, m.launchX, m.launchY) < C.MISSILE_ARMING_DIST_M) continue;

      // ships — friendly hulls never trip the fuse (v5 §8 IFF)
      for (const target of this.ships.values()) {
        if (this.sameSide(m.owner, m.team, target.id, target.team)) continue;
        const dMin = segmentMinDist(
          m.prevX, m.prevY, m.x, m.y,
          target.x - target.vx * dt, target.y - target.vy * dt, target.x, target.y
        );
        if (dMin <= C.MISSILE_PROX_FUSE_M) {
          deadMissiles.add(m.id);
          this.fx.push({ type: "boom", x: m.x, y: m.y });
          this.damageShip(target, C.MISSILE_DAMAGE, "missile", events, m.owner);
          break;
        }
      }
      if (deadMissiles.has(m.id)) continue;
      // enemy decoys (friendly ones are IFF-exempt)
      for (const d of this.decoys) {
        if (this.sameSide(m.owner, m.team, d.owner, d.team) || deadDecoys.has(d.id)) continue;
        const dMin = segmentMinDist(
          m.prevX, m.prevY, m.x, m.y,
          d.x - d.vx * dt, d.y - d.vy * dt, d.x, d.y
        );
        if (dMin <= C.MISSILE_PROX_FUSE_M) {
          deadMissiles.add(m.id);
          deadDecoys.add(d.id);
          this.fx.push({ type: "boom", x: m.x, y: m.y });
          // the decoy is OUR equipment — its owner always learns it's off
          // the board. The missile's owner only learns what the bird ate
          // if they could watch the intercept (else "it was a decoy" hands
          // an ID-tier fact through fog to a fire-and-forget shooter).
          events.push({ kind: "notice", ship: d.owner, text: "Their missile took the decoy." });
          const shooter2 = this.ships.get(m.owner);
          if (shooter2 && this.canObserve(shooter2, m.x, m.y)) {
            events.push({ kind: "notice", ship: m.owner, text: "Missile detonated — it was a decoy." });
          }
          break;
        }
      }
      if (deadMissiles.has(m.id)) continue;
      // probes (v5 §6): a legitimate prox target — hostile ones only
      for (const pr of this.probes) {
        if (this.sameSide(m.owner, m.team, pr.owner, pr.team) || deadProbes.has(pr.id)) continue;
        const dMin = segmentMinDist(
          m.prevX, m.prevY, m.x, m.y,
          pr.prevX, pr.prevY, pr.x, pr.y
        );
        if (dMin <= C.MISSILE_PROX_FUSE_M) {
          deadMissiles.add(m.id);
          deadProbes.add(pr.id);
          this.fx.push({ type: "boom", x: m.x, y: m.y });
          break;
        }
      }
      if (deadMissiles.has(m.id)) continue;
      // enemy missiles ("any enemy object" per the handoff — a friendly
      // bird is not an enemy object)
      for (const other of this.missiles) {
        if (this.sameSide(m.owner, m.team, other.owner, other.team) || deadMissiles.has(other.id)) continue;
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

      // uplink severance: the mother ship must live and still hold lock ON
      // THIS BIRD'S TARGET (v5 §2: a lock swung to a different hostile cuts
      // the feed). One-way — a re-acquired lock does NOT re-uplink a bird.
      if (m.guidance === "uplinked") {
        const owner = this.ships.get(m.owner);
        if (!owner || owner.hull <= 0 || !owner.lock.has || owner.lock.target !== m.target) {
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
        m.lock = m.target ? { type: "ship", id: m.target } : null;
        continue;
      }

      // AUTONOMOUS seeker: strongest signature it can DETECT in the cone
      // (seeker detection = MISSILE_SEEKER_BASE_M x sig / 100, LOS
      // required). Fully decoy-susceptible. No candidate = hold course;
      // it may acquire later (only dry fuel ends steering for good).
      const course = m.course;
      type Cand = { lock: NonNullable<Missile["lock"]>; sig: number };
      const cands: Cand[] = [];
      const seekerSees = (x: number, y: number, sig: number): boolean =>
        dist(m.x, m.y, x, y) <= C.MISSILE_SEEKER_BASE_M * (sig / 100) &&
        Math.abs(angDiff(course, bearingTo(m.x, m.y, x, y))) <= C.MISSILE_ACQ_CONE_DEG &&
        this.losClear(m.x, m.y, x, y);
      // v5 §8 IFF: seekers never acquire friendly ships/decoys/probes
      for (const s of this.ships.values()) {
        if (this.sameSide(m.owner, m.team, s.id, s.team)) continue;
        const sig = this.signatureOf(s);
        if (seekerSees(s.x, s.y, sig)) {
          cands.push({ lock: { type: "ship", id: s.id }, sig });
        }
      }
      for (const d of this.decoys) {
        if (this.sameSide(m.owner, m.team, d.owner, d.team) || deadDecoys.has(d.id)) continue;
        if (seekerSees(d.x, d.y, C.DECOY_SIGNATURE)) {
          cands.push({ lock: { type: "decoy", id: d.id }, sig: C.DECOY_SIGNATURE });
        }
      }
      // v5 §6: a probe is a weak seeker candidate too (sig 25 — only a
      // very close bird bothers); friendly probes are IFF-exempt
      for (const pr of this.probes) {
        if (this.sameSide(m.owner, m.team, pr.owner, pr.team) || deadProbes.has(pr.id)) continue;
        if (seekerSees(pr.x, pr.y, C.PROBE_SIGNATURE)) {
          cands.push({ lock: { type: "probe", id: pr.id }, sig: C.PROBE_SIGNATURE });
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
          speak: `Missile inbound — bearing ${spokenBearing(brg)}!`,
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
        // playtest 2026-07-12: the em-dash synthesis garbled its tail and
        // the bad take was disk-cached forever. Plain punctuation for the
        // voice (new text = new cache key = fresh take); transcript keeps
        // the dash.
        speak: now
          ? "We're in the cloud. Our sensors are blind, but so are theirs."
          : "Clear of the cloud. Sensors are back.",
      });
    }
    ship.wasInDust = now;
  }


  // Re-evaluate this viewer's contact tier on every hostile and refresh
  // the faint caches and last-known ghosts. Announcements moved to
  // updateDesignations (v5 §3): the XO speaks in designation letters.
  private updateSensors(ship: Ship): void {
    for (const enemy of this.hostilesOf(ship)) {
      const st = this.contactOn(ship.id, enemy.id);
      const ownTier = this.contactTierFor(ship, enemy);
      // v5 §6: fuse in probe relays — best tier from any of our probes,
      // each judging from ITS position. contactOn becomes the captain's
      // MAP picture; anything that must stay own-sensor (missile locks)
      // reads contactTierFor directly.
      let probeTier: 0 | 1 | 2 | 3 = 0;
      for (const pr of this.probesOf(ship.id)) {
        const t = this.probeTierOn(
          pr,
          enemy.x,
          enemy.y,
          this.signatureOf(enemy),
          enemy.pingRevealS > 0,
          !this.insideZone(enemy)
        );
        if (t > probeTier) probeTier = t;
      }
      const tier = Math.max(ownTier, probeTier) as 0 | 1 | 2 | 3;
      st.tier = tier;
      st.viaProbe = probeTier > ownTier && tier >= 1;

      if (tier === 1) {
        // approximate position only, refreshed every FAINT_UPDATE_INTERVAL_S
        if (
          !st.faint ||
          this.tickCount - st.faint.t >= C.FAINT_UPDATE_INTERVAL_S * C.TICK_RATE_HZ
        ) {
          const ang = Math.random() * Math.PI * 2;
          const noise = Math.random() * C.FAINT_POS_NOISE_M;
          st.faint = {
            x: enemy.x + Math.cos(ang) * noise,
            y: enemy.y + Math.sin(ang) * noise,
            t: this.tickCount,
          };
        }
        st.lastKnown = {
          x: st.faint.x,
          y: st.faint.y,
          facing: 0, // no vector data at faint
          t: st.faint.t,
        };
      } else {
        st.faint = null;
        if (tier >= 2) {
          st.lastKnown = { x: enemy.x, y: enemy.y, facing: enemy.facing, t: this.tickCount };
        }
      }
    }
  }

  // v5 §3: the designation pass. Hostile SHIPS and unresolved enemy DECOYS
  // share one book per observer — same letters, same XO ceremony (anything
  // less unmasks decoys by silence). Handles acquisition (new letter or
  // correlated return), tier-transition lines, the identification event,
  // and loss (last-known ghost under the letter).
  private updateDesignations(ship: Ship, events: SimEvent[]): void {
    const book = this.bookOf(ship.id);
    // v5.1 §3.3: the ceremony always happens — letters, transcript lines,
    // fog-identical decoy treatment (invariant 15) — but it only gets a
    // VOICE when the change is a threat: inside the (board-size-scaled)
    // announce range, or the contact holds a lock on us, or it's the only
    // contact on the board. Below the bar: transcript-only.
    const say = (text: string, speak?: string, alert = false, relevant = true) => {
      if (!ship.isDrone) {
        events.push({
          kind: "notice",
          ship: ship.id,
          text,
          ...(speak ? { speak } : {}),
          alert,
          ...(relevant ? {} : { silent: true }),
        });
      }
    };

    // one trackable object per pass entry: current tier + a live position
    // for bearings/ranges + identity data for the ID event
    type Entry = {
      key: string;
      tier: 0 | 1 | 2 | 3;
      viaProbe?: boolean;
      x: number;
      y: number;
      lastKnown: ContactRecord["lastKnown"];
      idLine: (letter: string) => { text: string; speak: string };
    };
    const entries: Entry[] = [];
    for (const h of this.hostilesOf(ship)) {
      const st = this.contactOn(ship.id, h.id);
      entries.push({
        key: `s${h.id}`,
        tier: st.tier,
        viaProbe: st.viaProbe,
        x: h.x,
        y: h.y,
        lastKnown: st.lastKnown,
        idLine: (letter) => ({
          text: `Close-range ID on Contact ${letter}: it's ${h.callsign}.`,
          speak: `Contact identified — it's ${h.callsign}.`,
        }),
      });
    }
    const faintFixes = this.decoyFaint.get(ship.id);
    for (const d of this.decoys) {
      if (d.owner === ship.id) continue;
      const tier = this.decoyTierFor(ship, d);
      const fix = faintFixes?.get(d.id);
      const px = tier === 1 && fix ? fix.x : d.x;
      const py = tier === 1 && fix ? fix.y : d.y;
      entries.push({
        key: `d${d.id}`,
        tier,
        x: px,
        y: py,
        lastKnown:
          tier >= 1
            ? { x: px, y: py, facing: 0, t: this.tickCount }
            : null,
        idLine: (letter) => ({
          text: `Close-range ID on Contact ${letter}: it's a decoy.`,
          speak: `Contact identified — it's a decoy.`,
        }),
      });
    }

    // §3.4 terseness: the announce bar scales with how busy the board is
    const boardCount = entries.filter((en) => en.tier >= 1).length;
    const relevanceOf = (x: number, y: number, key: string): boolean => {
      if (boardCount <= 1) return true; // the only contact: tell me everything
      if (key.startsWith("s")) {
        const h = this.ships.get(key.slice(1));
        if (h && h.lock.has && h.lock.target === ship.id) return true; // it can shoot us
      }
      return dist(ship.x, ship.y, x, y) < contactAnnounceRange(boardCount);
    };

    const seen = new Set<string>();
    for (const e of entries) {
      seen.add(e.key);
      let rec = book.records.get(e.key);
      const brgDeg = bearingTo(ship.x, ship.y, e.x, e.y);
      const brg = fmtBearing(brgDeg);
      const rangeKm = Math.round(dist(ship.x, ship.y, e.x, e.y) / 1000);
      const relevant = relevanceOf(e.x, e.y, e.key);

      if (e.tier >= 1 && !rec) {
        // first acquisition ever ("via probe" names the relay, v5 §6)
        rec = { letter: this.nextLetter(book), identified: false, prevTier: 0, lostAt: null, lastKnown: null };
        book.records.set(e.key, rec);
        const via = e.viaProbe ? " (via probe)" : "";
        say(
          e.tier === 1
            ? `New contact${via} — designating ${rec.letter}. Faint, bearing ${brg}, range approximately ${rangeKm} km.`
            : `New contact${via} — designating ${rec.letter}. I have a track — bearing ${brg}, range ${rangeKm} km.`,
          e.viaProbe
            ? `New contact via probe — designating ${rec.letter}. Bearing ${spokenBearing(brgDeg)}.`
            : `New contact — designating ${rec.letter}. Bearing ${spokenBearing(brgDeg)}.`,
          false,
          relevant
        );
      } else if (e.tier >= 1 && rec && rec.lostAt !== null) {
        // reacquisition: keep the letter only if the XO can plausibly
        // correlate — recent loss AND within max-speed reach of the last
        // known fix (plus faint noise slack). Otherwise the old fix stays
        // on the map as a tombstone ghost and a NEW letter opens
        // (identification resets with it).
        const elapsedS = (this.tickCount - rec.lostAt) / C.TICK_RATE_HZ;
        const reach = C.MAX_SPEED_MPS * elapsedS + C.FAINT_POS_NOISE_M * 2;
        const plausible =
          elapsedS <= C.CONTACT_CORRELATE_S &&
          (!rec.lastKnown || dist(e.x, e.y, rec.lastKnown.x, rec.lastKnown.y) <= reach);
        if (plausible) {
          rec.lostAt = null;
          const label = rec.identified ? this.callsigns.get(e.key.slice(1)) ?? `Contact ${rec.letter}` : `Contact ${rec.letter}`;
          say(
            `${label} is back — bearing ${brg}, range approximately ${rangeKm} km.`,
            `${label} is back — bearing ${spokenBearing(brgDeg)}.`,
            false,
            relevant
          );
          rec.prevTier = 1; // transition lines below take it from faint
        } else {
          if (rec.lastKnown) book.tombstones.push({ letter: rec.letter, lastKnown: rec.lastKnown });
          rec.letter = this.nextLetter(book);
          rec.identified = false;
          rec.lostAt = null;
          rec.lastKnown = null;
          rec.prevTier = 0;
          say(
            e.tier === 1
              ? `New contact — designating ${rec.letter}. Faint, bearing ${brg}, range approximately ${rangeKm} km.`
              : `New contact — designating ${rec.letter}. I have a track — bearing ${brg}, range ${rangeKm} km.`,
            `New contact — designating ${rec.letter}. Bearing ${spokenBearing(brgDeg)}.`,
            false,
            relevant
          );
        }
      }
      if (!rec) continue;

      // resolved decoys leave the contact world (they render as decoys);
      // no further ceremony
      const isDecoy = e.key.startsWith("d");
      if (isDecoy && rec.identified) {
        rec.prevTier = e.tier;
        rec.lastKnown = null;
        continue;
      }

      const was = rec.prevTier;
      const label = rec.identified
        ? this.callsigns.get(e.key.slice(1)) ?? `Contact ${rec.letter}`
        : `Contact ${rec.letter}`;

      if (e.tier >= 1) rec.lastKnown = e.lastKnown ?? rec.lastKnown;

      if (e.tier !== was) {
        if (e.tier === 0) {
          const lk = rec.lastKnown;
          const lkDeg = lk ? bearingTo(ship.x, ship.y, lk.x, lk.y) : brgDeg;
          rec.lostAt = this.tickCount;
          // §3.3: a fade at 200 km is not news; the SAME fade while that
          // contact holds a lock on us is screaming news — relevanceOf
          // encodes exactly that (lock trumps range)
          say(
            was >= 2
              ? `Track lost on ${label} — last known bearing ${fmtBearing(lkDeg)}.`
              : `${label} faded — last known bearing ${fmtBearing(lkDeg)}.`,
            was >= 2
              ? `Track lost on ${label} — last known bearing ${spokenBearing(lkDeg)}.`
              : `${label} faded — last known bearing ${spokenBearing(lkDeg)}.`,
            was >= 2,
            lk ? relevanceOf(lk.x, lk.y, e.key) : relevant
          );
        } else if (e.tier === 1 && was >= 2) {
          say(`Losing resolution — ${label}'s gone faint.`, undefined, false, relevant);
        } else if (e.tier === 2) {
          if (was < 2 && was > 0) {
            say(
              `${label} firming up — I have a track. Bearing ${brg}, range ${rangeKm} km.`,
              `${label} firming up — I have a track. Bearing ${spokenBearing(brgDeg)}.`,
              false,
              relevant
            );
          } else if (was === 3) {
            say(`Lost the detail readout on ${label} — still holding the track.`, undefined, false, relevant);
          }
        } else if (e.tier === 3) {
          // ID happens at close range by sensor math — it passes the bar
          // on range in practice; the gate is uniform anyway
          if (!rec.identified) {
            rec.identified = true;
            const line = e.idLine(rec.letter);
            say(line.text, line.speak, false, relevant);
          } else if (!isDecoy) {
            say(`Close-range ID — full readout on ${this.callsigns.get(e.key.slice(1)) ?? label}.`, undefined, false, relevant);
          }
        }
        rec.prevTier = e.tier;
      }
    }

    // objects gone from the board entirely (decoy expired, ship destroyed
    // or scuttled UNOBSERVED — destroyShip already purged the records of
    // everyone who watched it die): close the record as a loss so the
    // ghost lingers — a lie outliving its decoy is the deception working,
    // and an unseen death is just a track that went dark
    for (const [key, rec] of book.records) {
      if (seen.has(key) || rec.lostAt !== null) continue;
      const isDecoyKey = key.startsWith("d");
      if (isDecoyKey && rec.identified) {
        // a RESOLVED decoy leaving the board: nothing to mourn
        book.records.delete(key);
        continue;
      }
      if (rec.prevTier >= 1) {
        rec.lostAt = this.tickCount;
        const label =
          rec.identified && !isDecoyKey
            ? this.callsigns.get(key.slice(1)) ?? `Contact ${rec.letter}`
            : `Contact ${rec.letter}`;
        const lk = rec.lastKnown;
        const lkDeg = lk ? bearingTo(ship.x, ship.y, lk.x, lk.y) : 0;
        say(
          rec.prevTier >= 2
            ? `Track lost on ${label} — last known bearing ${fmtBearing(lkDeg)}.`
            : `${label} faded — last known bearing ${fmtBearing(lkDeg)}.`,
          rec.prevTier >= 2
            ? `Track lost on ${label} — last known bearing ${spokenBearing(lkDeg)}.`
            : `${label} faded — last known bearing ${spokenBearing(lkDeg)}.`,
          rec.prevTier >= 2,
          lk ? relevanceOf(lk.x, lk.y, key) : false
        );
        rec.prevTier = 0;
      }
    }
  }

  private stepShip(ship: Ship, events: SimEvent[], dt: number): void {
    // Housekeeping shared by drones and players: cooldowns, launch flash,
    // tube reloads.
    ship.sigSpikeLaunch = Math.max(0, ship.sigSpikeLaunch - dt);
    ship.sigSpikePdc = Math.max(0, ship.sigSpikePdc - dt);
    ship.sigSpikeRail = Math.max(0, ship.sigSpikeRail - dt);
    ship.railCooldownS = Math.max(0, ship.railCooldownS - dt);
    ship.commsCooldownBroadcastS = Math.max(0, ship.commsCooldownBroadcastS - dt);
    ship.commsCooldownTightbeamS = Math.max(0, ship.commsCooldownTightbeamS - dt);
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
      const maxStep = statsOf(ship).turn * dt;
      const step = clamp(ship.goal.remaining, -maxStep, maxStep);
      ship.facing = norm360(ship.facing + step);
      ship.goal.remaining -= step; // exact: final step equals the remainder
      if (ship.goal.remaining === 0) ship.goal = null;
    } else {
      const goalDeg = this.resolveGoal(ship);
      if (goalDeg !== null) {
        const diff = angDiff(ship.facing, goalDeg);
        const maxStep = statsOf(ship).turn * dt;
        ship.facing = norm360(ship.facing + clamp(diff, -maxStep, maxStep));
      }
    }

    // accelerate along facing; rotation does NOT change velocity (drift).
    // Output thrust dies with the tank; the throttle SETTING is remembered.
    // accelMult: campaign §6 progression module (1 everywhere else).
    const effective = effectiveThrust(ship);
    const accel = (effective / 100) * statsOf(ship).accel * ship.accelMult;
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
  // autopilot macro ("belay that" arrives as one of those). Aborting a
  // salvage keeps everything already landed (§4.2 — the transfer is a
  // greed curve; walking away is always legal).
  private cancelManeuver(ship: Ship, events: SimEvent[]): void {
    if (!ship.maneuver) return;
    const wasSalvage = ship.maneuver.type === "salvage";
    ship.maneuver = null;
    if (wasSalvage && this.mission) this.mission.salvaging = null;
    if (!ship.isDrone) {
      events.push({
        kind: "notice",
        ship: ship.id,
        text: wasSalvage
          ? "Breaking off the salvage — what's aboard stays aboard, Captain."
          : "Full stop belayed — you have the conn.",
      });
    }
  }

  // Autopilot executor, one substep. full_stop: turn to retrograde, burn at
  // an appropriate throttle, cut thrust when speed < 5 m/s. Future macros
  // switch on maneuver.type here.
  private stepManeuver(ship: Ship, events: SimEvent[], dt: number): void {
    if (!ship.maneuver) return;
    const type = ship.maneuver.type;
    const speed = this.speedOf(ship);
    const accel = statsOf(ship).accel * ship.accelMult;

    // salvage (§4.1): "the XO handles the velocity-matching" — the
    // maneuver flies the TERMINAL approach itself: gentle hops toward the
    // wreck, braking to arrive inside dock range, then station-keeping
    // while the transfer runs. The captain flew the hundreds of km to get
    // here; the XO flies the last handful.
    if (type === "salvage") {
      const wreck = this.mission?.wrecks.find((w) => w.id === (ship.maneuver as { wreckId: number }).wreckId);
      if (wreck) {
        const d = dist(ship.x, ship.y, wreck.x, wreck.y);
        const stopping = (speed * speed) / (2 * accel);
        if (
          d > C.SALVAGE_DOCK_RANGE_M * 0.6 &&
          d - stopping > 400 &&
          speed < Math.min(250, d / 12)
        ) {
          if (ship.propellant <= 0) {
            ship.maneuver = null;
            ship.thrust = 0;
            if (this.mission) this.mission.salvaging = null;
            events.push({ kind: "notice", ship: ship.id, text: "Tanks dry — I can't finish the stop, Captain.", alert: true });
            return;
          }
          const to = bearingTo(ship.x, ship.y, wreck.x, wreck.y);
          ship.goal = { mode: "absolute", degrees: to };
          ship.thrust = Math.abs(angDiff(ship.facing, to)) <= 15 ? 35 : 0;
          return;
        }
      }
    }

    if (speed < 5) {
      if (type === "full_stop") {
        ship.maneuver = null;
        events.push({ kind: "notice", ship: ship.id, text: "Answering all stop." });
      }
      // salvage: HOLD the maneuver — station-keeping while the transfer
      // runs (stepSalvage owns the clock and the end states)
      ship.thrust = 0;
      ship.goal = null;
      ship.vx = 0; // kill the last crawl — "all stop" means stopped
      ship.vy = 0;
      return;
    }
    if (ship.propellant <= 0) {
      ship.maneuver = null;
      ship.thrust = 0;
      if (this.mission) this.mission.salvaging = null;
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
      ship.thrust = clamp(Math.round((speed / accel) * 100), 5, 100);
    } else {
      ship.thrust = 0; // still flipping; don't burn off-axis
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
      if (dmg > 0) this.damageShip(ship, dmg, "rock", events, null);
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
        // campaign: crossing the gate IS leaving the shroud — "We're
        // through, Captain" already said it (playtest finding: the two
        // lines doubled every exit)
        if (!(this.mission?.cleared && ship.id === this.mission.playerId)) {
          events.push({
            kind: "notice",
            ship: ship.id,
            text: "We've left the shroud — we're lit up and the current's against us, Captain.",
            alert: true,
          });
        }
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

  // ---------- campaign "Deep Black" (Stage 0) ----------

  // The aperture: the rim tangent segment through the gate center
  // (perpendicular to the outward radial).
  apertureSegment(): [number, number, number, number] {
    const g = this.mission!.gate;
    const gl = Math.max(1, Math.hypot(g.x, g.y));
    const tx = -g.y / gl; // tangent = outward radial rotated 90°
    const ty = g.x / gl;
    const h = g.apertureW / 2;
    return [g.x - tx * h, g.y - ty * h, g.x + tx * h, g.y + ty * h];
  }

  // Hunter spawn (clock at zero) — one per ladder-row spec. Placement law:
  // OUT OF THE PLAYER'S DETECTION RANGE IS A HARD FLOOR, away-from-the-gate
  // a soft preference, spacing from already-placed Hunters a second soft
  // preference — the first the player knows is the clock, the second a
  // rumble they worked for. Never a contact pop-in. A gate-camping player
  // therefore gets the pack behind them: a chase, which is correct.
  private spawnHunter(events: SimEvent[]): void {
    const m = this.mission!;
    m.hunterSpawned = true;
    const player = this.ships.get(m.playerId);
    if (!player) return; // nobody left to hunt
    const ring = C.REGION_RADIUS_M * C.HUNTER_SPAWN_RADIUS_FRAC;
    const placed: { x: number; y: number }[] = [];
    m.hunters.forEach((spec, i) => {
      const stats = C.ARCHETYPES[spec.archetype];
      const hunterSig = (stats.sigBase + C.HUNTER_HUNT_THROTTLE) * spec.sigMult;
      const floor = this.detectionRange(hunterSig, player) * C.HUNTER_SPAWN_DETECT_MARGIN;
      let pos: { x: number; y: number } | null = null;
      let bestScore = -Infinity;
      let fallback = { x: 0, y: ring };
      let fallbackDist = -Infinity;
      for (let k = 0; k < 72; k++) {
        const [dx, dy] = headingVec(k * 5);
        const x = dx * ring;
        const y = dy * ring;
        const dPlayer = dist(x, y, player.x, player.y);
        if (dPlayer > fallbackDist) {
          fallbackDist = dPlayer;
          fallback = { x, y };
        }
        if (dPlayer < floor) continue; // the hard floor
        // pack spacing: two bearings at once should be two BEARINGS
        const dPack = placed.length
          ? Math.min(...placed.map((p) => dist(x, y, p.x, p.y)))
          : Infinity;
        if (dPack < 40000) continue;
        const dGate = dist(x, y, m.gate.x, m.gate.y);
        if (dGate > bestScore) {
          bestScore = dGate;
          pos = { x, y };
        }
      }
      // filter empty (player detection covers the whole ring): best effort
      // is maximum distance — never a crash, never a silent lap-spawn
      const at = pos ?? fallback;
      placed.push(at);
      const id = i === 0 ? "H" : `H${i + 1}`;
      const hunter = this.addShip(
        id,
        at.x,
        at.y,
        bearingTo(at.x, at.y, 0, 0),
        false, // real physics, real fuel — NOT the drone path
        null,
        i === 0 ? "Hunter" : `Hunter-${i + 1}`,
        spec.archetype
      );
      hunter.sensorMult = spec.sensorMult;
      hunter.sigMult = spec.sigMult;
      hunter.hunterAI = true;
      hunter.hunterSpec = spec;
      m.hunterIds.push(id);
    });
    // the notice carries NO bearing (spec §7.1: the spawn conveys none) —
    // the hearing channel does its own honest work from here. The line is
    // the ladder row's: the player learns to fear a word (§3).
    events.push({ kind: "notice", ship: m.playerId, text: m.spawnLine, alert: true });
  }

  // The Hunter's tick: its ONLY input is its own wire snapshot (+ public
  // terrain + public mission intel). The cast is the type seam, not a fog
  // seam — snapshotFor is the same fog-scoped object a human client
  // receives. Intel carries MARKED wreck sites only (§4.4: rumored sites
  // are the player's private leads — the Hunter never learns them; pinned
  // in tests/hunter.test.ts) and the gate (public geometry) for gateCamp.
  // Public for tests: the EXACT intel struct the Hunter AI receives.
  // MARKED wrecks only — a rumored site is the player's private lead and
  // must never appear here (§4.4; pinned in tests/campaign.test.ts).
  hunterIntelFor(ship: Ship): HunterIntel {
    const m = this.mission!;
    return {
      sites: m.wrecks.filter((w) => w.marked && w.items.length > 0).map((w) => ({ x: w.x, y: w.y })),
      gate: { x: m.gate.x, y: m.gate.y },
      gateCamp: ship.hunterSpec?.gateCamp ?? false,
    };
  }

  private hunterAct(ship: Ship, events: SimEvent[]): void {
    if (!ship.hunterAI || this.winner) return;
    const snap = this.snapshotFor(ship.id) as unknown as HunterSnap;
    const result = hunterDecide(snap, ship.hunterMem, this.terrain, this.hunterIntelFor(ship));
    ship.hunterMem = result.mem;
    for (const cmd of result.commands) {
      this.applyCommand(ship, cmd, events);
    }
  }

  // Rumor resolution (§4.4, playtest fix): a rumored site resolves by
  // PRESENCE, not sensors — fly within RUMOR_RESOLVE_RANGE_M and the XO
  // eyeballs the hulk. Dust is irrelevant at that range (you're alongside),
  // which is the point: the dust rumors are reachable-blind on purpose.
  // A dry hole is announced once and struck off the map.
  private stepRumors(events: SimEvent[]): void {
    const m = this.mission!;
    const player = this.ships.get(m.playerId);
    if (!player) return;
    for (const w of m.wrecks) {
      if (w.marked || w.checked) continue;
      if (dist(player.x, player.y, w.x, w.y) > C.RUMOR_RESOLVE_RANGE_M) continue;
      w.checked = true;
      events.push(
        w.items.length > 0
          ? {
              kind: "notice",
              ship: player.id,
              text: `There's a wreck here alright, Captain — ${w.items.length} piece${w.items.length === 1 ? "" : "s"} worth taking.`,
              speak: "There's a wreck here alright, Captain. Worth taking.",
            }
          : {
              kind: "notice",
              ship: player.id,
              text: "Nothing here, Captain — that rumor was a dry hole.",
            }
      );
    }
  }

  // Campaign salvage transfer (§4.2), one command tick. The maneuver holds
  // the transfer clock; drifting out of dock range or losing the stop
  // pauses it (the clock, not the loot, is what's at risk — landed items
  // are already aboard).
  private stepSalvage(events: SimEvent[]): void {
    const m = this.mission!;
    const player = this.ships.get(m.playerId);
    const man = player?.maneuver;
    if (!player || !man || man.type !== "salvage") {
      m.salvaging = null;
      return;
    }
    const wreck = m.wrecks.find((w) => w.id === man.wreckId);
    if (!wreck || wreck.items.length === 0) {
      player.maneuver = null;
      m.salvaging = null;
      return;
    }
    if (dist(player.x, player.y, wreck.x, wreck.y) > C.SALVAGE_DOCK_RANGE_M) {
      // out of dock range: an ACTIVE transfer breaks (we drifted off);
      // a not-yet-started one is just the XO still flying the approach
      if (m.salvaging) {
        player.maneuver = null;
        m.salvaging = null;
        events.push({ kind: "notice", ship: player.id, text: "We've drifted off the wreck, Captain." });
      }
      return;
    }
    if (this.speedOf(player) >= C.SALVAGE_STOP_SPEED_MPS) return; // still killing velocity
    if (!wreck.checked) wreck.checked = true; // docking is the closest look there is
    if (!m.salvaging || m.salvaging.wreckId !== wreck.id) {
      m.salvaging = { wreckId: wreck.id, t: 0 };
      // the count sets the captain's expectations up front (playtest:
      // "I wasn't sure how long the process was going to take")
      events.push({
        kind: "notice",
        ship: player.id,
        text: `Alongside. Transfer's running — ${wreck.items.length} piece${wreck.items.length === 1 ? "" : "s"} to move, Captain.`,
        speak: "Alongside. Transfer's running, Captain.",
      });
    }
    m.salvaging.t += 1;
    if (m.salvaging.t < C.SALVAGE_ITEM_S) return;
    m.salvaging.t = 0;
    const item = wreck.items.shift()!; // worst first — the last item is the reason to stay
    this.applySalvageItem(player, item, events);
    m.stats.salvaged += 1;
    if (wreck.items.length === 0) {
      player.maneuver = null;
      m.salvaging = null;
      events.push({ kind: "notice", ship: player.id, text: "That's the last of it — wreck's stripped, Captain." });
    } else if (wreck.items[wreck.items.length - 1].kind === "upgrade" && wreck.items.length === 1) {
      // the §4.2 teaser: you are stationary, listening to a rumble grow,
      // deciding whether the last item is worth it
      events.push({ kind: "notice", ship: player.id, text: "There's something else in here, Captain — big. Stay put." });
    }
  }

  private applySalvageItem(ship: Ship, item: SalvageItem, events: SimEvent[]): void {
    this.mission!.haul.push(item);
    const say = (text: string) => events.push({ kind: "notice", ship: ship.id, text });
    switch (item.kind) {
      case "propellant":
        ship.propellant = Math.min(C.PROPELLANT_MAX, ship.propellant + item.amount);
        say("Propellant aboard, Captain.");
        break;
      case "missiles":
        ship.reserve += item.amount;
        say("Missiles aboard.");
        break;
      case "pdc_ammo":
        ship.pdcAmmoS += item.amount;
        say("PDC ammunition aboard.");
        break;
      case "decoys":
        ship.decoys += item.amount;
        say("Decoys aboard.");
        break;
      case "hull":
        ship.hull = Math.min(hullMaxOf(ship), ship.hull + item.amount);
        say("Patch crews report hull repairs holding.");
        break;
      case "upgrade": {
        // §6: one permanent (per-run) stat module — applied to the ship
        // NOW and exported with the run state at system clear
        const u = item.upgrade ?? "sig";
        if (u === "sig") ship.sigMult *= C.UPGRADE_SIG_MULT;
        if (u === "sensor") ship.sensorMult *= C.UPGRADE_SENSOR_MULT;
        if (u === "accel") ship.accelMult *= C.UPGRADE_ACCEL_MULT;
        if (u === "hull") ship.hullMult *= C.UPGRADE_HULL_MULT;
        this.mission!.stats.upgrades += 1;
        this.mission!.upgradeCounts[u] += 1;
        say(
          u === "sig"
            ? "Engine baffles, Captain — fitted. We run quieter now."
            : u === "sensor"
              ? "A sensor suite, Captain — fitted. We hear farther now."
              : u === "accel"
                ? "Drive parts, Captain — fitted. She burns harder now."
                : "Armor plate, Captain — fitted. She can take more now."
        );
        break;
      }
    }
  }

  // §5.4 approach solution, computed from the viewer's OWN true state and
  // a fixed public landmark — zero fog surface. Returns null when there is
  // no solution to speak of (not closing, past the plane, out of range).
  gateSolution(ship: Ship): { ttg: number; missM: number; side: "left" | "right"; good: boolean } | null {
    const m = this.mission;
    if (!m) return null;
    const g = m.gate;
    if (dist(ship.x, ship.y, g.x, g.y) > C.GATE_SOLUTION_RANGE_M) return null;
    const gl = Math.max(1, Math.hypot(g.x, g.y));
    const nx = g.x / gl; // outward normal of the gate plane
    const ny = g.y / gl;
    const vn = ship.vx * nx + ship.vy * ny; // outward closing rate on the plane
    if (vn <= 1) return null; // not closing: ttg is Infinity (spec §5.4)
    const t = ((g.x - ship.x) * nx + (g.y - ship.y) * ny) / vn;
    if (t < 0) return null; // already past the plane
    // ballistic crossing point, measured from aperture center — the same
    // projection family as the v4.7 drift marker
    const cx = ship.x + ship.vx * t - g.x;
    const cy = ship.y + ship.vy * t - g.y;
    const missM = Math.hypot(cx, cy);
    // side in the pilot's frame: left = 90° CCW of the travel direction
    const travel = Math.atan2(ship.vx, ship.vy);
    const lx = Math.sin(travel - Math.PI / 2);
    const ly = Math.cos(travel - Math.PI / 2);
    const side = cx * lx + cy * ly > 0 ? "left" : "right";
    return { ttg: t, missM, side, good: missM < g.apertureW / 2 };
  }

  // XO solution calls: NEWS tier, edge-triggered on good/wide transitions,
  // rate-limited hard (spec §5.4: not a place to be chatty). Numbers stay
  // in the transcript; the voice gets fixed strings (v4.7.1 TTS doctrine).
  private updateGateXO(events: SimEvent[]): void {
    const m = this.mission!;
    m.solCooldownS = Math.max(0, m.solCooldownS - 1);
    const player = this.ships.get(m.playerId);
    if (!player) return;
    const sol = this.gateSolution(player);
    if (sol === null) {
      m.solGood = false; // reset silently — turning away is not news
      return;
    }
    if (sol.good !== m.solGood && m.solCooldownS <= 0) {
      if (sol.good) {
        events.push({
          kind: "notice",
          ship: player.id,
          text: `Solution good, Captain. ${Math.max(1, Math.round(sol.ttg))} seconds.`,
          speak: "Solution good, Captain.",
        });
      } else {
        const km = (sol.missM / 1000).toFixed(1);
        events.push({
          kind: "notice",
          ship: player.id,
          text: `We're wide — ${km} km ${sol.side}.`,
          speak: `We're wide ${sol.side}, Captain.`,
        });
      }
      m.solGood = sol.good;
      m.solCooldownS = C.GATE_XO_COOLDOWN_S;
    }
  }

  // Crossing the aperture (Stage 1: the gate is a TRANSITION). A non-final
  // system emits system_clear — the Match exports run state and stages the
  // next system, no gameover. The FINAL system's crossing ends the run as
  // a win. Either way the sim is done: `cleared` freezes re-fires until
  // the Match swaps the sim out.
  private checkGateCrossing(ship: Ship, preX: number, preY: number, events: SimEvent[]): void {
    const m = this.mission!;
    if (this.winner || m.cleared) return;
    // outward-moving only: you fly OUT through the gate, not back in
    if (ship.vx * m.gate.x + ship.vy * m.gate.y <= 0) return;
    const [x1, y1, x2, y2] = this.apertureSegment();
    if (!segsIntersect(preX, preY, ship.x, ship.y, x1, y1, x2, y2)) return;
    m.cleared = true;
    events.push({ kind: "notice", ship: ship.id, text: "We're through, Captain." });
    if (m.system < C.CAMPAIGN_SYSTEMS) {
      events.push({ kind: "system_clear", ship: ship.id, system: m.system });
      return;
    }
    // system eight: the run is COMPLETE
    this.winner = ship.id;
    const others = [...this.ships.keys()].filter((id) => id !== ship.id);
    const placements = [ship.id, ...others, ...[...this.placements].reverse()];
    events.push({
      kind: "gameover",
      winner: ship.id,
      winnerName: ship.callsign,
      placements,
      placementNames: placements.map((id) => this.callsigns.get(id) ?? id),
      gateCleared: true,
    });
  }

  // Fog-scoped intel on ONE hostile as this ship's sensors know it (for
  // prompts, queries, and standing-order metrics — never from ground
  // truth). Data texture follows the contact tier: faint = approximate
  // position only; track = true position + vector; id = + status detail.
  private intelOn(ship: Ship, enemy: Ship): Record<string, unknown> {
    const st = this.contactOn(ship.id, enemy.id);
    const rec = this.recordOn(ship.id, `s${enemy.id}`);
    // designation joins every intel shape (v5 §3): the letter is how the
    // captain names this track; the callsign appears ONLY once identified
    const naming = rec
      ? {
          designation: rec.letter,
          ...(rec.identified ? { callsign: enemy.callsign } : {}),
        }
      : {};
    const tier = st.tier;
    if (tier >= 2) {
      const range = dist(ship.x, ship.y, enemy.x, enemy.y);
      const brg = bearingTo(ship.x, ship.y, enemy.x, enemy.y);
      return {
        ...naming,
        contact_tier: tier === 3 ? "id" : "track",
        bearing: Math.round(brg),
        bearing_off_nose: Math.round(Math.abs(angDiff(ship.facing, brg))),
        range_m: Math.round(range),
        their_heading: Math.round(enemy.facing),
        their_speed_mps: Math.round(Math.hypot(enemy.vx, enemy.vy)),
        ...(tier === 3
          ? { their_hull: `${enemy.hull}/${hullMaxOf(enemy)}`, their_archetype: enemy.archetype }
          : {}),
      };
    }
    if (tier === 1 && st.faint) {
      const brg = bearingTo(ship.x, ship.y, st.faint.x, st.faint.y);
      return {
        ...naming,
        contact_tier: "faint",
        approx_bearing: Math.round(brg),
        approx_range_m: Math.round(dist(ship.x, ship.y, st.faint.x, st.faint.y)),
        note: "faint contact: approximate position only, NO vector, no lock possible",
      };
    }
    if (st.lastKnown) {
      const lk = st.lastKnown;
      return {
        ...naming,
        contact_tier: "none",
        last_seen_seconds_ago: this.tickCount - lk.t,
        last_known_bearing: Math.round(bearingTo(ship.x, ship.y, lk.x, lk.y)),
        last_known_range_m: Math.round(dist(ship.x, ship.y, lk.x, lk.y)),
      };
    }
    return { contact_tier: "none", never_seen: true };
  }

  // The PRIMARY hostile picture (1v1 shape, kept for prompts/queries):
  // best-known hostile — nearest tracked, else best faint, else freshest
  // last-known, else never_seen. §3 replaces this with the labeled
  // per-contact table.
  private enemyIntel(ship: Ship): Record<string, unknown> {
    const hostiles = this.hostilesOf(ship);
    const ranked = hostiles
      .map((h) => ({ h, st: this.contactOn(ship.id, h.id) }))
      .sort((a, b) => {
        if (a.st.tier !== b.st.tier) return b.st.tier - a.st.tier;
        return (
          dist(ship.x, ship.y, a.h.x, a.h.y) - dist(ship.x, ship.y, b.h.x, b.h.y)
        );
      });
    const best = ranked.find((r) => r.st.tier >= 1) ?? ranked.find((r) => r.st.lastKnown) ?? ranked[0];
    const intel = best ? this.intelOn(ship, best.h) : { contact_tier: "none", never_seen: true };
    const others = hostiles.length - (best ? 1 : 0);
    return others > 0 ? { ...intel, other_hostiles: others } : intel;
  }

  // Compact live-state summary injected into the translator prompt.
  stateSummaryFor(id: ShipId): string {
    const ship = this.ships.get(id);
    if (!ship) return "(no ship)";
    const lines: string[] = [];
    const zoneDist = dist(ship.x, ship.y, 0, 0);
    lines.push(
      `Own ship (${ship.archetype.toUpperCase()}): heading ${fmtBearing(ship.facing)}, speed ${Math.round(this.speedOf(ship))} m/s, thrust ${Math.round(ship.thrust)}%${effectiveThrust(ship) < ship.thrust ? " (NO output — tanks dry)" : ""}, hull ${ship.hull}/${hullMaxOf(ship)}, propellant ${Math.round(ship.propellant)}/${C.PROPELLANT_MAX}${
        ship.propellant < 50 && !ship.isDrone
          ? ` (ramscoop ${
              this.insideZone(ship) && ship.thrust <= C.REGEN_MAX_THRUST_PCT
                ? "REGENERATING"
                : `NOT regenerating — needs: inside the zone AND throttle setting <= ${C.REGEN_MAX_THRUST_PCT}%`
            })`
          : ""
      }.`
    );
    lines.push(
      `Position: ${(zoneDist / 1000).toFixed(1)} km from zone center (${this.insideZone(ship) ? "inside" : "OUTSIDE"} the zone)${this.inDust(ship) ? " — INSIDE A DUST CLOUD: sensors blind both ways, no locks" : ""}. Own signature ${Math.round(this.signatureOf(ship))} (detection range others get on us scales with it).`
    );
    // campaign: the mission picture — the gate is a landmark the XO must
    // be able to talk about (playtest 2026-07-12: "I referenced the gate
    // and the XO thought I meant an enemy contact")
    if (this.mission && id === this.mission.playerId) {
      const m = this.mission;
      const gBearing = fmtBearing(bearingTo(ship.x, ship.y, m.gate.x, m.gate.y));
      const gRange = (dist(ship.x, ship.y, m.gate.x, m.gate.y) / 1000).toFixed(0);
      const alive = m.hunterIds.filter((h) => this.ships.has(h)).length;
      const clock = m.hunterSpawned
        ? alive > 0
          ? `HUNTER${alive > 1 ? "S" : ""} IN-SYSTEM (${alive})`
          : "hunters destroyed — the system is ours"
        : `${Math.max(0, m.hunterSpawnS - this.tickCount)}s on the clock before the Hunter wakes`;
      lines.push(
        `MISSION (system ${m.system}/${C.CAMPAIGN_SYSTEMS} — "${m.systemName}"): THE GATE bears ${gBearing}, range ${gRange} km. The gate is FLOWN through (helm orders — there is no gate verb; 'head for the gate' = set_heading absolute ${gBearing}). ${clock}.`
      );
      const live = m.wrecks.filter((w) => w.items.length > 0 || (!w.marked && !w.checked));
      if (live.length > 0) {
        lines.push(
          `Salvage on the board: ${live
            .map(
              (w) =>
                `${w.marked ? "marked wreck" : "rumored wreck"} bearing ${fmtBearing(bearingTo(ship.x, ship.y, w.x, w.y))}, ${(dist(ship.x, ship.y, w.x, w.y) / 1000).toFixed(0)} km${
                  w.marked || w.checked
                    ? ` (${w.items.length} items)`
                    : ` (contents unknown — a rumor resolves by PRESENCE: fly within ${C.RUMOR_RESOLVE_RANGE_M / 1000} km and I'll call what's there; sensors and pings can't do it, dust or no dust)`
                }`
            )
            .join("; ")}. The salvage verb docks the nearest wreck — we must be alongside (${C.SALVAGE_DOCK_RANGE_M / 1000} km) and it needs a full stop.`
        );
      }
      if (m.salvaging) {
        const left = m.wrecks.find((w) => w.id === m.salvaging!.wreckId)?.items.length ?? 0;
        lines.push(
          `SALVAGE TRANSFER RUNNING: next item in ${Math.max(0, C.SALVAGE_ITEM_S - m.salvaging.t)}s, ${left} left aboard the wreck. Any thrust or heading order breaks off (we keep what's landed).`
        );
      }
    }
    if (ship.goal?.mode === "track") {
      const label =
        ship.goal.target === "enemy_ship"
          ? "the enemy contact"
          : `the ${ship.goal.target.replace(/_/g, " ")}`;
      lines.push(
        `Helm: continuously tracking ${label} (nose follows it every tick until a new heading order)${ship.goal.lost ? " — contact LOST, holding its last known bearing" : ""}.`
      );
    }
    if (ship.collisionWarnS !== null) {
      lines.push(
        `COLLISION WARNING: rock on our vector, impact in ~${Math.round(ship.collisionWarnS)}s at current velocity.`
      );
    }
    lines.push(
      `Weapons: PDC posture ${ship.pdcPosture.toUpperCase()} (ammo ${Math.round(ship.pdcAmmoS)}s of fire left), ${this.tubeSummary(ship)}, missiles aboard ${missilesAboard(ship)}/${statsOf(ship).magazine}, decoys ${ship.decoys}/${statsOf(ship).decoys}. Railgun: ${statsOf(ship).railguns === 0 ? "NOT FITTED (corvette)" : ship.railSlugs <= 0 ? "slugs out" : ship.railCooldownS > 0 ? `recharging (${Math.ceil(ship.railCooldownS)}s), ${ship.railSlugs} slugs` : `READY, ${ship.railSlugs} slugs (solution needs a TRACK; any target thrust during flight = miss)`}. Probes: ${ship.probesLeft} left${this.probesOf(ship.id).length > 0 ? `, ${this.probesOf(ship.id).length} deployed (relaying)` : ""}. Active ping: ${ship.pingCooldownS <= 0 ? "READY (reveals us map-wide for " + C.PING_REVEAL_S + "s)" : `recharging (${Math.ceil(ship.pingCooldownS)}s)`}.`
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
    // v5 §8: transponders — teammates at full state, by callsign
    const allies = this.alliesOf(ship);
    if (allies.length > 0) {
      lines.push(
        `Team ${ship.team}: ${allies
          .map(
            (t) =>
              `${t.callsign} (${t.archetype}, bearing ${fmtBearing(bearingTo(ship.x, ship.y, t.x, t.y))}, ${(dist(ship.x, ship.y, t.x, t.y) / 1000).toFixed(0)} km, hull ${t.hull}/${hullMaxOf(t)})`
          )
          .join("; ")}. Teammates are always tightbeamable and are valid helm targets ("form up on ${allies[0].callsign}") — but never lock targets.`
      );
    }
    // v5 §3: the per-observer CONTACT TABLE — the names the captain may use
    // as targets ("point at Bravo", "lock Kestrel"). Unresolved decoy
    // contacts appear exactly like ship contacts (fog law).
    const book = this.contactBooks.get(ship.id);
    if (book && (book.records.size > 0 || book.tombstones.length > 0)) {
      const rows: string[] = [];
      for (const [key, rec] of book.records) {
        if (key.startsWith("d") && rec.identified) continue; // resolved decoys aren't contacts
        const name =
          rec.identified && key.startsWith("s")
            ? `${this.callsigns.get(key.slice(1))} (identified, was ${rec.letter})`
            : `Contact ${rec.letter}`;
        const pos = this.recordPos(ship, key);
        if (rec.lostAt === null && pos && pos.live) {
          const tierWord = rec.prevTier >= 3 ? "ID" : rec.prevTier === 2 ? "TRACK" : "FAINT";
          const approx = rec.prevTier === 1 ? "~" : "";
          const via = key.startsWith("s") && this.contactBooks.get(ship.id) && this.shipContacts.get(ship.id)?.get(key.slice(1))?.viaProbe ? " (via probe)" : "";
          rows.push(
            `${name}: ${tierWord}${via}, bearing ${fmtBearing(bearingTo(ship.x, ship.y, pos.x, pos.y))}, range ${approx}${(dist(ship.x, ship.y, pos.x, pos.y) / 1000).toFixed(1)} km`
          );
        } else if (rec.lastKnown) {
          rows.push(
            `${name}: LOST ${Math.round((this.tickCount - (rec.lostAt ?? this.tickCount)) / C.TICK_RATE_HZ)}s ago, last known bearing ${fmtBearing(bearingTo(ship.x, ship.y, rec.lastKnown.x, rec.lastKnown.y))}`
          );
        }
      }
      for (const t of book.tombstones) {
        rows.push(
          `Contact ${t.letter}: uncorrelated old track, last known bearing ${fmtBearing(bearingTo(ship.x, ship.y, t.lastKnown.x, t.lastKnown.y))}`
        );
      }
      if (rows.length > 0) {
        lines.push(`Contact table (these names are valid targets): ${rows.join(". ")}.`);
      }
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
      hull: `${ship.hull}/${hullMaxOf(ship)}`,
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
      // playtest 2026-07-11: "reloading" while reserve reads 0 sounds like
      // a lie unless the XO says it's the final stock going in
      ...(ship.reserve === 0 && ship.tubes.some((t) => !t.loaded && t.reload > 0)
        ? { magazine_note: "reserve empty — the missiles loading now are the LAST aboard" }
        : {}),
      lock: ship.lock.has ? "held" : ship.lock.progress > 0 ? "acquiring" : "none",
    };
    const pdc = {
      pdc_posture: ship.pdcPosture,
      pdc_ammo_seconds_of_fire: Math.round(ship.pdcAmmoS),
      pdc_missile_range_m: C.PDC_RANGE_M,
      pdc_ship_range_m: C.PDC_SHIP_RANGE_M,
      pdc_note: "automated: engages inbound missiles and knife-range ships while posture=free; hold conserves ammo and stays dark",
    };
    const rail =
      statsOf(ship).railguns === 0
        ? { railgun: "not fitted" }
        : {
            railgun: ship.railCooldownS > 0 ? `recharging (${Math.ceil(ship.railCooldownS)}s)` : "ready",
            rail_slugs: ship.railSlugs,
            rail_note: "solution mode needs a TRACK-or-better contact; a coasting target is dead, any thrust during flight is a miss. bearing mode is a manual shot.",
          };
    const weapons = {
      ...pdc,
      ...rail,
      probes_left: ship.probesLeft,
      probes_deployed: this.probesOf(ship.id).length,
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
      sensor_base_m: statsOf(ship).sensorBase,
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
          hull_max: hullMaxOf(ship),
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
        // per-hostile tier list with bearings and ranges (v5 §2: one entry
        // per hostile ship; §3 adds designation labels)
        const inboundList = this.visibleEnemyMissiles(ship).map((m) => ({
          type: "missile",
          bearing: Math.round(bearingTo(ship.x, ship.y, m.x, m.y)),
          range_m: Math.round(dist(ship.x, ship.y, m.x, m.y)),
          engine: m.burning ? "burning" : "coasting",
        }));
        return {
          ship_contacts: this.hostilesOf(ship).map((h) => this.intelOn(ship, h)),
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
      case "mission": {
        // campaign: everything the XO may say about the run — all of it
        // fixed public geometry + own bookkeeping, zero fog surface
        const m = this.mission;
        if (!m || id !== m.playerId) return { note: "no mission — this is not a campaign match" };
        return {
          system: `${m.system} of ${C.CAMPAIGN_SYSTEMS}`,
          system_name: m.systemName,
          gate_bearing: fmtBearing(bearingTo(ship.x, ship.y, m.gate.x, m.gate.y)),
          gate_range_km: Math.round(dist(ship.x, ship.y, m.gate.x, m.gate.y) / 1000),
          gate_note: "the gate is flown through — no verb; a good ballistic line through the aperture exits the system",
          hunter_clock: m.hunterSpawned
            ? "expired — hunter phase"
            : `${Math.max(0, m.hunterSpawnS - this.tickCount)}s`,
          hunters_alive: m.hunterIds.filter((h) => this.ships.has(h)).length,
          wrecks: m.wrecks
            .filter((w) => w.items.length > 0 || (!w.marked && !w.checked))
            .map((w) => ({
              type: w.marked ? "marked" : "rumored",
              bearing: fmtBearing(bearingTo(ship.x, ship.y, w.x, w.y)),
              range_km: Math.round(dist(ship.x, ship.y, w.x, w.y) / 1000),
              items:
                w.marked || w.checked
                  ? w.items.length
                  : `unknown — resolves by presence (fly within ${C.RUMOR_RESOLVE_RANGE_M / 1000} km; sensors/pings cannot resolve a rumor)`,
            })),
          salvage_note: `salvage docks the nearest wreck: be alongside (${C.SALVAGE_DOCK_RANGE_M / 1000} km) and come to a full stop; items land one per ${C.SALVAGE_ITEM_S}s, worst first`,
        };
      }
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
    // above the earned tier. One entry per hostile ship the sensors hold
    // (v5 §2); decoy contacts interleave below. The cid IS the designation
    // letter (v5 §3): stable for the client exactly as long as the XO can
    // correlate — the old object-keyed cids leaked linkage the fiction
    // denies (and told ships from decoys by prefix). `label` carries the
    // callsign once identified.
    const contacts: Record<string, unknown>[] = [];
    for (const enemy of this.hostilesOf(ship)) {
      const st = this.contactOn(id, enemy.id);
      const rec = this.recordOn(id, `s${enemy.id}`);
      if (!rec) continue; // designated on the next sensor pass
      const label = rec.identified ? enemy.callsign : rec.letter;
      if (st.tier === 1 && st.faint) {
        contacts.push({
          cid: rec.letter,
          label,
          tier: 1,
          ...(st.viaProbe ? { viaProbe: true } : {}),
          x: st.faint.x,
          y: st.faint.y,
          // no vector, no facing: a faint contact is a smudge
        });
      } else if (st.tier >= 2) {
        contacts.push({
          cid: rec.letter,
          label,
          tier: st.tier,
          ...(st.viaProbe ? { viaProbe: true } : {}),
          x: enemy.x,
          y: enemy.y,
          vx: enemy.vx,
          vy: enemy.vy,
          facing: enemy.facing,
          // status detail is earned at TIER_ID (drives the enemy hull bar)
          // archetype is ID-tier information (v5 §4)
          ...(st.tier === 3
            ? { hull: enemy.hull, hullMax: hullMaxOf(enemy), archetype: enemy.archetype }
            : {}),
        });
      }
    }
    // Enemy decoys at faint/track read as ordinary unresolved contacts —
    // deliberately indistinguishable from a quiet ship (a fake facing is
    // derived from drift so the sprite renders like any track; same
    // designation letters, same label field). They only resolve as decoys
    // at ID tier (the decoys[] list below).
    const faintFixes = this.decoyFaint.get(id)!;
    for (const d of this.decoys) {
      if (d.owner === id) continue;
      const tier = this.decoyTierFor(ship, d);
      const rec = this.recordOn(id, `d${d.id}`);
      if (!rec || rec.identified) continue; // resolved decoys render in decoys[]
      if (tier === 1) {
        const fix = faintFixes.get(d.id);
        if (fix) contacts.push({ cid: rec.letter, label: rec.letter, tier: 1, x: fix.x, y: fix.y });
      } else if (tier === 2) {
        contacts.push({
          cid: rec.letter,
          label: rec.letter,
          tier: 2,
          x: d.x,
          y: d.y,
          vx: d.vx,
          vy: d.vy,
          facing: Math.hypot(d.vx, d.vy) > 1 ? norm360(bearingTo(0, 0, d.vx, d.vy)) : 0,
        });
      }
    }
    // last-known ghosts (v5 §3): one per LOST record — ships and decoy
    // contacts alike, labeled by designation — plus the tombstones of
    // letters the XO could not correlate. `ghost` keeps the legacy
    // single-ghost shape (freshest) for the current client.
    const ghosts: { x: number; y: number; facing: number; t: number; label?: string }[] = [];
    const book = this.contactBooks.get(id);
    if (book) {
      for (const [key, rec] of book.records) {
        if (rec.lostAt === null || !rec.lastKnown) continue;
        const label =
          rec.identified && key.startsWith("s")
            ? this.callsigns.get(key.slice(1)) ?? rec.letter
            : rec.letter;
        ghosts.push({ ...rec.lastKnown, label });
      }
      for (const t of book.tombstones) {
        ghosts.push({ ...t.lastKnown, label: t.letter });
      }
    }
    ghosts.sort((a, b) => b.t - a.t);
    const ghost = ghosts[0] ?? null;

    // v5 §7: live comms spikes — bearing + CALLSIGN (the voiceprint is
    // the design: broadcasting tells everyone who spoke and roughly from
    // where), never a position on the wire
    const comms = this.commsSpikes
      .filter((sp) => sp.from !== id && sp.expiresAtTick > this.tickCount)
      .map((sp) => ({
        bearing: Math.round(norm360(bearingTo(ship.x, ship.y, sp.x, sp.y))) % 360,
        callsign: sp.callsign,
      }));

    // v4.5 hearing: bearing-only rumbles (below faint). Strictly {cid,
    // bearing, loud} with per-viewer opaque cids — the fog invariant
    // forbids anything positional or identity-linked here.
    const rumbles = this.rumblesFor(ship).map((r) => ({
      cid: r.cid,
      bearing: r.bearing,
      loud: r.loud,
      // v5 §6: probe-relayed rumbles carry their chevron origin (the
      // probe is the owner's own equipment — not a leak)
      ...(r.probe !== undefined ? { probe: r.probe, ox: r.ox, oy: r.oy } : {}),
    }));

    return {
      tick: this.tickCount,
      you: {
        callsign: ship.callsign, // own callsign (v5 §3): HUD badge
        archetype: ship.archetype, // own stat block is not a secret (v5 §4)
        hullMax: hullMaxOf(ship),
        accel: statsOf(ship).accel, // client stop-point projection
        turnRate: statsOf(ship).turn,
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
        // playtest 2026-07-12: a dry captain couldn't tell WHY nothing was
        // recharging (he was outside the zone) — surface the gate's state
        regen: this.insideZone(ship) && ship.thrust <= C.REGEN_MAX_THRUST_PCT,
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
        // v5.1 §2.2: how many hostiles hold a lock on us — a COUNT only,
        // no identity, no bearing (you already know THAT you're painted;
        // this says how many times). The client heartbeat thumps once per
        // locker. Fog test pins that nothing else rides along.
        lockedBy: this.lockersOn(ship),
        decoys: ship.decoys,
        pdc: { posture: ship.pdcPosture, ammoS: Math.round(ship.pdcAmmoS) },
        rail:
          statsOf(ship).railguns > 0
            ? { slugs: ship.railSlugs, cooldownS: Math.ceil(ship.railCooldownS) }
            : null,
        probes: ship.probesLeft,
        // revealS: OWNER-ONLY (drives the LIT countdown) — the fog tests pin
        // that it never appears in the enemy's snapshot of this ship
        ping: {
          ready: ship.pingCooldownS <= 0,
          cooldownS: Math.ceil(ship.pingCooldownS),
          revealS: Math.ceil(ship.pingRevealS),
        },
        insideZone: this.insideZone(ship),
        inDust: this.inDust(ship),
        collisionWarning: ship.collisionWarnS === null ? null : Math.round(ship.collisionWarnS),
        signature: this.signatureOf(ship), // own signature: how loud we are
        standingOrders: ship.standingOrders.map((o) => ({
          label: o.label,
          repeat: o.repeat,
          armed: o.cooldown <= 0,
        })),
        // campaign: the clock, the approach solution, the transfer state —
        // all derived from the player's own state + fixed public geometry.
        // hunterActive is deliberately honest about the pack's death even
        // if unobserved: the XO's quiet line already told them (spec §2.3
        // — the relief IS the reward).
        ...(this.mission && id === this.mission.playerId
          ? {
              mission: {
                system: this.mission.system,
                systemName: this.mission.systemName,
                spawnInS: this.mission.hunterSpawned
                  ? 0
                  : Math.max(0, this.mission.hunterSpawnS - this.tickCount),
                hunterActive: this.mission.hunterIds.some((h) => this.ships.has(h)),
                salvaging: this.mission.salvaging
                  ? {
                      wreckId: this.mission.salvaging.wreckId,
                      nextInS: Math.max(0, C.SALVAGE_ITEM_S - this.mission.salvaging.t),
                      itemS: C.SALVAGE_ITEM_S,
                      itemsLeft:
                        this.mission.wrecks.find((w) => w.id === this.mission!.salvaging!.wreckId)
                          ?.items.length ?? 0,
                    }
                  : null,
              },
              gate: (() => {
                const sol = this.gateSolution(ship);
                return sol
                  ? {
                      ttg: Math.round(sol.ttg),
                      missM: Math.round(sol.missM),
                      side: sol.side,
                      good: sol.good,
                    }
                  : null;
              })(),
            }
          : {}),
      },
      // campaign wrecks: landmarks, not contacts — the player knows where
      // every site is (§4.4: MARKED sites have reliable known contents;
      // RUMORED sites hide their haul until CHECKED by presence — `items`
      // is a count once known, null for unresolved rumors). A dry hole
      // stays on the map until visited: the rumor of a place is real even
      // when the loot isn't.
      ...(this.mission && id === this.mission.playerId
        ? {
            wrecks: this.mission.wrecks
              .filter((w) => w.items.length > 0 || (!w.marked && !w.checked))
              .map((w) => ({
                id: w.id,
                x: w.x,
                y: w.y,
                marked: w.marked,
                items: w.marked || w.checked ? w.items.length : null,
              })),
          }
        : {}),
      contacts,
      // v5 §8 transponders: full state, always (own equipment class)
      allies: this.alliesOf(ship).map((t) => ({
        id: t.id,
        callsign: t.callsign,
        archetype: t.archetype,
        x: t.x,
        y: t.y,
        vx: t.vx,
        vy: t.vy,
        facing: t.facing,
        thrustOut: effectiveThrust(t),
        hull: t.hull,
        hullMax: hullMaxOf(t),
      })),
      rumbles,
      comms,
      ghost,
      ghosts,
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
        // a teammate's bird, if our sensors happen to see it: friendly
        // paint, no alarm (detected normally — ordnance feeds aren't shared)
        ...this.missiles
          .filter(
            (m) =>
              m.owner !== id &&
              this.sameSide(id, ship.team, m.owner, m.team) &&
              dist(ship.x, ship.y, m.x, m.y) <= this.detectionRange(this.missileSignature(m), ship) &&
              this.losClear(ship.x, ship.y, m.x, m.y)
          )
          .map((m) => ({
            id: m.id, x: m.x, y: m.y, vx: m.vx, vy: m.vy, burning: m.burning, own: false, ally: true,
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
      // v5 §6: own probes always (with their ordinal); enemy probes when
      // detected (sig 25, LOS) — findable if hunted
      probes: [
        ...this.probesOf(id).map((pr) => ({
          id: pr.id, idx: pr.idx, x: pr.x, y: pr.y, vx: pr.vx, vy: pr.vy,
          burnS: Math.max(0, C.PROBE_BURN_S - pr.age), lifeS: Math.max(0, C.PROBE_LIFETIME_S - pr.age),
          own: true,
        })),
        ...this.probes
          .filter(
            (pr) =>
              pr.owner !== id &&
              dist(ship.x, ship.y, pr.x, pr.y) <= this.detectionRange(C.PROBE_SIGNATURE, ship) &&
              this.losClear(ship.x, ship.y, pr.x, pr.y)
          )
          .map((pr) => ({ id: pr.id, x: pr.x, y: pr.y, vx: pr.vx, vy: pr.vy, own: false })),
      ],
      // v5 §5: own slugs always; enemy slugs only inside the near-nothing
      // detection of a driveless projectile (you hear the SHOT, not the round)
      slugs: [
        ...this.slugs
          .filter((sl) => sl.owner === id)
          .map((sl) => ({ id: sl.id, x: sl.x, y: sl.y, vx: sl.vx, vy: sl.vy, own: true })),
        ...this.slugs
          .filter(
            (sl) =>
              sl.owner !== id &&
              dist(ship.x, ship.y, sl.x, sl.y) <= this.detectionRange(C.RAIL_SLUG_SIG, ship) &&
              this.losClear(ship.x, ship.y, sl.x, sl.y)
          )
          .map((sl) => ({ id: sl.id, x: sl.x, y: sl.y, vx: sl.vx, vy: sl.vy, own: false })),
      ],
      fx: this.fx.filter((f) => {
        if (f.type === "pdc") {
          return f.owner === id || this.contactOn(id, f.owner).tier >= 1;
        }
        // ping (v4.7): both players always — the scream is map-wide, no
        // LOS, by design (the reveal is the ping's stated price)
        if (f.type === "ping") return true;
        // explosions are bright: visible anywhere the sensor base could
        // reach an average target, LOS permitting
        return (
          dist(ship.x, ship.y, f.x, f.y) <= statsOf(ship).sensorBase &&
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
        callsign: s.callsign,
        team: s.team,
        x: s.x,
        y: s.y,
        vx: s.vx,
        vy: s.vy,
        facing: s.facing,
        thrustOut: effectiveThrust(s),
        hull: s.hull,
        hullMax: hullMaxOf(s),
        archetype: s.archetype,
        drone: s.isDrone,
      })),
      contacts: [],
      ghost: null,
      // `owner` is the v5 shape (per-ship tints); `own` keeps the legacy
      // two-color client rendering alive until the client learns owners
      missiles: this.missiles.map((m) => ({
        id: m.id, x: m.x, y: m.y, vx: m.vx, vy: m.vy, burning: m.burning,
        owner: m.owner, own: m.owner === "A",
      })),
      decoys: this.decoys.map((d) => ({
        id: d.id, x: d.x, y: d.y, vx: d.vx, vy: d.vy, owner: d.owner, own: d.owner === "A",
      })),
      slugs: this.slugs.map((sl) => ({
        id: sl.id, x: sl.x, y: sl.y, vx: sl.vx, vy: sl.vy, owner: sl.owner, own: sl.owner === "A",
      })),
      probes: this.probes.map((pr) => ({
        id: pr.id, idx: pr.idx, x: pr.x, y: pr.y, vx: pr.vx, vy: pr.vy, owner: pr.owner, own: pr.owner === "A",
      })),
      fx: this.fx,
    };
  }

  // Called by the match after all per-player snapshots are broadcast.
  clearFx(): void {
    this.fx = [];
  }
}
