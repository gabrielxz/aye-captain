// §0 sub-tick physics: tunneling regression + substep/tick equivalence.
// These tests are written against the constants, so they tighten themselves
// when v4 scales speeds up (ships 3 km/s, missiles 6 km/s).
import { Sim, type Missile } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

// A live missile at max speed, past its launch delay, flying `course`.
// Injected directly so the scenario controls geometry exactly.
function injectMissile(sim: Sim, owner: "A" | "B", x: number, y: number, course: number): Missile {
  const m: Missile = {
    id: 9000 + (sim as any).missiles.length,
    owner,
    x, y,
    prevX: x, prevY: y,
    course,
    speed: C.MISSILE_MAX_SPEED_MPS,
    vx: 0, vy: 0,
    age: C.MISSILE_LAUNCH_DELAY_TICKS / C.TICK_RATE_HZ + 1,
    lock: null,
    seekTimer: 0,
    ballistic: true, // no steering: pure kinematics under test
  };
  (sim as any).missiles.push(m);
  return m;
}

// 1. MANDATORY (HANDOFF-v4 §0): max-speed missile head-on vs max-speed ship
// must always fuse. Closing speed is MISSILE_MAX + MAX; the start range is
// deliberately not a multiple of per-substep travel, so the closest approach
// falls mid-substep — a point-in-radius check would tunnel.
{
  const sim = new Sim();
  sim.addShip("A", -20000, 0, 0);
  const b = sim.addShip("B", 0, 7137, 180); // range not substep-aligned
  b.pdcPosture = "hold"; // tunneling test: point defense must not save it
  b.vy = -C.MAX_SPEED_MPS; // charging straight down the missile's throat
  injectMissile(sim, "A", 0, 0, 0);
  let hit = false;
  for (let i = 0; i < 12 && !hit; i++) {
    const ev = sim.tick();
    hit = ev.some((e) => e.kind === "notice" && /Missile strike/.test((e as any).text));
  }
  assert(hit, "head-on max closure always fuses (no tunneling)");
  assert(b.hull === C.HULL_POINTS - C.MISSILE_DAMAGE, `damage applied (hull ${b.hull})`);
}

// 2. Perpendicular max-speed crossing, meeting mid-substep: the swept
// relative segment passes through zero range even though neither substep
// endpoint is close.
{
  const sim = new Sim();
  sim.addShip("A", -30000, -30000, 0);
  const b = sim.addShip("B", 0, 0, 270);
  b.pdcPosture = "hold";
  const meetT = 4.73; // seconds; deliberately between substep boundaries
  b.x = C.MAX_SPEED_MPS * meetT;
  b.vx = -C.MAX_SPEED_MPS; // westbound through the origin
  injectMissile(sim, "A", 0, -C.MISSILE_MAX_SPEED_MPS * meetT, 0); // northbound
  let hit = false;
  for (let i = 0; i < 10 && !hit; i++) {
    const ev = sim.tick();
    hit = ev.some((e) => e.kind === "notice" && /Missile strike/.test((e as any).text));
  }
  assert(hit, "perpendicular max-speed crossing fuses mid-substep");
}

// 3. tick() still advances exactly one second of game time under substeps.
{
  const sim = new Sim();
  const s = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 500000, 180);
  sim.enqueue("A", [{ verb: "set_thrust", params: { percent: 100 } }]);
  sim.tick();
  assert(
    Math.abs(s.vy - C.ACCEL_FULL_THRUST_MPS2) < 1e-9,
    `1 tick of full thrust = exactly ACCEL m/s (vy ${s.vy})`
  );
  const before = sim.tickCount;
  sim.tick();
  assert(sim.tickCount === before + 1, "tickCount advances once per tick()");
}

// 4. snapshots carry velocities (client interpolation/extrapolation needs them)
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 6000, 180); // track band for a quiet ship
  b.vx = 42;
  sim.enqueue("A", [{ verb: "deploy_decoy", params: {} }]);
  sim.tick();
  const snap = sim.snapshotFor("A") as any;
  assert(typeof snap.you.vx === "number" && typeof snap.you.vy === "number", "own velocity in snapshot");
  assert(snap.contacts[0]?.tier >= 2 && typeof snap.contacts[0].vx === "number", "tracked contact velocity in snapshot");
  assert(snap.decoys.length > 0 && typeof snap.decoys[0].vx === "number", "decoy velocity in snapshot");
}

console.log("done");
