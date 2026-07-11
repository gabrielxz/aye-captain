// v5 §8: teams + IFF. Transponders (mutual full-state, NOTHING else
// shared), the IFF matrix (every guided weapon × friendly/hostile ×
// ship/decoy/probe/missile), the deliberate rail/collision exemption
// (covered positively in rail.test.ts), teammate refs, and fog: allies
// never leak through hostile snapshots.
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

// 1. transponders: a teammate across the map is on the snapshot at full
// state; hostile viewers get nothing extra; NOTHING else is shared
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0, false, "red", "Kestrel");
  const b = sim.addShip("B", 0, 200000, 180, false, "red", "Mako");
  const c = sim.addShip("C", 150000, 150000, 225, false, "blue", "Sable");
  quiet(sim);
  b.hull = 42;
  sim.tick();
  const snapA = sim.snapshotFor("A") as any;
  assert(snapA.allies.length === 1, "teammate on the map from anywhere");
  const ally = snapA.allies[0];
  assert(
    ally.callsign === "Mako" && ally.hull === 42 && ally.archetype === "frigate" &&
    typeof ally.vx === "number" && typeof ally.facing === "number",
    "transponder is FULL state: callsign, archetype, vector, hull"
  );
  // nothing else is shared: C cruises near B — B sees it, A must not
  // (sig 80 -> detect 144 km: 40 km from B, 204 km from A)
  c.x = 40000; c.y = 200000; c.thrust = 50;
  run(sim, 2);
  assert(sim.contactOn("B", "C").tier >= 2, "B holds its own track on C");
  assert(sim.contactOn("A", "C").tier === 0, "A gets NO fused teammate picture — intel moves by talking");
  const snapC = sim.snapshotFor("C") as any;
  assert((snapC.allies ?? []).length === 0 && !JSON.stringify(snapC.allies).includes("Kestrel"),
    "hostiles have no allies array content");
}

// 2. IFF matrix — seekers: a blind bird flying up a corridor of friendly
// ship/decoy/probe grabs NONE of them, then acquires the hostile beyond
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0, false, "red");
  sim.addShip("B", 0, 12000, 0, false, "red"); // friendly ship in the corridor
  const c = sim.addShip("C", 0, 30000, 180, false, "blue");
  c.thrust = 100; // loud hostile at the end
  quiet(sim);
  (sim as any).decoys.push({ id: 701, owner: "B", team: "red", x: 500, y: 8000, vx: 0, vy: 0, age: 0 });
  (sim as any).probes.push({ id: 702, owner: "B", team: "red", idx: 1, bearing: 0, x: -500, y: 9000, prevX: -500, prevY: 9000, vx: 0, vy: 0, age: 30 });
  sim.enqueue("A", [{ verb: "fire_missile", params: { guidance: "bearing", bearing_degrees: 0 } }]);
  for (let i = 0; i < 5; i++) sim.tick();
  const m = (sim as any).missiles[0];
  assert(!!m && m.lock?.type === "ship" && m.lock.id === "C",
    `seeker ignores friendly ship/decoy/probe and grabs the hostile (${JSON.stringify(m?.lock)})`);
  void a;
}

// 3. IFF matrix — prox fuses: the bird coasts safely PAST a friendly hull,
// decoy, probe, and a friendly missile without detonating
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0, false, "red");
  const b = sim.addShip("B", 60, 10000, 0, false, "red"); // 60 m off the flight line! (fuse is 150 m)
  quiet(sim);
  (sim as any).decoys.push({ id: 703, owner: "B", team: "red", x: -60, y: 6000, vx: 0, vy: 0, age: 0 });
  (sim as any).probes.push({ id: 704, owner: "B", team: "red", idx: 1, bearing: 0, x: 60, y: 8000, prevX: 60, prevY: 8000, vx: 0, vy: 0, age: 30 });
  sim.enqueue("A", [{ verb: "fire_missile", params: { guidance: "bearing", bearing_degrees: 0 } }]);
  run(sim, 15);
  const m = (sim as any).missiles[0];
  assert(!!m && m.y > 12000, `the bird sails through the friendly corridor (y ${m?.y?.toFixed(0)})`);
  assert(b.hull === 100, "no friendly prox detonation");
}

// 4. IFF matrix — PDCs: guns free, a friendly missile and probe cross the
// envelope unengaged; a hostile missile on the same pass is shredded
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0, false, "red");
  a.pdcPosture = "free";
  const mk = (id: number, owner: string, team: string) => ({
    id, owner, team, x: 0, y: 3000, vx: 0, vy: 0, prevX: 0, prevY: 3000,
    course: 180, speed: 0, age: 5, launchX: 0, launchY: 20000, fuel: 0,
    burning: true, guidance: "autonomous", target: null, cmdBearing: null, lock: null,
  });
  (sim as any).missiles.push(mk(705, "B", "red")); // friendly bird parked in the envelope
  (sim as any).probes.push({ id: 706, owner: "B", team: "red", idx: 1, bearing: 0, x: 0, y: 2000, prevX: 0, prevY: 2000, vx: 0, vy: 0, age: 30 });
  run(sim, 30);
  assert((sim as any).missiles.some((m: any) => m.id === 705), "PDCs ignore the friendly bird for 30 s");
  assert((sim as any).probes.some((p: any) => p.id === 706), "PDCs ignore the friendly probe");
  (sim as any).missiles.push(mk(707, "C", "blue"));
  run(sim, 40);
  assert(!(sim as any).missiles.some((m: any) => m.id === 707), "the hostile bird on the same pass is shredded");
}

// 5. no false alarms: a detected friendly bird raises no "missile inbound",
// trips no missile_inbound metric, and paints friendly on the snapshot
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0, false, "red");
  sim.addShip("B", 0, 20000, 180, false, "red");
  quiet(sim);
  sim.enqueue("B", [{ verb: "fire_missile", params: { guidance: "bearing", bearing_degrees: 90 } }]);
  const evs = run(sim, 3);
  assert(!evs.some((e) => e.kind === "notice" && e.ship === "A" && /Missile inbound|Ballistic inbound/.test((e as any).text)),
    "no inbound alarm for a teammate's launch");
  const snap = sim.snapshotFor("A") as any;
  const seen = (snap.missiles ?? []).find((m: any) => !m.own);
  assert(!!seen && seen.ally === true, "the detected friendly bird is marked ally on the wire");
  assert((sim as any).metricValue(a, "missile_inbound") === false, "missile_inbound stays ANY-HOSTILE-source");
}

// 6. teammate refs: "form up on Mako" steers; locking or solving on a
// teammate is refused by name (transponders — no fog to protect)
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0, false, "red", "Kestrel");
  sim.addShip("B", 40000, 0, 0, false, "red", "Mako"); // due east
  quiet(sim);
  sim.tick();
  sim.enqueue("A", [{ verb: "set_heading", params: { mode: "target", target: "Mako" } }]);
  for (let i = 0; i < 8; i++) sim.tick();
  assert(Math.round(a.facing) === 90, `helm forms up on the teammate (facing ${a.facing.toFixed(0)})`);
  sim.enqueue("A", [{ verb: "set_lock_target", params: { contact: "Mako" } }]);
  let evs = run(sim, 1);
  assert(evs.some((e) => e.kind === "reject" && /squawking friendly/.test((e as any).reason)), "lock designation on a teammate is refused");
  sim.enqueue("A", [{ verb: "fire_railgun", params: { mode: "solution", target: "Mako" } }]);
  evs = run(sim, 1);
  assert(evs.some((e) => e.kind === "reject" && /squawking friendly/.test((e as any).reason)), "a deliberate rail solution on a teammate is refused (bearing mode remains the legend)");
}

console.log("done: teams");
