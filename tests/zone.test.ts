import { Sim } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

// 1. leaving/re-entering zone announcements, edge-triggered
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, C.REGION_RADIUS_M - 200, 0); // just inside, heading out north
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

// 2. edge gravity: no wall — a restoring pull grows with distance, capped,
// and always brings a derelict home
{
  // pull magnitude: 50 km beyond => 5 m/s^2 toward center
  const sim = new Sim();
  const a = sim.addShip("A", 0, C.REGION_RADIUS_M + 50000, 0); // 50 km beyond, due north of center
  sim.addShip("B", 0, -14000, 0, true);
  sim.tick();
  assert(Math.abs(a.vy + C.EDGE_PULL_MPS2_PER_50KM) < 0.2, `pull ~5 m/s^2 at 50 km beyond (vy ${a.vy.toFixed(2)})`);

  // pull caps at EDGE_PULL_CAP_MPS2
  const sim2 = new Sim();
  const a2 = sim2.addShip("A", 0, C.REGION_RADIUS_M + 900000, 0); // absurdly far
  sim2.addShip("B", 0, -14000, 0, true);
  sim2.tick();
  assert(Math.abs(a2.vy + C.EDGE_PULL_CAP_MPS2) < 1, `pull capped at ${C.EDGE_PULL_CAP_MPS2} (vy ${a2.vy.toFixed(1)})`);

  // no ship can be stranded: a dry derelict outside drifts back in
  const sim3 = new Sim();
  const a3 = sim3.addShip("A", 0, C.REGION_RADIUS_M + 60000, 0);
  sim3.addShip("B", 0, -14000, 0, true);
  a3.propellant = 0; // tanks dry, adrift
  let returned = false;
  for (let i = 0; i < 600 && !returned; i++) {
    sim3.tick();
    returned = sim3.insideZone(a3);
  }
  assert(returned, "derelict outside the region is pulled back inside");
}

// 3. distance_from_zone_center metric works for standing orders (e.g. auto-return)
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, C.REGION_RADIUS_M + 500, 0); // outside
  sim.addShip("B", 0, -14000, 0, true);
  sim.enqueue("A", [{
    verb: "set_standing_order",
    params: {
      label: "come home",
      condition: { metric: "distance_from_zone_center", op: "gt", value: C.REGION_RADIUS_M },
      actions: [{ verb: "set_heading", params: { mode: "absolute", degrees: 180 } }],
    },
  } as any]);
  sim.tick();
  const ev = sim.tick();
  assert(ev.some(e => e.kind === "notice" && /'come home' triggered/.test((e as any).text)), "zone-distance standing order fires");
}
console.log("done");
