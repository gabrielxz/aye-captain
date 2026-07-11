// v4.2 spectator presence: omniscient referee snapshot, callsign pool with
// first-come reuse and -2 suffixes, silent roster broadcasts, and the fog
// guarantee that player snapshots gain nothing from spectator support.
import { Sim, type Ship } from "../server/sim.js";
import { Match } from "../server/match.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};
const grantLock = (ship: Ship) => {
  ship.lock = { progress: C.LOCK_TIME_S, has: true, grace: C.LOCK_GRACE_S };
};

// 1. snapshotSpectator is omniscient: both ships in full detail plus ALL
// ordnance, regardless of what either player could sense
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, -100000, 0);
  const b = sim.addShip("B", 0, 100000, 180); // 200 km apart: mutually dark at low sig
  a.thrust = 100;
  grantLock(a);
  sim.enqueue("A", [{ verb: "fire_missile", params: {} }]);
  sim.enqueue("B", [{ verb: "deploy_decoy", params: {} }]);
  sim.tick();

  const spec = sim.snapshotSpectator() as any;
  assert(spec.spectator === true, "snapshot is flagged spectator");
  assert(spec.ships.length === 2, "both ships present");
  const sa = spec.ships.find((s: any) => s.id === "A");
  const sb = spec.ships.find((s: any) => s.id === "B");
  assert(sa.hull === a.hull && sb.hull === b.hull, "full hull detail on both ships");
  assert(sa.thrustOut === 100, "thrust output visible");
  assert(typeof sb.facing === "number" && typeof sb.vx === "number", "vectors on both ships");
  assert(spec.contacts.length === 0 && spec.ghost === null, "no fog artifacts in spectator view");

  const allMissiles = (sim as any).missiles.length;
  const allDecoys = (sim as any).decoys.length;
  assert(allMissiles === 1 && spec.missiles.length === allMissiles, "every missile visible");
  assert(allDecoys === 1 && spec.decoys.length === allDecoys, "every decoy visible");
  assert(spec.missiles[0].own === true, "A's missile colored as ship A (own=true)");
  assert(spec.decoys[0].own === false, "B's decoy colored as ship B (own=false)");

  // fog guarantee: the player-facing snapshot did not grow spectator data
  const forA = sim.snapshotFor("A") as any;
  assert(forA.ships === undefined && forA.spectator === undefined, "player snapshot has no spectator fields");
  assert((forA.decoys as any[]).every((d) => d.own), "player A still can't see B's decoy at 200 km");
}

// 2. Match-level callsigns and roster broadcasts (fake sockets, no network)
{
  const fakeWs = () => {
    const ws = { sent: [] as any[], readyState: 1, OPEN: 1, send(s: string) { ws.sent.push(JSON.parse(s)); } };
    return ws;
  };
  const wsA = fakeWs();
  const wsB = fakeWs();
  const match = Match.createRoom("TEST", wsA as any);
  match.joinOrReconnect(wsB as any);

  const transcriptsBefore = wsA.sent.filter((m) => m.type === "transcript").length;

  // pool assignment in order, then -2 suffixes on exhaustion
  const specs = Array.from({ length: 9 }, () => fakeWs());
  const names = specs.map((ws) => match.addSpectator(ws as any));
  const expected = [...C.SPECTATOR_CALLSIGNS, `${C.SPECTATOR_CALLSIGNS[0]}-2`];
  assert(JSON.stringify(names) === JSON.stringify(expected), `pool assigns in order with -2 reuse (${names.join(", ")})`);

  // spectator got a start message carrying role/callsign/terrain
  const start = specs[2].sent.find((m) => m.type === "start");
  assert(start?.role === "spectator" && start?.callsign === "Echo" && !!start?.terrain, "spectator start has role, callsign, terrain");

  // players see live rosters, silently
  const rosters = wsA.sent.filter((m) => m.type === "spectators");
  assert(rosters.length === 9 && rosters.at(-1).names.length === 9, "player received a roster per join");
  const transcriptsAfter = wsA.sent.filter((m) => m.type === "transcript").length;
  assert(transcriptsAfter === transcriptsBefore, "spectator joins produced no transcript events");

  // leave frees the callsign for the next joiner (first-come reuse)
  match.detach(specs[2] as any); // Echo leaves
  assert(wsA.sent.filter((m) => m.type === "spectators").at(-1).names.includes("Echo") === false, "roster updates on leave");
  const reused = match.addSpectator(fakeWs() as any);
  assert(reused === "Echo", "freed callsign is reassigned first");

  // rematch re-sends start with the SAME callsign (identity survives reset)
  specs[0].sent.length = 0;
  match.reset();
  const restart = specs[0].sent.find((m) => m.type === "start");
  assert(restart?.role === "spectator" && restart?.callsign === "Ghost", "rematch keeps the spectator's callsign");
  assert(specs[0].sent.some((m) => m.type === "spectators"), "rematch re-broadcasts the roster");

  // gameover reaches spectators without a youWin verdict
  (match as any).routeEvent({
    kind: "gameover", winner: "A", winnerName: "Kestrel",
    placements: ["A", "B"], placementNames: ["Kestrel", "Drone"],
  });
  const over = specs[0].sent.find((m) => m.type === "gameover");
  assert(over?.winner === "Kestrel" && over?.youWin === undefined, "spectator gameover names the winner, no youWin");

  match.destroy();
}
