// v5.1 §3: FFA announcement scaling. The rumble budget is GLOBAL (one
// aggregated line per window, max 3 bearings — regression-pins the
// per-emitter bug that produced a line every 2 s at N=6), and contact
// ceremony speaks only when the change is a THREAT (range bar scaled by
// board size, lock trumps range, only-contact always speaks). Gated lines
// still hit the transcript: notices carry silent:true, never disappear.
import { Sim, contactAnnounceRange } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

const rumbleLines = (evs: any[]) =>
  evs.filter((e) => e.kind === "notice" && e.ship === "A" && /rumble|drives out there/i.test(e.text));

// 1. §3.4 terseness scaling (the handoff's own spec points)
{
  assert(contactAnnounceRange(1) === 60000, "contactAnnounceRange(1) = 60 km");
  assert(contactAnnounceRange(2) === 30000, "contactAnnounceRange(2) = 30 km");
  assert(contactAnnounceRange(3) === 20000, "contactAnnounceRange(3) = 20 km (floor)");
  assert(contactAnnounceRange(6) === 20000, "contactAnnounceRange(6) = 20 km (floored)");
}

// 2. §3.1-3.2 rumble budget: five emitters, coasting so bearings drift —
//    at most ONE line per window, aggregated, max 3 bearings
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  a.pdcPosture = "hold";
  // five emitters on a 100 km ring: outside detection (~54 km at sig 30),
  // inside hearing (~135 km). Tangential coast drifts their bearings.
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * 2 * Math.PI;
    const s = sim.addShip(`ship${i}` as any, Math.sin(ang) * 100000, Math.cos(ang) * 100000, 0, false);
    s.pdcPosture = "hold";
    s.vx = Math.cos(ang) * 2000; // perpendicular to the bearing from A
    s.vy = -Math.sin(ang) * 2000;
  }
  const first = rumbleLines(sim.tick());
  assert(first.length === 1, `tick 1: exactly one rumble line (got ${first.length})`);
  assert(/^Five drives out there, Captain/.test(first[0]?.text ?? ""), `aggregated count line (got "${first[0]?.text}")`);
  const bearingsNamed = (first[0]?.text.match(/\d{3}/g) ?? []).length;
  assert(bearingsNamed <= C.RUMBLE_ANNOUNCE_MAX_BEARINGS, `names at most ${C.RUMBLE_ANNOUNCE_MAX_BEARINGS} bearings (got ${bearingsNamed})`);
  assert(/loudest bearings/i.test(first[0]?.text ?? ""), "over-cap picture says 'loudest'");

  // the window: even with five drifting emitters, silence until it reopens
  let during = 0;
  for (let t = 0; t < C.RUMBLE_ANNOUNCE_COOLDOWN_S - 2; t++) during += rumbleLines(sim.tick()).length;
  assert(during === 0, `no rumble lines inside the ${C.RUMBLE_ANNOUNCE_COOLDOWN_S}s window (got ${during})`);
  let after = 0;
  for (let t = 0; t < 5; t++) after += rumbleLines(sim.tick()).length;
  assert(after === 1, `exactly one aggregated line when the window reopens (got ${after})`);
}

// 3. §3.3 relevance: a new contact at ~50 km with a busy board is
//    transcript-only; at 15 km it speaks; the only contact always speaks
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  a.pdcPosture = "hold";
  // 5 hostiles inside detection (54 km) => busy board, bar floors at 20 km
  const hostiles: any[] = [];
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * 2 * Math.PI + 0.3;
    const s = sim.addShip(`ship${i}` as any, Math.sin(ang) * 45000, Math.cos(ang) * 45000, 0, false);
    s.pdcPosture = "hold";
    hostiles.push(s);
  }
  // parked far away for now: joins the board later
  const late = sim.addShip("late" as any, 0, 220000, 180, false);
  late.pdcPosture = "hold";

  const evs1 = sim.tick();
  const newLines = evs1.filter((e: any) => e.ship === "A" && /New contact/.test(e.text ?? ""));
  assert(newLines.length === 5, `busy board designates all five (got ${newLines.length})`);
  assert(newLines.every((e: any) => e.silent === true), "45 km contacts on a 5-strong board are transcript-only");

  // the late ship warps to 15 km — inside the floored 20 km bar
  late.x = 0;
  late.y = 15000;
  const evs2 = sim.tick();
  const closeLine = evs2.find((e: any) => e.ship === "A" && /New contact/.test(e.text ?? ""));
  assert(!!closeLine && closeLine.silent !== true, "a 15 km contact SPEAKS even on a busy board");

  // lock trumps range: hostile 0 (at 45 km) fades while holding a lock on us
  const locker = hostiles[0];
  locker.lock.target = "A";
  locker.lock.has = true;
  locker.x = Math.sin(0.3) * 200000; // drops off the sensors
  locker.y = Math.cos(0.3) * 200000;
  const evs3 = sim.tick();
  const lostLocked = evs3.find(
    (e: any) => e.ship === "A" && /Track lost|faded/.test(e.text ?? "") && e.silent !== true
  );
  assert(!!lostLocked, "losing a contact that HOLDS A LOCK ON US speaks, wherever it happened");
}

// 4. the only contact on the board always speaks, even far out
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  a.pdcPosture = "hold";
  const b = sim.addShip("B", 0, 50000, 180, false);
  b.pdcPosture = "hold";
  const evs = sim.tick();
  const line = evs.find((e: any) => e.ship === "A" && /New contact/.test(e.text ?? ""));
  assert(!!line && line.silent !== true, "a lone 50 km contact speaks (only contact on the board)");
}
console.log("done");
