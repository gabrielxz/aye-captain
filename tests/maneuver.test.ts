// §7 maneuvers: full_stop autopilot macro + show_vector ui event.
import { Sim } from "../server/sim.js";
import { validateCommand } from "../server/translator.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

// 1. full stop: flip to retrograde, burn, cut at < 5 m/s, with XO lines
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0); // facing north
  sim.addShip("B", 0, 200000, 180, false);
  a.vx = 0;
  a.vy = 1200; // northbound at 1200 m/s
  const heard: string[] = [];
  sim.enqueue("A", [{ verb: "maneuver", params: { type: "full_stop" } }]);
  let stopped = false;
  for (let i = 0; i < 60 && !stopped; i++) {
    for (const e of sim.tick()) {
      if (e.kind === "notice") heard.push((e as any).text);
    }
    stopped = a.maneuver === null && sim.speedOf(a) < 5;
  }
  assert(heard.some((t) => /Flipping to kill our velocity/.test(t)), "start announcement");
  assert(heard.some((t) => /Answering all stop/.test(t)), "completion announcement");
  assert(sim.speedOf(a) < 5, `ship stopped (speed ${sim.speedOf(a).toFixed(1)})`);
  assert(a.thrust === 0 && a.maneuver === null, "thrust cut, maneuver cleared");
  assert(Math.abs(Math.abs(a.facing - 180)) < 30, `flipped to retrograde-ish (facing ${a.facing.toFixed(0)})`);
}

// 2. cancelled by any thrust/heading order
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  a.vy = 1000;
  sim.enqueue("A", [{ verb: "maneuver", params: { type: "full_stop" } }]);
  sim.tick();
  assert(a.maneuver !== null, "maneuver active");
  const ev = sim.tick();
  void ev;
  sim.enqueue("A", [{ verb: "set_thrust", params: { percent: 50 } }]);
  const ev2 = sim.tick();
  assert(a.maneuver === null, "thrust order cancels the maneuver");
  assert(ev2.some((e) => e.kind === "notice" && /belayed/.test((e as any).text)), "belay notice");
  assert(a.thrust === 50, "the cancelling order applies");
}

// 3. already stopped: rejected; dry tanks: stall announcement + cancel
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  sim.enqueue("A", [{ verb: "maneuver", params: { type: "full_stop" } }]);
  const ev = sim.tick();
  assert(ev.some((e) => e.kind === "reject" && /already stopped/.test((e as any).reason)), "no-op stop rejected");

  const sim2 = new Sim();
  const a2 = sim2.addShip("A", 0, 0, 0);
  sim2.addShip("B", 0, 200000, 180, false);
  a2.vy = 2000;
  a2.propellant = 0.5; // nowhere near enough
  sim2.enqueue("A", [{ verb: "maneuver", params: { type: "full_stop" } }]);
  let stalled = false;
  for (let i = 0; i < 40 && !stalled; i++) {
    stalled = sim2.tick().some((e) => e.kind === "notice" && /can't finish the stop/.test((e as any).text));
  }
  assert(stalled, "dry tanks stall the maneuver with a report");
  assert(a2.maneuver === null, "stalled maneuver cleared");
}

// 4. show_vector: ui event routed to the owner
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  sim.enqueue("A", [{ verb: "show_vector", params: {} }]);
  const ev = sim.tick();
  assert(
    ev.some((e) => e.kind === "ui" && (e as any).what === "show_vector" && (e as any).ship === "A"),
    "show_vector emits a ui event"
  );
}

// 5. validator accepts the new verbs, rejects junk
{
  assert(validateCommand({ verb: "maneuver", params: { type: "full_stop" } }) !== null, "maneuver full_stop valid");
  assert(validateCommand({ verb: "maneuver", params: { type: "barrel_roll" } }) === null, "unknown maneuver rejected");
  assert(validateCommand({ verb: "show_vector", params: {} }) !== null, "show_vector valid");
  assert(validateCommand({ verb: "fire_laser", params: {} }) === null, "fire_laser is gone");
}

console.log("done");
