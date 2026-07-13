// Campaign Patch 2 "Two Ships" (HANDOFF-CAMPAIGN-COOP.md): the co-op room
// lifecycle, the two-captain mission sim, and the patch's central fog
// invariant — 🔴 NO DATALINK: a teammate's snapshot carries their position,
// velocity, hull, propellant, and signature, and NEVER their contacts,
// rumbles, or ghost. Every piece of sensor intelligence moves by talking.
import { Sim, dist, type Mission, type SimEvent } from "../server/sim.js";
import { Match } from "../server/match.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

// A hand-built two-captain mission sim (empty terrain: exact fields).
const coopSim = (
  aPos: [number, number],
  bPos: [number, number],
  over: Partial<Mission> = {}
): Sim => {
  const sim = new Sim();
  sim.addShip("A", aPos[0], aPos[1], 0, false, "blue", C.CALLSIGN_POOL[0]);
  sim.addShip("B", bPos[0], bPos[1], 0, false, "blue", C.CALLSIGN_POOL[1]);
  sim.mission = {
    playerIds: ["A", "B"],
    system: 2,
    systemName: "Sharp Ears",
    gate: { x: 0, y: C.REGION_RADIUS_M, apertureW: C.APERTURE_W_M },
    hunterSpawnS: C.CAMPAIGN_HUNTER_SPAWN_S,
    hunterSpawned: false,
    hunterIds: [],
    hunters: [{ archetype: "corvette", sensorMult: C.HUNTER_SENSOR_MULT, sigMult: C.HUNTER_SIG_MULT, gateCamp: false }],
    spawnLine: "Clock's run out, Captain — a drive just lit off in-system.",
    wrecks: [],
    salvaging: {},
    cleared: false,
    stats: { huntersKilled: 0, salvaged: 0, pingsFired: 0, upgrades: 0 },
    haul: [],
    decoyTaught: false,
    upgradeCounts: { sig: 0, sensor: 0, accel: 0, hull: 0 },
    solGood: {},
    solCooldownS: {},
    gateCloseS: null,
    gateCloseCalled: 0,
    pylonIdx: null,
    ...over,
  };
  return sim;
};

const fakeWs = () => {
  const ws = { sent: [] as any[], readyState: 1, OPEN: 1, send(s: string) { ws.sent.push(JSON.parse(s)); } };
  return ws;
};

// 1. 🔴 THE CENTRAL INVARIANT — no datalink. A holds no contact on a hostile
// that B tracks; A's snapshot shows B on transponder (full state) and
// NOTHING of B's sensor picture.
{
  // A far west; B at center; hostile 20 km east of B (inside B's detection,
  // ~180 km from A — beyond A's detection AND the 2.5× hearing band for an
  // idle sig-30 hull)
  const sim = coopSim([-160000, 0], [0, 0]);
  const h = sim.addShip("H", 20000, 0, 270);
  h.thrust = 0;
  sim.tick();
  const snapA = sim.snapshotFor("A") as any;
  const snapB = sim.snapshotFor("B") as any;
  assert(snapB.contacts.length === 1, "B's own sensors hold the hostile (setup is real)");
  assert(snapA.contacts.length === 0, "🔴 NO DATALINK: A gets none of B's contacts");
  assert((snapA.rumbles ?? []).length === 0, "🔴 NO DATALINK: A gets none of B's hearing");
  assert(snapA.ghost === null, "🔴 NO DATALINK: no ghost either");
  const ally = (snapA.allies ?? []).find((t: any) => t.id === "B");
  assert(!!ally, "the teammate rides the transponder — always on the board");
  for (const k of ["x", "y", "vx", "vy", "hull", "callsign"]) {
    assert(k in ally, `transponder carries ${k}`);
  }
  for (const k of ["contacts", "rumbles", "ghost", "lock", "ping"]) {
    assert(!(k in ally), `transponder NEVER carries ${k} — intel moves by talking`);
  }
  // the hostile sees two separate ships, no linkage
  const snapH = sim.snapshotFor("H") as any;
  assert((snapH.allies ?? []).length === 0, "the hostile has no transponder friends");
}

// 2. Both captains get the mission picture (clock, wrecks, gate) — fixed
// public geometry, not sensor intel.
{
  const sim = coopSim([-160000, 0], [0, 0]);
  sim.mission!.wrecks.push({ id: 1, letter: "A", x: 50000, y: 0, marked: true, checked: false, items: [{ kind: "pdc_ammo", amount: 10 }] });
  sim.tick();
  for (const id of ["A", "B"]) {
    const snap = sim.snapshotFor(id) as any;
    assert(!!snap.you.mission && snap.you.mission.systemName === "Sharp Ears", `${id} carries the mission block`);
    assert((snap.wrecks ?? []).length === 1, `${id} sees the shared wreck board`);
  }
}

// 3. Two transfers at once: each captain strips their own wreck on their
// own clock (per-captain salvaging state).
{
  const sim = coopSim([-60000, 0], [60000, 0]);
  sim.mission!.wrecks.push(
    { id: 1, letter: "A", x: -60000, y: 500, marked: true, checked: false, items: [{ kind: "pdc_ammo", amount: 10 }] },
    { id: 2, letter: "B", x: 60000, y: 500, marked: true, checked: false, items: [{ kind: "decoys", amount: 2 }] }
  );
  sim.enqueue("A", [{ verb: "salvage", params: { target: "A" } } as any]);
  sim.enqueue("B", [{ verb: "salvage", params: { target: "B" } } as any]);
  for (let t = 0; t < C.SALVAGE_ITEM_S + 6; t++) sim.tick();
  assert(sim.mission!.stats.salvaged === 2, "two simultaneous transfers both land items");
  assert(sim.mission!.wrecks.every((w) => w.items.length === 0), "both wrecks stripped in parallel");
}

// 4. Hunter spawn: the no-pop-in hard floor holds against EVERY captain's
// live sensors (each ship's own detection range).
{
  const sim = coopSim([-160000, 0], [80000, 80000], { hunterSpawnS: 3 });
  for (let t = 0; t < 3; t++) sim.tick();
  const h = sim.ships.get("H");
  assert(!!h, "Hunter spawns on the clock with two captains on the board");
  const stats = C.ARCHETYPES.corvette;
  const hunterSig = (stats.sigBase + C.HUNTER_HUNT_THROTTLE) * C.HUNTER_SIG_MULT;
  for (const id of ["A", "B"]) {
    const p = sim.ships.get(id)!;
    const floor = sim.detectionRange(hunterSig, p) * C.HUNTER_SPAWN_DETECT_MARGIN;
    assert(dist(h!.x, h!.y, p.x, p.y) >= floor, `spawn clears ${id}'s detection floor — no pop-in on either board`);
  }
  const evSpawnTick = sim.snapshotFor("B") as any;
  assert(evSpawnTick.contacts.length === 0, "spawn tick shows zero contacts on the second board too");
}

// 5. The quiet + destabilizing lines fire ONCE, to both captains, on the
// arming transition — a later death re-entering checkVictory is silent.
{
  const sim = coopSim([-160000, 0], [0, 0], { hunterSpawned: true, hunterIds: ["H"] });
  const h = sim.addShip("H", 100000, 0, 270);
  (h as any).hunterAI = true;
  const events: SimEvent[] = [];
  (sim as any).damageShip(h, 9999, "missile", events, "B");
  const quiet = events.filter((e) => e.kind === "notice" && /gone quiet/.test((e as any).text));
  const closing = events.filter((e) => e.kind === "notice" && /destabilizing/.test((e as any).text));
  assert(quiet.length === 2 && closing.length === 2, "quiet + gate lines reach BOTH captains");
  assert(new Set(quiet.map((e: any) => e.ship)).size === 2, "one each — not a double to one board");
  assert(sim.mission!.gateCloseS === 0, "the last kill arms the gate");
  const ev2: SimEvent[] = [];
  (sim as any).scuttleShip(sim.ships.get("A")!, ev2);
  assert(!ev2.some((e) => e.kind === "notice" && /gone quiet/.test((e as any).text)), "a later player death does NOT re-announce the quiet");
}

// 6. Match level: the co-op room lifecycle — create, cap at two, join,
// launch; crew spawns team-spaced on a shared transponder team.
{
  const wsA = fakeWs();
  const wsB = fakeWs();
  const wsC = fakeWs();
  const match = Match.createRoom("COOP", wsA as any, "Gabe", true);
  assert(wsA.sent.some((m) => m.type === "created" && m.coop === true), "created message carries the coop flag");
  assert(wsA.sent.some((m) => m.type === "lobby" && m.campaign === true && m.maxPlayers === 2), "lobby broadcast: campaign room, two seats");
  assert(match.launch(wsA as any) !== null, "cannot launch a co-op run alone");
  assert(match.joinOrReconnect(wsB as any, "Friend") === null, "partner joins with the code");
  assert(match.joinOrReconnect(wsC as any) !== null, "a third captain is refused — two ships, §10");
  match.setMode(wsA as any, "teams");
  match.setArchetype(wsA as any, "cruiser");
  match.setArchetype(wsB as any, "corvette");
  assert(match.launch(wsB as any) !== null, "only the creator launches");
  assert(match.launch(wsA as any) === null, "creator launches the run");
  match.stop(); // deterministic from here

  const sim = match.sim;
  assert(!!sim.mission && sim.mission.playerIds.length === 2, "mission knows both captains");
  const a = sim.ships.get("A")!;
  const b = sim.ships.get("B")!;
  assert(a.archetype === "cruiser" && b.archetype === "corvette", "lobby hull picks fly — complementary builds");
  assert(a.team === "blue" && b.team === "blue", "the crew shares a transponder team");
  assert(a.callsign !== b.callsign && C.CALLSIGN_POOL.includes(a.callsign) && C.CALLSIGN_POOL.includes(b.callsign), "two callsigns from the pool");
  const spacing = dist(a.x, a.y, b.x, b.y);
  assert(spacing > C.TEAM_SPAWN_SPACING_M * 0.85 && spacing < C.TEAM_SPAWN_SPACING_M * 1.15, `crew spawns team-spaced (${Math.round(spacing / 1000)} km)`);
  const startB = wsB.sent.find((m) => m.type === "start");
  assert(!!startB && startB.campaign === true && startB.coop === true && !!startB.gate, "partner's start: campaign + coop + gate geometry");
  const startPylons = (startB.terrain.rocks as any[]).filter((r) => r.r === C.GATE_PYLON_RADIUS_M);
  assert(startPylons.length === 2, "pylons travel with the co-op terrain too");

  // 7. transition: both ships cross; system_clear reaches BOTH seats with
  // NO runState (the run lives in the Match — §7); consumables attrit
  // per hull, propellant refills (1.1 §6)
  b.decoys = 1; // spend the corvette's decoys down: 1 of base
  const g = sim.mission!.gate;
  const R = Math.hypot(g.x, g.y);
  const ux = g.x / R;
  const uy = g.y / R;
  for (const s of [a, b]) {
    s.x = g.x - ux * 400 + (s === a ? 0 : -uy * 900);
    s.y = g.y - uy * 400 + (s === a ? 0 : ux * 900);
    s.vx = ux * 3000;
    s.vy = uy * 3000;
  }
  for (let i = 0; i < 40 && !sim.mission!.cleared; i++) (match as any).physicsStep();
  const clearA = wsA.sent.find((m) => m.type === "system_clear");
  const clearB = wsB.sent.find((m) => m.type === "system_clear");
  assert(!!clearA && !!clearB, "system_clear reaches BOTH captains");
  assert(clearA.runState === undefined, "co-op system_clear carries no runState — the server owns the run");

  match.nextSystem(wsA as any, undefined);
  match.stop();
  const m2 = match.sim.mission!;
  assert(m2.system === 2 && m2.playerIds.length === 2, "either captain's click advances the crew");
  const a2 = match.sim.ships.get("A")!;
  const b2 = match.sim.ships.get("B")!;
  assert(a2.archetype === "cruiser" && b2.archetype === "corvette", "same hulls next system");
  assert(b2.decoys === 1, "consumables attrit PER HULL across the jump (corvette's spent decoys stay spent)");
  assert(a2.propellant === C.PROPELLANT_MAX && b2.propellant === C.PROPELLANT_MAX, "propellant refills per jump (1.1 §6)");
  assert(a2.team === "blue" && b2.team === "blue", "still a crew in system two");
  match.destroy();
}

// 8. Solo campaign is UNCHANGED: same spawn point, same callsign, no team.
{
  const ws = fakeWs();
  const match = Match.createCampaign(ws as any, "frigate");
  match.stop();
  const a = match.sim.ships.get("A")!;
  assert(Math.abs(a.x) < 1 && Math.abs(a.y + C.SPAWN_RING_RADIUS_M) < 1 && a.facing === 0, "solo spawns exactly on the classic south point");
  assert(a.team === null, "solo captain has no team — nothing about the wire changes");
  assert(a.callsign === C.CALLSIGN_POOL[0], "solo callsign unchanged");
  assert(match.sim.mission!.playerIds.length === 1, "solo is the one-element case");
  const start = ws.sent.find((m) => m.type === "start");
  assert(start.coop === false, "solo start: coop false");
  match.destroy();
}

console.log("done: coop");
