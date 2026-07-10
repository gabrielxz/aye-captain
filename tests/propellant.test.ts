import { Sim, effectiveThrust } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

// 1. burn scales linearly with thrust; turning is free
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 40000, 180, true);
  sim.enqueue("A", [{ verb: "set_thrust", params: { percent: 100 } }]);
  for (let i = 0; i < 10; i++) sim.tick();
  // 10s at full burn; regen doesn't apply (thrust > 20%)
  assert(Math.abs(a.propellant - (C.PROPELLANT_MAX - 10 * C.PROPELLANT_BURN_AT_FULL)) < 1e-6, `full thrust burns ${C.PROPELLANT_BURN_AT_FULL}/s (at ${a.propellant.toFixed(1)})`);

  const sim2 = new Sim();
  const a2 = sim2.addShip("A", 0, 0, 0);
  sim2.addShip("B", 0, 40000, 180, true);
  sim2.enqueue("A", [{ verb: "set_heading", params: { mode: "absolute", degrees: 180 } }]);
  for (let i = 0; i < 10; i++) sim2.tick();
  // thrust 0 (<= 20%): only regen applies, capped at max
  assert(a2.propellant === C.PROPELLANT_MAX, "turning at zero thrust burns nothing");
}

// 2. regen only inside zone AND throttle setting <= 20%
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0); // inside zone
  sim.addShip("B", 0, 40000, 180, true);
  a.propellant = 50;
  a.thrust = C.REGEN_MAX_THRUST_PCT; // exactly at the ceiling
  sim.tick();
  const expected = 50 - (C.REGEN_MAX_THRUST_PCT / 100) * C.PROPELLANT_BURN_AT_FULL + C.PROPELLANT_REGEN_PER_S;
  assert(Math.abs(a.propellant - expected) < 1e-6, `regen at <=20% throttle inside zone (${a.propellant.toFixed(2)})`);

  a.thrust = C.REGEN_MAX_THRUST_PCT + 1; // just over: burn only
  const before = a.propellant;
  sim.tick();
  assert(a.propellant < before, "no regen just above the throttle ceiling");

  const sim2 = new Sim();
  const a2 = sim2.addShip("A", 0, C.ZONE_RADIUS_M + 3000, 0); // OUTSIDE zone
  sim2.addShip("B", 0, -40000, 180, true);
  a2.propellant = 50;
  a2.thrust = 0;
  sim2.tick();
  assert(a2.propellant === 50, "zero regen outside the zone, ever");
}

// 3. tanks dry: output forced to 0, setting remembered, coasting + turning work,
// signature goes dim, refuel resumes thrust
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 40000, 180, true);
  a.propellant = 1.5;
  sim.enqueue("A", [{ verb: "set_thrust", params: { percent: 100 } }]);
  sim.tick(); // burns 1.0
  sim.tick(); // burns to 0 (0.5 left -> 0, clamped)
  sim.tick();
  assert(a.propellant === 0, "tank empty");
  assert(a.thrust === 100, "throttle setting remembered");
  assert(effectiveThrust(a) === 0, "no thrust output when dry");
  assert(sim.signatureOf(a) === C.SHIP_BASE_SIGNATURE, "dry ship signature drops to base (dim)");
  const [vx, vy] = [a.vx, a.vy];
  sim.enqueue("A", [{ verb: "set_heading", params: { mode: "absolute", degrees: 90 } }]);
  sim.tick();
  assert(a.vx === vx && a.vy === vy, "coasts under Newton while dry");
  assert(a.facing > 0, "turning still works while dry");
  // refuel via regen: drop throttle setting under the ceiling
  sim.enqueue("A", [{ verb: "set_thrust", params: { percent: 10 } }]);
  for (let i = 0; i < 4; i++) sim.tick();
  assert(a.propellant > 0, "ramscoop refuels at low throttle inside zone");
  assert(effectiveThrust(a) === 10, "thrust output resumes once fuel regenerates");
}

// 4. warnings at 50/25/10/0, edge-triggered, re-armed on recovery
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 40000, 180, true);
  sim.enqueue("A", [{ verb: "set_thrust", params: { percent: 100 } }]);
  const warnings: string[] = [];
  for (let i = 0; i < 110; i++) {
    for (const e of sim.tick()) {
      if (e.kind === "notice" && e.ship === "A" && /[Pp]ropellant|Tanks dry/.test(e.text)) warnings.push(e.text);
    }
  }
  assert(warnings.length === 4, `exactly 4 warnings on the way down (got ${warnings.length})`);
  assert(/one-half/.test(warnings[0]) && /one-quarter/.test(warnings[1]) && /critical/.test(warnings[2]) && /Tanks dry/.test(warnings[3]), "warnings in order: 50, 25, 10, empty");
}

// 5. drone exempt: no burn, no warnings
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  const drone = sim.addShip("B", 0, 8000, 180, true);
  for (let i = 0; i < 20; i++) sim.tick();
  assert(drone.propellant === C.PROPELLANT_MAX, "drone burns no propellant");
  assert(sim.signatureOf(drone) === C.SHIP_BASE_SIGNATURE + C.DRONE_THRUST_PERCENT, "drone signature unchanged");
}

// 6. standing-order metric propellant_percent
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 40000, 180, true);
  a.propellant = 30;
  sim.enqueue("A", [{
    verb: "set_standing_order",
    params: {
      label: "fuel guard",
      condition: { metric: "propellant_percent", op: "lt", value: 35 },
      actions: [{ verb: "set_thrust", params: { percent: 10 } }],
    },
  } as any]);
  sim.tick();
  const ev = sim.tick();
  assert(ev.some(e => e.kind === "notice" && /'fuel guard' triggered/.test((e as any).text)), "propellant_percent standing order fires");
  assert(a.thrust === 10, "fuel guard action applied");
}
console.log("done");
