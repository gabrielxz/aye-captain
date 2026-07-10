import { Sim } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

// 1. leaving/re-entering zone announcements, edge-triggered
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, C.ZONE_RADIUS_M - 200, 0); // just inside, heading out north
  sim.addShip("B", 0, -14000, 0, true);
  a.vx = 0; a.vy = 300;
  let ev = sim.tick();
  assert(ev.some(e => e.kind === "notice" && /left the shroud/.test((e as any).text)), "leave announcement");
  ev = sim.tick();
  assert(!ev.some(e => e.kind === "notice" && /left the shroud/.test((e as any).text)), "no repeat while outside");
  a.vy = -300;
  sim.tick(); // still outside at 20.1km? 20400-300=20100 -> outside
  ev = sim.tick(); // 19800 -> inside
  assert(ev.some(e => e.kind === "notice" && /Back inside the shroud/.test((e as any).text)), "re-entry announcement");
}

// 2. hard limit: position clamped, outward radial velocity zeroed, tangential survives
{
  const sim = new Sim();
  const a = sim.addShip("A", C.HARD_LIMIT_RADIUS_M - 100, 0, 90); // near the ring, flying east (outward) + some north
  sim.addShip("B", 0, -14000, 0, true);
  a.vx = 250; a.vy = 100; // radial=vx (outward), tangential=vy
  const ev = sim.tick();
  const r = Math.hypot(a.x, a.y);
  assert(Math.abs(r - C.HARD_LIMIT_RADIUS_M) < 1, `clamped to ring (r=${r.toFixed(0)})`);
  assert(ev.some(e => e.kind === "notice" && /Drive failure/.test((e as any).text)), "hard limit announcement");
  // radial velocity ~0 (a is ~at (30000, ~100): radial ≈ +x)
  const rn = Math.hypot(a.x, a.y);
  const vRad = (a.vx * a.x + a.vy * a.y) / rn;
  assert(Math.abs(vRad) < 5, `outward radial velocity zeroed (${vRad.toFixed(1)})`);
  const speed = Math.hypot(a.vx, a.vy);
  assert(speed > 90 && speed < 110, `tangential component survives (${speed.toFixed(0)} m/s)`);
  // announcement doesn't repeat while pinned
  const ev2 = sim.tick();
  assert(!ev2.some(e => e.kind === "notice" && /Drive failure/.test((e as any).text)), "no repeat while pinned at limit");
}

// 3. distance_from_zone_center metric works for standing orders (e.g. auto-return)
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, C.ZONE_RADIUS_M + 500, 0); // outside
  sim.addShip("B", 0, -14000, 0, true);
  sim.enqueue("A", [{
    verb: "set_standing_order",
    params: {
      label: "come home",
      condition: { metric: "distance_from_zone_center", op: "gt", value: C.ZONE_RADIUS_M },
      actions: [{ verb: "set_heading", params: { mode: "absolute", degrees: 180 } }],
    },
  } as any]);
  sim.tick();
  const ev = sim.tick();
  assert(ev.some(e => e.kind === "notice" && /'come home' triggered/.test((e as any).text)), "zone-distance standing order fires");
}
console.log("done");
