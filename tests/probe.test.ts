// v5 §6: sensor probes — burn-and-drift ballistics, fog-scoped relay from
// the probe's position (LOS from the probe; hears through terrain),
// via-probe provenance, the two-bearing triangulation payoff, probes as
// targets, the lock firewall (probe tracks never feed locks), and supply.
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

// 1. ballistics: inherits ship velocity, burns 150 m/s² along the fixed
// bearing for 20 s, then drifts
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  quiet(sim);
  a.vx = 500;
  sim.enqueue("A", [{ verb: "launch_probe", params: { bearing_degrees: 0 } }]);
  const evs = run(sim, 2);
  assert(evs.some((e) => e.kind === "notice" && /Probe one away — bearing 000/.test((e as any).text)), "launch line names probe one and the bearing");
  const pr = (sim as any).probes[0];
  assert(Math.abs(pr.vx - 500) < 1 && Math.abs(pr.vy - 2 * C.PROBE_ACCEL_MPS2) < 2,
    `probe inherits drift and burns along its bearing (${pr.vx.toFixed(0)}, ${pr.vy.toFixed(0)})`);
  run(sim, C.PROBE_BURN_S);
  const vAfterBurn = Math.hypot(pr.vx - 500, pr.vy);
  run(sim, 3);
  assert(Math.abs(Math.hypot(pr.vx - 500, pr.vy) - vAfterBurn) < 1, "burn ends at PROBE_BURN_S — pure drift after");
  assert(a.probesLeft === C.ARCHETYPES.frigate.probes - 1, "supply spent (no reloads)");
}

// 2. relay + provenance: a probe parked near a dark hostile gives the
// captain a via-probe track the ship's own sensors can't hold — and the
// XO's acquisition line says so
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 150000, 180); // dark, far beyond own sensors (54 km)
  quiet(sim);
  const pr = { id: 901, owner: "A", idx: 1, bearing: 0, x: 0, y: 130000, prevX: 0, prevY: 130000, vx: 0, vy: 0, age: 0 };
  (sim as any).probes.push(pr); // parked 20 km from B: probe detect 18 km? sig30 -> 60000*0.3=18km... place closer
  pr.y = 145000; // 5 km from B: probe frac 5/18 = .28 -> ID... use 8 km: frac .44 -> TRACK
  pr.y = 142000;
  const evs = run(sim, 1);
  assert(sim.contactOn("A", "B").tier === 2, `probe relay grants the captain a TRACK (tier ${sim.contactOn("A", "B").tier})`);
  assert(sim.contactOn("A", "B").viaProbe === true, "provenance: the tier is via probe");
  assert(evs.some((e) => e.kind === "notice" && /New contact \(via probe\) — designating/.test((e as any).text)), "XO names the relay in the acquisition line");
  const snap = sim.snapshotFor("A") as any;
  assert(snap.contacts[0]?.viaProbe === true, "snapshot contact carries the via-probe marker");
}

// 3. fog from the probe's position: a rock between PROBE and target blinds
// the relay even with a clear ship-to-target line... and the probe HEARS
// through that same rock (two bearings = the triangulation payoff)
{
  const sim = new Sim();
  (sim as any).terrain.rocks.push({ x: 0, y: 136000, r: 3000 }); // between probe and B
  sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 150000, 180);
  b.thrust = 40; // sig 70: audible far, visible ~126 km (still beyond own eyes)
  quiet(sim);
  (sim as any).probes.push({ id: 902, owner: "A", idx: 1, bearing: 0, x: 0, y: 130000, prevX: 0, prevY: 130000, vx: 0, vy: 0, age: 30 }); // burn over: parked
  run(sim, 1);
  assert(sim.contactOn("A", "B").tier === 0, "rock blinds the probe's eyes (fog from the probe's position)");
  const snap = sim.snapshotFor("A") as any;
  const probeRumbles = (snap.rumbles ?? []).filter((r: any) => r.probe === 1);
  const shipRumbles = (snap.rumbles ?? []).filter((r: any) => r.probe === undefined);
  assert(probeRumbles.length === 1 && probeRumbles[0].ox === 0 && probeRumbles[0].oy === 130000,
    "the probe hears through the rock — bearing chevron anchored at the probe");
  assert(shipRumbles.length === 1, "own ship hears it too: two bearings on one emitter — a human fix");
  assert(probeRumbles[0].bearing === 0 && shipRumbles[0].bearing === 0, "each bearing is from its own origin");
}

// 4. the lock firewall: a via-probe track never feeds a missile lock
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 60000, 180); // inside LOCK_RANGE (80 km), dead ahead, dark (own eyes: 54 km faint max... 60km = nothing)
  quiet(sim);
  (sim as any).probes.push({ id: 903, owner: "A", idx: 1, bearing: 0, x: 0, y: 55000, prevX: 0, prevY: 55000, vx: 0, vy: 0, age: 0 });
  run(sim, 2);
  assert(sim.contactOn("A", "B").tier >= 2, "the map holds a via-probe track inside lock range");
  run(sim, C.LOCK_TIME_S + 3);
  assert(!a.lock.has && a.lock.progress === 0, "probes FIND ships — the lock never builds on a relayed track");
}

// 5. probes are targets: PDCs shred one in the envelope; the owner is told
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 30000, 180);
  (sim as any).ships.get("A").pdcPosture = "hold";
  b.pdcPosture = "free";
  (sim as any).probes.push({ id: 904, owner: "A", idx: 2, bearing: 0, x: 0, y: 26000, prevX: 0, prevY: 26000, vx: 0, vy: 0, age: 0 });
  const evs = run(sim, 40); // kill prob 0.25/s in envelope — 40 s is plenty
  assert((sim as any).probes.length === 0, "PDCs engage the probe");
  assert(evs.some((e) => e.kind === "notice" && e.ship === "A" && /We just lost probe two/.test((e as any).text)),
    "the owner hears about their equipment");
}

// 6. lifetime: a spent probe leaves quietly (owner notice, no boom) and
// its relayed picture fades through the normal designation machinery
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 150000, 180);
  quiet(sim);
  (sim as any).probes.push({ id: 905, owner: "A", idx: 1, bearing: 0, x: 0, y: 142000, prevX: 0, prevY: 142000, vx: 0, vy: 0, age: C.PROBE_LIFETIME_S - 2 });
  run(sim, 1);
  assert(sim.contactOn("A", "B").tier >= 1, "relay live just before expiry");
  const evs = run(sim, 3);
  assert(evs.some((e) => e.kind === "notice" && /Probe one is spent/.test((e as any).text)), "spent probe announced to the owner");
  assert(evs.some((e) => e.kind === "notice" && /Track lost on|faded/.test((e as any).text)), "the relayed contact fades like any lost track");
  assert(sim.contactOn("A", "B").tier === 0, "no probe, no picture");
}

// 7. supply rejection + archetype counts
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0, false, null, "A", "cruiser"); // 1 probe
  quiet(sim);
  sim.enqueue("A", [{ verb: "launch_probe", params: {} }]);
  run(sim, 1);
  sim.enqueue("A", [{ verb: "launch_probe", params: {} }]);
  const evs = run(sim, 1);
  assert(a.probesLeft === 0 && evs.some((e) => e.kind === "reject" && /No probes left/.test((e as any).reason)),
    "cruiser carries one probe; the second launch is refused");
}

console.log("done: probe");
