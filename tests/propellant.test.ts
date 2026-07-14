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
  const a2 = sim2.addShip("A", 0, C.REGION_RADIUS_M + 3000, 0); // OUTSIDE zone
  sim2.addShip("B", 0, -40000, 180, true);
  a2.propellant = 50;
  a2.thrust = 0;
  sim2.tick();
  assert(a2.propellant === 50, "zero regen outside the zone, ever");
}

// 3. tanks dry: the throttle AUTO-SAFES to zero (playtest 2026-07-13 — the
// old "setting remembered" rule left a dry ship with a high setting getting
// no output AND no regen, a stuck state; REVERSED by design), coasting +
// turning work, signature goes dim, and re-ordering thrust after regen
// resumes output.
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 40000, 180, true);
  a.propellant = 1.5;
  sim.enqueue("A", [{ verb: "set_thrust", params: { percent: 100 } }]);
  sim.tick(); // burns 1.0
  sim.tick(); // burns to 0 (0.5 left -> 0, clamped) -> auto-safe fires
  sim.tick();
  assert(a.thrust === 0, "dry tanks auto-safe the setting to zero (no more stuck state)");
  assert(a.propellant < 1, "tank ran dry (regen trickle already restarting)");
  assert(effectiveThrust(a) === 0, "no thrust output at zero setting");
  assert(sim.signatureOf(a) === C.SIG_BASE, "dry ship signature drops to base (dim)");
  const [vx, vy] = [a.vx, a.vy];
  sim.enqueue("A", [{ verb: "set_heading", params: { mode: "absolute", degrees: 90 } }]);
  sim.tick();
  assert(a.vx === vx && a.vy === vy, "coasts under Newton while dry");
  assert(a.facing > 0, "turning still works while dry");
  // regen is already running (setting auto-safed under the ceiling)
  for (let i = 0; i < 4; i++) sim.tick();
  assert(a.propellant > 0, "harvest refills on its own after the auto-safe");
  sim.enqueue("A", [{ verb: "set_thrust", params: { percent: 10 } }]);
  sim.tick();
  assert(effectiveThrust(a) === 10, "thrust output resumes when the captain re-orders it");
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
  assert(sim.signatureOf(drone) === C.SIG_BASE + C.DRONE_THRUST_PERCENT, "drone signature unchanged");
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

// 7. the snapshot surfaces the regen gate (playtest 2026-07-12: a dry
// captain couldn't tell WHY nothing was recharging — likely outside the
// zone; the HUD PROP row now shows ⟳/✕ off this flag)
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 40000, 180, true);
  sim.tick();
  assert((sim.snapshotFor("A") as any).you.regen === true, "regen flag true at zero throttle inside the zone");
  sim.enqueue("A", [{ verb: "set_thrust", params: { percent: 60 } }]);
  sim.tick();
  assert((sim.snapshotFor("A") as any).you.regen === false, "regen flag false above the throttle ceiling");
  a.thrust = 0;
  a.x = C.REGION_RADIUS_M + 10000; // beyond the shroud: gate closed at any throttle
  assert((sim.snapshotFor("A") as any).you.regen === false, "regen flag false outside the zone");
}

// Playtest fix 2026-07-13: BONE-DRY AUTO-SAFES THE THROTTLE. A dry ship
// with the setting still high got no output AND no regen (the setting
// gates regen) — a stuck state unless the crew knew to say "throttle
// down". Dry now zeroes the setting (belaying a timed burn), the XO says
// so, and harvest resumes on its own.
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0); // inside zone
  sim.addShip("B", 0, 40000, 180, true);
  a.propellant = 1.5;
  a.thrust = 80;
  const all: any[] = [];
  for (let t = 0; t < 5; t++) all.push(...sim.tick());
  assert(a.thrust === 0, "dry tanks auto-safe the throttle to zero");
  assert(all.some((e) => e.kind === "notice" && /Throttle to zero/.test(e.text)), "…and the XO says so");
  const atDry = a.propellant;
  sim.tick();
  assert(a.propellant > atDry, "…and regen resumes on its own — the stuck state is gone");

  // a running timed burn is belayed by dry tanks (its whole job is thrust)
  const sim2 = new Sim();
  const b = sim2.addShip("A", 0, 0, 0);
  sim2.addShip("B", 0, 40000, 180, true);
  b.propellant = 1.5;
  sim2.enqueue("A", [{ verb: "maneuver", params: { type: "burn", seconds: 60, percent: 100 } }]);
  for (let t = 0; t < 5; t++) sim2.tick();
  assert(b.maneuver === null && b.thrust === 0, "dry tanks belay a timed burn too");

  // the law is INTACT with fuel aboard: a high setting still blocks regen
  const sim3 = new Sim();
  const c = sim3.addShip("A", 0, 0, 0);
  sim3.addShip("B", 0, 40000, 180, true);
  c.propellant = 50;
  c.thrust = 80;
  sim3.tick();
  assert(c.thrust === 80 && c.propellant < 50, "with fuel aboard the setting stands and regen stays gated (invariant 8)");
}
console.log("done");
