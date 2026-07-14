// Patch 3.5 — the two rings. Both are ESTIMATES AGAINST THE BOOK
// (addendum §3, MANDATORY): voice = reference SENSOR_BASE_M hearing OUR
// signature; ears = OUR suite hearing a reference SIG_BASE hull. The 🔴
// pins: neither ring ever reads another ship's stats, and the voice ring
// NEVER reacts to an undetected contact inside it — that would be a
// proximity alarm that sees through the fog, and it is exactly the kind
// of "improvement" a future session would helpfully add. Don't.
import { Sim } from "../server/sim.js";
import * as C from "../server/constants.js";
import { ringState } from "../client/rings-model.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

const crossoverUp = /They'll hear us before we hear them/;
const crossoverDown = /We hear them first again/;

// 1. the derivations: voice from own signature, ears from own suite
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.tick();
  const you = (sim.snapshotFor("A") as any).you;
  assert(
    you.rings.voiceM === Math.round(C.SENSOR_BASE_M * (sim.signatureOf(a) / 100)),
    "voiceM = reference SENSOR_BASE_M x own signature"
  );
  assert(
    you.rings.earsM === Math.round(C.ARCHETYPES.frigate.sensorBase * (C.SIG_BASE / 100)),
    "earsM = own sensorBase x reference SIG_BASE"
  );
  // the voice ring BREATHES with throttle
  a.thrust = 100;
  for (let i = 0; i < 5; i++) sim.tick();
  const hot = (sim.snapshotFor("A") as any).you.rings;
  assert(hot.voiceM > you.rings.voiceM, `voice swells under burn (${you.rings.voiceM} -> ${hot.voiceM} m)`);
  assert(hot.earsM === you.rings.earsM, "ears hold steady under burn (mostly fixed, per spec)");
}

// 2. archetype ears: the suite is the archetype's, not the book's
{
  const sim = new Sim();
  sim.addShip("C", 0, 0, 0, false, null, "C", "corvette");
  sim.addShip("K", 200000, 0, 0, false, null, "K", "cruiser");
  sim.tick();
  const cv = (sim.snapshotFor("C") as any).you.rings;
  const cr = (sim.snapshotFor("K") as any).you.rings;
  assert(cv.earsM === Math.round(C.ARCHETYPES.corvette.sensorBase * (C.SIG_BASE / 100)), "corvette ears use its 210 km suite");
  assert(cr.earsM === Math.round(C.ARCHETYPES.cruiser.sensorBase * (C.SIG_BASE / 100)), "cruiser ears use its 160 km suite");
  assert(cv.voiceM < cv.earsM, "a dark corvette hunts: voice inside ears");
  assert(cr.voiceM > cr.earsM, "a dark cruiser is prey: voice outside ears from birth");
}

// 3. campaign multipliers flow through: sensorMult grows ears, sigMult
// shrinks voice (baffles quiet you; a better suite hears farther)
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.tick();
  const base = (sim.snapshotFor("A") as any).you.rings;
  a.sensorMult = 1.5;
  a.sigMult = 0.7;
  sim.tick();
  const upgraded = (sim.snapshotFor("A") as any).you.rings;
  assert(upgraded.earsM === Math.round(base.earsM * 1.5), "sensorMult 1.5 grows ears by exactly 1.5x");
  assert(upgraded.voiceM === Math.round(C.SENSOR_BASE_M * ((sim.signatureOf(a)) / 100)) && upgraded.voiceM < base.voiceM, "sigMult shrinks the voice ring");
}

// 4. 🔴 own-stats only: nothing about the ENEMY moves either ring
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 40000, 180);
  sim.tick();
  const before = (sim.snapshotFor("A") as any).you.rings;
  b.thrust = 100; // enemy goes loud...
  b.sensorMult = 3; // ...and grows unearthly ears
  for (let i = 0; i < 3; i++) sim.tick();
  const after = (sim.snapshotFor("A") as any).you.rings;
  assert(
    after.voiceM === before.voiceM && after.earsM === before.earsM,
    "🔴 enemy stats never touch our rings — both are estimates against the book"
  );
}

// 5. 🔴 the voice ring does not react to an UNDETECTED contact inside it.
// A burning frigate's voice reaches ~234 km; a dark ship at 60 km sits
// INSIDE that voice but beyond the ~54 km faint band — the snapshot grants
// nothing, so the ring cannot go hot. The pure-function signature of
// ringState IS the guarantee: it sees only you + the fogged contacts[].
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  a.thrust = 100;
  sim.addShip("B", 0, 60000, 180); // dark, undetected, inside A's voice
  for (let i = 0; i < 5; i++) sim.tick();
  const snap = sim.snapshotFor("A") as any;
  assert(snap.contacts.length === 0, "the intruder is genuinely undetected");
  assert(snap.you.rings.voiceM > 60000, "and genuinely inside our voice ring");
  const rs = ringState(snap.you, snap.contacts)!;
  assert(rs.state !== "contact", "🔴 voice ring stays cold — no proximity alarm through the fog");
  assert(rs.state === "crossover", "burning: they hear us first (crossover state)");
}

// 6. the ring goes hot on a KNOWN contact inside the voice
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  a.thrust = 100;
  const b = sim.addShip("B", 0, 30000, 180); // inside the faint band: detected
  for (let i = 0; i < 5; i++) sim.tick();
  const snap = sim.snapshotFor("A") as any;
  assert(snap.contacts.length === 1, "contact earned through the sensors");
  const rs = ringState(snap.you, snap.contacts)!;
  assert(rs.state === "contact", "known contact inside the voice ring reads hot");
  void b;
}

// 7. crossover XO line: edge-triggered, once per transition, both directions
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  let up = 0;
  let down = 0;
  const count = (evs: any[]) => {
    for (const e of evs) {
      if (e.kind !== "notice") continue;
      if (crossoverUp.test(e.text)) up++;
      if (crossoverDown.test(e.text)) down++;
    }
  };
  count(sim.tick()); // first pass initializes silently
  assert(up === 0 && down === 0, "no crossover line at spawn (frigate starts at the book's edge)");
  a.thrust = 100;
  for (let i = 0; i < 10; i++) count(sim.tick());
  assert(up === 1, `burning past the crossover speaks EXACTLY once (got ${up})`);
  a.thrust = 0;
  for (let i = 0; i < 30; i++) count(sim.tick());
  assert(down === 1, `dropping back under speaks exactly once (got ${down})`);
  assert(up === 1, "the sustain never re-speaks (edge-triggered, not repeated)");
}

// 8. a ship that SPAWNS prey gets the tinted ring, not a spoken alarm —
// and a drone never speaks at all
{
  const sim = new Sim();
  sim.addShip("K", 0, 0, 0, false, null, "K", "cruiser"); // prey from birth
  sim.addShip("D", 0, 220000, 0, true); // drone
  let lines = 0;
  for (let i = 0; i < 5; i++) {
    for (const e of sim.tick() as any[]) {
      if (e.kind === "notice" && (crossoverUp.test(e.text) || crossoverDown.test(e.text))) lines++;
    }
  }
  assert(lines === 0, "spawn-state prey is initialized silently; drones exempt");
}

// 9. fog: our rings ride only OUR snapshot — the enemy's view of us
// carries nothing of them
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  a.thrust = 100; // loud enough for B to hold a contact
  sim.addShip("B", 0, 50000, 180);
  for (let i = 0; i < 5; i++) sim.tick();
  const bSnap = sim.snapshotFor("B") as any;
  assert(bSnap.contacts.length >= 1, "B holds the contact");
  assert(!JSON.stringify(bSnap.contacts).includes("rings"), "🔴 no rings data on anyone else's contacts");
}

// 10. the client model is defensive: no rings field -> no ring state
{
  assert(ringState({ x: 0, y: 0 } as any, []) === null, "pre-3.5 snapshot shape degrades to null");
  assert(ringState(undefined as any, undefined as any) === null, "missing you degrades to null");
}

console.log("done: rings");
