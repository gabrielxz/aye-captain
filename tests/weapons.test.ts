import { Sim, segmentMinDist, missilesAboard, type Ship } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};
const fire = (sim: Sim, id: "A"|"B", verb: string) => sim.enqueue(id, [{verb, params:{}} as any]);
// Missiles require a held lock; tests that aren't about lock acquisition
// grant one directly (the lock suite covers acquisition itself).
const grantLock = (ship: Ship) => {
  ship.lock = { progress: C.LOCK_TIME_S, has: true, grace: C.LOCK_GRACE_S };
};

// 1. PDCs at knife range: mutual mauling at 5 hull/s each way; 'hold' silences
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 2500, 180, true); // inside PDC_SHIP_RANGE_M
  for (let i = 0; i < 4; i++) sim.tick();
  assert(
    Math.abs(b.hull - (C.DRONE_HULL_POINTS - 4 * C.PDC_SHIP_DPS)) < 0.5,
    `our PDCs chew the drone at ${C.PDC_SHIP_DPS}/s (hull ${b.hull.toFixed(1)})`
  );
  assert(
    Math.abs(a.hull - (C.HULL_POINTS - 4 * C.PDC_SHIP_DPS)) < 0.5,
    `mutual mauling: their PDCs chew us too (hull ${a.hull.toFixed(1)})`
  );
  assert(a.pdcAmmoS < C.PDC_AMMO_S, "firing drains ammo");

  const sim2 = new Sim();
  const a2 = sim2.addShip("A", 0, 0, 0);
  const b2 = sim2.addShip("B", 0, 2500, 180, true);
  sim2.enqueue("A", [{verb: "set_pdc", params: {posture: "hold"}} as any]);
  b2.pdcPosture = "hold";
  for (let i = 0; i < 4; i++) sim2.tick();
  assert(b2.hull === C.DRONE_HULL_POINTS && a2.hull === C.HULL_POINTS, "'hold' silences the mounts");
}

// 2. PDCs never target decoys; out-of-range ships are safe; sig spikes while firing
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 5000, 180, true); // outside PDC_SHIP_RANGE_M
  (sim as any).decoys.push({id: 900, owner: "B", x: 0, y: 1000, vx: 0, vy: 0, age: 0});
  const ammo = a.pdcAmmoS;
  sim.tick();
  assert((sim as any).decoys.length === 1, "PDCs ignore decoys");
  assert(a.pdcAmmoS === ammo, "no targets in envelope => no ammo spent");
  assert(sim.signatureOf(a) === C.SIG_BASE, "no PDC signature spike while silent");
}

// 3. missile: launch delay, seeker, accelerating kill of the drone + gameover
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 500, 6000, 90, true); // ahead, will drift east on its circle
  a.pdcPosture = "hold"; b.pdcPosture = "hold"; // this test is about missiles, not point defense
  grantLock(a);
  let dead = false;
  let winner: string | null = null;
  fire(sim, "A", "fire_missile");
  fire(sim, "A", "fire_missile"); // 2 x 35 = 70 >= 60 hull (one from each tube)
  for (let i = 0; i < 60 && !dead; i++) {
    const ev = sim.tick();
    for (const e of ev) if (e.kind === "gameover") { dead = true; winner = e.winner; }
  }
  assert(missilesAboard(a) === C.MISSILE_MAGAZINE - 2, `magazine decremented (${missilesAboard(a)} aboard)`);
  assert(dead && winner === "A", `missiles kill the drone (winner ${winner})`);
  assert(sim.winner === "A", "sim.winner set");
}

// 4. decoy seduction (v4.1, retuned v4.3): an AUTONOMOUS seeker is
// out-shone by a decoy (DECOY_SIGNATURE) only while the ship's signature
// stays below it — throttle discipline is back. Uplinked immunity lives in
// tests/uplink.test.ts.
{
  // quiet ship (sig 30 < 100): decoy wins
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 5000, 0, false);
  b.thrust = 0;
  a.pdcPosture = "hold"; b.pdcPosture = "hold";
  grantLock(a);
  fire(sim, "A", "fire_missile");
  sim.tick(); sim.tick(); sim.tick(); // past launch delay
  const m = (sim as any).missiles[0];
  m.guidance = "autonomous"; // orphan the bird: seeker-only rules under test
  sim.tick();
  assert(m.lock?.type === "ship", "autonomous seeker holds the quiet ship while nothing louder shows");
  sim.enqueue("B", [{verb: "deploy_decoy", params: {}} as any]);
  sim.tick();
  assert(m.lock?.type === "decoy", `decoy (${C.DECOY_SIGNATURE}) seduces the seeker off a quiet ship (${C.SIG_BASE})`);

  // full-burn ship (sig 130 > 100): the ship out-shines its own decoy
  const sim2 = new Sim();
  const a2 = sim2.addShip("A", 0, 0, 0);
  const b2 = sim2.addShip("B", 0, 5000, 0, false);
  b2.thrust = 100;
  a2.pdcPosture = "hold"; b2.pdcPosture = "hold";
  grantLock(a2);
  sim2.enqueue("A", [{verb: "fire_missile", params: {}} as any]);
  sim2.tick(); sim2.tick(); sim2.tick();
  const m2 = (sim2 as any).missiles[0];
  m2.guidance = "autonomous";
  sim2.enqueue("B", [{verb: "deploy_decoy", params: {}} as any]);
  sim2.tick();
  assert(m2.lock?.type === "ship", `a full-burn ship (${C.SIG_BASE + 100}) out-shines its decoy (${C.DECOY_SIGNATURE}) — spoof fails`);
}

// 5. prox fuse via segment check: fast head-on crossing detonates
// (target starts OUTSIDE arming distance — the fuse must be live at the merge)
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 8000, 180, false);
  b.vx = 0; b.vy = -280; b.thrust = 100; // charging at us fast, head-on
  a.pdcPosture = "hold"; b.pdcPosture = "hold";
  grantLock(a);
  fire(sim, "A", "fire_missile");
  let hit = false;
  for (let i = 0; i < 10 && !hit; i++) {
    const ev = sim.tick();
    hit = ev.some(e => e.kind === "notice" && /Missile strike/.test((e as any).text));
  }
  assert(hit, "fast head-on closure still detonates (segment fuse)");
  assert(b.hull === C.HULL_POINTS - C.MISSILE_DAMAGE, `missile damage applied (hull ${b.hull})`);
}

// 6. segmentMinDist sanity
assert(segmentMinDist(0,0, 1000,0, 500,100, 500,100) === 100, "segment vs static point");
assert(segmentMinDist(0,0, 1000,0, 500,-50, 500,50) === 0, "crossing paths -> 0");

// 7. rejects: no lock, dry magazine, no decoys
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 40000, 180, true);
  fire(sim, "A", "fire_missile"); // no lock yet
  let ev = sim.tick();
  assert(ev.some(e => e.kind === "reject" && /No lock/.test((e as any).reason)), "fire without lock rejected");

  grantLock(a);
  a.tubes.forEach(t => { t.loaded = false; t.reload = 0; });
  a.reserve = 0;
  a.decoys = 0;
  fire(sim, "A", "fire_missile");
  fire(sim, "A", "deploy_decoy");
  ev = sim.tick();
  assert(ev.some(e => e.kind === "reject" && /Magazine dry/.test((e as any).reason)), "dry magazine reject");
  assert(ev.some(e => e.kind === "reject" && /No decoys/.test((e as any).reason)), "no decoys reject");
}

// 8. a target-less autonomous bird holds its course (no reacquire timeout
// in v4.1 — blind birds must fly far without a candidate) and expires at
// lifetime
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 180); // firing south, away from B
  const b = sim.addShip("B", 0, 200000, 0, true);
  grantLock(a); // test bypass: aiming away on purpose
  fire(sim, "A", "fire_missile");
  sim.tick(); // spawned, still inside the launch delay — no steering yet
  const m = (sim as any).missiles[0];
  m.guidance = "autonomous"; // orphaned, nothing in the cone
  for (let i = 0; i < 6; i++) sim.tick();
  assert(m.lock === null && m.course === 180, `no candidate: holds course (${m.course})`);
  assert(m.fuel > 0, "still has fuel — not ballistic, just patient");
  for (let i = 0; i < C.MISSILE_LIFETIME_S; i++) sim.tick();
  assert((sim as any).missiles.length === 0, "missile expires at lifetime");
}

// 9. fog: ordnance detection uses signature math — a burning torpedo is
// visible far beyond the old flat radius (range derived from constants)
{
  const burnDetectM = (C.SENSOR_BASE_M * C.MISSILE_SIG_BURNING) / 100; // 144 km at v4.3 values
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 100000, 180, false); // 100 km out, well inside
  grantLock(b);
  sim.enqueue("B", [{verb: "fire_missile", params: {}} as any]);
  sim.tick();
  let snap = sim.snapshotFor("A") as any;
  assert(
    snap.missiles.some((m: any) => !m.own),
    `burning enemy missile visible at ~100 km (sig ${C.MISSILE_SIG_BURNING} => detect ${Math.round(burnDetectM / 1000)} km)`
  );
  // beyond its detection range it is not
  const sim2 = new Sim();
  sim2.addShip("A", 0, 0, 0);
  const b2 = sim2.addShip("B", 0, burnDetectM + 10000, 180, false);
  grantLock(b2);
  sim2.enqueue("B", [{verb: "fire_missile", params: {}} as any]);
  sim2.tick();
  snap = sim2.snapshotFor("A") as any;
  assert(!snap.missiles.some((m: any) => !m.own), `missile beyond ${Math.round(burnDetectM / 1000)} km detect range hidden`);
}
// v4.7.2: the tubes query flags when the loading missiles are the last
// aboard (playtest: "reloading" with reserve 0 read as a lie)
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  a.reserve = 2;
  sim.enqueue("A", [{ verb: "fire_missile", params: { tubes: [1, 2], guidance: "bearing", bearing_degrees: 90 } } as any]);
  sim.tick();
  sim.tick();
  let data = sim.queryData("A", "tubes") as any;
  assert(/reloading/.test(data.tubes), "both tubes reloading the last birds");
  assert(/LAST aboard/.test(data.magazine_note ?? ""), "magazine_note flags the last-of-it reload");

  const sim2 = new Sim();
  const a2 = sim2.addShip("A", 0, 0, 0);
  sim2.addShip("B", 0, 200000, 180, false);
  a2.reserve = 0;
  sim2.enqueue("A", [{ verb: "fire_missile", params: { tubes: [1, 2], guidance: "bearing", bearing_degrees: 90 } } as any]);
  sim2.tick();
  sim2.tick();
  data = sim2.queryData("A", "tubes") as any;
  assert(/tube one empty, tube two empty/.test(data.tubes), "dry magazine: tubes report empty, not reloading");
  assert(data.magazine_note === undefined, "no note when nothing is loading");
}
console.log("done");
