// HANDOFF-v4.1: blind fire, uplinked/autonomous guidance, seeker detection
// math, sensor-slaved PDCs, decoy contact deception.
import { Sim, type Ship, norm360, angDiff } from "../server/sim.js";
import { validateCommand } from "../server/translator.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};
const grantLock = (ship: Ship) => {
  ship.lock = { progress: C.LOCK_TIME_S, has: true, grace: C.LOCK_GRACE_S };
};

// 1. blind fire: no lock needed, steers onto the commanded bearing,
// distinct launch line; plain fire without lock still rejects (offering it)
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0); // facing north, NO lock
  sim.addShip("B", 0, 200000, 180, false);
  sim.enqueue("A", [{ verb: "fire_missile", params: {} }]);
  let ev = sim.tick();
  assert(
    ev.some((e) => e.kind === "reject" && /No lock, Captain — I can fire blind/.test((e as any).reason)),
    "lockless plain fire rejected, offering blind fire"
  );
  sim.enqueue("A", [{ verb: "fire_missile", params: { guidance: "bearing", bearing_degrees: 220 } }]);
  ev = sim.tick();
  assert(ev.some((e) => e.kind === "notice" && /Bird away, running blind/.test((e as any).text)), "blind launch line");
  const m = (sim as any).missiles[0];
  assert(m.guidance === "autonomous" && m.cmdBearing === 220, "autonomous from birth with commanded bearing");
  for (let i = 0; i < 12; i++) sim.tick();
  assert(Math.abs(angDiff(m.course, 220)) < 1, `steers itself onto bearing 220 (course ${m.course.toFixed(1)})`);

  // bearing omitted = straight out the nose
  const sim2 = new Sim();
  const a2 = sim2.addShip("A", 0, 0, 135);
  sim2.addShip("B", 0, 200000, 315, false);
  sim2.enqueue("A", [{ verb: "fire_missile", params: { guidance: "bearing" } }]);
  sim2.tick();
  const m2 = (sim2 as any).missiles[0];
  assert(m2.course === 135 && m2.cmdBearing === null, "no bearing given: straight out the nose");
}

// 2. uplinked birds ignore decoys entirely and lead the target
// (geometry keeps B inside A's real lock: quiet ship track band ~9.9 km,
// 30-degree cone — the uplink must survive on genuine lock conditions)
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 8000, 90, false);
  b.thrust = 0; // quiet ship (sig 30): a decoy would ALWAYS win autonomously
  b.vx = 400; // crossing east — lead pursuit should aim ahead of it
  a.pdcPosture = "hold"; b.pdcPosture = "hold";
  grantLock(a);
  sim.enqueue("A", [{ verb: "fire_missile", params: {} }]);
  sim.tick(); sim.tick(); sim.tick();
  const m = (sim as any).missiles[0];
  assert(m.guidance === "uplinked", "locked launch is uplinked");
  sim.enqueue("B", [{ verb: "deploy_decoy", params: {} }]);
  sim.tick();
  assert(m.guidance === "uplinked" && m.lock?.type === "ship", "uplinked bird ignores the decoy (mother ship discriminates)");
  // lead: the bird's course points ahead of the target's current bearing
  const directBrg = norm360(Math.atan2(b.x - m.x, b.y - m.y) * 180 / Math.PI);
  const lead = angDiff(directBrg, m.course);
  assert(lead > 1, `intercept guidance leads the crossing target (${lead.toFixed(1)} deg ahead)`);
}

// 3. severance: lock break orphans the bird (one-way), with the XO line;
// once autonomous, the decoy seduces a quiet target's bird
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 8000, 0, false); // track band: real lock geometry
  b.thrust = 0;
  a.pdcPosture = "hold"; b.pdcPosture = "hold";
  for (let i = 0; i < C.LOCK_TIME_S + 1; i++) sim.tick();
  assert(a.lock.has, "lock acquired for real");
  sim.enqueue("A", [{ verb: "fire_missile", params: {} }]);
  sim.tick(); sim.tick();
  const m = (sim as any).missiles[0];
  assert(m.guidance === "uplinked", "bird flying uplinked");
  // break the lock: teleport B far out of cone and range
  b.x = 200000; b.y = 200000;
  let severed = false;
  for (let i = 0; i < C.LOCK_GRACE_S + 3 && !severed; i++) {
    severed = sim.tick().some((e) => e.kind === "notice" && /Uplink lost — bird is autonomous/.test((e as any).text));
  }
  assert(severed, "uplink severed when the lock broke past grace");
  assert(m.guidance === "autonomous", "bird is autonomous");
  // one-way: restore geometry, re-grant lock — the bird stays autonomous
  grantLock(a);
  sim.tick();
  assert(m.guidance === "autonomous", "re-acquired lock does NOT re-uplink a flying bird");
}

// 4. severance on launcher death
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 40000, 180, false);
  a.pdcPosture = "hold"; b.pdcPosture = "hold";
  grantLock(a);
  sim.enqueue("A", [{ verb: "fire_missile", params: {} }]);
  sim.tick();
  const m = (sim as any).missiles[0];
  a.hull = 0; // launcher dies (sim keeps running until a gameover event)
  sim.tick();
  assert(m.guidance === "autonomous", "dead launcher = autonomous bird");
}

// 5. seeker detection thresholds: a dark drifter is invisible to a seeker
// just beyond its dark-signature range; a full burn is not. Ranges derived
// from constants (v4.3: dark sig 30 => ~12 km, burn 130 => ~52 km).
{
  const darkSeekM = (C.MISSILE_SEEKER_BASE_M * C.SIG_BASE) / 100;
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, darkSeekM + 4000, 0, false);
  b.thrust = 0;
  a.pdcPosture = "hold"; b.pdcPosture = "hold";
  grantLock(a);
  sim.enqueue("A", [{ verb: "fire_missile", params: {} }]);
  sim.tick();
  const m = (sim as any).missiles[0];
  m.guidance = "autonomous"; // seeker-only
  sim.tick();
  assert(m.lock === null, `seeker cannot detect a dark drifter beyond ${Math.round(darkSeekM / 1000)} km (sig ${C.SIG_BASE})`);
  b.thrust = 100;
  b.propellant = C.PROPELLANT_MAX;
  sim.tick();
  assert(m.lock?.type === "ship", `the moment it burns (sig ${C.SIG_BASE + 100}), the seeker grabs it`);
}

// 6. PDCs are sensor-slaved: ordnance the ship cannot detect (dust between)
// is not engaged even inside the envelope
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  sim.terrain.dust.push({ x: 0, y: 2000, rx: 1500, ry: 800, rot: 0 }); // shadow between
  const mkMissile = () => ({
    id: 9100, owner: "B" as const, x: 0, y: 4000, prevX: 0, prevY: 4000,
    launchX: 0, launchY: 200000, // armed: launched far away
    course: 0, speed: 0, vx: 0, vy: 0, age: 10, fuel: 0, burning: false,
    guidance: "autonomous" as const, cmdBearing: null, lock: null,
  });
  (sim as any).missiles.push(mkMissile());
  for (let i = 0; i < 15; i++) sim.tick();
  assert((sim as any).missiles.length === 1, "shadowed ordnance not engaged (mount shares the sensor picture)");
  assert(a.pdcAmmoS === C.PDC_AMMO_S, "no ammo spent on what we can't see");
}

// 7. close-detection bark: ordnance first detected already inside PDC range
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  a.pdcPosture = "hold"; // isolate the bark from the engagement
  (sim as any).missiles.push({
    id: 9200, owner: "B", x: 0, y: 5000, prevX: 0, prevY: 5000,
    launchX: 0, launchY: 200000, // armed: launched far away
    course: 180, speed: 0, vx: 0, vy: 0, age: 10, fuel: 0, burning: false,
    guidance: "autonomous", cmdBearing: null, lock: null,
  });
  const ev = sim.tick();
  assert(
    ev.some((e) => e.kind === "notice" && /Ballistic inbound, close!/.test((e as any).text)),
    "urgent bark when ordnance pops up inside the envelope"
  );
}

// 8. decoy deception (v4.1 §7): an enemy decoy reads as an unlabeled contact
// at faint tier and resolves as a decoy only at ID tier
{
  const decoyDetect = C.SENSOR_BASE_M * (C.DECOY_SIGNATURE / 100); // ~148.5 km
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, decoyDetect * 0.9, 180, false); // far: decoy will be faint to A
  b.pdcPosture = "hold";
  sim.enqueue("B", [{ verb: "deploy_decoy", params: {} }]);
  sim.tick();
  let snap = sim.snapshotFor("A") as any;
  const faintContacts = snap.contacts.filter((c: any) => c.tier === 1);
  assert(faintContacts.length >= 1, "faint-tier decoy appears in contacts[]");
  const json = JSON.stringify(faintContacts);
  assert(!/decoy/i.test(json), "…and nothing in the payload says 'decoy'");
  assert(!snap.decoys.some((d: any) => !d.own), "…and it is NOT in the labeled decoys list");

  // close range: resolves as a decoy
  const sim2 = new Sim();
  sim2.addShip("A", 0, 0, 0);
  const b2 = sim2.addShip("B", 0, 20000, 180, false); // decoy at ~20 km < ID threshold (~44.6 km)
  b2.pdcPosture = "hold";
  sim2.enqueue("B", [{ verb: "deploy_decoy", params: {} }]);
  sim2.tick();
  snap = sim2.snapshotFor("A") as any;
  assert(snap.decoys.some((d: any) => !d.own), "ID-tier decoy resolves into the labeled decoys list");
  assert(!snap.contacts.some((c: any) => String(c.cid).startsWith("d")), "…and is no longer an anonymous contact");
}

// 9. validator: guidance params
{
  assert(validateCommand({ verb: "fire_missile", params: { guidance: "bearing", bearing_degrees: 220 } }) !== null, "blind fire with bearing valid");
  assert(validateCommand({ verb: "fire_missile", params: { guidance: "bearing" } }) !== null, "blind fire without bearing valid (out the nose)");
  assert(validateCommand({ verb: "fire_missile", params: { guidance: "sideways" } }) === null, "junk guidance rejected");
  assert(validateCommand({ verb: "fire_missile", params: { guidance: "bearing", bearing_degrees: "north" } }) === null, "non-numeric bearing rejected");
}

console.log("done");
