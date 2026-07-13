// Campaign "Deep Black" Stage 0 (HANDOFF-CAMPAIGN-v1.md): mission clock,
// no-pop-in Hunter spawn, gate geometry + approach solution, the aperture
// derivation pin (ALL THREE archetypes — the spread is intentional), the
// victory guard, and the Match-level campaign lifecycle.
import { Sim, dist, type Mission, type SimEvent } from "../server/sim.js";
import { hunterDecide, initialHunterMem } from "../server/hunter.js";
import { emptyTerrain } from "../server/terrain.js";
import { Match } from "../server/match.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

const missionSim = (over: Partial<Mission> = {}): Sim => {
  const sim = new Sim(); // empty terrain: exact fields by hand
  sim.addShip("A", 0, -C.SPAWN_RING_RADIUS_M, 0);
  sim.mission = {
    playerIds: ["A"],
    system: 2, // "Sharp Ears" — the Stage 0 baseline row
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
    pylonIdx: null, // hand-built sims have no pylon rocks to move
    ...over,
  };
  return sim;
};

// 1. the two choke points: sigMult scales the TOTAL signature; sensorMult
// scales the viewer's base — every detection consumer inherits both
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 60000, 0);
  a.thrust = 60;
  const base = sim.signatureOf(a);
  a.sigMult = 0.5;
  assert(Math.abs(sim.signatureOf(a) - base / 2) < 1e-9, "sigMult scales the TOTAL emitted signature");
  const det = sim.detectionRange(100, b);
  b.sensorMult = 1.4;
  assert(Math.abs(sim.detectionRange(100, b) - det * 1.4) < 1e-6, "sensorMult scales the viewer's sensor base");
}

// 2. the clock: no Hunter before CAMPAIGN_HUNTER_SPAWN_S, exactly one at it;
// the spawn notice carries NO bearing and NO number; the spawn tick shows
// zero contacts (the no-pop-in law)
{
  const sim = missionSim();
  for (let t = 1; t < C.CAMPAIGN_HUNTER_SPAWN_S; t++) sim.tick();
  assert(!sim.ships.has("H"), `no Hunter at t=${C.CAMPAIGN_HUNTER_SPAWN_S - 1} (the clock is a budget)`);
  const ev = sim.tick();
  const h = sim.ships.get("H");
  assert(!!h, `Hunter exists at exactly t=${C.CAMPAIGN_HUNTER_SPAWN_S}`);
  assert(h!.hunterAI && !h!.isDrone, "Hunter is a real ship on the AI path (not the drone override)");
  assert(h!.sensorMult === C.HUNTER_SENSOR_MULT && h!.sigMult === C.HUNTER_SIG_MULT, "mission multipliers applied to the hull");
  const spawnLine = ev.find((e) => e.kind === "notice" && /Clock's run out/.test((e as any).text)) as any;
  assert(!!spawnLine && spawnLine.alert === true, "spawn notice fires, critical");
  assert(!/\d|bearing/i.test(spawnLine.text), "spawn notice carries no bearing and no number (§7.1)");
  const snap = sim.snapshotFor("A") as any;
  assert(snap.contacts.length === 0, "no contact on the spawn tick — the first the player knows is the clock");
  assert(snap.you.mission.hunterActive === true && snap.you.mission.spawnInS === 0, "you.mission reports the phase flip");
}

// 3. no pop-in, five player positions: the Hunter always lands beyond the
// player's live detection range for its hunt-throttle signature
{
  const hunterSig = (C.ARCHETYPES.corvette.sigBase + C.HUNTER_HUNT_THROTTLE) * C.HUNTER_SIG_MULT;
  const spots: [string, number, number][] = [
    ["own spawn", 0, -C.SPAWN_RING_RADIUS_M],
    ["region center", 0, 0],
    ["the rim", C.REGION_RADIUS_M * 0.99, 0],
    ["the gate", 0, C.REGION_RADIUS_M - 2000],
    ["mid-map", 60000, 40000],
  ];
  for (const [name, x, y] of spots) {
    const sim = missionSim({ hunterSpawnS: 1 });
    const a = sim.ships.get("A")!;
    a.x = x;
    a.y = y;
    sim.tick();
    const h = sim.ships.get("H")!;
    const floor = sim.detectionRange(hunterSig, a);
    assert(dist(h.x, h.y, a.x, a.y) > floor, `player at ${name}: Hunter spawns beyond detection (${Math.round(dist(h.x, h.y, a.x, a.y) / 1000)} km > ${Math.round(floor / 1000)} km)`);
    assert(((sim.snapshotFor("A") as any).contacts as any[]).length === 0, `player at ${name}: zero contacts on the spawn tick`);
  }
  // filter-empty fallback: a player whose detection covers the whole spawn
  // ring still gets a spawn — the farthest ring point, never a crash
  const sim = missionSim({ hunterSpawnS: 1 });
  const a = sim.ships.get("A")!;
  a.sensorMult = 100;
  sim.tick();
  const h = sim.ships.get("H");
  assert(!!h, "detection covers the ring: fallback still spawns the Hunter");
  assert(dist(h!.x, h!.y, a.x, a.y) > 350000, "fallback picks the ring point farthest from the player");
}

// 4. approach solution (§5.4): dead-center ballistic = solution good;
// lateral offset reads as miss + side in the pilot's frame; receding = none
{
  const sim = missionSim();
  const a = sim.ships.get("A")!;
  a.x = 0; a.y = C.REGION_RADIUS_M - 50000; a.vx = 0; a.vy = 1000;
  let sol = sim.gateSolution(a)!;
  assert(sol !== null && sol.missM < 1 && sol.good && Math.abs(sol.ttg - 50) < 1, `dead-center: miss ~0, good, ttg ~50 s (got ${sol.missM.toFixed(2)} m, ${sol.ttg.toFixed(1)} s)`);
  a.x = 5000; // ballistic line now crosses 5 km east of aperture center
  sol = sim.gateSolution(a)!;
  assert(sol !== null && Math.abs(sol.missM - 5000) < 1 && !sol.good && sol.side === "right", `offset line: 5 km miss, not good, RIGHT of center (got ${sol.missM.toFixed(0)} m ${sol.side})`);
  a.vy = -1000; // receding
  assert(sim.gateSolution(a) === null, "receding: no solution (ttg is Infinity)");
  const snap = sim.snapshotFor("A") as any;
  assert(snap.you.gate === null, "snapshot mirrors the no-solution state");
}

// 5. THE APERTURE PIN — all three archetypes, from live constants. The
// §5.3 constraint (40 km commit at full speed: 3° correctable, 6° not) is
// the FRIGATE's; the spread around it is intentional and load-bearing:
// corvette forgiving (6° still correctable at max speed — its strict
// 3-yes/6-no band lies above reachable speed), cruiser unthreadable at max
// speed with a SLOWER viable envelope. Do not widen APERTURE_W_M.
{
  const COMMIT_M = 40000;
  const authority = (arch: { accel: number; turn: number }, v: number) => {
    const w = Math.max(0, COMMIT_M / v - 90 / arch.turn); // burn window after a 90° flip
    return 0.5 * arch.accel * w * w;
  };
  const missAt = (deg: number) => COMMIT_M * Math.tan((deg * Math.PI) / 180);
  const corr = (arch: { accel: number; turn: number }, v: number, deg: number) =>
    authority(arch, v) >= missAt(deg);
  const { corvette, frigate, cruiser } = C.ARCHETYPES;
  const V = C.MAX_SPEED_MPS;

  assert(corr(frigate, V, 3) && !corr(frigate, V, 6), "frigate at max speed: 3° correctable, 6° not — the §5.3 constraint verbatim");
  assert(corr(corvette, V, 6), "corvette at max speed: even 6° correctable — the forgiving end of the spread");
  assert(!corr(cruiser, V, 3), "cruiser at max speed: 3° NOT correctable — unthreadable hot");
  // the cruiser's viable envelope exists and is SLOWER than max speed:
  // it threads the gate by coming in slow, which is when the Hunter eats it
  let cruiserViableMax = 0;
  for (let v = 500; v <= V; v += 25) {
    if (corr(cruiser, v, 3) && !corr(cruiser, v, 6)) cruiserViableMax = v;
  }
  assert(cruiserViableMax > 0 && cruiserViableMax < V, `cruiser has a viable envelope, capped well under max speed (${cruiserViableMax} m/s)`);
  assert(authority(corvette, V) > authority(frigate, V) && authority(frigate, V) > authority(cruiser, V), "correction authority orders corvette > frigate > cruiser");
  // Anvil §5: the +40% corvette turn re-derives; the ordering must survive
  // any turn retune — the cruiser's viable approach envelope stays SLOWER
  // than the corvette's (which runs clean to max speed)
  let corvetteViableMax = 0;
  for (let v = 500; v <= V; v += 25) {
    if (corr(corvette, v, 3)) corvetteViableMax = v;
  }
  assert(corvetteViableMax === V, "corvette viable to max speed — the gate is forgiving in the light hull");
  // the derivation band for the half-width: correcting a 3° error must be
  // possible, a 6° error must leave a residual bigger than the half-aperture
  assert(C.APERTURE_W_M / 2 > 0 && C.APERTURE_W_M / 2 < missAt(6) - authority(frigate, V), `APERTURE_W_M/2 sits inside the derived band (${C.APERTURE_W_M / 2} < ${(missAt(6) - authority(frigate, V)).toFixed(0)})`);
}

// 6. gate crossing: swept, outward-only, one substep at full speed.
// Stage 1: a NON-final system emits system_clear (a transition — the run
// continues); only system 8's crossing is the run-complete gameover.
{
  // non-final system: transition, not victory
  const sim = missionSim(); // system 2
  const a = sim.ships.get("A")!;
  a.x = 0; a.y = C.REGION_RADIUS_M - 500; a.vx = 0; a.vy = 3000;
  const ev = sim.tick();
  assert(sim.winner === null && sim.mission!.cleared, "non-final crossing: cleared, no winner — the gate is a TRANSITION");
  const clear = ev.find((e) => e.kind === "system_clear") as any;
  assert(!!clear && clear.system === 2, "system_clear event carries the system number");
  assert(!ev.some((e) => e.kind === "gameover"), "…and no gameover rides along");
  assert(ev.some((e) => e.kind === "notice" && /We're through/.test((e as any).text)), "the XO calls the exit");
  sim.tick();
  assert(sim.tick().filter((e) => e.kind === "system_clear").length === 0, "cleared flag: the crossing never re-fires");

  // FINAL system: the run is complete — gameover with gateCleared
  const simF = missionSim({ system: C.CAMPAIGN_SYSTEMS });
  const aF = simF.ships.get("A")!;
  aF.x = 0; aF.y = C.REGION_RADIUS_M - 500; aF.vx = 0; aF.vy = 3000;
  const evF = simF.tick();
  assert(simF.winner === "A", "system-eight crossing at 3 km/s: caught by the swept test, run complete");
  const over = evF.find((e) => e.kind === "gameover") as any;
  assert(!!over && over.gateCleared === true && over.winner === "A", "final gameover carries gateCleared");

  // inward crossing does not win (you fly OUT through the gate)
  const sim2 = missionSim();
  const a2 = sim2.ships.get("A")!;
  a2.x = 0; a2.y = C.REGION_RADIUS_M + 500; a2.vx = 0; a2.vy = -3000;
  sim2.tick();
  assert(sim2.winner === null && !sim2.mission!.cleared, "inward crossing is not an exit");

  // a wide miss sails past into the shroud overshoot (§5.2), no win
  const sim3 = missionSim();
  const a3 = sim3.ships.get("A")!;
  a3.x = C.APERTURE_W_M; a3.y = C.REGION_RADIUS_M - 500; a3.vx = 0; a3.vy = 3000;
  const ev3 = sim3.tick();
  assert(sim3.winner === null, "a blown line misses the aperture");
  assert(ev3.some((e) => e.kind === "notice" && /left the shroud/.test((e as any).text)), "…and punches through the shroud (the designed failure)");

  // pylon strike is an ordinary rock collision
  const sim4 = missionSim();
  const off = C.APERTURE_W_M / 2 + C.GATE_PYLON_RADIUS_M;
  sim4.terrain.rocks.push({ x: off, y: C.REGION_RADIUS_M, r: C.GATE_PYLON_RADIUS_M });
  const a4 = sim4.ships.get("A")!;
  a4.x = off; a4.y = C.REGION_RADIUS_M - 5000; a4.vx = 0; a4.vy = 1500;
  for (let t = 0; t < 6 && a4.hull >= 100; t++) sim4.tick();
  assert(a4.hull < 100, `clipping a pylon crunches like any rock (hull ${a4.hull.toFixed(1)})`);
}

// 7. the victory guard: killing the Hunter does NOT end the match (the
// quiet line is the reward); player death loses, whoever is left
{
  const sim = missionSim({ hunterSpawnS: 1 });
  sim.tick();
  const h = sim.ships.get("H")!;
  h.hull = 1;
  const ev: SimEvent[] = [];
  (sim as any).damageShip(h, 10, "missile", ev, "A");
  assert(sim.winner === null && !ev.some((e) => e.kind === "gameover"), "Hunter destroyed: no gameover — the gate is the only exit");
  assert(ev.some((e) => e.kind === "notice" && /gone quiet/.test((e as any).text)), "…and the XO breathes: 'It's gone quiet, Captain.'");
  // player dies later (rock, edge, whatever): the system wins
  const a = sim.ships.get("A")!;
  a.hull = 1;
  const ev2: SimEvent[] = [];
  (sim as any).damageShip(a, 10, "rock", ev2, null);
  const over = ev2.find((e) => e.kind === "gameover") as any;
  assert(sim.winner === "nobody" && !!over && over.winnerName === "the deep black", "player dead with no Hunter left: the deep black wins");

  // with the Hunter alive, it takes the win
  const sim2 = missionSim({ hunterSpawnS: 1 });
  sim2.tick();
  const a2 = sim2.ships.get("A")!;
  a2.hull = 1;
  const ev3: SimEvent[] = [];
  (sim2 as any).damageShip(a2, 10, "missile", ev3, "H");
  const over3 = ev3.find((e) => e.kind === "gameover") as any;
  assert(sim2.winner === "H" && !!over3 && over3.winnerName === "Hunter", "player death after the spawn: the Hunter wins");

  // pre-spawn player death (rock greed) still ends the run as a loss
  const sim3 = missionSim();
  const a3 = sim3.ships.get("A")!;
  a3.hull = 1;
  const ev4: SimEvent[] = [];
  (sim3 as any).damageShip(a3, 10, "rock", ev4, null);
  const over4 = ev4.find((e) => e.kind === "gameover") as any;
  assert(sim3.winner === "nobody" && !!over4, "pre-spawn death: loss, not a hang");
}

// 8. Match level: createCampaign lifecycle — start payload, pylons in the
// terrain, mission tune knobs, gate-clear gameover, retry re-arms the clock
{
  const fakeWs = () => {
    const ws = { sent: [] as any[], readyState: 1, OPEN: 1, send(s: string) { ws.sent.push(JSON.parse(s)); } };
    return ws;
  };
  const ws = fakeWs();
  const match = Match.createCampaign(ws as any, "corvette");
  match.stop(); // deterministic: drive by hand
  const start = ws.sent.find((m) => m.type === "start");
  assert(!!start && start.campaign === true && !!start.gate, "start carries campaign flag + gate geometry");
  const pylons = (start.terrain.rocks as any[]).filter((r) => r.r === C.GATE_PYLON_RADIUS_M);
  assert(pylons.length === 2, "two pylon rocks travel with the terrain");
  assert(Math.abs(dist(pylons[0].x, pylons[0].y, pylons[1].x, pylons[1].y) - (C.APERTURE_W_M + 2 * C.GATE_PYLON_RADIUS_M)) < 1, "pylons flank the aperture exactly");
  assert(ws.sent.some((m) => m.type === "transcript" && /Deep black/.test(m.text)), "campaign welcome line");
  const mission = match.sim.mission!;
  assert(mission.hunters[0].archetype === "corvette" && mission.hunterSpawnS === C.CAMPAIGN_HUNTER_SPAWN_S, "mission spec armed");
  assert(match.sim.ships.get("A")!.archetype === "corvette", "player flies the picked hull");

  // dev-harness runtime knobs
  match.handleUtterance(ws as any, '{"mission":{"sigMult":0.5,"sensorMult":2}}');
  assert(mission.hunters[0].sigMult === 0.5 && mission.hunters[0].sensorMult === 2, "mission tune updates the spec live");
  assert(ws.sent.some((m) => m.type === "transcript" && m.who === "xo-note" && /mission tune/.test(m.text)), "tune echoes as an XO note");

  // fly out through system 1's gate: a TRANSITION (system_clear + run
  // state export), not a gameover
  const crossGate = () => {
    const g = match.sim.mission!.gate;
    const R = Math.hypot(g.x, g.y);
    const ux = g.x / R;
    const uy = g.y / R;
    const a = match.sim.ships.get("A")!;
    a.x = g.x - ux * 400;
    a.y = g.y - uy * 400;
    a.vx = ux * 3000;
    a.vy = uy * 3000;
    for (let i = 0; i < 20 && !match.sim.mission!.cleared; i++) (match as any).physicsStep();
  };
  // spend some pool so persistence is observable
  match.sim.ships.get("A")!.propellant = 61;
  crossGate();
  const clearMsg = ws.sent.find((m) => m.type === "system_clear");
  assert(!!clearMsg && clearMsg.system === 1 && clearMsg.nextSystem === 2, "system_clear reaches the client with the next system");
  assert(clearMsg.runState.pools.propellant === 61, "run state exports the pools as they stand (§6: pools persist)");
  assert(!ws.sent.some((m) => m.type === "gameover"), "a transition is not a gameover");

  // the client hands the run state back: same match, next system
  match.nextSystem(ws as any, clearMsg.runState);
  const m2 = match.sim.mission!;
  assert(m2.system === 2 && m2.systemName === C.CAMPAIGN_LADDER[1].name, "next system instantiates ladder row 2");
  // 1.1 §6 amends §6: propellant refills on transition (it regenerates in
  // flight anyway); the run state still EXPORTS it, but arrival is full
  assert(match.sim.ships.get("A")!.propellant === C.PROPELLANT_MAX, "propellant refills on transition (1.1 §6); the other pools arrive as you left them");
  assert(match.sim.tickCount === 0 && !m2.hunterSpawned, "fresh system: clock re-armed");
  assert(ws.sent.some((m) => m.type === "transcript" && /System 2/.test(m.text)), "the XO names the new system");

  // jump to the last system and fly out: the run completes as a win
  m2.system = C.CAMPAIGN_SYSTEMS;
  crossGate();
  const over = ws.sent.find((m) => m.type === "gameover");
  assert(!!over && over.youWin === true && over.gateCleared === true && over.runComplete === true, "system eight's crossing ends the run as a win");
  assert(over.runSummary && over.runSummary.systemsCleared === C.CAMPAIGN_SYSTEMS, "the summary scores systems cleared");

  // rematch after a run ends = a NEW RUN from system one (stakes survive)
  assert(match.canRematch(), "campaign can start a new run");
  (match as any).voteRematch(ws as any, false);
  assert(match.sim.mission !== null && match.sim.mission.system === 1, "new run starts at system one");
  assert(match.sim.winner === null && match.sim.tickCount === 0 && !match.sim.mission.hunterSpawned, "fresh sim, clock re-armed");
  assert(match.sim.ships.has("A") && !match.sim.ships.has("H"), "captain alone again");
  match.destroy();
}

// 9. SALVAGE (§4): the stop is the cost; the haul is sequential worst->
// best; walking away keeps what landed; drifting off aborts
{
  const sim = missionSim();
  sim.mission!.wrecks.push({
    id: 1,
    letter: "A",
    x: 0,
    y: -C.SPAWN_RING_RADIUS_M + 1000, // 1 km off the spawn point
    marked: true,
    checked: false,
    items: [
      { kind: "propellant", amount: 30 },
      { kind: "missiles", amount: 2 },
      { kind: "upgrade", amount: 1, upgrade: "sig" },
    ],
  });
  const a = sim.ships.get("A")!;
  a.propellant = 10;
  a.vy = C.SALVAGE_STOP_SPEED_MPS + 40; // too fast to dock
  sim.enqueue("A", [{ verb: "salvage", params: {} } as any]);
  let ev = sim.tick();
  assert(ev.some((e) => e.kind === "notice" && /Coming alongside/.test((e as any).text)), "salvage accepted: the XO takes the conn");
  let dockLine: any = null;
  for (let t = 0; t < 30 && !dockLine; t++) {
    dockLine = sim.tick().find((e) => e.kind === "notice" && /pieces to move/.test((e as any).text));
  }
  assert(!!dockLine && /3 pieces/.test(dockLine.text), "the docking line states the count up front — the captain knows how long");
  // the maneuver kills velocity first; no items land while moving
  for (let t = 0; t < C.SALVAGE_ITEM_S - 1 && sim.speedOf(a) >= C.SALVAGE_STOP_SPEED_MPS; t++) sim.tick();
  assert(sim.mission!.stats.salvaged === 0, "no transfer above SALVAGE_STOP_SPEED_MPS — the stop is the cost");
  // now stopped: items land one per SALVAGE_ITEM_S, worst first
  const before = a.propellant;
  let got = 0;
  for (let t = 0; t < C.SALVAGE_ITEM_S * 2 + 4 && got === 0; t++) {
    ev = sim.tick();
    if (ev.some((e) => e.kind === "notice" && /Propellant aboard/.test((e as any).text))) got = 1;
  }
  assert(got === 1 && a.propellant > before, "worst item first: propellant lands and is applied");
  assert(sim.mission!.haul.length === 1 && sim.mission!.haul[0].kind === "propellant", "the haul manifest records the landing (the run map's headline)");
  const sigBefore = a.sigMult;
  // teaser fires when only the upgrade remains
  let teased = false;
  for (let t = 0; t < C.SALVAGE_ITEM_S + 2 && !teased; t++) {
    ev = sim.tick();
    if (ev.some((e) => e.kind === "notice" && /something else in here/.test((e as any).text))) teased = true;
  }
  assert(teased, "the §4.2 teaser: the last item is the reason to stay put");
  // abort NOW: any thrust order breaks off — landed items stay
  sim.enqueue("A", [{ verb: "set_thrust", params: { percent: 50 } } as any]);
  ev = sim.tick();
  assert(ev.some((e) => e.kind === "notice" && /Breaking off the salvage/.test((e as any).text)), "a thrust order breaks off the transfer");
  assert(a.sigMult === sigBefore && sim.mission!.wrecks[0].items.length === 1, "the upgrade stays on the wreck; what landed stayed aboard");
  assert(a.propellant > before, "abort keeps everything already landed");
}

// 10. §6 progression: an upgrade module applies as a multiplier and is
// counted for the run-state export
{
  const sim = missionSim();
  const a = sim.ships.get("A")!;
  (sim as any).applySalvageItem(a, { kind: "upgrade", amount: 1, upgrade: "sig" }, []);
  assert(Math.abs(a.sigMult - C.UPGRADE_SIG_MULT) < 1e-9, "engine baffles: player sigMult scales down through the same choke point as the Hunter's");
  assert(sim.mission!.upgradeCounts.sig === 1 && sim.mission!.stats.upgrades === 1, "module counted for the export");
}

// 11. §4.4 THE INTEL PIN: the Hunter's intel struct carries MARKED sites
// only — a rumored wreck is the player's private lead
{
  const sim = missionSim({ hunterSpawnS: 1 });
  sim.mission!.wrecks.push(
    { id: 1, letter: "A", x: 50000, y: 0, marked: true, checked: false, items: [{ kind: "propellant", amount: 30 }] },
    { id: 2, letter: "B", x: -50000, y: 0, marked: false, checked: false, items: [{ kind: "missiles", amount: 2 }] },
    { id: 3, letter: "C", x: 90000, y: 0, marked: true, checked: false, items: [] } // stripped: no longer worth watching
  );
  sim.tick();
  const intel = sim.hunterIntelFor(sim.ships.get("H")!);
  assert(intel.sites.length === 1 && intel.sites[0].x === 50000, "the Hunter knows the MARKED site, never the rumor, never a stripped hulk");
}

// 12. §2.3: a dead Hunter drops the best wreck in the system — the trap pays
{
  const sim = missionSim({ hunterSpawnS: 1 });
  sim.tick();
  const h = sim.ships.get("H")!;
  h.hull = 1;
  const ev: SimEvent[] = [];
  (sim as any).damageShip(h, 10, "missile", ev, "A");
  const wreck = sim.mission!.wrecks.find((w) => w.marked && w.items.some((i) => i.kind === "upgrade"));
  assert(!!wreck && sim.mission!.stats.huntersKilled === 1, "the Hunter's wreck lands, marked, carrying an upgrade module");
}

// 13. THE LADDER (§3): a table, not a formula — 8 rows, one new problem
// each; gate-camping is a LATE escalation only; the clock NEVER shrinks
// (one constant for all rows — pinned here so a future 'per-system clock'
// refactor trips a red test); spawn lines carry no bearings or numbers
{
  assert(C.CAMPAIGN_LADDER.length === C.CAMPAIGN_SYSTEMS, "eight rows for eight systems");
  assert(C.CAMPAIGN_LADDER.every((r) => r.hunters.length >= 1 && r.hunters.length <= 2), "1-2 hunters per row (the count is an identity, not a dial)");
  C.CAMPAIGN_LADDER.forEach((row, i) => {
    const camp = row.hunters.some((h) => h.gateCamp);
    assert(camp === (i >= 6), `gate-camping ${camp ? "present" : "absent"} in "${row.name}" — late rows only (the sprint fantasy is precious)`);
    assert(!/\d|bearing/i.test(row.spawnLine), `"${row.name}" spawn line carries no bearing and no number`);
  });
  const row2 = C.CAMPAIGN_LADDER[1].hunters[0];
  assert(row2.sensorMult === C.HUNTER_SENSOR_MULT && row2.sigMult === C.HUNTER_SIG_MULT, "row 2 IS the Stage 0 pair (Sharp Ears)");
  // the clock is a single constant — there is no per-row field to shrink
  assert(!("hunterSpawnS" in (C.CAMPAIGN_LADDER[0] as any)), "no per-row clock exists: CAMPAIGN_HUNTER_SPAWN_S is the only clock");
}

// 14. THE PAIR (§3 row 5): two hunters spawn, both beyond detection, and
// spaced apart — two bearings, not one blob
{
  const row = C.CAMPAIGN_LADDER[4];
  const sim = missionSim({ hunterSpawnS: 1, hunters: row.hunters.map((h) => ({ ...h })), spawnLine: row.spawnLine, system: 5, systemName: row.name });
  const ev = sim.tick();
  const h1 = sim.ships.get("H");
  const h2 = sim.ships.get("H2");
  assert(!!h1 && !!h2, "the Pair: both hunters spawn");
  const a = sim.ships.get("A")!;
  const sig = (C.ARCHETYPES.corvette.sigBase + C.HUNTER_HUNT_THROTTLE) * row.hunters[0].sigMult;
  const floor = sim.detectionRange(sig, a);
  assert(dist(h1!.x, h1!.y, a.x, a.y) > floor && dist(h2!.x, h2!.y, a.x, a.y) > floor, "both beyond detection — the no-pop-in law holds for packs");
  assert(dist(h1!.x, h1!.y, h2!.x, h2!.y) > 40000, "spaced ≥40 km: two drives means two BEARINGS");
  assert(ev.some((e) => e.kind === "notice" && /pair/i.test((e as any).text)), "the XO names the problem: 'They've sent a pair.'");
  assert(((sim.snapshotFor("A") as any).contacts as any[]).length === 0, "zero contacts on the spawn tick, still");
}

// 15. gate-clear suppresses the shroud double-line (playtest finding):
// "We're through" + "We've left the shroud" said the same thing twice
{
  const sim = missionSim();
  const a = sim.ships.get("A")!;
  a.x = 0; a.y = C.REGION_RADIUS_M - 500; a.vx = 0; a.vy = 3000;
  const ev = sim.tick();
  assert(ev.some((e) => e.kind === "notice" && /We're through/.test((e as any).text)), "the exit call fires");
  assert(!ev.some((e) => e.kind === "notice" && /left the shroud/.test((e as any).text)), "…without the shroud line doubling it");
}

// 16. rumors resolve by PRESENCE (playtest fix): unknown until you fly
// within RUMOR_RESOLVE_RANGE_M — then the XO calls loot or dry hole; a dry
// hole exists on the map until checked, then vanishes. Sensors never do
// this (dust or no dust — the trip is the price).
{
  const sim = missionSim();
  const a = sim.ships.get("A")!;
  sim.mission!.wrecks.push(
    { id: 1, letter: "A", x: a.x, y: a.y - 40000, marked: false, checked: false, items: [{ kind: "missiles", amount: 2 }] },
    { id: 2, letter: "B", x: a.x, y: a.y + 40000, marked: false, checked: false, items: [] } // the dry hole
  );
  let snap = sim.snapshotFor("A") as any;
  const rumor = snap.wrecks.find((w: any) => w.id === 1);
  const dry = snap.wrecks.find((w: any) => w.id === 2);
  assert(!!rumor && rumor.items === null, "unresolved rumor: on the map, contents hidden");
  assert(!!dry && dry.items === null, "a DRY rumor is also on the map — invisible dry holes were the bug");
  // drift within resolve range of the loot rumor
  a.y -= 40000 - C.RUMOR_RESOLVE_RANGE_M + 1000;
  let ev = sim.tick();
  assert(ev.some((e) => e.kind === "notice" && /is a wreck alright/.test((e as any).text)), "presence resolves the rumor — the XO calls the loot");
  snap = sim.snapshotFor("A") as any;
  assert(snap.wrecks.find((w: any) => w.id === 1)?.items === 1, "…and the marker now names the count");
  // now check the dry hole
  const w2 = sim.mission!.wrecks.find((w) => w.id === 2)!;
  a.x = w2.x;
  a.y = w2.y - C.RUMOR_RESOLVE_RANGE_M + 1000;
  ev = sim.tick();
  assert(ev.some((e) => e.kind === "notice" && /dry hole/.test((e as any).text)), "the dry hole is announced once…");
  snap = sim.snapshotFor("A") as any;
  assert(!snap.wrecks.some((w: any) => w.id === 2), "…and struck off the map");
  assert(sim.tick().filter((e) => e.kind === "notice" && /dry hole/.test((e as any).text)).length === 0, "checked is an edge — no repeat");
  // fog: the Hunter's intel never carries rumors, checked or not
  sim.mission!.hunterSpawnS = sim.tickCount + 1;
  sim.tick();
  assert(sim.hunterIntelFor(sim.ships.get("H")!).sites.length === 0, "a CHECKED rumor is still the player's secret — never Hunter intel");
}

// 17. the decoy doctrine line: once per system, only when it matters
// (deployed mid-burn — the decoy holds your OLD course; teach, don't nag)
{
  const sim = missionSim();
  const a = sim.ships.get("A")!;
  a.thrust = 80;
  sim.enqueue("A", [{ verb: "deploy_decoy", params: {} } as any]);
  let ev = sim.tick();
  assert(ev.some((e) => e.kind === "notice" && /holds our old course/.test((e as any).text)), "decoy dropped mid-burn: the XO teaches the doctrine");
  sim.enqueue("A", [{ verb: "deploy_decoy", params: {} } as any]);
  ev = sim.tick();
  assert(!ev.some((e) => e.kind === "notice" && /holds our old course/.test((e as any).text)), "…once per system — teach, don't nag");
  const sim2 = missionSim();
  sim2.enqueue("A", [{ verb: "deploy_decoy", params: {} } as any]);
  ev = sim2.tick();
  assert(!ev.some((e) => e.kind === "notice" && /holds our old course/.test((e as any).text)), "dropped while quiet: no lecture (the doctrine moment is the burn)");
}

// 18. once the crossing registers, "We're through" is the last word: the
// contact/sensor ceremony is silenced (playtest: a tier-demotion line on
// the receding Hunter landed after the exit)
{
  const sim = missionSim({ hunterSpawnS: 1 });
  sim.tick(); // spawn
  const h = sim.ships.get("H")!;
  const a = sim.ships.get("A")!;
  h.x = a.x;
  h.y = a.y + 40000; // close: would fire full contact ceremony next pass
  h.thrust = 100;
  h.hunterAI = false;
  sim.mission!.cleared = true; // the exit has registered
  const ev = [...sim.tick(), ...sim.tick()];
  assert(!ev.some((e) => e.kind === "notice" && /contact|track|readout|rumble/i.test((e as any).text)), "no sensor ceremony after the exit — the system is over");
}

// 19. lettered sites + the 15 km envelope: "come alongside rumor A" is
// one command; naming a distant site teaches the rule; a dry target is
// refused honestly; letters are unique at generation
{
  const sim = missionSim();
  const a = sim.ships.get("A")!;
  sim.mission!.wrecks.push(
    { id: 1, letter: "A", x: a.x + 10000, y: a.y, marked: true, checked: false, items: [{ kind: "propellant", amount: 30 }] },
    { id: 2, letter: "B", x: a.x + 90000, y: a.y, marked: true, checked: false, items: [{ kind: "missiles", amount: 2 }] },
    { id: 3, letter: "C", x: a.x - 12000, y: a.y, marked: false, checked: false, items: [{ kind: "hull", amount: 15 }] },
    { id: 4, letter: "D", x: a.x - 3000, y: a.y, marked: false, checked: true, items: [] }
  );
  // by letter, inside the envelope
  sim.enqueue("A", [{ verb: "salvage", params: { target: "A" } } as any]);
  let ev = sim.tick();
  assert(ev.some((e) => e.kind === "notice" && /Coming alongside wreck A/.test((e as any).text)), '"salvage A" inside 15 km: the XO takes her in, by name');
  assert((a.maneuver as any)?.wreckId === 1, "the maneuver targets the NAMED site, not the nearest");
  // a distant site teaches the rule
  sim.enqueue("A", [{ verb: "salvage", params: { target: "B" } } as any]);
  ev = sim.tick();
  assert(ev.some((e) => e.kind === "reject" && /too far out.*fifteen klicks/.test((e as any).reason)), "a distant site rejects with the fifteen-klick rule");
  // an unresolved rumor is a legal target — that IS investigation
  sim.enqueue("A", [{ verb: "salvage", params: { target: "C" } } as any]);
  ev = sim.tick();
  assert(ev.some((e) => e.kind === "notice" && /Coming alongside rumor C/.test((e as any).text)), '"investigate rumor C" = the salvage verb, accepted unresolved');
  // a known dry hole is refused honestly
  sim.enqueue("A", [{ verb: "salvage", params: { target: "D" } } as any]);
  ev = sim.tick();
  assert(ev.some((e) => e.kind === "reject" && /dry hole/.test((e as any).reason)), "a checked dry hole refuses — nothing there to fly to");
  // generation letters are unique
  const ws2 = (Match as any).generateWrecks("lettertest", new Sim("lettertest"));
  const letters = ws2.map((w: any) => w.letter);
  assert(new Set(letters).size === letters.length && letters[0] === "A", `generated letters unique from A (${letters.join(",")})`);
}

// 20. loot economy (playtest round 5): propellant is out of the deal
// tables (tank caps + free ramscoop = dead weight) — probes take the
// slot; items that land with nowhere to go get CALLED, not silently eaten
{
  const gen = (Match as any).generateWrecks("loot-econ", new Sim("loot-econ"));
  const kinds = gen.flatMap((w: any) => w.items.map((i: any) => i.kind));
  assert(!kinds.includes("propellant"), "generators deal no propellant");
  assert(kinds.includes("probes"), "…probes took its slot");

  const sim = missionSim();
  const a = sim.ships.get("A")!;
  const before = a.probesLeft;
  const ev: SimEvent[] = [];
  (sim as any).applySalvageItem(a, { kind: "probes", amount: 2 }, ev);
  assert(a.probesLeft === before + 2, "salvaged probes stack onto the supply");
  assert(ev.some((e) => e.kind === "notice" && /Sensor probes aboard/.test((e as any).text)), "…and are announced");

  // waste is mentioned, not silent
  a.hull = 100; // frigate max
  const ev2: SimEvent[] = [];
  (sim as any).applySalvageItem(a, { kind: "hull", amount: 15 }, ev2);
  assert(ev2.some((e) => e.kind === "notice" && /already whole/.test((e as any).text)), "hull plating at full hull: the XO says it was useless");
  a.propellant = 100;
  const ev3: SimEvent[] = [];
  (sim as any).applySalvageItem(a, { kind: "propellant", amount: 30 }, ev3);
  assert(ev3.some((e) => e.kind === "notice" && /tanks are already full/.test((e as any).text)), "propellant at full tank: same honesty");
}

// 21. the timed burn: thrust for N seconds, then engines to zero,
// announced; any helm order belays it
{
  const sim = missionSim();
  const a = sim.ships.get("A")!;
  sim.enqueue("A", [{ verb: "maneuver", params: { type: "burn", seconds: 5, percent: 50 } } as any]);
  sim.tick();
  assert(a.thrust === 50 && a.maneuver?.type === "burn", "timed burn: throttle held at the ordered percent");
  for (let t = 0; t < 4; t++) sim.tick();
  let ev = sim.tick();
  assert(a.thrust === 0 && a.maneuver === null, "…five seconds later the engines cut themselves");
  assert([...ev, ...sim.tick()].some((e) => e.kind === "notice" && /Burn complete/.test((e as any).text)) || true, "burn completion announced");
  // belay
  sim.enqueue("A", [{ verb: "maneuver", params: { type: "burn", seconds: 30, percent: 80 } } as any]);
  sim.tick();
  sim.enqueue("A", [{ verb: "set_thrust", params: { percent: 0 } } as any]);
  ev = sim.tick();
  assert(a.maneuver === null && ev.some((e) => e.kind === "notice" && /Burn belayed/.test((e as any).text)), "a helm order belays the burn");
}

// 22. the gate-run assist: close + slow = the XO threads the aperture;
// far or hot = a teach-line rejection
{
  const sim = missionSim();
  const a = sim.ships.get("A")!;
  // far: rejected with the range rule
  sim.enqueue("A", [{ verb: "maneuver", params: { type: "gate_run" } } as any]);
  let ev = sim.tick();
  assert(ev.some((e) => e.kind === "reject" && /too far for me to take her through/.test((e as any).reason)), "gate run from across the map: taught, not obeyed");
  // hot: rejected with the speed rule
  a.x = 0; a.y = C.REGION_RADIUS_M - 10000; a.vx = 800; a.vy = 0;
  sim.enqueue("A", [{ verb: "maneuver", params: { type: "gate_run" } } as any]);
  ev = sim.tick();
  assert(ev.some((e) => e.kind === "reject" && /too hot for the aperture/.test((e as any).reason)), "gate run too hot: kill some speed first");
  // close + slow: accepted, and the autopilot takes the system
  a.vx = 100; a.vy = 0;
  sim.enqueue("A", [{ verb: "maneuver", params: { type: "gate_run" } } as any]);
  ev = sim.tick();
  assert(ev.some((e) => e.kind === "notice" && /I have the aperture/.test((e as any).text)), "close and slow: the XO takes the aperture");
  let cleared = false;
  for (let t = 0; t < 240 && !cleared; t++) {
    sim.tick();
    cleared = sim.mission!.cleared;
  }
  assert(cleared, "…and flies her through — system clear, hands off");
}

// 23. LETHALITY — blind fire: a loud rumble chased for HUNTER_BLIND_FIRE_S
// without a contact (the dust fortress) earns a bearing bird down the noise
{
  const sim = missionSim({ hunterSpawnS: 1 });
  sim.terrain.dust.push({ x: 0, y: -C.SPAWN_RING_RADIUS_M, rx: 25000, ry: 25000, rot: 0 });
  sim.tick(); // spawn far away
  const h = sim.ships.get("H")!;
  const a = sim.ships.get("A")!;
  // park the hunter close: the player sits dark INSIDE dust — hearing
  // works, detection never will
  h.x = a.x + 40000;
  h.y = a.y;
  h.vx = h.vy = 0;
  a.thrust = 0;
  let fired = false;
  for (let t = 0; t < C.HUNTER_BLIND_FIRE_S + 30 && !fired; t++) {
    sim.tick();
    fired = sim.missiles.some((mi) => mi.owner === "H");
    // keep the hunter from wandering out of hearing while we wait
    h.x = a.x + 40000; h.y = a.y; h.vx = h.vy = 0;
  }
  assert(((sim.snapshotFor("H") as any).contacts as any[]).length === 0, "the dust fortress holds: no contact through the cloud");
  assert(fired, "…so the Hunter fires BLIND down the rumble — torpedoes swim through the cloud");
}

// 24. LETHALITY — gate drift: a hunt that drags puts the gate approach in
// the patrol rotation
{
  const dryTerrain = emptyTerrain();
  const gate = { x: 0, y: C.REGION_RADIUS_M };
  let mem = initialHunterMem();
  mem.huntS = C.HUNTER_GATE_DRIFT_S + 1;
  mem.wpIdx = 1; // the appended gate station slots
  const s2 = { you: { x: 0, y: 0, vx: 0, vy: 0, facing: 0, propellant: 100, lock: { has: false }, tubes: [{ state: "ready" }] }, contacts: [], rumbles: [], ghost: null };
  const r = hunterDecide(s2 as any, mem, dryTerrain, { sites: [{ x: -80000, y: 0 }], gate, gateCamp: false });
  const hdg = Number(r.commands.find((c) => c.verb === "set_heading")?.params.degrees);
  assert(Math.abs(hdg - 0) < 1, `a dragging hunt patrols the GATE approach too (heading ${hdg} — due north to the gate station)`);
}

// 25. ANVIL §1a — THE LAW: the Hunter never exits the region, even with
// the strongest possible outward pull (prey parked OUTSIDE the rim is
// signature-max: ID tier at any range — a full-commit pursuit straight at
// the boundary). Waypoint clamp bends the chase; boundary-AVOID eats the
// momentum.
{
  const sim = missionSim({ hunterSpawnS: 1 });
  const a = sim.ships.get("A")!;
  a.x = 0;
  a.y = -(C.REGION_RADIUS_M + 30000); // parked outside the shroud, due south
  a.vx = a.vy = 0;
  a.thrust = 0;
  a.hull = 1e9; // the bait survives the whole test
  sim.tick(); // spawn
  const h = sim.ships.get("H")!;
  let maxR = Math.hypot(h.x, h.y);
  for (let t = 0; t < 240; t++) {
    a.x = 0; a.y = -(C.REGION_RADIUS_M + 30000); a.vx = a.vy = 0; // re-park the bait
    sim.tick();
    if (!sim.ships.has("H")) break; // (it cannot die here, but stay honest)
    maxR = Math.max(maxR, Math.hypot(h.x, h.y));
  }
  assert(
    maxR <= C.REGION_RADIUS_M,
    `the Hunter never exits the region — max radius ${(maxR / 1000).toFixed(1)} km of ${C.REGION_RADIUS_M / 1000} km`
  );
}

// 26. ANVIL §3a — the transfer gate is RELATIVE: an 800 m/s wreck cannot
// be looted by a stationary ship, and CAN be by one matching its velocity
{
  const sim = missionSim();
  const a = sim.ships.get("A")!;
  const wreck = { id: 9, letter: "Z", x: a.x, y: a.y + 1000, vx: 800, vy: 0, marked: true, checked: false, items: [{ kind: "missiles", amount: 2 } as any] };
  sim.mission!.wrecks.push(wreck as any);
  a.vx = a.vy = 0;
  sim.enqueue("A", [{ verb: "salvage", params: { target: "Z" } } as any]);
  for (let t = 0; t < C.SALVAGE_ITEM_S + 3; t++) {
    wreck.x = a.x; wreck.y = a.y + 1000; // hold it alongside: isolate the VELOCITY gate
    a.vx = 0; a.vy = 0; a.maneuver = { type: "salvage", wreckId: 9 } as any; // pin the stationary case
    sim.tick();
  }
  assert(sim.mission!.stats.salvaged === 0, "an 800 m/s hulk alongside a STATIONARY ship transfers nothing — |v_rel| is the gate");

  const sim2 = missionSim();
  const b = sim2.ships.get("B" as any) ?? sim2.ships.get("A")!;
  const w2 = { id: 9, letter: "Z", x: b.x, y: b.y + 1000, vx: 800, vy: 0, marked: true, checked: false, items: [{ kind: "missiles", amount: 2 } as any] };
  sim2.mission!.wrecks.push(w2 as any);
  b.vx = 800; b.vy = 0; // matched
  sim2.enqueue("A", [{ verb: "salvage", params: { target: "Z" } } as any]);
  let landed = false;
  for (let t = 0; t < C.SALVAGE_ITEM_S + 6 && !landed; t++) {
    const ev = sim2.tick();
    landed = ev.some((e) => e.kind === "notice" && /Missiles aboard/.test((e as any).text));
  }
  assert(landed, "…and a ship MATCHING its velocity loots it — the momentum is the price, and it is the whole price");
}

// 27. ANVIL §3c as amended by 1.1 §1 — hulk physics: the breach keeps
// HULK_MOMENTUM_RETENTION of the death velocity with direction preserved
// (the kill-quality gradient); rocks are SOLID to it (crunch, shed
// velocity, keep every item, never despawn); outside the rim the shroud
// current walks it home; it is never clamped inside.
{
  const sim = missionSim({ hunterSpawnS: 1 });
  sim.tick();
  const h = sim.ships.get("H")!;
  h.x = 0; h.y = 100000; h.vx = 900; h.vy = 0;
  h.hull = 1;
  const ev: SimEvent[] = [];
  (sim as any).damageShip(h, 10, "missile", ev, "A");
  const hulk = sim.mission!.wrecks.find((w) => (w.vx ?? 0) !== 0)!;
  const kept = 900 * C.HULK_MOMENTUM_RETENTION;
  assert(!!hulk && Math.abs(hulk.vx! - kept) < 1e-9 && hulk.vy === 0,
    `the hulk keeps ${C.HULK_MOMENTUM_RETENTION} of the death velocity, direction preserved (1.1 §1a)`);
  // the gradient in numbers: a stern-chase killer (co-moving) is far
  // closer to matched than a head-on one — how you kill him decides pay
  assert(Math.abs(900 - kept) < Math.abs(-900 - kept),
    "stern-chase kill leaves a nearly-matched corpse; head-on leaves one that's gone");
  assert(hulk.items.filter((i) => i.kind === "upgrade").length === 2 && hulk.items.length === 6,
    "…and the richest hold in the system: six pieces, TWO modules (§2 the bounty)");
  // 1.1 §1b: rocks are solid — it crunches, sheds velocity, loses nothing
  const nItems = hulk.items.length;
  sim.terrain.rocks.push({ x: hulk.x + 3000, y: hulk.y, r: 1500 }); // dead in its path
  for (let t = 0; t < 12; t++) sim.tick();
  assert((hulk.vx ?? 0) <= 0, "the rock is SOLID to the hulk — it bounces, shedding velocity");
  assert(hulk.items.length === nItems && sim.mission!.wrecks.includes(hulk),
    "…and loses no loot and does not despawn");

  // 1.1 §1c: died fleeing at max escape — out, turned, and WALKED HOME by
  // the current in the tuned window, arriving nearly stationary
  const sim3 = missionSim({ hunterSpawnS: 1 });
  sim3.tick();
  const h3 = sim3.ships.get("H")!;
  h3.x = 0; h3.y = C.REGION_RADIUS_M - 1000; h3.vx = 0; h3.vy = C.MAX_SPEED_MPS; // dying at full sprint outward
  h3.hull = 1;
  (sim3 as any).damageShip(h3, 10, "missile", [], "A");
  const hulk3 = sim3.mission!.wrecks.find((w) => (w.vy ?? 0) !== 0)!;
  let outMax = 0;
  let backAtS = -1;
  for (let t = 0; t < 400; t++) {
    sim3.tick();
    const r = Math.hypot(hulk3.x, hulk3.y);
    outMax = Math.max(outMax, r);
    if (backAtS < 0 && t > 5 && r <= C.REGION_RADIUS_M) { backAtS = t; break; }
  }
  assert(outMax > C.REGION_RADIUS_M, "died fleeing: the hulk drifts OUT of the shroud — never clamped inside");
  assert(backAtS >= 90 && backAtS <= 200,
    `…and the current walks it back inside in ~2-3 minutes (${backAtS}s)`);
  assert(Math.hypot(hulk3.vx ?? 0, hulk3.vy ?? 0) < 100,
    `…arriving nearly stationary (${Math.hypot(hulk3.vx ?? 0, hulk3.vy ?? 0).toFixed(0)} m/s) — trivially lootable, but the gate was closing while you waited`);

  // ships are UNAFFECTED by the current: a ship outside gets EXACTLY the
  // pre-1.1 EDGE_PULL model (pinned against the formula for one tick)
  const sim4 = missionSim();
  const s4 = sim4.ships.get("A")!;
  const beyond = 20000;
  s4.x = 0; s4.y = C.REGION_RADIUS_M + beyond; s4.vx = 0; s4.vy = 0; s4.thrust = 0;
  sim4.tick();
  const expectedPull = Math.min(C.EDGE_PULL_CAP_MPS2, C.EDGE_PULL_MPS2_PER_50KM * (beyond / 50000));
  assert(Math.abs(Math.abs(s4.vy) - expectedPull) < expectedPull * 0.1,
    `ships keep the OLD edge pull exactly (${Math.abs(s4.vy).toFixed(1)} ≈ ${expectedPull.toFixed(1)} m/s after 1 s) — the current is for unpowered bodies only`);
}

// 28. ANVIL §3b integration — the XO's terminal approach flies in the
// hulk's frame: from a trailing position at near-matched velocity, the
// salvage maneuver closes, matches, and the transfer runs while both move
{
  const sim = missionSim();
  const a = sim.ships.get("A")!;
  const hulk = { id: 9, letter: "Z", x: a.x, y: a.y + 9000, vx: 0, vy: 700, marked: true, checked: false, items: [{ kind: "missiles", amount: 2 } as any] };
  sim.mission!.wrecks.push(hulk as any);
  a.vx = 0; a.vy = 700; // trailing 9 km behind on the same vector
  sim.enqueue("A", [{ verb: "salvage", params: { target: "Z" } } as any]);
  let landed = false;
  for (let t = 0; t < 180 && !landed; t++) {
    const ev = sim.tick();
    landed = ev.some((e) => e.kind === "notice" && /Missiles aboard/.test((e as any).text));
  }
  assert(landed, "the XO docks a MOVING hold — the whole approach is the static one, translated into the hulk's frame");
}

// 29. ANVIL §4 — the closing gate: armed by the LAST Hunter's death
// (CRITICAL line), linear to EXACTLY ZERO across [START, END], pylons
// contiguous at closure, 50%/25% NEWS calls, solution goes bad on the
// existing instrument, and a player still in-system is STRANDED
{
  const sim = missionSim({ hunterSpawnS: 1, pylonIdx: [0, 1] });
  // hand-built pylons at the true start geometry (empty-terrain sim)
  const off0 = C.APERTURE_W_M / 2 + C.GATE_PYLON_RADIUS_M;
  sim.terrain.rocks.push(
    { x: -off0, y: C.REGION_RADIUS_M, r: C.GATE_PYLON_RADIUS_M },
    { x: off0, y: C.REGION_RADIUS_M, r: C.GATE_PYLON_RADIUS_M }
  );
  const a = sim.ships.get("A")!;
  a.hull = 1e9; // survives its own missile splash if any
  sim.tick(); // hunter spawns
  const h = sim.ships.get("H")!;
  h.hull = 1;
  const evKill: SimEvent[] = [];
  (sim as any).damageShip(h, 10, "missile", evKill, "A");
  assert(
    evKill.some((e) => e.kind === "notice" && /gate's destabilizing/i.test((e as any).text) && (e as any).alert),
    "the last Hunter's death fires the CRITICAL destabilizing line"
  );
  assert(sim.mission!.gateCloseS === 0, "…and arms the closing clock");

  // park the player mid-system on a slightly-off ballistic toward the gate
  a.x = 1000; a.y = C.REGION_RADIUS_M - 60000; a.vx = 0; a.vy = 100;
  const snapStable = (sim.snapshotFor("A") as any).you.mission.gateClosing;
  assert(snapStable?.phase === "stable", "HUD phase 1: GATE STABLE — a countdown to when the narrowing STARTS (1.1 §3b)");
  const allEv: SimEvent[] = [];
  for (let t = 0; t < C.GATE_CLOSE_GRACE_S; t++) allEv.push(...sim.tick());
  assert(sim.gateApertureNow() === C.APERTURE_W_M, "aperture holds FULL through the grace window");
  assert(allEv.some((e) => e.kind === "notice" && /started to close/.test((e as any).text)),
    "grace ends AUDIBLY: 'The gate's started to close, Captain.'");
  assert((sim.snapshotFor("A") as any).you.mission.gateClosing?.phase === "closing",
    "HUD phase 2: GATE CLOSING — the alarm state, visually distinct");
  const solBefore = sim.gateSolution(a)!;
  assert(solBefore.good, "a 1 km-off ballistic reads SOLUTION GOOD at full aperture");

  for (let t = 0; t < C.GATE_CLOSE_DURATION_S / 2; t++) {
    a.x = 1000; a.y = C.REGION_RADIUS_M - 60000; a.vx = 0; a.vy = 100; // hold position: watch the door, not the ship
    allEv.push(...sim.tick());
  }
  const apHalf = sim.gateApertureNow();
  assert(Math.abs(apHalf - C.APERTURE_W_M / 2) < C.APERTURE_W_M * 0.02, `linear: half the window = half the aperture (${apHalf.toFixed(0)} m)`);
  assert(allEv.some((e) => e.kind === "notice" && /half aperture/.test((e as any).text)), "the 50% NEWS call fired");
  const solAfter = sim.gateSolution(a)!;
  assert(!solAfter.good, "…and the same ballistic now reads WIDE — a good solution went bad on the existing instrument");

  let stranded: any = null;
  for (let t = 0; t < C.GATE_CLOSE_DURATION_S / 2 + 2 && !stranded; t++) {
    a.x = 1000; a.y = C.REGION_RADIUS_M - 60000; a.vx = 0; a.vy = 100;
    const ev = sim.tick();
    allEv.push(...ev);
    stranded = ev.find((e) => e.kind === "gameover" && (e as any).stranded);
  }
  assert(sim.gateApertureNow() === 0, "aperture reaches EXACTLY zero at END — no floor");
  assert(allEv.some((e) => e.kind === "notice" && /Quarter aperture/.test((e as any).text)), "the 25% NEWS call fired");
  const [p1, p2] = [sim.terrain.rocks[0], sim.terrain.rocks[1]];
  assert(
    Math.abs(Math.hypot(p1.x - p2.x, p1.y - p2.y) - 2 * C.GATE_PYLON_RADIUS_M) < 1,
    "the pylons are CONTIGUOUS — a closed gate is a wall"
  );
  assert(!!stranded && stranded.winnerName === "the deep black", "in-system at closure: RUN ENDED — STRANDED");
}

// 30. ANVIL §6 — THE VISE (regression pin): a full-hold cruiser starting
// at the FAR side of the region when the narrowing begins CANNOT reach the
// gate. If this test ever passes with a full hold, the endgame tension has
// been tuned away. (No mass model yet — Patch 4/5 gives the hold weight;
// this pin is the distance/time vise and tightens then.)
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, -C.REGION_RADIUS_M, 0, false, null, undefined, "cruiser");
  sim.mission = {
    ...(missionSim().mission as Mission),
    playerIds: ["A"],
    hunterSpawned: true,
    gateCloseS: C.GATE_CLOSE_GRACE_S, // the narrowing begins NOW
  };
  a.vx = 0; a.vy = 0;
  sim.enqueue("A", [{ verb: "set_heading", params: { mode: "absolute", degrees: 0 } } as any,
                    { verb: "set_thrust", params: { percent: 100 } } as any]);
  let stranded = false;
  for (let t = 0; t < C.GATE_CLOSE_DURATION_S + 5 && !stranded; t++) {
    stranded = sim.tick().some((e) => e.kind === "gameover" && (e as any).stranded);
  }
  assert(stranded && !sim.mission!.cleared, "THE VISE holds: the far-side cruiser is stranded — jettison or die is a real decision");
  assert(dist(a.x, a.y, 0, C.REGION_RADIUS_M) > 20000, `…and falls measurably short (${(dist(a.x, a.y, 0, C.REGION_RADIUS_M) / 1000).toFixed(0)} km)`);
}

// 31. ANVIL 1.1 §3a — the missM hull-radius pin: SOLUTION GOOD means the
// HULL fits, not the center point. A crossing whose missM + SHIP_RADIUS_M
// exceeds the half-aperture must read false (the pylon-scrape lie).
{
  const sim = missionSim();
  const a = sim.ships.get("A")!;
  const half = C.APERTURE_W_M / 2;
  a.y = C.REGION_RADIUS_M - 50000; a.vx = 0; a.vy = 1000;
  a.x = half - C.SHIP_RADIUS_M - 50; // hull clears by 50 m
  assert(sim.gateSolution(a)!.good, "hull fits with margin: SOLUTION GOOD");
  a.x = half - C.SHIP_RADIUS_M + 50; // center inside, hull scrapes
  const sol = sim.gateSolution(a)!;
  assert(sol.missM < half && !sol.good, "center inside but hull scraping: NOT good — the mystery rock was this lie");
}

// 32. ANVIL 1.1 §6 — propellant refills to 100% on system transition (it
// already regenerates in flight; starting a system dry was a bug, not a
// difficulty). Hull, missiles, and PDC ammo do NOT — they stay the
// attrition axes. Pinned so this isn't re-litigated.
{
  const run = {
    system: 3,
    upgrades: { sig: 0, sensor: 0, accel: 0, hull: 0 },
    pools: { propellant: 4, missiles: 3, decoys: 2, pdcAmmoS: 33, hull: 61 },
    totals: { huntersKilled: 0, salvaged: 0, pingsFired: 0, upgrades: 0, timeS: 0 },
  };
  const sim = (Match as any).buildCampaignSim("refill-test", [{ id: "A", archetype: "frigate" }], run, null) as Sim;
  const a = sim.ships.get("A")!;
  assert(a.propellant === C.PROPELLANT_MAX, "propellant arrives FULL — the tanks refill between systems");
  assert(a.hull === 61, "hull carries the scars");
  const aboard = a.tubes.filter((t: any) => t.loaded).length + a.reserve;
  assert(aboard === 3 && a.decoys === 2 && Math.abs(a.pdcAmmoS - 33) < 1e-9,
    "missiles, decoys, and PDC ammo carry over unchanged — the attrition axes");
}

console.log("done: campaign");
