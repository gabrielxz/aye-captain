// v5 §5: the railgun. Solution hit-while-ballistic and miss-under-thrust,
// bearing skill shots, rocks stop slugs, slugs kill ordnance en route,
// NO IFF (the friendly-fire positive test), PDCs never engage slugs,
// inherited shooter velocity, rejections, and the rail-fire hearing call.
import { Sim, type SimEvent } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};
const quiet = (sim: Sim) => {
  for (const s of (sim as any).ships.values()) s.pdcPosture = "hold";
};
const run = (sim: Sim, ticks: number): SimEvent[] => {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
};

// 1. solution mode kills a drifter: B coasts ballistic at 20 km with a
// track held; one slug, ~3.3 s of flight, 25 hull
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 20000, 90);
  quiet(sim);
  b.vx = 400; // crossing target, constant velocity
  sim.tick(); // track
  sim.enqueue("A", [{ verb: "fire_railgun", params: { mode: "solution" } }]);
  const evs = run(sim, 6);
  assert(evs.some((e) => e.kind === "notice" && /Solution ready — firing/.test((e as any).text)), "XO fires the solution");
  assert(b.hull === 75, `slug leads the crossing drifter (hull ${b.hull})`);
  assert(evs.some((e) => e.kind === "notice" && e.ship === "A" && /Rail slug connected/.test((e as any).text)), "shooter's XO calls the hit");
  assert(a.railSlugs === C.ARCHETYPES.frigate.railSlugs - 1 && a.railCooldownS > 0, "ammo spent, rail recharging");
}

// 2. any thrust beats a solution: same geometry, target burns hard after
// the shot — the slug misses
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 20000, 90);
  quiet(sim);
  b.vx = 400;
  sim.tick();
  sim.enqueue("A", [{ verb: "fire_railgun", params: { mode: "solution" } }]);
  sim.enqueue("B", [{ verb: "set_thrust", params: { percent: 100 } }]); // reacts immediately
  run(sim, 6);
  assert(b.hull === 100, `thrusting target dodges the solution (hull ${b.hull})`);
}

// 3. bearing mode: a skill shot down a named bearing hits a stationary
// hull; and rocks stop slugs (target safe behind the moonlet)
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 15000, 180);
  quiet(sim);
  sim.enqueue("A", [{ verb: "fire_railgun", params: { mode: "bearing", bearing_degrees: 0 } }]);
  run(sim, 4);
  assert(b.hull === 75, `bearing shot connects dead ahead (hull ${b.hull})`);

  const sim2 = new Sim();
  (sim2 as any).terrain.rocks.push({ x: 0, y: 8000, r: 2000 });
  sim2.addShip("A", 0, 0, 0);
  const b2 = sim2.addShip("B", 0, 15000, 180);
  quiet(sim2);
  sim2.enqueue("A", [{ verb: "fire_railgun", params: { mode: "bearing", bearing_degrees: 0 } }]);
  run(sim2, 4);
  assert(b2.hull === 100 && (sim2 as any).slugs.length === 0, "the rock eats the slug — target safe in its shadow");
}

// 4. NO IFF: a teammate in the line of fire takes the slug (the game's
// only friendly-fire vector — physics doesn't read transponders)
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0, false, "red");
  const b = sim.addShip("B", 0, 10000, 0, false, "red"); // friend, dead ahead
  sim.addShip("C", 0, 30000, 180, false, "blue"); // the intended direction
  quiet(sim);
  sim.enqueue("A", [{ verb: "fire_railgun", params: { mode: "bearing", bearing_degrees: 0 } }]);
  run(sim, 3);
  assert(b.hull === 75, `the teammate slugging is legend (friend hull ${b.hull})`);
}

// 5. slugs obliterate ordnance en route without stopping, and PDCs never
// engage a slug
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 20000, 180);
  a.pdcPosture = "hold";
  b.pdcPosture = "free"; // guns free: they must STILL ignore the slug
  // a hostile missile parked on the firing line
  (sim as any).missiles.push({
    id: 999, owner: "B", x: 0, y: 10000, vx: 0, vy: 0, prevX: 0, prevY: 10000,
    course: 180, speed: 0, age: 5, launchX: 0, launchY: 20000, fuel: 0,
    burning: false, guidance: "autonomous", target: null, cmdBearing: null, lock: null,
  });
  sim.enqueue("A", [{ verb: "fire_railgun", params: { mode: "bearing", bearing_degrees: 0 } }]);
  run(sim, 4);
  assert(!(sim as any).missiles.some((m: any) => m.id === 999), "slug swats the missile en route");
  assert(b.hull === 75, `...and carries on into the hull behind it (hull ${b.hull})`);
}

// 5b. muzzle guard: rail + probe ordered the SAME tick co-spawn at the
// ship — the slug must not swat its own co-launch (browser-found bug);
// a same-owner probe well downrange is still honestly hittable
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  quiet(sim);
  sim.enqueue("A", [
    { verb: "fire_railgun", params: { mode: "bearing", bearing_degrees: 0 } },
    { verb: "launch_probe", params: { bearing_degrees: 0 } },
  ]);
  run(sim, 2);
  assert((sim as any).probes.length === 1, "same-tick probe survives its own rail muzzle");
  // a parked own probe far downrange is fair game (no IFF on slugs)
  const sim2 = new Sim();
  sim2.addShip("A", 0, 0, 0);
  quiet(sim2);
  (sim2 as any).probes.push({ id: 950, owner: "A", team: null, idx: 1, bearing: 0, x: 0, y: 20000, prevX: 0, prevY: 20000, vx: 0, vy: 0, age: 60 });
  sim2.enqueue("A", [{ verb: "fire_railgun", params: { mode: "bearing", bearing_degrees: 0 } }]);
  run(sim2, 5);
  assert((sim2 as any).probes.length === 0, "your own probe downrange is still hittable — no IFF");
}

// 6. inherited velocity: a shooter sliding sideways imparts its drift
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  quiet(sim);
  a.vx = 1000; // sliding east, firing north
  sim.enqueue("A", [{ verb: "fire_railgun", params: { mode: "bearing", bearing_degrees: 0 } }]);
  sim.tick();
  const sl = (sim as any).slugs[0];
  assert(!!sl && Math.abs(sl.vx - 1000) < 1 && Math.abs(sl.vy - C.RAIL_SLUG_SPEED_MPS) < 1,
    `slug velocity = shooter velocity + ${C.RAIL_SLUG_SPEED_MPS} along the line (${sl?.vx.toFixed(0)}, ${sl?.vy.toFixed(0)})`);
}

// 7. rejections: corvette has no rail; no track = offer bearing fire;
// cooldown and dry magazine speak up
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0, false, null, "A", "corvette");
  quiet(sim);
  sim.enqueue("A", [{ verb: "fire_railgun", params: {} }]);
  let evs = run(sim, 1);
  assert(evs.some((e) => e.kind === "reject" && /doesn't mount a railgun/.test((e as any).reason)), "corvette: no rail fitted");

  const sim2 = new Sim();
  const a2 = sim2.addShip("A", 0, 0, 0);
  sim2.addShip("B", 0, 200000, 180); // no contact at all
  quiet(sim2);
  sim2.enqueue("A", [{ verb: "fire_railgun", params: { mode: "solution" } }]);
  evs = run(sim2, 1);
  assert(evs.some((e) => e.kind === "reject" && /No track for a solution/.test((e as any).reason)), "no track: XO offers the bearing shot");

  sim2.enqueue("A", [{ verb: "fire_railgun", params: { mode: "bearing" } }]);
  sim2.tick();
  sim2.enqueue("A", [{ verb: "fire_railgun", params: { mode: "bearing" } }]);
  evs = run(sim2, 1);
  assert(evs.some((e) => e.kind === "reject" && /recharging/.test((e as any).reason)), "cooldown rejection");
  a2.railSlugs = 0;
  a2.railCooldownS = 0;
  sim2.enqueue("A", [{ verb: "fire_railgun", params: { mode: "bearing" } }]);
  evs = run(sim2, 1);
  assert(evs.some((e) => e.kind === "reject" && /Slugs are out/.test((e as any).reason)), "dry magazine rejection");
}

// 8. rail fire is HEARD: a listener far beyond detection gets the bearing
// call (spiked sig 30+80=110 -> frigate hearing reaches ~495 km)
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 240000, 180); // far beyond passive detection
  quiet(sim);
  sim.enqueue("A", [{ verb: "fire_railgun", params: { mode: "bearing", bearing_degrees: 90 } }]);
  const evs = run(sim, 1);
  const call = evs.find((e) => e.kind === "notice" && e.ship === "B" && /Rail fire, bearing/.test((e as any).text)) as any;
  assert(!!call && /bearing 180/.test(call.text), `the shot is heard with a bearing (${call?.text})`);
  assert(/one eight zero/.test(call?.speak ?? ""), "spoken bearing is quantized digit words");
}

// 9. fog: an enemy slug in flight is all but invisible (sig 8 -> ~14 km);
// own slugs always render
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 100000, 180);
  quiet(sim);
  sim.enqueue("A", [{ verb: "fire_railgun", params: { mode: "bearing", bearing_degrees: 90 } }]);
  sim.tick();
  const snapA = sim.snapshotFor("A") as any;
  const snapB = sim.snapshotFor("B") as any;
  assert(snapA.slugs.length === 1 && snapA.slugs[0].own, "own slug always in the snapshot");
  assert((snapB.slugs ?? []).length === 0, "a distant enemy slug is invisible in flight");
}

console.log("done: rail");
