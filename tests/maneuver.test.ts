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

// ANVIL 1.1 §2 — maneuver discipline: the autopilot throttle ceiling.
// Default STANDARD (60, down from the old 100 — deliberate); a per-command
// override caps that command only and leaves the posture unchanged; a
// SILENT stop takes ~4× the distance of a FLANK one; the XO quotes the
// price; timed burns are exempt (the captain named the percent).
{
  // helper: run a full stop from `v0` at the given posture/override and
  // return {maxThrust, distance}
  const runStop = (posture: C.Discipline | null, override: C.Discipline | null) => {
    const sim = new Sim();
    const a = sim.addShip("A", 0, 0, 0);
    a.pdcPosture = "hold";
    a.vx = 0; a.vy = 1500;
    if (posture) a.discipline = posture;
    const params: Record<string, unknown> = { type: "full_stop" };
    if (override) params.discipline = override;
    sim.enqueue("A", [{ verb: "maneuver", params } as any]);
    let maxThrust = 0;
    let yBurn: number | null = null; // distance from BURN start (the flip is constant overhead)
    for (let t = 0; t < 400 && (a.maneuver || sim.speedOf(a) >= 5); t++) {
      sim.tick();
      if (yBurn === null && a.thrust > 0) yBurn = a.y;
      maxThrust = Math.max(maxThrust, a.thrust);
    }
    return { maxThrust, distance: Math.abs(a.y - (yBurn ?? a.y)), ship: a, sim };
  };

  const std = runStop(null, null);
  assert(std.maxThrust <= C.DISCIPLINE_CAP.standard && std.maxThrust > 0,
    `default posture is STANDARD: autopilot never exceeds ${C.DISCIPLINE_CAP.standard}% (saw ${std.maxThrust})`);

  const silent = runStop("silent", null);
  assert(silent.maxThrust <= C.DISCIPLINE_CAP.silent,
    `SILENT posture: never above ${C.DISCIPLINE_CAP.silent}% (saw ${silent.maxThrust})`);

  const flank = runStop(null, "flank");
  assert(flank.maxThrust > C.DISCIPLINE_CAP.standard,
    "a per-command flank override outruns the standing posture");
  assert(flank.ship.discipline === "standard",
    "…and leaves the posture unchanged (override is for that command only)");

  const ratio = silent.distance / flank.distance;
  assert(ratio > 3 && ratio < 5.5,
    `a SILENT stop takes ~4× the distance of a FLANK one (${ratio.toFixed(1)}×)`);

  // the posture verb: cap applies, the ship speaks the line
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  a.pdcPosture = "hold";
  sim.enqueue("A", [{ verb: "set_maneuver_discipline", params: { level: "silent" } } as any]);
  const ev = sim.tick();
  assert(a.discipline === "silent", "set_maneuver_discipline sets the standing posture");
  assert(ev.some((e) => e.kind === "notice" && /discipline silent.*twenty-five/i.test((e as any).text)),
    "…and the XO names the cap aloud");
  sim.enqueue("A", [{ verb: "set_maneuver_discipline", params: { level: "loud" } } as any]);
  assert(sim.tick().some((e) => e.kind === "reject"), "an unknown level rejects");

  // the price is quoted: silent full_stop speaks an ETA; flank warns
  a.vx = 0; a.vy = 1500;
  sim.enqueue("A", [{ verb: "maneuver", params: { type: "full_stop" } } as any]);
  const evS = sim.tick();
  assert(evS.some((e) => e.kind === "notice" && /Silent approach — about \d+ minute/.test((e as any).text)),
    "accepting a maneuver under SILENT quotes the cost in minutes");
  sim.enqueue("A", [{ verb: "maneuver", params: { type: "full_stop", discipline: "flank" } } as any]);
  const evF = sim.tick();
  assert(evF.some((e) => e.kind === "notice" && /Flank — full burn/.test((e as any).text)),
    "accepting a FLANK maneuver warns about the noise");

  // timed burns are exempt: the captain's percent wins over the posture
  sim.enqueue("A", [{ verb: "set_thrust", params: { percent: 0 } } as any]);
  sim.tick();
  sim.enqueue("A", [{ verb: "maneuver", params: { type: "burn", seconds: 3, percent: 90 } } as any]);
  sim.tick();
  assert(a.thrust === 90, "a timed burn at 90% runs at 90% even under SILENT — the captain named the number");

  // validator: discipline enum on maneuver + salvage, and the new verb
  assert(validateCommand({ verb: "maneuver", params: { type: "full_stop", discipline: "silent" } } as any) !== null, "validator: full_stop + discipline");
  assert(validateCommand({ verb: "maneuver", params: { type: "full_stop", discipline: "sneaky" } } as any) === null, "validator: bad discipline rejected");
  assert(validateCommand({ verb: "salvage", params: { target: "A", discipline: "flank" } } as any) !== null, "validator: salvage + discipline");
  assert(validateCommand({ verb: "set_maneuver_discipline", params: { level: "flank" } } as any) !== null, "validator: the posture verb");
}

console.log("done");
