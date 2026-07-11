import { readFileSync } from "node:fs";
import { Sim } from "../server/sim.js";
import { validateCommand } from "../server/translator.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};
const so = (params: any) => ({ verb: "set_standing_order", params } as any);

// 1. one-shot fires once when condition true, is consumed, logs trigger
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 4000, 180, true); // visible, in laser range, dead ahead
  sim.enqueue("A", [so({
    label: "fire when ready",
    condition: { all: [
      { metric: "enemy_bearing_off_nose", op: "lt", value: 4 },
      { metric: "enemy_range", op: "lt", value: 5000 },
    ]},
    actions: [{ verb: "set_pdc", params: { posture: "free" }, acknowledgement: "Guns firing." }],
  })]);
  let ev = sim.tick(); // registers; conditions eval next tick (sensors updated end of this tick)
  assert(a.standingOrders.length === 1, "order stored");
  ev = sim.tick();
  assert(ev.some(e => e.kind === "notice" && /Standing order 'fire when ready' triggered/.test((e as any).text)), "trigger logged");
  assert(ev.some(e => e.kind === "ack" && (e as any).text === "Guns firing."), "action ack fires");
  assert(a.standingOrders.length === 0, "one-shot consumed");
}

// 2. repeat order re-arms after cooldown
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 3000, 180, true);
  sim.enqueue("A", [so({
    label: "pd",
    condition: { metric: "enemy_contact_tier", op: "gte", value: 1 },
    actions: [{ verb: "set_pdc", params: { posture: "free" } }],
    repeat: true,
  })]);
  sim.tick();
  let fires = 0;
  for (let i = 0; i < 12; i++) {
    const ev = sim.tick();
    if (ev.some(e => e.kind === "notice" && /'pd' triggered/.test((e as any).text))) fires++;
  }
  // 12 ticks, 5s retrigger cooldown -> t0 fire, re-arm at t5(cooldown counts), fire ~t6, ~t12
  assert(a.standingOrders.length === 1, "repeat order persists");
  assert(fires >= 2 && fires <= 3, `repeat fires with cooldown spacing (fired ${fires}x in 12 ticks)`);
}

// 3. fog: enemy_range unknowable when off sensors -> false, no fire
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 120000, 180, true); // inside zone, beyond detection (drone sig 60 => ~99 km)
  sim.enqueue("A", [so({
    label: "blind",
    condition: { metric: "enemy_range", op: "lt", value: 50000 },
    actions: [{ verb: "set_pdc", params: { posture: "free" } }],
  })]);
  for (let i = 0; i < 5; i++) {
    const ev = sim.tick();
    assert2: if (ev.some(e => e.kind === "notice" && /'blind' triggered/.test((e as any).text))) {
      console.error("FAIL: unknowable metric fired"); process.exitCode = 1; break assert2;
    }
  }
  assert(a.standingOrders.length === 1, "unknowable enemy_range never fires (still armed)");
}

// 4. missile_inbound triggers point defense
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 5500, 180, false);
  a.pdcPosture = "hold"; // the trigger, not the guns, is under test
  sim.enqueue("A", [so({
    label: "missile defense",
    condition: { metric: "missile_inbound", op: "eq", value: true },
    actions: [
      { verb: "set_heading", params: { mode: "target", target: "nearest_missile" } },
      { verb: "set_pdc", params: { posture: "free" } },
    ],
    repeat: true,
  })]);
  (b as any).lock = { progress: 5, has: true, grace: 2 }; // B may fire
  sim.enqueue("B", [{ verb: "fire_missile", params: {} } as any]);
  let triggered = false;
  for (let i = 0; i < 10 && !triggered; i++) {
    const ev = sim.tick();
    triggered = ev.some(e => e.kind === "notice" && /'missile defense' triggered/.test((e as any).text));
  }
  assert(triggered, "missile_inbound trigger fires when missile enters detect range");
}

// 5. cap at 6, cancellation by label and 'all', unknown label reject
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 25000, 180, true);
  for (let i = 1; i <= 7; i++) {
    sim.enqueue("A", [so({
      label: `o${i}`,
      condition: { metric: "own_speed", op: "gt", value: 99999 },
      actions: [{ verb: "set_pdc", params: { posture: "free" } }],
    })]);
  }
  let ev = sim.tick();
  assert(a.standingOrders.length === 6, `cap enforced (${a.standingOrders.length})`);
  assert(ev.some(e => e.kind === "reject" && /book is full/.test((e as any).reason)), "7th order rejected with XO line");
  sim.enqueue("A", [so({ cancel_label: "o3" })]);
  ev = sim.tick();
  assert(a.standingOrders.length === 5 && !a.standingOrders.some(o => o.label === "o3"), "cancel by label");
  sim.enqueue("A", [so({ cancel_label: "nope" })]);
  ev = sim.tick();
  assert(ev.some(e => e.kind === "reject" && /No standing order named/.test((e as any).reason)), "unknown label rejected");
  sim.enqueue("A", [so({ cancel_label: "all" })]);
  sim.tick();
  assert(a.standingOrders.length === 0, "cancel all");
}

// 6. re-issuing a label replaces, doesn't duplicate or hit cap
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 25000, 180, true);
  const mk = (v: number) => so({ label: "pd", condition: { metric: "own_speed", op: "gt", value: v }, actions: [{ verb: "set_pdc", params: { posture: "free" } }] });
  sim.enqueue("A", [mk(1000)]);
  sim.tick();
  sim.enqueue("A", [mk(2000)]);
  sim.tick();
  assert(a.standingOrders.length === 1 && (a.standingOrders[0].condition as any).value === 2000, "same label replaces");
}

// 7. nested standing order rejected server-side (dev harness path)
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 25000, 180, true);
  sim.enqueue("A", [so({
    condition: { metric: "own_speed", op: "gt", value: 0 },
    actions: [so({ condition: { metric: "own_speed", op: "gt", value: 0 }, actions: [{ verb: "set_pdc", params: { posture: "free" } }] })],
  })]);
  const ev = sim.tick();
  assert(ev.some(e => e.kind === "reject" && /nest/.test((e as any).reason)), "nested order rejected");
  assert(a.standingOrders.length === 0, "nothing stored");
}

// 8. v4.3 §1 regression — "cut thrusters at 300 m/s" fired instantly at 114.
// Root cause was the TRANSLATOR emitting lte for a rising threshold; this
// block pins the evaluator half (correct ops behave, wrong op reproduces
// the bug, unknown metrics never fire) and the schema example that anchors
// the prompt fix.
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, true);
  a.vy = 114; // the live repro state: under the threshold, climbing
  const cut = (op: string) => so({
    label: "cutoff",
    condition: { metric: "own_speed", op, value: 300 },
    actions: [{ verb: "set_thrust", params: { percent: 0 } }],
  });

  sim.enqueue("A", [cut("gte")]);
  sim.tick();
  let ev = sim.tick();
  assert(!ev.some(e => e.kind === "notice" && /'cutoff' triggered/.test((e as any).text)), "gte 300 does NOT fire at 114 m/s");
  a.vy = 305; // threshold reached
  ev = sim.tick();
  assert(ev.some(e => e.kind === "notice" && /'cutoff' triggered/.test((e as any).text)), "gte 300 fires once we reach 300");

  // the buggy translation: lte on a rising threshold fires immediately
  const sim2 = new Sim();
  const b2 = sim2.addShip("A", 0, 0, 0);
  sim2.addShip("B", 0, 200000, 180, true);
  b2.vy = 114;
  sim2.enqueue("A", [cut("lte")]);
  sim2.tick();
  const ev2 = sim2.tick();
  assert(ev2.some(e => e.kind === "notice" && /'cutoff' triggered/.test((e as any).text)), "lte 300 at 114 m/s reproduces the instant-fire bug (why direction matters)");

  // unknowable/unknown metrics evaluate FALSE — never undefined-truthy
  const sim3 = new Sim();
  const a3 = sim3.addShip("A", 0, 0, 0);
  sim3.addShip("B", 0, 200000, 180, true);
  (a3.standingOrders as any).push({
    label: "ghost metric", condition: { metric: "own_velocity", op: "lte", value: 300 },
    actions: [{ verb: "set_thrust", params: { percent: 0 } }], repeat: false, cooldown: 0,
  });
  const ev3 = sim3.tick();
  assert(!ev3.some(e => e.kind === "notice" && /'ghost metric' triggered/.test((e as any).text)), "unknown metric evaluates false, never fires");
  assert(a3.standingOrders.length === 1, "unknown-metric order stays armed (not consumed)");
}

// 9. the schema example anchoring the prompt fix stays a valid RISING order
{
  const schema = JSON.parse(readFileSync(new URL("../ship_command_schema.json", import.meta.url), "utf8"));
  const ex = schema.example_translations.examples.find(
    (e: any) => e.captain === "cut thrusters at 300 meters per second"
  );
  assert(!!ex, "verbatim playtest utterance is a schema example");
  const cmd = ex.commands[0];
  assert(cmd.params.condition.op === "gte", "example encodes the RISING threshold (gte)");
  assert(validateCommand(cmd) !== null, "example passes the validator");
  assert(/reach/i.test(cmd.acknowledgement), "readback states the trigger direction");
  const rules: string[] = schema.llm_translator_rules.rules;
  assert(rules.some(r => /DIRECTION of crossing/.test(r)), "prompt rule for threshold direction present");
  assert(rules.some(r => /NEVER claim an action was taken/.test(r)), "reply-only lines may never claim actions (the 'Hold Pieces' phantom)");
  assert(rules.some(r => /EMIT THE VERB/.test(r)), "if the model can name the action it must emit the command");
  assert(rules.some(r => /trigger direction/.test(r)), "prompt rule for spoken readback direction present");
}
console.log("done");
