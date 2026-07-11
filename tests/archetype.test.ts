// v5 §4: ship archetypes — numbers only. The frigate row IS the v4
// baseline (every other suite runs on the default and is the invariance
// proof); this suite pins the corvette/cruiser deltas, the per-viewer
// sensor bases, the loadouts, and the archetype fog rule (ID-tier only).
import { Sim } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

// 0. the LINKED invariant: frigate row == the legacy baseline globals
{
  const f = C.ARCHETYPES.frigate;
  assert(f.hull === C.HULL_POINTS, "frigate hull == HULL_POINTS");
  assert(f.accel === C.ACCEL_FULL_THRUST_MPS2, "frigate accel == ACCEL_FULL_THRUST_MPS2");
  assert(f.turn === C.TURN_RATE_DEG_PER_SEC, "frigate turn == TURN_RATE_DEG_PER_SEC");
  assert(f.sigBase === C.SIG_BASE, "frigate sigBase == SIG_BASE");
  assert(f.sensorBase === C.SENSOR_BASE_M, "frigate sensorBase == SENSOR_BASE_M");
  assert(f.tubes === C.TUBE_COUNT && f.magazine === C.MISSILE_MAGAZINE, "frigate tubes/magazine == baseline");
  assert(f.tubeReload === C.TUBE_RELOAD_S && f.decoys === C.DECOY_SUPPLY && f.pdcAmmoS === C.PDC_AMMO_S, "frigate reload/decoys/pdc == baseline");
}

// 1. movement: corvette out-accelerates and out-turns the cruiser
{
  const sim = new Sim();
  const cv = sim.addShip("A", 0, 0, 0, false, null, "A", "corvette");
  const cr = sim.addShip("B", 200000, 0, 0, false, null, "B", "cruiser"); // far apart (inside the region: edge pull would pollute the accel numbers)
  cv.pdcPosture = "hold"; cr.pdcPosture = "hold";
  sim.enqueue("A", [{ verb: "set_thrust", params: { percent: 100 } }]);
  sim.enqueue("B", [{ verb: "set_thrust", params: { percent: 100 } }]);
  sim.tick(); sim.tick();
  const vCv = Math.hypot(cv.vx, cv.vy);
  const vCr = Math.hypot(cr.vx, cr.vy);
  assert(Math.abs(vCv - 2 * 85) < 2, `corvette accel 85 m/s² (${vCv.toFixed(0)} m/s after 2 s)`);
  assert(Math.abs(vCr - 2 * 40) < 2, `cruiser accel 40 m/s² (${vCr.toFixed(0)} m/s after 2 s)`);
  sim.enqueue("A", [{ verb: "set_heading", params: { mode: "relative", direction: "starboard", degrees: 90 } }]);
  sim.enqueue("B", [{ verb: "set_heading", params: { mode: "relative", direction: "starboard", degrees: 90 } }]);
  sim.tick(); sim.tick();
  assert(Math.abs(cv.facing - 56) < 1, `corvette turns 28°/s (${cv.facing.toFixed(0)}° after 2 s)`);
  assert(Math.abs(cr.facing - 28) < 1, `cruiser turns 14°/s (${cr.facing.toFixed(0)}° after 2 s)`);
}

// 2. signature & sensors: the cruiser cannot hide, the corvette nearly can;
// each hull's own sensor base sets what IT sees
{
  const sim = new Sim();
  const cv = sim.addShip("A", 0, 0, 0, false, null, "A", "corvette");
  const cr = sim.addShip("B", 0, 80000, 180, false, null, "B", "cruiser");
  cv.pdcPosture = "hold"; cr.pdcPosture = "hold";
  assert(sim.signatureOf(cv) === 20 && sim.signatureOf(cr) === 45, "dark sig: corvette 20, cruiser 45");
  sim.tick();
  // corvette sees the cruiser: 210000 * 45/100 = 94.5 km detect; 80 km = TRACK band (frac .85 -> faint? .846 -> FAINT)
  const cvSees = sim.contactOn("A", "B").tier;
  const crSees = sim.contactOn("B", "A").tier;
  // cruiser sees the corvette: 160000 * 20/100 = 32 km detect; 80 km = nothing
  assert(cvSees >= 1, `corvette's big eyes hold the loud cruiser at 80 km (tier ${cvSees})`);
  assert(crSees === 0, `the dim corvette is invisible to the cruiser at 80 km (tier ${crSees})`);
}

// 3. loadouts: tubes, magazine, decoys, PDC ammo per the table
{
  const sim = new Sim();
  const cv = sim.addShip("A", 0, 0, 0, false, null, "A", "corvette");
  const cr = sim.addShip("B", 200000, 0, 0, false, null, "B", "cruiser");
  assert(cv.tubes.length === 1 && cv.reserve === 3 && cv.decoys === 6 && cv.pdcAmmoS === 40, "corvette loadout: 1 tube, 4 aboard, 6 decoys, 40 s PDC");
  assert(cr.tubes.length === 3 && cr.reserve === 6 && cr.decoys === 4 && cr.pdcAmmoS === 90, "cruiser loadout: 3 tubes, 9 aboard, 4 decoys, 90 s PDC");
  assert(cv.hull === 60 && cr.hull === 160, "hulls: corvette 60, cruiser 160");
  // tube 3 exists on the cruiser and not on the corvette
  const evs: any[] = [];
  (sim as any).applyCommand(cv, { verb: "fire_missile", params: { guidance: "bearing", tubes: [1] } }, evs);
  assert((sim as any).missiles.length === 1, "corvette fires its single tube");
}

// 4. fog: archetype is ID-tier information — absent from the snapshot at
// track, present at ID
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 40000, 180, false, null, "B", "cruiser"); // sig 45: detect 81 km; 40 km = TRACK
  a.pdcPosture = "hold"; b.pdcPosture = "hold";
  sim.tick();
  let snap = sim.snapshotFor("A") as any;
  assert(snap.contacts[0]?.tier === 2, `cruiser tracked at 40 km (tier ${snap.contacts[0]?.tier})`);
  assert(!JSON.stringify(snap.contacts).includes("cruiser"), "archetype absent below ID");
  b.y = 20000; // inside ID band (81 * .3 = 24.3 km)
  sim.tick();
  snap = sim.snapshotFor("A") as any;
  assert(snap.contacts[0]?.tier === 3 && snap.contacts[0]?.archetype === "cruiser", "archetype revealed at ID");
  assert((snap.you.archetype === "frigate") && snap.you.accel === 60, "own archetype and accel ride the snapshot");
}

console.log("done: archetype");
