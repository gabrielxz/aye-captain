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
    gate: { x: 0, y: C.REGION_RADIUS_M, apertureW: C.APERTURE_W_M },
    hunterSpawnS: C.CAMPAIGN_HUNTER_SPAWN_S,
    hunterSpawned: false,
    hunterId: null,
    hunter: { archetype: "corvette", sensorMult: C.HUNTER_SENSOR_MULT, sigMult: C.HUNTER_SIG_MULT },
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

// 6. gate crossing: swept, outward-only, one substep at full speed
{
  // outward crossing wins
  const sim = missionSim();
  const a = sim.ships.get("A")!;
  a.x = 0; a.y = C.REGION_RADIUS_M - 500; a.vx = 0; a.vy = 3000;
  const ev = sim.tick();
  assert(sim.winner === "A", "outward crossing at 3 km/s: caught by the swept test in one substep");
  const over = ev.find((e) => e.kind === "gameover") as any;
  assert(!!over && over.gateCleared === true && over.winner === "A", "gameover carries gateCleared");
  assert(ev.some((e) => e.kind === "notice" && /We're through/.test((e as any).text)), "the XO calls the exit");

  // inward crossing does not win (you fly OUT through the gate)
  const sim2 = missionSim();
  const a2 = sim2.ships.get("A")!;
  a2.x = 0; a2.y = C.REGION_RADIUS_M + 500; a2.vx = 0; a2.vy = -3000;
  sim2.tick();
  assert(sim2.winner === null, "inward crossing is not an exit");

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
  assert(mission.hunter.archetype === "corvette" && mission.hunterSpawnS === C.CAMPAIGN_HUNTER_SPAWN_S, "mission spec armed");
  assert(match.sim.ships.get("A")!.archetype === "corvette", "player flies the picked hull");

  // dev-harness runtime knobs
  match.handleUtterance(ws as any, '{"mission":{"sigMult":0.5,"sensorMult":2}}');
  assert(mission.hunter.sigMult === 0.5 && mission.hunter.sensorMult === 2, "mission tune updates the spec live");
  assert(ws.sent.some((m) => m.type === "transcript" && m.who === "xo-note" && /mission tune/.test(m.text)), "tune echoes as an XO note");

  // fly out: place the player on the aperture line, moving outward
  const g = mission.gate;
  const R = Math.hypot(g.x, g.y);
  const ux = g.x / R;
  const uy = g.y / R;
  const a = match.sim.ships.get("A")!;
  a.x = g.x - ux * 400;
  a.y = g.y - uy * 400;
  a.vx = ux * 3000;
  a.vy = uy * 3000;
  for (let i = 0; i < 20 && !match.sim.winner; i++) (match as any).physicsStep();
  const over = ws.sent.find((m) => m.type === "gameover");
  assert(!!over && over.youWin === true && over.gateCleared === true, "gate clear reaches the client as a gateCleared win");

  // retry: the ready-up needs exactly one vote, and the clock re-arms
  assert(match.canRematch(), "campaign can retry");
  (match as any).voteRematch(ws as any, false);
  assert(match.sim.winner === null && match.sim.tickCount === 0, "retry rebuilds the mission sim");
  assert(match.sim.mission !== null && !match.sim.mission.hunterSpawned, "retry re-arms the clock");
  assert(match.sim.ships.has("A") && !match.sim.ships.has("H"), "fresh system: captain alone again");
  match.destroy();
}

console.log("done: campaign");
