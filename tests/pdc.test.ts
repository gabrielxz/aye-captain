// §6 PDCs: posture command, missile attrition, ammo budget, warnings,
// LOS gating, signature spike.
import { Sim, type Ship, type Missile } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};
const grantLock = (ship: Ship) => {
  ship.lock = { progress: C.LOCK_TIME_S, has: true, grace: C.LOCK_GRACE_S };
};

// A slow inbound missile that will sit in the PDC envelope (test dummy).
function injectSlowMissile(sim: Sim, owner: "A" | "B", x: number, y: number): Missile {
  const m: Missile = {
    id: 9000, owner, x, y, prevX: x, prevY: y,
    launchX: x, launchY: y + 200000, // armed: launched far away
    course: 0, speed: 0, vx: 0, vy: 0,
    age: 10, fuel: 0, burning: false,
    guidance: "autonomous", cmdBearing: null, lock: null,
  };
  (sim as any).missiles.push(m);
  return m;
}

// 1. defaults + verb validation
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  assert(a.pdcPosture === "free" && a.pdcAmmoS === C.PDC_AMMO_S, "spawns free with a full ammo budget");
  sim.enqueue("A", [{ verb: "set_pdc", params: { posture: "hold" } }]);
  sim.tick();
  assert(a.pdcPosture === "hold", "set_pdc hold applies");
  sim.enqueue("A", [{ verb: "set_pdc", params: { posture: "sideways" } }]);
  const ev = sim.tick();
  assert(ev.some((e) => e.kind === "reject"), "bad posture rejected");
}

// 2. missile attrition: a loitering missile dies to sustained fire; ammo
// drains 1s per second of firing; signature spikes while firing
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  injectSlowMissile(sim, "B", 0, 4000); // parked inside PDC_RANGE_M
  let killed = false;
  let sawSpike = false;
  let ticks = 0;
  for (; ticks < 40 && !killed; ticks++) {
    const ev = sim.tick();
    if (sim.signatureOf(a) > C.SIG_BASE) sawSpike = true;
    killed = ev.some((e) => e.kind === "notice" && /PDC splash/.test((e as any).text));
  }
  assert(killed, `sustained PDC fire kills a loitering missile (${ticks} ticks; 25%/s)`);
  assert(sawSpike, "firing spikes our signature");
  assert(
    Math.abs(C.PDC_AMMO_S - a.pdcAmmoS - ticks) < 1.5,
    `ammo drains ~1s per second of fire (spent ${(C.PDC_AMMO_S - a.pdcAmmoS).toFixed(1)} in ${ticks}s)`
  );
}

// 3. ammo is finite: dry mounts don't fire, with staged warnings on the way
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  const warnings: string[] = [];
  // an endless supply of parked missiles keeps the guns firing
  for (let i = 0; i < 80; i++) {
    if ((sim as any).missiles.length === 0) injectSlowMissile(sim, "B", 0, 4000);
    for (const e of sim.tick()) {
      if (e.kind === "notice" && /PDC (ammunition|magazines)/.test((e as any).text)) {
        warnings.push((e as any).text);
      }
    }
  }
  assert(a.pdcAmmoS === 0, "ammo exhausts with no regeneration");
  assert(
    warnings.length === 4 &&
      /one-half/.test(warnings[0]) &&
      /one-quarter/.test(warnings[1]) &&
      /critical/.test(warnings[2]) &&
      /dry/.test(warnings[3]),
    `staged ammo warnings 50/25/10/dry (got ${warnings.length})`
  );
  // dry: a parked missile is safe forever
  (sim as any).missiles = [];
  injectSlowMissile(sim, "B", 0, 4000);
  for (let i = 0; i < 10; i++) sim.tick();
  assert((sim as any).missiles.length === 1, "dry mounts don't fire");
}

// 4. LOS gates the PDCs: a missile behind a rock is safe
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  sim.terrain.rocks.push({ x: 0, y: 2000, r: 800 });
  injectSlowMissile(sim, "B", 0, 4000); // in range, but shadowed by the rock
  for (let i = 0; i < 20; i++) sim.tick();
  assert((sim as any).missiles.length === 1, "no LOS, no engagement");
  assert(a.pdcAmmoS === C.PDC_AMMO_S, "no ammo wasted on a shadowed target");
}

// 5. saturation leaks by design. v4.5 kinematics: a full-speed (2400 m/s)
// torpedo spends ~3.3s crossing the envelope — single-missile kill is now
// ~55-60% (the spec's intent), so leaks drop but never vanish. The assert
// brackets the binomial spread; don't tighten it to "always dies".
{
  let leaked = 0;
  const trials = 30;
  for (let t = 0; t < trials; t++) {
    const sim = new Sim();
    const a = sim.addShip("A", 0, 0, 0);
    const b = sim.addShip("B", 0, 100000, 180, false);
    b.pdcPosture = "hold";
    grantLock(b);
    // torpedo at full speed just outside the envelope, boring straight in
    const m = injectSlowMissile(sim, "B", 0, 8500);
    m.course = 180;
    m.speed = C.MISSILE_MAX_SPEED_MPS;
    let struck = false;
    for (let i = 0; i < 5 && !struck; i++) {
      struck = sim.tick().some((e) => e.kind === "notice" && /Missile strike/.test((e as any).text));
    }
    if (struck) leaked++;
  }
  assert(
    leaked >= trials * 0.15 && leaked <= trials * 0.7,
    `torpedoes still leak, but die more often than not (${leaked}/${trials} got through)`
  );
}

console.log("done");
