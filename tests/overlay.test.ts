// v4.7 §2: set_overlay — a pure ui event; toggles client overlays, mutates
// no sim state, and the XO speaks the right stock line for the ship's state.
import { Sim } from "../server/sim.js";
import { validateCommand } from "../server/translator.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

// 1. validation: exactly {element:"drift", state:"on"|"off"}
{
  assert(validateCommand({ verb: "set_overlay", params: { element: "drift", state: "on" } }) !== null, "set_overlay drift on valid");
  assert(validateCommand({ verb: "set_overlay", params: { element: "drift", state: "off" } }) !== null, "set_overlay drift off valid");
  assert(validateCommand({ verb: "set_overlay", params: { element: "prograde", state: "on" } }) === null, "unknown element rejected");
  assert(validateCommand({ verb: "set_overlay", params: { element: "drift", state: "maybe" } }) === null, "unknown state rejected");
  assert(validateCommand({ verb: "set_overlay", params: { state: "on" } }) === null, "missing element rejected");
  assert(validateCommand({ verb: "set_overlay", params: { element: "drift" } }) === null, "missing state rejected");
  assert(validateCommand({ verb: "set_overlay", params: {} }) === null, "empty params rejected");
}

// 2. emits a ui event addressed to the owner, carrying element + state
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  sim.enqueue("A", [{ verb: "set_overlay", params: { element: "drift", state: "on" } }]);
  const ev = sim.tick();
  const ui = ev.find((e) => e.kind === "ui" && (e as any).what === "overlay") as any;
  assert(!!ui, "set_overlay emits a ui overlay event");
  assert(ui?.ship === "A", "ui event addressed to the owner");
  assert(ui?.element === "drift" && ui?.state === "on", "ui event carries element + state");
}

// 3. mutates no sim state (the ship object is untouched)
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  sim.tick(); // settle any first-tick bookkeeping before the baseline
  const before = JSON.stringify(a);
  sim.enqueue("A", [{ verb: "set_overlay", params: { element: "drift", state: "on" } }]);
  sim.tick();
  assert(JSON.stringify(a) === before, "ship object untouched by set_overlay");
}

// 4. XO lines: stopped ship gets the nothing-to-mark line (still toggles),
//    moving ship gets "up", any off gets "down"
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0); // v = 0: stopped
  sim.addShip("B", 0, 200000, 180, false);
  sim.enqueue("A", [{ verb: "set_overlay", params: { element: "drift", state: "on" } }]);
  const ev = sim.tick();
  assert(
    ev.some((e) => e.kind === "notice" && /not drifting anywhere/.test((e as any).text)),
    "stopped ship: nothing-to-mark line"
  );
  assert(
    ev.some((e) => e.kind === "ui" && (e as any).what === "overlay" && (e as any).state === "on"),
    "stopped ship: the marker still toggles on (state is state)"
  );

  const sim2 = new Sim();
  const a2 = sim2.addShip("A", 0, 0, 0);
  sim2.addShip("B", 0, 200000, 180, false);
  a2.vy = 300;
  sim2.enqueue("A", [{ verb: "set_overlay", params: { element: "drift", state: "on" } }]);
  const ev2 = sim2.tick();
  assert(
    ev2.some((e) => e.kind === "notice" && /Drift marker up/.test((e as any).text)),
    "moving ship: 'Drift marker up, Captain.'"
  );

  sim2.enqueue("A", [{ verb: "set_overlay", params: { element: "drift", state: "off" } }]);
  const ev3 = sim2.tick();
  assert(
    ev3.some((e) => e.kind === "notice" && /Drift marker down/.test((e as any).text)),
    "off: 'Drift marker down.'"
  );
}

// 5. sim-level junk (dev harness bypasses the validator) is rejected in-character
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  sim.enqueue("A", [{ verb: "set_overlay", params: { element: "probes", state: "on" } }]);
  const ev = sim.tick();
  assert(
    ev.some((e) => e.kind === "reject" && /No such overlay/.test((e as any).reason)),
    "unknown element rejected at the sim too"
  );
}

console.log("done");
