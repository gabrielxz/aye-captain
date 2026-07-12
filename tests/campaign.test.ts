// Campaign "Deep Black" Stage 0 (HANDOFF-CAMPAIGN-v1.md): mission clock,
// no-pop-in Hunter spawn, gate geometry + approach solution, the aperture
// derivation pin (ALL THREE archetypes — the spread is intentional), the
// victory guard, and the Match-level campaign lifecycle.
import { Sim, dist, type Mission, type SimEvent } from "../server/sim.js";
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
    playerId: "A",
    system: 2, // "Sharp Ears" — the Stage 0 baseline row
    systemName: "Sharp Ears",
    gate: { x: 0, y: C.REGION_RADIUS_M, apertureW: C.APERTURE_W_M },
    hunterSpawnS: C.CAMPAIGN_HUNTER_SPAWN_S,
    hunterSpawned: false,
    hunterIds: [],
    hunters: [{ archetype: "corvette", sensorMult: C.HUNTER_SENSOR_MULT, sigMult: C.HUNTER_SIG_MULT, gateCamp: false }],
    spawnLine: "Clock's run out, Captain — a drive just lit off in-system.",
    wrecks: [],
    salvaging: null,
    cleared: false,
    stats: { huntersKilled: 0, salvaged: 0, pingsFired: 0, upgrades: 0 },
    haul: [],
    decoyTaught: false,
    upgradeCounts: { sig: 0, sensor: 0, accel: 0, hull: 0 },
    solGood: false,
    solCooldownS: 0,
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
  assert(match.sim.ships.get("A")!.propellant === 61, "pools arrive as you left them — the campaign economy");
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

console.log("done: campaign");
