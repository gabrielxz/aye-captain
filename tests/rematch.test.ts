// v5.1 §7: rematch is a ready-up vote (one impatient captain can't relaunch
// the room; leavers don't block), practice picks archetypes for both hulls,
// and the practice REMATCH regression: it used to respawn via spawnShips()
// — captain alone, NO DRONE, an empty range.
import { Match } from "../server/match.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

const fakeWs = () => {
  const ws = { sent: [] as any[], readyState: 1, OPEN: 1, send(s: string) { ws.sent.push(JSON.parse(s)); } };
  return ws;
};

// 1. §7.1 practice archetype picks — both hulls, stats applied, drone present
{
  const ws = fakeWs();
  const match = Match.createPractice(ws as any, "corvette", "cruiser");
  match.stop();
  const sim: any = match.sim;
  assert(sim.ships.get("A").archetype === "corvette", "own ship flies the picked archetype");
  const drone = sim.ships.get("B");
  assert(drone.isDrone === true && drone.archetype === "cruiser", "the sparring drone flies ITS picked archetype");
  // §0 guardrail: the archetype gives the drone its shape/signature/
  // handling, NOT a hull change — drones keep DRONE_HULL_POINTS (60) so
  // practice difficulty is untouched (no balance changes in v5.1)
  assert(drone.hull === C.DRONE_HULL_POINTS, "drone hull stays the fixed practice value");
  const bogus = Match.createPractice(fakeWs() as any, "battlestar", "nonsense");
  bogus.stop();
  assert((bogus.sim as any).ships.get("A").archetype === "frigate", "unknown archetypes fall back to frigate");
}

// 2. the practice-rematch regression: the drone survives a reset
{
  const ws = fakeWs();
  const match = Match.createPractice(ws as any, "corvette", "cruiser");
  match.stop();
  (match.sim as any).winner = "A"; // end it by fiat
  match.voteRematch(ws as any, false); // practice: one vote relaunches
  match.stop();
  const sim: any = match.sim;
  assert(sim.winner === null || sim.winner === undefined ? true : sim.winner === null, "practice rematch produced a fresh sim");
  assert(!!sim.ships.get("B") && sim.ships.get("B").isDrone, "REGRESSION: practice rematch still spawns the drone");
  assert(sim.ships.get("A").archetype === "corvette" && sim.ships.get("B").archetype === "cruiser", "practice rematch keeps both picks");
}

// 3. §7.3 the ready-up: votes accumulate, tally broadcasts, all-connected
//    fires, majority picks the field
{
  const wsA = fakeWs();
  const wsB = fakeWs();
  const wsC = fakeWs();
  const match = Match.createRoom("REMA", wsA as any);
  match.joinOrReconnect(wsB as any);
  match.joinOrReconnect(wsC as any);
  assert(match.launch(wsA as any) === null, "3-captain launch");
  match.stop();
  const firstSeed = match.sim.terrain.seed;
  (match.sim as any).winner = "A";

  match.voteRematch(wsA as any, false);
  assert((match.sim as any).winner === "A", "one vote does not relaunch the room");
  const tally = [...wsB.sent].reverse().find((m) => m.type === "rematch_tally");
  assert(tally?.ready === 1 && tally?.total === 3, `everyone sees the tally (got ${JSON.stringify(tally)})`);

  match.voteRematch(wsB as any, true);
  assert((match.sim as any).winner === "A", "two of three: still waiting");
  match.voteRematch(wsC as any, true);
  match.stop();
  assert(!(match.sim as any).winner, "all connected ready -> relaunch");
  assert(match.sim.terrain.seed !== firstSeed, "majority wanted a NEW field (2 of 3)");
}

// 4. §7.3 leavers don't block — and a departure can complete the vote
{
  const wsA = fakeWs();
  const wsB = fakeWs();
  const wsC = fakeWs();
  const match = Match.createRoom("REMB", wsA as any);
  match.joinOrReconnect(wsB as any);
  match.joinOrReconnect(wsC as any);
  match.launch(wsA as any);
  match.stop();
  const firstSeed = match.sim.terrain.seed;
  (match.sim as any).winner = "B";

  assert(match.canRematch(), "rematch possible with everyone present");
  match.voteRematch(wsA as any, false);
  match.voteRematch(wsB as any, false);
  // C closes the tab instead of voting — the old code bricked rematch here
  match.detach(wsC as any);
  match.stop();
  assert(!(match.sim as any).winner, "the leaver's departure completes the ready-up");
  assert(match.sim.terrain.seed === firstSeed, "unanimous same-field keeps the terrain");
  assert(!!(match.sim as any).ships.get("C"), "the absent captain's ship spawns as a ghost seat");
}
console.log("done");
