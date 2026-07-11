// v5 §2 match-level flows the sim tests can't see: DEATH -> SPECTATOR
// inflow (XO sign-off, spectator start, seat kept), gameover routing with
// placements, and rematch re-seating the fallen captain with same picks.
import { Match } from "../server/match.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};
const fakeWs = () => {
  const ws = { sent: [] as any[], readyState: 1, OPEN: 1, send(s: string) { ws.sent.push(JSON.parse(s)); } };
  return ws;
};

// 3-captain room; C dies mid-match; the match keeps running; C flows to
// spectator; then B dies and A wins with placements
{
  const wsA = fakeWs();
  const wsB = fakeWs();
  const wsC = fakeWs();
  const match = Match.createRoom("MFLW", wsA as any);
  match.joinOrReconnect(wsB as any);
  match.joinOrReconnect(wsC as any);
  assert(match.launch(wsA as any) === null, "3-captain launch");
  match.stop(); // deterministic: we drive events by hand below

  const sim: any = match.sim;
  const cs = (id: string) => sim.ships.get(id).callsign as string;
  const [csA, csB, csC] = [cs("A"), cs("B"), cs("C")];
  const kill = (id: string, attacker: string) => {
    const ship = sim.ships.get(id);
    ship.hull = 1;
    const events: any[] = [];
    sim.damageShip(ship, 10, "missile", events, attacker);
    for (const ev of events) (match as any).routeEvent(ev);
  };

  kill("C", "A");
  const honor = wsC.sent.filter((m) => m.type === "transcript" && /honor/.test(m.text));
  assert(honor.length === 1, "the XO signs off to the fallen captain");
  const specStart = wsC.sent.find((m) => m.type === "start" && m.role === "spectator");
  assert(!!specStart && specStart.callsign === csC, "dead captain flows into the spectator pipeline, named by their ship's callsign");
  assert(wsC.sent.indexOf(honor[0]) < wsC.sent.indexOf(specStart), "sign-off lands before the spectator transition");
  assert(!wsA.sent.some((m) => m.type === "gameover"), "match continues with two hostiles alive");

  kill("B", "A");
  const overA = wsA.sent.find((m) => m.type === "gameover");
  assert(!!overA && overA.youWin === true && overA.winner === "A", "winner gets youWin");
  assert(
    Array.isArray(overA.placements) && overA.placements.join(",") === [csA, csB, csC].join(","),
    `placements on the banner as callsigns, winner first (got ${overA?.placements})`
  );
  const overC = wsC.sent.find((m) => m.type === "gameover");
  assert(!!overC && overC.youWin === false, "the fallen captain hears the result too");

  // rematch: same seats, dead captains re-seated as players
  assert(match.canRematch(), "rematch allowed — every captain still connected");
  match.reset(false);
  const reseat = wsC.sent.filter((m) => m.type === "start").pop();
  assert(!!reseat && reseat.role === "C", "rematch re-seats the fallen captain on their ship");
  assert(match.sim.ships.has("A") && match.sim.ships.has("B") && match.sim.ships.has("C"), "fresh sim has all three ships");
  match.destroy();
}

console.log("done: matchflow");
