// Campaign Patch 2 "Two Ships" (HANDOFF-CAMPAIGN-COOP.md): the co-op room
// lifecycle, the two-captain mission sim, and the patch's central fog
// invariant — 🔴 NO DATALINK: a teammate's snapshot carries their position,
// velocity, hull, propellant, and signature, and NEVER their contacts,
// rumbles, or ghost. Every piece of sensor intelligence moves by talking.
import { Sim, dist, missilesAboard, type Mission, type SimEvent } from "../server/sim.js";
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
    stats: { huntersKilled: 0, salvaged: 0, pingsFired: 0, modules: 0 },
    haul: [],
    decoyTaught: false,
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

// ---------- §3: the teammate strip + the XO loudness read ----------

// 9. Transponders carry propellant + SIGNATURE (the strip's critical
// field) — and sig is the LIVE emitted signature, not a stat.
{
  const sim = coopSim([-160000, 0], [0, 0]);
  const b = sim.ships.get("B")!;
  b.thrust = 100;
  sim.tick();
  const ally = ((sim.snapshotFor("A") as any).allies as any[]).find((t) => t.id === "B");
  assert(typeof ally.propellant === "number", "transponder carries propellant");
  assert(Math.abs(ally.sig - Math.round(sim.signatureOf(b))) < 1, "transponder sig is the LIVE signature (burning reads loud)");
}

// 10. The XO calls the loudness flip — each captain gets their side, NEWS
// tier, edge-triggered, margin-guarded, rate-limited, hunter-gated.
{
  const sim = coopSim([-100000, 0], [0, 0], { hunterSpawned: true, hunterIds: ["H"] });
  sim.addShip("H", 150000, 150000, 180);
  const a = sim.ships.get("A")!;
  const b = sim.ships.get("B")!;

  // both idle: too close to call — silence
  let ev = sim.tick();
  assert(!ev.some((e) => e.kind === "notice" && /loudest/.test((e as any).text)), "equal signatures: too close to call, no headline");

  // A burns: the read fires once, both sides
  a.thrust = 100;
  ev = sim.tick();
  const mineA = ev.filter((e) => e.kind === "notice" && (e as any).ship === "A" && /We're the loudest/.test((e as any).text));
  const otherB = ev.filter((e) => e.kind === "notice" && (e as any).ship === "B" && /loudest thing on the board/.test((e as any).text));
  assert(mineA.length === 1, "the loud captain hears 'we're the loudest'");
  assert(otherB.length === 1 && new RegExp(a.callsign).test((otherB[0] as any).text), "the quiet captain hears WHO is loudest, by callsign");
  assert(!/km|\d\d\d/.test((otherB[0] as any).speak ?? ""), "the spoken variant is a fixed line (TTS economy)");

  // still burning: no repeat
  ev = sim.tick();
  assert(!ev.some((e) => e.kind === "notice" && /loudest/.test((e as any).text)), "no repeat while nothing changes");

  // the flip: A cuts, B burns — but the cooldown holds the call, then it fires
  a.thrust = 0;
  b.thrust = 100;
  let flipTick = -1;
  for (let t = 0; t < C.LOUD_CALL_COOLDOWN_S + 5 && flipTick < 0; t++) {
    ev = sim.tick();
    if (ev.some((e) => e.kind === "notice" && (e as any).ship === "B" && /We're the loudest/.test((e as any).text))) flipTick = t;
  }
  assert(flipTick >= 0, "the flip is the moment the bait play turns — and the player hears it");
  assert(flipTick >= C.LOUD_CALL_COOLDOWN_S - 3, "…rate-limited hard, not chatty");
}

// 11. No Hunter on the board: the read stays quiet (nothing is listening).
{
  const sim = coopSim([-100000, 0], [0, 0]); // hunterSpawned false
  sim.ships.get("A")!.thrust = 100;
  const ev = sim.tick();
  assert(!ev.some((e) => e.kind === "notice" && /loudest/.test((e as any).text)), "no hunter listening: no loudness headline");
}

// ---------- §8: THE BAIT PLAY, end to end — it is the patch ----------
// Ship A burns at 100% as bait; ship B coasts dark alongside a wreck.
// Both are inside the Hunter's real detection. The Hunter must pursue A
// (the loudest), and B must complete a full salvage transfer untouched.
{
  const sim = coopSim([0, 150000], [60000, 0], { hunterSpawned: true, hunterIds: ["H"] });
  const a = sim.ships.get("A")!;
  const b = sim.ships.get("B")!;
  const hunter = sim.addShip("H", 0, 0, 0, false, null, "Hunter", "corvette");
  hunter.hunterAI = true;
  hunter.sensorMult = C.HUNTER_SENSOR_MULT;
  hunter.sigMult = C.HUNTER_SIG_MULT;

  // the bait burns AWAY; the looter sits dark on the wreck. East, not
  // north: due north from this spawn is the GATE, and a bait that crosses
  // the aperture legitimately leaves the system (§5 — the first draft of
  // this test discovered that the hard way)
  a.thrust = 100;
  a.facing = 90;
  b.thrust = 0;
  sim.mission!.wrecks.push({
    id: 1, letter: "A", x: 60000, y: 500, marked: true, checked: false,
    items: [{ kind: "pdc_ammo", amount: 20 }, { kind: "missiles", amount: 2 }],
  });
  sim.enqueue("B", [{ verb: "salvage", params: { target: "A" } } as any]);

  sim.tick();
  const hSnap = sim.snapshotFor("H") as any;
  assert(hSnap.contacts.length === 2, "the Hunter's own sensors hold BOTH ships (setup is real)");
  const cidOf = (ship: any) =>
    hSnap.contacts.find((c: any) => Math.hypot(c.x - ship.x, c.y - ship.y) < 5000)?.cid;
  const aCid = cidOf(a);
  const bCid = cidOf(b);
  assert(!!aCid && !!bCid && aCid !== bCid, "both contacts designated");

  let towardA = 0;
  let towardB = 0;
  const bHull0 = b.hull;
  for (let t = 0; t < 90; t++) {
    sim.tick();
    if (!sim.ships.has("H")) break;
    const tgt = hunter.hunterMem.targetCid;
    if (tgt === aCid) towardA++;
    if (tgt === bCid) towardB++;
  }
  assert(towardA > 80, `the Hunter pursues the BAIT for the whole window (${towardA}/90 ticks on A)`);
  assert(towardB === 0, "…and never once switches to the dark looter");
  assert(sim.mission!.wrecks[0].items.length === 0, "B strips the whole wreck in the silence his friend bought");
  assert(b.hull === bHull0, "…untouched");
  assert(sim.mission!.stats.salvaged === 2, "both pieces landed");
}

// ---------- §4: death is a role change, not a bench ----------

// 12. A dead co-op captain's ship becomes a HULK carrying their entire
// hold at their death velocity, under the 1.1 hulk rules.
{
  const sim = coopSim([-100000, 0], [0, 0]);
  const b = sim.ships.get("B")!;
  b.vx = 800;
  b.vy = -400;
  b.decoys = 3;
  b.pdcAmmoS = 42;
  b.probesLeft = 2;
  const events: SimEvent[] = [];
  (sim as any).damageShip(b, 9999, "missile", events, "H");
  const hulk = sim.mission!.wrecks[sim.mission!.wrecks.length - 1];
  assert(!!hulk && hulk.marked, "the dead captain's ship becomes a marked wreck");
  assert(Math.abs((hulk.vx ?? 0) - 800 * C.HULK_MOMENTUM_RETENTION) < 1e-9 &&
    Math.abs((hulk.vy ?? 0) + 400 * C.HULK_MOMENTUM_RETENTION) < 1e-9,
    "the hulk carries the death velocity under 1.1 momentum retention");
  const kinds = hulk.items.map((i) => i.kind);
  assert(kinds.includes("decoys") && kinds.includes("pdc_ammo") && kinds.includes("probes") && kinds.includes("missiles"),
    "the whole hold is in the wreck — your friend's cargo is floating out there");
}

// 13. Match level: the fallen captain rides the SURVIVOR's sensors — never
// the omniscient feed. The fog holds.
{
  const wsA = fakeWs();
  const wsB = fakeWs();
  const match = Match.createRoom("COOX", wsA as any, null, true);
  match.joinOrReconnect(wsB as any);
  match.launch(wsA as any);
  match.stop();
  const sim = match.sim;
  const b = sim.ships.get("B")!;
  const events: SimEvent[] = [];
  (sim as any).damageShip(b, 9999, "missile", events, null);
  for (const ev of events) (match as any).routeEvent(ev);
  const flip = wsB.sent.filter((m) => m.type === "start" && m.role === "spectator");
  assert(flip.length === 1 && flip[0].coop === true, "death flips the captain to co-op coach mode");
  assert(wsB.sent.some((m) => m.type === "transcript" && /ride with our partner/.test(m.text)), "the XO frames the role change");
  (match as any).broadcast();
  const snap = wsB.sent[wsB.sent.length - 1];
  assert(snap.type === "snapshot" && snap.coopEyes === sim.ships.get("A")!.callsign,
    "the dead captain's feed is labeled with the survivor's callsign");
  assert(snap.you && snap.you.callsign === sim.ships.get("A")!.callsign, "…and IS the survivor's picture");
  assert(snap.ships === undefined && snap.spectator === undefined, "🔴 never the omniscient referee feed — the fog holds");
  match.destroy();
}

// ---------- §5: the gate needs the whole crew ----------

// 14. First through does NOT advance the system; they coach through the
// partner's eyes; the LAST crossing advances. Then the next system seats
// everyone again — the dead/through distinction gone, carries applied.
{
  const wsA = fakeWs();
  const wsB = fakeWs();
  const match = Match.createRoom("COOZ", wsA as any, null, true);
  match.joinOrReconnect(wsB as any);
  match.launch(wsA as any);
  match.stop();
  const sim = match.sim;
  const g = sim.mission!.gate;
  const R = Math.hypot(g.x, g.y);
  const ux = g.x / R;
  const uy = g.y / R;
  const cross = (id: string) => {
    const s = sim.ships.get(id)!;
    s.x = g.x - ux * 400;
    s.y = g.y - uy * 400;
    s.vx = ux * 3000;
    s.vy = uy * 3000;
    for (let i = 0; i < 30 && !(sim.mission!.through ?? []).includes(id); i++) (match as any).physicsStep();
  };
  const crossEvents: SimEvent[] = [];
  const origStep = (match as any).physicsStep.bind(match);
  (match as any).physicsStep = () => {
    const evs: SimEvent[] = [];
    sim.step(evs);
    crossEvents.push(...evs);
    for (const e of evs) (match as any).routeEvent(e);
  };
  cross("A");
  (match as any).physicsStep = origStep;
  assert((sim.mission!.through ?? []).includes("A"), "A is through");
  assert(!sim.mission!.cleared, "the system does NOT advance — the partner is still in it");
  // playtest 2026-07-13: the crossing spoke the "we've left the shroud"
  // ALARM instead of the through line (solo suppressed it via `cleared`
  // landing same-substep; a waiting partner delays cleared). Pinned: the
  // through-captain hears "We're through" and never the zone-exit alarm.
  assert(crossEvents.some((e) => e.kind === "notice" && (e as any).ship === "A" && /We're through/.test((e as any).text)),
    "the crossing speaks the through line");
  assert(!crossEvents.some((e) => e.kind === "notice" && (e as any).ship === "A" && /left the shroud/.test((e as any).text)),
    "…and NEVER the left-the-shroud alarm (the co-op crossing bug)");
  assert(!wsA.sent.some((m) => m.type === "system_clear"), "no run map yet");
  assert(wsA.sent.some((m) => m.type === "start" && m.role === "spectator" && m.coop === true),
    "the through captain flips to coach mode");
  assert(wsA.sent.some((m) => m.type === "transcript" && /talk them home/.test(m.text)), "…and is told to coach");
  (match as any).broadcast();
  const coachSnap = wsA.sent[wsA.sent.length - 1];
  assert(coachSnap.type === "snapshot" && coachSnap.you?.callsign === sim.ships.get("B")!.callsign,
    "the coach sees exactly the partner's picture");
  // the departed ship is off everyone's board
  assert(((sim.snapshotFor("B") as any).allies ?? []).length === 0, "the through-ship vanishes from the partner's transponder");

  cross("B");
  assert(sim.mission!.cleared, "the LAST captain's crossing clears the system");
  assert(wsA.sent.some((m) => m.type === "system_clear") && wsB.sent.some((m) => m.type === "system_clear"),
    "both captains reach the run map");
  match.nextSystem(wsB as any, undefined);
  match.stop();
  assert(match.sim.ships.has("A") && match.sim.ships.has("B") && !(match.sim.mission!.through ?? []).length,
    "next system: both captains seated and flying again");
  match.destroy();
}

// 15. STRANDED with a partner through: the straggler dies with the system,
// the run CONTINUES (system_clear, not gameover), and next system they
// return in a fresh base ship with an empty hold (§4).
{
  const wsA = fakeWs();
  const wsB = fakeWs();
  const match = Match.createRoom("COOS", wsA as any, null, true);
  match.joinOrReconnect(wsB as any);
  match.launch(wsA as any);
  match.stop();
  const sim = match.sim;
  const b = sim.ships.get("B")!;
  b.decoys = 1; // spend the hold down: the fresh ship must NOT keep this
  const g = sim.mission!.gate;
  const R = Math.hypot(g.x, g.y);
  const ux = g.x / R;
  const uy = g.y / R;
  const a = sim.ships.get("A")!;
  a.x = g.x - ux * 400;
  a.y = g.y - uy * 400;
  a.vx = ux * 3000;
  a.vy = uy * 3000;
  for (let i = 0; i < 30 && !(sim.mission!.through ?? []).includes("A"); i++) (match as any).physicsStep();
  // slam the gate with B still inside
  sim.mission!.gateCloseS = C.GATE_CLOSE_GRACE_S + C.GATE_CLOSE_DURATION_S - 1;
  for (let i = 0; i < 15 && !sim.mission!.cleared; i++) (match as any).physicsStep();
  assert(!sim.ships.has("B"), "the straggler dies with the system");
  assert(!wsB.sent.some((m) => m.type === "gameover"), "…but the RUN continues — no gameover");
  assert(wsB.sent.some((m) => m.type === "transcript" && /gate closed with us inside/.test(m.text)),
    "the stranded captain is told, without an explosion");
  assert(wsB.sent.some((m) => m.type === "system_clear"), "the survivor's clear reaches the fallen too");
  match.nextSystem(wsA as any, undefined);
  match.stop();
  const b2 = match.sim.ships.get("B")!;
  assert(!!b2, "the stranded captain returns at the next system");
  assert(b2.decoys === C.ARCHETYPES[b2.archetype].decoys, "…in a fresh base ship with an empty hold — losing the cargo is the cost");
  match.destroy();
}

// 16. §4b: BOTH dead = run over (the standard summary path).
{
  const sim = coopSim([-100000, 0], [0, 0], { hunterSpawned: true, hunterIds: ["H"] });
  const h = sim.addShip("H", 150000, 0, 270);
  h.hunterAI = true;
  const events: SimEvent[] = [];
  (sim as any).damageShip(sim.ships.get("A")!, 9999, "missile", events, "H");
  assert(!events.some((e) => e.kind === "gameover"), "one captain down: the run fights on");
  (sim as any).damageShip(sim.ships.get("B")!, 9999, "missile", events, "H");
  const over = events.find((e) => e.kind === "gameover") as any;
  assert(!!over && over.winner === "H", "both dead: the system wins the run");
}

// 16b. The translator's state line carries the TEAMMATE (transponder data
// + the no-datalink reminder) — the callsign is the noun come_alongside
// targets. Solo summaries carry no such line.
{
  const sim = coopSim([0, 0], [9000, 0]);
  sim.tick();
  const summary = sim.stateSummaryFor("A");
  const mate = sim.ships.get("B")!;
  assert(new RegExp(`TEAMMATE: ${mate.callsign}`).test(summary), "the state summary names the teammate by callsign");
  assert(/intel moves by voice/.test(summary), "…and reminds the XO there is no datalink");
  const solo = new Sim();
  solo.addShip("A", 0, 0, 0);
  assert(!/TEAMMATE/.test(solo.stateSummaryFor("A")), "solo summaries carry no teammate line");
}

// ---------- §6: come_alongside — the transfer that makes them a crew ----------

// 17. Docked at matched velocity: the give manifest crosses, one
// consignment per SALVAGE_ITEM_S, both XOs narrating.
{
  const sim = coopSim([0, 0], [800, 0]);
  const a = sim.ships.get("A")!;
  const b = sim.ships.get("B")!;
  a.reserve = 4;
  const b0 = missilesAboard(b);
  const bDecoys0 = b.decoys;
  sim.enqueue("A", [{ verb: "come_alongside", params: { target: b.callsign, give: { missiles: 2, decoys: 1 } } } as any]);
  const all: SimEvent[] = [];
  for (let t = 0; t < C.SALVAGE_ITEM_S * 2 + 6; t++) all.push(...sim.tick());
  assert(missilesAboard(b) === b0 + 2, "the teammate receives the missiles");
  assert(b.decoys === bDecoys0 + 1, "…and the decoy");
  assert(a.reserve === 2, "the giver's reserve is down by two");
  assert(all.some((e) => e.kind === "notice" && (e as any).ship === "B" && /aboard from/.test((e as any).text)),
    "the receiving XO calls the stores aboard");
  assert(all.some((e) => e.kind === "notice" && (e as any).ship === "A" && /Transfer complete/.test((e as any).text)),
    "the giving XO calls it complete");
  assert(a.maneuver === null, "the maneuver ends with the manifest");
}

// 18. At 800 m/s relative: NOTHING crosses (the §8 pin) — the dock gate is
// the salvage gate, |v_rel| < SALVAGE_STOP_SPEED_MPS.
{
  const sim = coopSim([0, 0], [800, 0]);
  const a = sim.ships.get("A")!;
  const b = sim.ships.get("B")!;
  a.reserve = 4;
  b.vx = 800; // screaming past
  const b0 = missilesAboard(b);
  sim.enqueue("A", [{ verb: "come_alongside", params: { give: { missiles: 2 } } } as any]);
  for (let t = 0; t < 5; t++) sim.tick();
  assert(missilesAboard(b) === b0, "at 800 m/s relative, nothing crosses");
  assert((a.maneuver as any)?.give?.length === 1, "the manifest waits for the velocity match");
}

// 19. The verb is campaign co-op only, and clamps are honest.
{
  const mp = new Sim();
  mp.addShip("A", 0, 0, 0, false, "red");
  mp.addShip("B", 500, 0, 0, false, "red");
  const ev = mp.tick(); // flush spawn
  void ev;
  mp.enqueue("A", [{ verb: "come_alongside", params: {} } as any]);
  const rejected = mp.tick().find((e) => e.kind === "reject") as any;
  assert(!!rejected && /not rigged/.test(rejected.reason), "multiplayer teams: the verb is refused (no balance change)");

  const sim = coopSim([0, 0], [600, 0]);
  const a = sim.ships.get("A")!;
  const b = sim.ships.get("B")!;
  a.decoys = 1;
  b.propellant = 90;
  a.propellant = 50;
  sim.enqueue("A", [{ verb: "come_alongside", params: { give: { decoys: 5, propellant: 40 } } } as any]);
  for (let t = 0; t < C.SALVAGE_ITEM_S * 2 + 6; t++) sim.tick();
  // b sat near-full: only the shortfall moved (an unclamped 40 would have
  // gutted a's tank to ~19 even with regen; the clamp leaves it > 40)
  assert(b.propellant <= C.PROPELLANT_MAX && a.propellant > 40, "propellant clamps at the receiver's tank — only the shortfall moves");
  assert(b.decoys === C.ARCHETYPES[b.archetype].decoys + 1 && a.decoys === 0, "decoys clamp at what's aboard (1 moved of 5 asked)");
}

// 20. Abort keeps what's crossed; formation (no give) just holds station.
{
  const sim = coopSim([0, 0], [700, 0]);
  const a = sim.ships.get("A")!;
  const b = sim.ships.get("B")!;
  a.reserve = 4;
  const b0 = missilesAboard(b);
  const bDec0 = b.decoys;
  // manifest crosses in fixed cheap-to-dear order: decoys land first,
  // missiles would be second — the abort must strand them aboard A
  sim.enqueue("A", [{ verb: "come_alongside", params: { give: { missiles: 1, decoys: 1 } } } as any]);
  for (let t = 0; t < C.SALVAGE_ITEM_S + 3; t++) sim.tick(); // first consignment lands
  assert(b.decoys === bDec0 + 1, "first consignment landed (decoys — cheap to dear)");
  sim.enqueue("A", [{ verb: "set_thrust", params: { percent: 50 } } as any]);
  const ev = sim.tick();
  assert(ev.some((e) => e.kind === "notice" && /what's crossed stays crossed/.test((e as any).text)),
    "a helm order breaks off the rendezvous");
  assert(a.maneuver === null && b.decoys === bDec0 + 1 && missilesAboard(b) === b0,
    "…and what's crossed stays crossed — the missiles never left");

  const sim2 = coopSim([0, 0], [700, 0]);
  sim2.enqueue("A", [{ verb: "come_alongside", params: {} } as any]);
  const ev2: SimEvent[] = [];
  for (let t = 0; t < 3; t++) ev2.push(...sim2.tick());
  assert(ev2.some((e) => e.kind === "notice" && /holding formation/.test((e as any).text)),
    "no manifest: alongside means formation");
  assert(sim2.ships.get("A")!.maneuver !== null, "…and the station-keeping holds");
}

// 21. The XO flies the whole rendezvous from km out — the exact salvage
// terminal approach, pointed at a friend.
{
  const sim = coopSim([0, 0], [3000, 0]);
  const a = sim.ships.get("A")!;
  const b = sim.ships.get("B")!;
  a.reserve = 2;
  const b0 = missilesAboard(b);
  sim.enqueue("A", [{ verb: "come_alongside", params: { give: { missiles: 1 } } } as any]);
  let done = false;
  for (let t = 0; t < 240 && !done; t++) {
    sim.tick();
    done = missilesAboard(b) === b0 + 1;
  }
  assert(done, "from 3 km out the XO flies the approach, docks, and moves the stores");
}

console.log("done: coop");
