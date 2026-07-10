import { Sim } from "../server/sim.js";
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
    actions: [{ verb: "fire_laser", params: {}, acknowledgement: "Guns firing." }],
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
    condition: { metric: "enemy_on_sensors", op: "eq", value: true },
    actions: [{ verb: "fire_laser", params: {} }],
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
  sim.addShip("B", 0, 19000, 180, true); // inside zone, off sensors
  sim.enqueue("A", [so({
    label: "blind",
    condition: { metric: "enemy_range", op: "lt", value: 50000 },
    actions: [{ verb: "fire_laser", params: {} }],
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
  sim.enqueue("A", [so({
    label: "missile defense",
    condition: { metric: "missile_inbound", op: "eq", value: true },
    actions: [
      { verb: "set_heading", params: { mode: "target", target: "nearest_missile" } },
      { verb: "fire_laser", params: {} },
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
      actions: [{ verb: "fire_laser", params: {} }],
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
  const mk = (v: number) => so({ label: "pd", condition: { metric: "own_speed", op: "gt", value: v }, actions: [{ verb: "fire_laser", params: {} }] });
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
    actions: [so({ condition: { metric: "own_speed", op: "gt", value: 0 }, actions: [{ verb: "fire_laser", params: {} }] })],
  })]);
  const ev = sim.tick();
  assert(ev.some(e => e.kind === "reject" && /nest/.test((e as any).reason)), "nested order rejected");
  assert(a.standingOrders.length === 0, "nothing stored");
}
console.log("done");
