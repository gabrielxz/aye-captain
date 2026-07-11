// v4.7.1: (a) XO reports about our own ordnance obey the explosion-fx
// observability rule (SENSOR_BASE_M + LOS) — an autonomous bird is one-way
// (HANDOFF-v4.1 §3), so its unseen fate stays unknown; (b) dynamic-bearing
// notices carry a TTS-safe `speak` variant (10°-quantized digit words).
import { Sim, spokenBearing, type Missile, type SimEvent } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

const noticesTo = (evs: SimEvent[], id: string) =>
  evs.filter((e) => e.kind === "notice" && (e as any).ship === id).map((e) => (e as any).text as string);

// A ballistic autonomous missile parked near a point, drifting slowly.
function plantMissile(sim: Sim, owner: "A" | "B", x: number, y: number, vx = 0, vy = 0): Missile {
  const m: Missile = {
    id: 900 + sim.missiles.length,
    owner,
    x, y, vx, vy,
    prevX: x, prevY: y,
    course: 0,
    speed: Math.hypot(vx, vy),
    age: 1,
    launchX: x - 20000, launchY: y, // well past arming distance
    fuel: 0, // ballistic: no steering, coasting signature
    burning: false,
    guidance: "autonomous",
    cmdBearing: null,
    lock: null,
  };
  sim.missiles.push(m);
  return m;
}

// 1. PDC kill of our missile: unseen (owner beyond SENSOR_BASE_M) = no
//    report to the owner; the defender still gets the splash.
{
  const sim = new Sim();
  sim.addShip("A", 0, -C.SENSOR_BASE_M - 60000, 0); // ~240 km from B: cannot observe
  const b = sim.addShip("B", 0, 0, 180, false);
  b.pdcPosture = "free";
  plantMissile(sim, "A", 0, -6000, 20, 0); // inside PDC range, outside prox fuse
  let heardA: string[] = [];
  let heardB: string[] = [];
  let killed = false;
  for (let i = 0; i < 240 && !killed; i++) {
    const ev = sim.tick();
    heardA = heardA.concat(noticesTo(ev, "A"));
    heardB = heardB.concat(noticesTo(ev, "B"));
    killed = !sim.missiles.some((m) => m.id >= 900);
  }
  assert(killed, "PDCs eventually kill the parked missile");
  assert(heardB.some((t) => /PDC splash/.test(t)), "defender gets the splash line");
  assert(!heardA.some((t) => /point defense got our missile/.test(t)), "UNSEEN kill: owner is NOT told (one-way bird)");
}

// 2. Same kill, owner close enough to watch: the report comes through.
{
  const sim = new Sim();
  sim.addShip("A", 0, -50000, 0); // 50 km: well inside SENSOR_BASE_M, clear LOS
  const b = sim.addShip("B", 0, 0, 180, false);
  b.pdcPosture = "free";
  plantMissile(sim, "A", 0, -6000, 20, 0);
  let heardA: string[] = [];
  let killed = false;
  for (let i = 0; i < 240 && !killed; i++) {
    const ev = sim.tick();
    heardA = heardA.concat(noticesTo(ev, "A"));
    killed = !sim.missiles.some((m) => m.id >= 900);
  }
  assert(killed, "PDCs kill the missile (observed case)");
  assert(heardA.some((t) => /point defense got our missile/.test(t)), "SEEN kill: owner gets the report");
}

// 3. Missile eats a decoy far from its owner: decoy owner always learns
//    (own equipment); the shooter learns nothing (fog would hand them an
//    ID-tier fact). Near: the shooter sees the pop.
{
  const far = new Sim();
  far.addShip("A", 0, -C.SENSOR_BASE_M - 60000, 0);
  const bFar = far.addShip("B", 0, 0, 180, false);
  bFar.pdcPosture = "hold";
  far.decoys.push({ id: 500, owner: "B", x: 0, y: -12000, vx: 0, vy: 0, age: 1 });
  plantMissile(far, "A", 0, -13000, 0, 500); // northbound at the decoy
  let heardA: string[] = [];
  let heardB: string[] = [];
  let popped = false;
  for (let i = 0; i < 10 && !popped; i++) {
    const ev = far.tick();
    heardA = heardA.concat(noticesTo(ev, "A"));
    heardB = heardB.concat(noticesTo(ev, "B"));
    popped = !far.decoys.some((d) => d.id === 500);
  }
  assert(popped, "missile detonates on the decoy");
  assert(heardB.some((t) => /missile took the decoy/.test(t)), "decoy owner always learns (own equipment)");
  assert(!heardA.some((t) => /it was a decoy/.test(t)), "UNSEEN decoy kill: shooter is NOT told");

  const near = new Sim();
  near.addShip("A", 0, -50000, 0);
  const bNear = near.addShip("B", 0, 0, 180, false);
  bNear.pdcPosture = "hold";
  near.decoys.push({ id: 500, owner: "B", x: 0, y: -12000, vx: 0, vy: 0, age: 1 });
  plantMissile(near, "A", 0, -13000, 0, 500);
  let heardA2: string[] = [];
  let popped2 = false;
  for (let i = 0; i < 10 && !popped2; i++) {
    const ev = near.tick();
    heardA2 = heardA2.concat(noticesTo(ev, "A"));
    popped2 = !near.decoys.some((d) => d.id === 500);
  }
  assert(popped2 && heardA2.some((t) => /it was a decoy/.test(t)), "SEEN decoy kill: shooter is told");
}

// 4. Missile strike on the enemy ship beyond our observation: no strike
//    call to the attacker; the victim still feels it. Near: called.
{
  const far = new Sim();
  far.addShip("A", 0, -C.SENSOR_BASE_M - 60000, 0);
  const bFar = far.addShip("B", 0, 0, 180, false);
  bFar.pdcPosture = "hold";
  plantMissile(far, "A", 0, -2000, 0, 600); // dives straight onto B
  let heardA: string[] = [];
  let heardB: string[] = [];
  for (let i = 0; i < 8; i++) {
    const ev = far.tick();
    heardA = heardA.concat(noticesTo(ev, "A"));
    heardB = heardB.concat(noticesTo(ev, "B"));
  }
  assert(bFar.hull < 100, "the strike lands");
  assert(heardB.some((t) => /Missile strike — hull at/.test(t)), "victim feels the hit");
  assert(!heardA.some((t) => /Missile strike on the enemy ship/.test(t)), "UNSEEN strike: attacker is NOT told");

  const near = new Sim();
  near.addShip("A", 0, -50000, 0);
  const bNear = near.addShip("B", 0, 0, 180, false);
  bNear.pdcPosture = "hold";
  plantMissile(near, "A", 0, -2000, 0, 600);
  let heardA2: string[] = [];
  for (let i = 0; i < 8; i++) heardA2 = heardA2.concat(noticesTo(near.tick(), "A"));
  assert(heardA2.some((t) => /Missile strike on the enemy ship/.test(t)), "SEEN strike: attacker is told");
}

// 5. spokenBearing: 10° quantization, three digit words
{
  assert(spokenBearing(331) === "three three zero", `331 -> 'three three zero' (${spokenBearing(331)})`);
  assert(spokenBearing(0) === "zero zero zero", "0 -> 'zero zero zero'");
  assert(spokenBearing(7) === "zero one zero", "7 -> 'zero one zero'");
  assert(spokenBearing(359) === "zero zero zero", "359 wraps to 'zero zero zero'");
  assert(spokenBearing(145) === "one five zero", "145 -> 'one five zero'");
}

// 6. dynamic-bearing notices carry the TTS-safe speak variant; the display
//    text keeps exact numbers
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const quietDetect = (C.SENSOR_BASE_M * C.SIG_BASE) / 100;
  sim.addShip("B", 0, quietDetect * 0.9, 180, false); // faint band, due north
  let faint: any = null;
  for (let i = 0; i < 3 && !faint; i++) {
    faint = sim.tick().find((e) => e.kind === "notice" && /Faint contact — bearing/.test((e as any).text));
  }
  assert(!!faint, "faint contact announced");
  assert(/range approximately \d+ km/.test(faint.text), "display text keeps exact range");
  assert(faint.speak === "Faint contact — bearing zero zero zero.", `speak is bearing-only digit words (${faint.speak})`);
  void a;
}

console.log("done");
