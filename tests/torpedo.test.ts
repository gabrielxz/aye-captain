// §5 burn-and-coast torpedoes: engine state, fuel, ballistic coast,
// signature switching, XO lost-it report.
import { Sim, type Ship } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};
const grantLock = (ship: Ship) => {
  ship.lock = { progress: C.LOCK_TIME_S, has: true, grace: C.LOCK_GRACE_S };
};

// 1. burn to max, then coast: engine cuts at max speed on a straight
// course, fuel stops draining, signature drops
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 500000, 180, false); // far away, dead ahead (outside region => tier ID, lockable geometry irrelevant: lock granted)
  grantLock(a);
  sim.enqueue("A", [{ verb: "fire_missile", params: {} }]);
  sim.tick();
  const m = (sim as any).missiles[0];
  assert(m.burning === true, "engine on at launch");
  const rampTicks = Math.ceil(C.MISSILE_MAX_SPEED_MPS / C.MISSILE_ACCEL_MPS2) + 1;
  for (let i = 0; i < rampTicks; i++) sim.tick();
  assert(m.speed === C.MISSILE_MAX_SPEED_MPS, "reached max speed");
  assert(m.burning === false, "engine cuts at max speed on a straight course (coasting)");
  assert(m.fuel > 0 && m.fuel < C.MISSILE_PROPELLANT_S, `fuel spent only while burning (${m.fuel.toFixed(1)}s left)`);
  const fuelAtCoast = m.fuel;
  sim.tick();
  assert(m.fuel === fuelAtCoast, "no fuel drain while coasting");
  assert(sim.missileSignature(m) === C.MISSILE_SIG_COASTING, "coasting signature is near-invisible");
}

// 2. fuel exhausted = ballistic: no turning even with a live lock
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 60000, 180, false);
  b.thrust = 100; // loud target, easy seeker lock
  grantLock(a);
  sim.enqueue("A", [{ verb: "fire_missile", params: {} }]);
  for (let i = 0; i < 4; i++) sim.tick(); // launched, seeker locked on ship
  const m = (sim as any).missiles[0];
  assert(m.lock?.type === "ship", "seeker locked");
  m.fuel = 0; // force dry
  const course = m.course;
  b.x = 40000; // target displaces hard to the east
  for (let i = 0; i < 5; i++) sim.tick();
  assert(m.course === course, `dry torpedo cannot turn (course ${m.course.toFixed(1)})`);
  assert(m.burning === false, "dry torpedo engine off");
}

// 3. ballistic torpedoes still detonate on prox
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 15000, 180, false); // dead ahead on the launch line
  b.pdcPosture = "hold"; // ballistic-lethality test: keep point defense out of it
  grantLock(a);
  sim.enqueue("A", [{ verb: "fire_missile", params: {} }]);
  sim.tick();
  const m = (sim as any).missiles[0];
  m.fuel = 0; // dry immediately: pure ballistic run at ~400 m/s
  let hit = false;
  for (let i = 0; i < 60 && !hit; i++) {
    const ev = sim.tick();
    hit = ev.some((e) => e.kind === "notice" && /Missile strike/.test((e as any).text));
  }
  assert(hit, "ballistic torpedo lethal on its line (prox fuse live)");
}

// 4. detection follows engine state: burning seen far out, coasting fades;
// XO reports the loss
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 100000, 180, false);
  grantLock(b);
  sim.enqueue("B", [{ verb: "fire_missile", params: {} }]);
  sim.tick();
  const m = (sim as any).missiles[0];
  assert(
    (sim.snapshotFor("A") as any).missiles.some((mm: any) => !mm.own),
    "burning torpedo visible at ~100 km"
  );
  m.fuel = 0;
  m.speed = C.MISSILE_MAX_SPEED_MPS; // force coast
  const ev = sim.tick();
  assert(
    !(sim.snapshotFor("A") as any).missiles.some((mm: any) => !mm.own),
    "coasting torpedo (sig 8) fades off sensors at range"
  );
  assert(
    ev.some((e) => e.kind === "notice" && e.ship === "A" && /gone ballistic — I've lost it/.test((e as any).text)),
    "XO reports the torpedo going ballistic"
  );
}

// 5. terminal maneuvering relights the engine (turning at max speed burns fuel)
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 80000, 180, false);
  b.thrust = 100;
  grantLock(a);
  sim.enqueue("A", [{ verb: "fire_missile", params: {} }]);
  const rampTicks = Math.ceil(C.MISSILE_MAX_SPEED_MPS / C.MISSILE_ACCEL_MPS2) + 2;
  for (let i = 0; i < rampTicks; i++) sim.tick();
  const m = (sim as any).missiles[0];
  assert(m.burning === false, "coasting at max on a straight line");
  const fuelBefore = m.fuel;
  b.x = 8000; // target sidesteps (stays inside the 60-deg seeker cone)
  sim.tick();
  assert(m.burning === true, "turning to track relights the engine");
  assert(m.fuel < fuelBefore, "terminal maneuvers cost fuel");
}

console.log("done");
