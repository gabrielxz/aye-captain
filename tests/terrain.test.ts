// §3 terrain: seeded generation, LOS raycasts, solid rocks (collisions,
// damage, ordnance destruction), collision warnings.
import { Sim, type Ship } from "../server/sim.js";
import {
  generateTerrain,
  losClear,
  insideDust,
  segCircleHitT,
} from "../server/terrain.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};
const grantLock = (ship: Ship) => {
  ship.lock = { progress: C.LOCK_TIME_S, has: true, grace: C.LOCK_GRACE_S };
};

// 1. generation: deterministic, correct counts, navigable spacing, clear spawns
{
  const t1 = generateTerrain("gabriel");
  const t2 = generateTerrain("gabriel");
  const t3 = generateTerrain("other-seed");
  assert(JSON.stringify(t1) === JSON.stringify(t2), "same seed => identical field");
  assert(JSON.stringify(t1) !== JSON.stringify(t3), "different seed => different field");

  assert(t1.rocks.length === C.ROCK_COUNT + 1, `rock count ${t1.rocks.length} (30 + centerpiece)`);
  const cp = t1.rocks.find((r) => r.centerpiece)!;
  assert(!!cp && cp.r === C.CENTERPIECE_RADIUS_M, "one centerpiece at its radius");
  assert(Math.hypot(cp.x, cp.y) <= C.REGION_RADIUS_M / 3, "centerpiece in the middle third");
  assert(
    t1.rocks.every(
      (r) => r.centerpiece || (r.r >= C.ROCK_RADIUS_MIN_M && r.r <= C.ROCK_RADIUS_MAX_M)
    ),
    "field rock radii within bounds"
  );
  let spacingOk = true;
  for (let i = 0; i < t1.rocks.length; i++) {
    for (let j = i + 1; j < t1.rocks.length; j++) {
      const a = t1.rocks[i];
      const b = t1.rocks[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) <= a.r + b.r + C.ROCK_MIN_GAP_M) spacingOk = false;
    }
  }
  assert(spacingOk, "minimum spacing between all rocks");
  const spawns = [
    { x: 0, y: -C.SPAWN_DIST_FROM_CENTER_M },
    { x: 0, y: C.SPAWN_DIST_FROM_CENTER_M },
  ];
  assert(
    t1.rocks.every((r) =>
      spawns.every((s) => Math.hypot(r.x - s.x, r.y - s.y) > r.r + C.ROCK_SPAWN_CLEAR_M)
    ),
    "spawn points clear of rocks"
  );
  assert(t1.dust.length === C.DUST_COUNT, "dust cloud count");
  assert(
    t1.dust.every(
      (d) =>
        d.rx >= C.DUST_SIZE_MIN_M / 2 && d.rx <= C.DUST_SIZE_MAX_M / 2 &&
        d.ry >= C.DUST_SIZE_MIN_M / 2 && d.ry <= C.DUST_SIZE_MAX_M / 2
    ),
    "dust sizes within 30-60 km"
  );
}

// 2. raycast geometry
{
  assert(segCircleHitT(0, 0, 10000, 0, 5000, 0, 1000) !== null, "segment through circle hits");
  assert(segCircleHitT(0, 0, 10000, 0, 5000, 2000, 1000) === null, "offset circle missed");
  const terrain = {
    seed: "manual",
    rocks: [{ x: 0, y: 5000, r: 2000 }],
    dust: [{ x: 20000, y: 0, rx: 5000, ry: 3000, rot: 0 }],
  };
  assert(!losClear(0, 0, 0, 10000, terrain), "rock blocks LOS");
  assert(losClear(0, 0, 10000, 0, terrain), "clear ray passes");
  assert(!losClear(10000, 0, 30000, 0, terrain), "dust blocks LOS");
  assert(
    losClear(10000, 0, 30000, 0, terrain) === losClear(30000, 0, 10000, 0, terrain),
    "dust blocks both directions"
  );
  assert(insideDust(20000, 0, terrain), "point inside dust");
  assert(!insideDust(20000, 4000, terrain), "point outside dust (short axis)");
  assert(!losClear(20000, 0, 20000, 100, terrain), "inside a cloud you are blind");
}

// 3. sensors LOS-gated: enemy in range but behind a rock is invisible
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 8000, 180, false); // well inside 12 km sensor range
  sim.terrain.rocks.push({ x: 0, y: 4000, r: 1500 });
  sim.tick();
  assert(!a.enemyVisible, "enemy hidden behind rock despite range");
  sim.terrain.rocks.length = 0;
  sim.tick();
  assert(a.enemyVisible, "clear LOS restores contact");
}

// 4. ship-vs-rock: gentle bump harmless, fast hit damages + bounces, tangential survives
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, -1500, 0);
  sim.addShip("B", 0, 200000, 180, false);
  sim.terrain.rocks.push({ x: 0, y: 0, r: 1000 });
  a.vy = 40; // head-on, below COLLISION_HARMLESS_BELOW_MPS
  for (let i = 0; i < 20 && a.vy > 0; i++) sim.tick();
  assert(a.hull === C.HULL_POINTS, "gentle bump: no damage");
  assert(a.vy < 0, "bounced (normal component reflected)");

  // tangential survival against a near-flat surface (huge rock)
  const simT = new Sim();
  const aT = simT.addShip("A", 0, 0, 0);
  simT.addShip("B", 0, 200000, 180, false);
  simT.terrain.rocks.push({ x: 0, y: 102000, r: 100000 }); // surface ~2 km north
  aT.vy = 40;
  aT.vx = 10;
  for (let i = 0; i < 60 && aT.vy > 0; i++) simT.tick();
  assert(aT.vy < 0, "flat-surface bounce");
  assert(Math.abs(aT.vx - 10) < 2, `tangential component survives (vx ${aT.vx.toFixed(1)})`);

  const sim2 = new Sim();
  const a2 = sim2.addShip("A", 0, -3000, 0);
  sim2.addShip("B", 0, 200000, 180, false);
  sim2.terrain.rocks.push({ x: 0, y: 0, r: 1000 });
  a2.vy = 600;
  let ev: ReturnType<Sim["tick"]> = [];
  for (let i = 0; i < 10 && a2.vy > 0; i++) ev = sim2.tick();
  const expected = Math.round(
    100 * ((600 - C.COLLISION_HARMLESS_BELOW_MPS) / (C.COLLISION_LETHAL_AT_MPS - C.COLLISION_HARMLESS_BELOW_MPS)) ** 2
  );
  assert(a2.hull === C.HULL_POINTS - expected, `600 m/s impact damage ${expected} (hull ${a2.hull})`);
  assert(ev.some((e) => e.kind === "notice" && /Collision/.test((e as any).text)), "collision notice");
  assert(Math.abs(a2.vy + 600 * C.COLLISION_RESTITUTION) < 30, `restitution bounce (vy ${a2.vy.toFixed(0)})`);
  assert(Math.hypot(a2.x, a2.y) > 1000, "ship placed outside the rock");
}

// 5. lethal collision ends the match, opponent wins
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, -5000, 0);
  sim.addShip("B", 0, 200000, 180, false);
  sim.terrain.rocks.push({ x: 0, y: 0, r: 1000 });
  a.vy = 1600; // beyond lethal speed
  let winner: string | null = null;
  for (let i = 0; i < 10 && !winner; i++) {
    for (const e of sim.tick()) if (e.kind === "gameover") winner = e.winner;
  }
  assert(winner === "B", `lethal collision: opponent wins (${winner})`);
}

// 6. missile impacting a rock is destroyed harmlessly; seeker can't see through it
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 20000, 180, false);
  sim.terrain.rocks.push({ x: 0, y: 5000, r: 1500 });
  grantLock(a);
  sim.enqueue("A", [{ verb: "fire_missile", params: {} }]);
  for (let i = 0; i < 12; i++) sim.tick();
  assert((sim as any).missiles.length === 0, "missile destroyed on the rock");
  assert(b.hull === C.HULL_POINTS, "rock detonation harms nobody");
}

// 7. collision warning: coarse countdown announcements, HUD field, re-arm
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  sim.terrain.rocks.push({ x: 0, y: 13000, r: 1000 });
  a.vy = 600; // surface 12 km ahead => impact in 20 s
  const heard: string[] = [];
  for (let i = 0; i < 25 && a.vy > 0; i++) {
    for (const e of sim.tick()) {
      if (e.kind === "notice" && /Rock on our vector/.test((e as any).text)) heard.push((e as any).text);
    }
  }
  assert(heard.some((t) => /twenty|fifteen/.test(t)), `early warning fired (${heard[0] ?? "none"})`);
  assert(heard.some((t) => /five/.test(t)), "five-second warning fired");
  assert(heard.length <= 4, `coarse steps only, no spam (${heard.length} lines)`);
  const snap = sim.snapshotFor("A") as any;
  assert(snap.you.collisionWarning === null, "warning clears after the bounce kills closure");
}

console.log("done");
