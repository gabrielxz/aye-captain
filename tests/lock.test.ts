import { Sim, missilesAboard } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

// 1. lock acquisition: cone + range + visible held LOCK_TIME_S, with notices
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 8000, 180, false); // dead ahead, 8km < lock range, visible
  const seen: string[] = [];
  let ticks = 0;
  while (!a.lock.has && ticks < C.LOCK_TIME_S + 3) {
    ticks++;
    for (const e of sim.tick()) if (e.kind === "notice" && e.ship === "A") seen.push(e.text);
  }
  assert(a.lock.has, `lock acquired (after ${ticks} ticks)`);
  assert(ticks >= C.LOCK_TIME_S, `not before LOCK_TIME_S (${ticks} >= ${C.LOCK_TIME_S})`);
  assert(seen.some(t => /Acquiring missile lock/.test(t)), "acquiring notice at timer start");
  assert(seen.some(t => /Lock acquired/.test(t)), "lock acquired notice");
}

// 2. out-of-cone target never locks
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 90); // facing east; B is due north
  sim.addShip("B", 0, 8000, 180, false);
  for (let i = 0; i < C.LOCK_TIME_S + 4; i++) sim.tick();
  assert(!a.lock.has && a.lock.progress === 0, "no lock outside the cone");
}

// 3. grace: a brief cone break survives; a long one resets
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 8000, 180, false);
  for (let i = 0; i < C.LOCK_TIME_S + 1; i++) sim.tick();
  assert(a.lock.has, "locked");
  const bx = b.x;
  b.x = 10000; // ~51 deg off the nose: out of cone
  sim.tick(); // 1s of grace consumed
  b.x = bx; // back in the cone within grace
  sim.tick();
  assert(a.lock.has, "lock survives a 1-tick blip (grace)");
  b.x = 12000;
  let lost = false;
  for (let i = 0; i < C.LOCK_GRACE_S + 2 && !lost; i++) {
    lost = sim.tick().some(e => e.kind === "notice" && e.ship === "A" && /Lock lost/.test((e as any).text));
  }
  assert(lost && !a.lock.has && a.lock.progress === 0, "lock breaks after grace expires, with notice");
}

// 4. painted warnings on the target, edge-triggered; relief line on break
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 8000, 180, false); // B faces A too — mutual lock geometry
  const toB: string[] = [];
  for (let i = 0; i < C.LOCK_TIME_S + 2; i++) {
    for (const e of sim.tick()) if (e.kind === "notice" && e.ship === "B") toB.push(e.text);
  }
  assert(toB.some(t => /being painted/.test(t)), "target warned when painting starts");
  assert(toB.some(t => /They have lock/.test(t)), "target warned on enemy lock acquired");
  assert(toB.filter(t => /being painted/.test(t)).length === 1, "painted warning fires once (edge-triggered)");
  // break A's lock: move B far out of cone/range
  b.x = 40000;
  const relief: string[] = [];
  for (let i = 0; i < C.LOCK_GRACE_S + 2; i++) {
    for (const e of sim.tick()) if (e.kind === "notice" && e.ship === "B") relief.push(e.text);
  }
  assert(relief.some(t => /lock is off us/.test(t)), "relief line when enemy lock breaks");
}

// 5. tubes: fire one -> auto-reload cycle -> ready notice; salvo; per-tube reject
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const bT = sim.addShip("B", 0, 8000, 180, false);
  bT.pdcPosture = "hold"; // tube accounting is under test, not point defense
  for (let i = 0; i < C.LOCK_TIME_S + 1; i++) sim.tick(); // acquire for real
  assert(a.lock.has, "locked for tube tests");

  sim.enqueue("A", [{ verb: "fire_missile", params: {} } as any]);
  let ev = sim.tick();
  assert(!a.tubes[0].loaded && Math.abs(a.tubes[0].reload - (C.TUBE_RELOAD_S - 1)) < 1e-9, "tube one fired, reloading");
  assert(ev.some(e => e.kind === "notice" && /Tube one reloading/.test((e as any).text)), "reload-start notice");
  assert(a.reserve === C.MISSILE_MAGAZINE - C.TUBE_COUNT - 1, "reserve decremented by auto-reload");

  // default fire uses the first READY tube (tube two while one reloads)
  sim.enqueue("A", [{ verb: "fire_missile", params: {} } as any]);
  ev = sim.tick();
  assert(!a.tubes[1].loaded, "default fire falls through to tube two");

  // both tubes reloading: firing rejects with the tube line
  sim.enqueue("A", [{ verb: "fire_missile", params: { tubes: [1] } } as any]);
  ev = sim.tick();
  assert(ev.some(e => e.kind === "reject" && /still loading/.test((e as any).reason)), "reloading tube rejected");

  // ready notices arrive when the countdown ends
  let readyCount = 0;
  for (let i = 0; i < C.TUBE_RELOAD_S + 2; i++) {
    for (const e of sim.tick()) {
      if (e.kind === "notice" && /Tube (one|two) ready/.test((e as any).text)) readyCount++;
    }
  }
  assert(readyCount === 2 && a.tubes[0].loaded && a.tubes[1].loaded, `both tubes reload in parallel (${readyCount} ready notices)`);

  // full salvo
  sim.enqueue("A", [{ verb: "fire_missile", params: { tubes: [1, 2] } } as any]);
  sim.tick();
  assert(!a.tubes[0].loaded && !a.tubes[1].loaded, "salvo empties both tubes");
  assert((sim as any).missiles.filter((m: any) => m.owner === "A").length >= 2, "salvo spawned two missiles");
}

// 6. magazine accounting: 6 total shots, then dry
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 8000, 180, false);
  (a as any).lock = { progress: C.LOCK_TIME_S, has: true, grace: C.LOCK_GRACE_S };
  let fired = 0;
  let dry = false;
  for (let i = 0; i < 200 && !dry; i++) {
    sim.enqueue("A", [{ verb: "fire_missile", params: {} } as any]);
    const ev = sim.tick();
    if (ev.some(e => e.kind === "reject" && /Magazine dry/.test((e as any).reason))) dry = true;
    (a as any).lock.has = true; // keep lock through geometry changes
    (sim as any).missiles = []; // discard flying missiles; we only count shots
  }
  assert(dry, "eventually rejects dry");
  assert(missilesAboard(a) === 0, "0 aboard after all shots");
}

// 7. missile speed ramp: inherits forward momentum, caps at max
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  // target far enough out that the missile reaches max speed before impact
  sim.addShip("B", 0, 80000, 180, false);
  a.vx = 0; a.vy = 400; // moving north at 400
  (a as any).lock = { progress: C.LOCK_TIME_S, has: true, grace: C.LOCK_GRACE_S };
  sim.enqueue("A", [{ verb: "fire_missile", params: {} } as any]);
  sim.tick();
  const m = (sim as any).missiles[0];
  assert(Math.round(m.speed) === Math.min(400 + C.MISSILE_ACCEL_MPS2, C.MISSILE_MAX_SPEED_MPS), `launch inherits ship's forward speed then accelerates (${Math.round(m.speed)})`);
  const rampTicks = Math.ceil((C.MISSILE_MAX_SPEED_MPS - 400) / C.MISSILE_ACCEL_MPS2) + 1;
  for (let i = 0; i < rampTicks; i++) sim.tick();
  assert(m.speed === C.MISSILE_MAX_SPEED_MPS, "missile speed capped at MISSILE_MAX_SPEED_MPS");
}

// 8. drone fires back: locked drone launches one missile then cools down
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const drone = sim.addShip("B", 0, 6000, 180, true);
  a.pdcPosture = "hold"; // don't let point defense eat the drone's shot mid-test
  (drone as any).lock = { progress: C.LOCK_TIME_S, has: true, grace: C.LOCK_GRACE_S };
  sim.tick();
  const droneShots = (sim as any).missiles.filter((m: any) => m.owner === "B").length;
  assert(droneShots === 1, `locked drone fires one missile (${droneShots})`);
  assert(drone.droneCooldown === C.DRONE_MISSILE_COOLDOWN_S, "drone cooldown set");
  (drone as any).lock = { progress: C.LOCK_TIME_S, has: true, grace: C.LOCK_GRACE_S };
  sim.tick();
  assert((sim as any).missiles.filter((m: any) => m.owner === "B").length === 1, "no second shot during cooldown");
}
console.log("done");
