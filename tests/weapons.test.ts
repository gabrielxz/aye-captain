import { Sim, segmentMinDist } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};
const fire = (sim: Sim, id: "A"|"B", verb: string) => sim.enqueue(id, [{verb, params:{}} as any]);

// 1. laser: hit, damage, cooldown reject, miss off-boresight
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 4000, 180, true); // dead ahead, in range
  fire(sim, "A", "fire_laser");
  let ev = sim.tick();
  assert(b.hull === C.DRONE_HULL_POINTS - C.LASER_DAMAGE, `laser hit: drone hull ${b.hull}`);
  assert(ev.some(e => e.kind === "notice" && /Direct hit/.test((e as any).text)), "hit notice to attacker");
  fire(sim, "A", "fire_laser");
  ev = sim.tick();
  assert(ev.some(e => e.kind === "reject" && /recharging/.test((e as any).reason)), "cooldown reject");
  // wait out cooldown, then fire while aiming away
  for (let i = 0; i < 4; i++) sim.tick();
  a.facing = 90; a.goal = null;
  const hullBefore = b.hull;
  fire(sim, "A", "fire_laser");
  sim.tick();
  assert(b.hull === hullBefore, "off-boresight shot misses");
}

// 2. laser: friendly decoy transparent, enemy missile behind it gets hit
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 4500, 180, true);
  // own decoy directly in the beam path, closer than the drone
  (sim as any).decoys.push({id: 900, owner: "A", x: 0, y: 2000, vx: 0, vy: 0, age: 0});
  fire(sim, "A", "fire_laser");
  sim.tick();
  assert(b.hull === C.DRONE_HULL_POINTS - C.LASER_DAMAGE, "friendly decoy transparent, ship behind hit");
  assert((sim as any).decoys.length === 1, "own decoy survives own laser");
}

// 3. missile: launch delay, lock, tracking kill of the drone + gameover
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 500, 6000, 90, true); // ahead, will drift east on its circle
  let dead = false;
  let winner: string | null = null;
  fire(sim, "A", "fire_missile");
  fire(sim, "A", "fire_missile"); // 2 x 35 = 70 >= 60 hull
  for (let i = 0; i < 60 && !dead; i++) {
    const ev = sim.tick();
    for (const e of ev) if (e.kind === "gameover") { dead = true; winner = e.winner; }
  }
  assert(a.missiles === C.MISSILE_MAGAZINE - 2, "magazine decremented");
  assert(dead && winner === "A", `missiles kill the drone (winner ${winner})`);
  assert(sim.winner === "A", "sim.winner set");
}

// 4. decoy steals lock from a quiet ship; full-burn ship keeps lock
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 5000, 0, false);
  b.thrust = 0; // quiet: sig 40 < decoy 120
  fire(sim, "A", "fire_missile");
  sim.tick(); sim.tick(); sim.tick(); // past launch delay, locked on ship
  const m = (sim as any).missiles[0];
  assert(m.lock?.type === "ship", "locked on ship first");
  // B drops a decoy right at its position
  sim.enqueue("B", [{verb: "deploy_decoy", params: {}} as any]);
  sim.tick();
  assert(m.lock?.type === "decoy", "decoy (sig 120) steals lock from quiet ship (sig 40)");

  const sim2 = new Sim();
  sim2.addShip("A", 0, 0, 0);
  const b2 = sim2.addShip("B", 0, 5000, 0, false);
  b2.thrust = 100; // sig 140 > decoy 120
  sim2.enqueue("A", [{verb: "fire_missile", params: {}} as any]);
  sim2.tick(); sim2.tick(); sim2.tick();
  sim2.enqueue("B", [{verb: "deploy_decoy", params: {}} as any]);
  sim2.tick();
  const m2 = (sim2 as any).missiles[0];
  assert(m2.lock?.type === "ship", "full-burn ship (sig 140) keeps lock over decoy (120)");
}

// 5. prox fuse via segment check: fast head-on crossing detonates
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 3000, 180, false);
  b.vx = 0; b.vy = -280; b.thrust = 100; // charging at us fast, head-on
  fire(sim, "A", "fire_missile");
  let hit = false;
  for (let i = 0; i < 10 && !hit; i++) {
    const ev = sim.tick();
    hit = ev.some(e => e.kind === "notice" && /Missile strike/.test((e as any).text));
  }
  assert(hit, "head-on closing ~730 m/s still detonates (segment fuse)");
  assert(b.hull === C.HULL_POINTS - C.MISSILE_DAMAGE, `missile damage applied (hull ${b.hull})`);
}

// 6. segmentMinDist sanity
assert(segmentMinDist(0,0, 1000,0, 500,100, 500,100) === 100, "segment vs static point");
assert(segmentMinDist(0,0, 1000,0, 500,-50, 500,50) === 0, "crossing paths -> 0");

// 7. rejects: empty magazine, no decoys
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 25000, 180, true);
  a.missiles = 0; a.decoys = 0;
  fire(sim, "A", "fire_missile");
  fire(sim, "A", "deploy_decoy");
  const ev = sim.tick();
  assert(ev.some(e => e.kind === "reject" && /Magazine's empty/.test((e as any).reason)), "empty magazine reject");
  assert(ev.some(e => e.kind === "reject" && /No decoys/.test((e as any).reason)), "no decoys reject");
}

// 8. missile goes ballistic when nothing in cone, expires at lifetime
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 180); // firing south, away from B
  const b = sim.addShip("B", 0, 20000, 0, true);
  fire(sim, "A", "fire_missile");
  for (let i = 0; i < 6; i++) sim.tick();
  const m = (sim as any).missiles[0];
  assert(m.ballistic === true, "no candidates in cone -> ballistic after reacquire window");
  for (let i = 0; i < C.MISSILE_LIFETIME_S; i++) sim.tick();
  assert((sim as any).missiles.length === 0, "missile expires at lifetime");
}

// 9. fog: enemy missiles only in snapshot within detect range
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 10000, 180, false);
  sim.enqueue("B", [{verb: "fire_missile", params: {}} as any]);
  sim.tick();
  let snap = sim.snapshotFor("A") as any;
  assert(snap.missiles.length === 0, "enemy missile at ~9.5km not in snapshot (detect 6km)");
  for (let i = 0; i < 8; i++) sim.tick();
  snap = sim.snapshotFor("A") as any;
  assert(snap.missiles.some((m: any) => !m.own), "enemy missile appears within 6km");
}
console.log("done");
