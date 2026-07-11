// v5 §2 multiplayer core: N-ship sim — per-viewer-per-target sensor state,
// per-target locks, nearest-hostile metrics, death/placements/win-check,
// team hostility, ghost ships, and the 8-ship cost sanity check.
import { Sim, type SimEvent } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

const collect = (sim: Sim, ticks: number): SimEvent[] => {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
};

// 1. per-viewer-per-target tiers are independent: A tracks B (8 km) while
// C (200 km, quiet) stays invisible — and C's view of both is its own
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 8000, 0, 0);
  const c = sim.addShip("C", 200000, 0, 0);
  for (const s of [a, c]) s.pdcPosture = "hold";
  sim.tick();
  assert(sim.contactOn("A", "B").tier >= 2, "A holds a track on B (8 km)");
  assert(sim.contactOn("A", "C").tier === 0, "A holds nothing on C (200 km, quiet)");
  assert(sim.contactOn("C", "A").tier === 0, "C sees neither (200 km)");
  const snap = sim.snapshotFor("A") as any;
  assert(snap.contacts.length === 1 && snap.contacts[0].cid === "sB", "snapshot carries exactly the earned contact, cid by ship");
  const json = JSON.stringify(snap);
  assert(!json.includes("200000"), "C's position leaks nowhere into A's snapshot");
}

// 2. nearest-hostile metrics: enemy_range reads the NEAREST tracked
// hostile; enemy_contact_tier is the best tier held on any hostile
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 8000, 0, 0); // track band
  sim.addShip("C", 12000, 0, 0); // also visible, farther
  a.pdcPosture = "hold";
  sim.tick();
  sim.enqueue("A", [{
    verb: "set_standing_order",
    params: {
      label: "close",
      condition: { metric: "enemy_range", op: "lte", value: 9000 },
      actions: [{ verb: "show_vector", params: {} }],
      repeat: false,
    },
  }]);
  const evs = collect(sim, 2);
  assert(
    evs.some((e) => e.kind === "notice" && /'close' triggered/.test((e as any).text)),
    "enemy_range metric fires on the NEAREST tracked hostile (8 km <= 9 km)"
  );
}

// 3. lock auto-picks the nearest eligible hostile and the bird flies at it
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 8000, 180); // dead ahead, nearest
  const c = sim.addShip("C", 2000, 12000, 180); // also in cone, farther
  for (const s of [a, b, c]) s.pdcPosture = "hold";
  let ticks = 0;
  while (!a.lock.has && ticks < C.LOCK_TIME_S + 3) { sim.tick(); ticks++; }
  assert(a.lock.has, "lock acquired among two candidates");
  assert(a.lock.target === "B", `lock auto-picked the nearest eligible (got ${a.lock.target})`);
  sim.enqueue("A", [{ verb: "fire_missile", params: {} }]);
  sim.tick();
  const m = (sim as any).missiles[0];
  assert(m.guidance === "uplinked" && m.target === "B", "bird uplinks on the locked ship, not just 'the enemy'");
}

// 4. painted is ANY-source: C painting A trips A's RWR even though B is idle
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, -60000, 0); // far, irrelevant
  const c = sim.addShip("C", 0, 8000, 180); // close, nose-on to A
  for (const s of [a, b, c]) s.pdcPosture = "hold";
  sim.tick(); sim.tick();
  assert(c.lock.target === "A" && c.lock.progress > 0, "C is building a lock on A");
  assert(sim.paintedState(a) !== "none", "A feels ANY hostile's paint");
}

// 5. death and placements: 3-ship FFA — first kill keeps the match running,
// the second ends it with winner + placements
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 500, 0);
  const c = sim.addShip("C", 100000, 0, 0);
  for (const s of [a, b, c]) s.pdcPosture = "hold";
  b.hull = 1;
  const evs1: SimEvent[] = [];
  (sim as any).damageShip(b, 10, "missile", evs1, "A");
  assert(evs1.some((e) => e.kind === "death" && e.ship === "B" && (e as any).attacker === "A"), "death event carries the victim and attacker");
  assert(!evs1.some((e) => e.kind === "gameover"), "no gameover with two hostiles still alive");
  assert(!sim.ships.has("B"), "dead ship leaves the board");
  sim.tick();
  const snapA = sim.snapshotFor("A") as any;
  assert(!snapA.contacts.some((k: any) => k.cid === "sB") && (snapA.ghosts ?? []).length === 0, "no contact or ghost lingers for the dead ship");
  c.hull = 1;
  const evs2: SimEvent[] = [];
  (sim as any).damageShip(c, 10, "missile", evs2, "A");
  const over = evs2.find((e) => e.kind === "gameover") as any;
  assert(!!over && over.winner === "A", "last ship alive wins the FFA");
  assert(Array.isArray(over.placements) && over.placements[0] === "A" && over.placements[1] === "C" && over.placements[2] === "B",
    `placements winner-first, then reverse death order (got ${over?.placements})`);
}

// 6. teams: teammates are not hostile (no contact state, no lock pick);
// last team with a ship alive wins under the same rule
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0, false, "red");
  const b = sim.addShip("B", 0, 8000, 0, false, "red");
  const c = sim.addShip("C", 0, 16000, 180, false, "blue");
  for (const s of [a, b, c]) s.pdcPosture = "hold";
  sim.tick(); sim.tick();
  assert(sim.contactOn("A", "B").tier === 0 && a.lock.target !== "B", "teammate is never a contact or a lock subject");
  assert(sim.hostilesOf(a).length === 1 && sim.hostilesOf(a)[0].id === "C", "hostiles exclude teammates");
  c.hull = 1;
  const evs: SimEvent[] = [];
  (sim as any).damageShip(c, 10, "missile", evs, "B");
  const over = evs.find((e) => e.kind === "gameover") as any;
  assert(!!over && over.winner === "red", `team name wins in Teams mode (got ${over?.winner})`);
}

// 7. ghost ships: thrust forced to 0, standing orders suspended, quiet
// scuttle after DISCONNECT_FORFEIT_S — no notice to anyone, but the match
// ends (that part IS public)
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 8000, 180);
  for (const s of [a, b]) s.pdcPosture = "hold";
  sim.enqueue("B", [
    { verb: "set_thrust", params: { percent: 100 } },
    { verb: "set_standing_order", params: {
        label: "tripwire",
        condition: { metric: "own_speed", op: "gte", value: 0 }, // always true
        actions: [{ verb: "show_vector", params: {} }],
        repeat: true,
    } },
  ]);
  sim.tick();
  sim.setGhost("B", true);
  assert(b.thrust === 0 && b.ghost, "ghost: thrust cut, flag set");
  const evs = collect(sim, C.DISCONNECT_FORFEIT_S + 1);
  assert(!evs.some((e) => e.kind === "notice" && e.ship === "B" && /tripwire/.test((e as any).text)),
    "standing orders suspended while ghosted");
  assert(evs.some((e) => e.kind === "scuttle" && e.ship === "B"), "ghost scuttles after the forfeit timer");
  assert(!evs.some((e) => e.kind === "death"), "a scuttle is not a death event");
  assert(!evs.some((e) => e.kind === "notice" && /scuttle/i.test((e as any).text)), "nobody is told about the scuttle");
  const over = evs.find((e) => e.kind === "gameover") as any;
  assert(!!over && over.winner === "A", "the survivor wins when the ghost scuttles");
  // reconnect path sanity on a fresh sim: ghost off restores command
  const sim2 = new Sim();
  sim2.addShip("A", 0, 0, 0);
  const b2 = sim2.addShip("B", 0, 8000, 180);
  sim2.setGhost("B", true);
  sim2.setGhost("B", false);
  sim2.enqueue("B", [{ verb: "set_thrust", params: { percent: 50 } }]);
  sim2.tick();
  assert(!b2.ghost && b2.thrust === 50, "reconnect: ghost off, commands work again");
}

// 8. seekers and PDCs in a crowd: an autonomous bird may grab ANY ship;
// PDC ship-fire engages the nearest hostile hull only
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 30000, 180);
  const c = sim.addShip("C", 3000, 20000, 180);
  for (const s of [a, b, c]) s.pdcPosture = "hold";
  c.thrust = 100; // louder and closer: the seeker's pick
  sim.enqueue("A", [{ verb: "fire_missile", params: { guidance: "bearing" } }]);
  for (let i = 0; i < 4; i++) sim.tick();
  const m = (sim as any).missiles[0];
  assert(m.lock?.type === "ship" && m.lock.id === "C", `blind bird grabs the strongest signature in cone (got ${JSON.stringify(m.lock)})`);
}

// 9. cost sanity at the player cap: 8 ships, live sensors and hearing,
// 60 sim-seconds well under a real-time budget
{
  const sim = new Sim();
  for (let i = 0; i < 8; i++) {
    const ang = (Math.PI * 2 * i) / 8;
    const s = sim.addShip(`S${i}`, Math.cos(ang) * 60000, Math.sin(ang) * 60000, 0);
    s.thrust = 50;
  }
  const t0 = performance.now();
  for (let i = 0; i < 60; i++) sim.tick();
  const ms = performance.now() - t0;
  assert(ms < 3000, `8-ship sim: 60 s of game time in ${ms.toFixed(0)} ms (real-time budget 60000 ms)`);
  console.log(`ok: 8-ship profile: ${(ms / 60).toFixed(2)} ms per tick`);
}

console.log("done: multiship");
