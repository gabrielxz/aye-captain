// v5 §3: callsigns & per-observer contact designations. Letters in
// acquisition order across ships AND decoys (one book), the identification
// event, the correlate window, fog rules (callsigns only at/after ID),
// contact-ref targeting, and explicit lock designation.
import { Sim, type SimEvent } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};
const texts = (evs: SimEvent[], ship: string) =>
  evs.filter((e) => e.kind === "notice" && e.ship === ship).map((e) => (e as any).text as string);

// 1. acquisition order letters, shared book: ship first (Alpha), then a
// decoy contact (Bravo) — same ceremony for both (fog law)
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 80000, 180, false, null, "Kestrel");
  a.pdcPosture = "hold"; b.pdcPosture = "hold";
  b.thrust = 60; // sig 90 -> detect 162 km; 80 km = frac 0.49 = TRACK band
  const ev1 = sim.tick();
  assert(
    texts(ev1, "A").some((t) => /New contact — designating Alpha/.test(t)),
    "first contact takes Alpha"
  );
  // a decoy pops next to B: second contact, next letter, identical wording
  sim.enqueue("B", [{ verb: "deploy_decoy", params: {} }]);
  const ev2 = [...sim.tick(), ...sim.tick()];
  assert(
    texts(ev2, "A").some((t) => /New contact — designating Bravo/.test(t)),
    "decoy contact takes the NEXT letter with the same ceremony"
  );
  const snap = sim.snapshotFor("A") as any;
  const cids = snap.contacts.map((c: any) => c.cid).sort();
  assert(cids.join(",") === "Alpha,Bravo", `snapshot cids are the letters (got ${cids})`);
  assert(!JSON.stringify(snap).includes("Kestrel"), "callsign absent from the snapshot below ID");
}

// 2. identification event: at ID tier the letter resolves to the callsign,
// once; the label switches from letter to callsign afterward
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 30000, 180, false, null, "Kestrel");
  a.pdcPosture = "hold"; b.pdcPosture = "hold";
  sim.tick(); // faint/track acquisition at some tier
  b.y = 6000; // well inside ID band for a quiet ship (~8 km)
  const ev = sim.tick();
  assert(
    texts(ev, "A").some((t) => /Close-range ID on Contact Alpha: it's Kestrel\./.test(t)),
    "identification is an event naming letter and callsign"
  );
  const snap = sim.snapshotFor("A") as any;
  assert(snap.contacts[0].label === "Kestrel", "HUD label is the callsign after ID");
  assert(snap.contacts[0].cid === "Alpha", "cid stays the letter (client interpolation key)");
  // and the summary names it for the translator
  assert(/Kestrel \(identified/.test(sim.stateSummaryFor("A")), "contact table names the identified callsign");
}

// 3. correlate window: reacquired quickly = same letter ("is back");
// reacquired after the window = NEW letter, identification reset, and the
// old letter's fix stays as a tombstone ghost
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 8000, 180, false, null, "Kestrel");
  a.pdcPosture = "hold"; b.pdcPosture = "hold";
  sim.tick();
  b.y = 200000; // vanish
  sim.tick();
  b.y = 8000; // right back where it was, well inside the window
  const evBack = sim.tick();
  assert(
    texts(evBack, "A").some((t) => /is back — bearing/.test(t)),
    "quick reacquisition keeps the letter"
  );
  // vanish again, wait out the correlate window, come back
  b.y = 200000;
  sim.tick();
  for (let i = 0; i < C.CONTACT_CORRELATE_S + 2; i++) sim.tick();
  b.y = 8000;
  const evNew = sim.tick();
  assert(
    texts(evNew, "A").some((t) => /New contact — designating (?!Alpha)/.test(t)),
    "stale reacquisition opens a NEW letter"
  );
  const snap = sim.snapshotFor("A") as any;
  // This used to assert the tombstone was ON the map here. It can't be: the
  // timeout branch only fires after CONTACT_CORRELATE_S (60 s), by which
  // point the fix is long past GHOST_TTL_S (30 s) and aged off on its own
  // clock — 30+ seconds BEFORE the new letter opened. That is the invariant
  // the tombstone was protecting, met more strongly: the old letter's fix
  // did not vanish *because* a new letter appeared.
  assert(
    !(snap.ghosts ?? []).some((g: any) => g.label === "Alpha"),
    "a fix older than the ghost TTL is off the map, whatever else happens"
  );
  void a;
}

// 3b. 🔴 the leak the tombstone exists for, in the branch where it still
// bites: correlation can ALSO fail on REACH (the contact moved further than
// max speed allows) — and that can happen at any age, including seconds in.
// There the fix is young, the tombstone draws, and the old letter does NOT
// disappear in the same instant its replacement is designated.
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 8000, 180, false, null, "Kestrel");
  a.pdcPosture = "hold"; b.pdcPosture = "hold";
  sim.tick();
  b.y = 200000; // vanish
  sim.tick();
  // back after only a few seconds, but somewhere max speed cannot explain
  for (let i = 0; i < 3; i++) sim.tick();
  b.x = 9000;
  b.y = -9000;
  const evNew = sim.tick();
  assert(
    texts(evNew, "A").some((t) => /New contact — designating (?!Alpha)/.test(t)),
    "an implausible reacquisition opens a NEW letter (reach, not timeout)"
  );
  const snap = sim.snapshotFor("A") as any;
  assert(
    (snap.ghosts ?? []).some((g: any) => g.label === "Alpha"),
    "🔴 the young tombstone still draws — deleting it would say both letters are one hull"
  );
  void a;
}

// 3c. the TTL is age-driven and nothing else: a ghost nobody reacquires
// still leaves, on its own clock. (The map used to accrete these forever —
// tombstones were push-only and an unobserved death was unclearable.)
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 8000, 180, false, null, "Kestrel");
  a.pdcPosture = "hold"; b.pdcPosture = "hold";
  sim.tick();
  b.y = 200000; // gone, and never coming back
  sim.tick();
  const before = sim.snapshotFor("A") as any;
  assert((before.ghosts ?? []).length === 1, "the fix is on the map while it is fresh");
  for (let i = 0; i < C.GHOST_TTL_S + 2; i++) sim.tick();
  const after = sim.snapshotFor("A") as any;
  assert((after.ghosts ?? []).length === 0, `and gone once it is stale (got ${(after.ghosts ?? []).length})`);
  void a;
}

// 4. contact refs: point at a letter; identified callsigns resolve;
// unknown names and unearned callsigns are rejected
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 8000, 0, 90, false, null, "Kestrel"); // due east, ID band
  a.pdcPosture = "hold"; b.pdcPosture = "hold";
  sim.tick(); // Alpha designated (and identified at this range)
  sim.enqueue("A", [{ verb: "set_heading", params: { mode: "target", target: "Alpha" } }]);
  for (let i = 0; i < 6; i++) sim.tick();
  assert(Math.round(a.facing) === 90, `"point at Alpha" steers by the designation (facing ${a.facing.toFixed(0)})`);
  sim.enqueue("A", [{ verb: "set_heading", params: { mode: "target", target: "Kestrel" } }]);
  const evCallsign = sim.tick();
  assert(!evCallsign.some((e) => e.kind === "reject"), "identified callsign is a valid target");
  sim.enqueue("A", [{ verb: "set_heading", params: { mode: "target", target: "Vagrant" } }]);
  const evUnknown = sim.tick();
  assert(
    evUnknown.some((e) => e.kind === "reject" && /No contact by that name/.test((e as any).reason)),
    "a name not on the board is rejected"
  );
}

// 4b. an UNIDENTIFIED callsign never resolves (fog: you haven't earned it)
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 40000, 180, false, null, "Kestrel"); // track band at most
  a.pdcPosture = "hold";
  sim.tick();
  sim.enqueue("A", [{ verb: "set_heading", params: { mode: "target", target: "Kestrel" } }]);
  const ev = sim.tick();
  assert(
    ev.some((e) => e.kind === "reject" && /No contact by that name/.test((e as any).reason)),
    "an unearned callsign does not resolve (no leak)"
  );
}

// 5. set_lock_target: explicit designation overrides the nearest auto-pick
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 8000, 180); // nearest, dead ahead — auto-pick bait
  const c = sim.addShip("C", 2000, 12000, 180); // farther, in cone: "Bravo"
  for (const s of [a, b, c]) s.pdcPosture = "hold";
  sim.tick(); // both designated: B=Alpha (nearer... acquisition order by hostiles iteration), C next
  // find C's letter from A's table
  const summary = sim.stateSummaryFor("A");
  const letterOfC = sim.resolveContactRef("A", "Alpha") === "sC" ? "Alpha" : "Bravo";
  sim.enqueue("A", [{ verb: "set_lock_target", params: { contact: letterOfC } }]);
  sim.tick();
  let ticks = 0;
  while (!a.lock.has && ticks < C.LOCK_TIME_S + 3) { sim.tick(); ticks++; }
  assert(a.lock.has && a.lock.target === "C", `designated lock built on C, not the nearer B (target ${a.lock.target})`);
  void summary;
}

// 6. designating an unresolved DECOY contact is accepted and the lock
// simply never completes (rejecting would unmask the decoy)
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 30000, 180);
  a.pdcPosture = "hold"; b.pdcPosture = "hold";
  sim.enqueue("B", [{ verb: "deploy_decoy", params: {} }]);
  sim.tick(); sim.tick();
  // find the decoy's letter in A's book
  const key = ["Alpha", "Bravo"].find((L) => sim.resolveContactRef("A", L)?.startsWith("d"));
  assert(!!key, `a decoy contact holds a letter (${key})`);
  const evs: SimEvent[] = [];
  sim.enqueue("A", [{ verb: "set_lock_target", params: { contact: key! } }]);
  evs.push(...sim.tick());
  assert(!evs.some((e) => e.kind === "reject"), "designating the decoy contact is NOT rejected (fog)");
  for (let i = 0; i < C.LOCK_TIME_S + 5; i++) sim.tick();
  assert(!a.lock.has && a.lock.progress === 0, "a lock on a decoy contact never completes");
}

// 7. multi-hostile RWR names the bearing of the painter
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, -60000, 0); // second hostile, far
  const c = sim.addShip("C", 8000, 0, 270); // due east, nose-on to A
  for (const s of [a, b, c]) s.pdcPosture = "hold";
  const evs = [...sim.tick(), ...sim.tick()];
  assert(
    texts(evs, "A").some((t) => /being painted — bearing 090/.test(t)),
    "painted warning names the painter's bearing when sources are ambiguous"
  );
}

console.log("done: designation");
