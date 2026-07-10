import { Sim } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

// 1. spawn distance: enemy off sensors, no lastKnown
{
  const sim = new Sim();
  sim.addShip("A", 0, -C.SPAWN_DIST_FROM_CENTER_M, 0);
  sim.addShip("B", 0, C.SPAWN_DIST_FROM_CENTER_M, 180, true);
  sim.tick();
  const snap = sim.snapshotFor("A") as any;
  assert(snap.enemy === null, "28km apart: no enemy block at all");
}

// 2. inside sensor range: visible, contact notice fires once
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 10000, 180, true);
  const ev1 = sim.tick();
  assert(ev1.some(e => e.kind === "notice" && e.ship === "A" && /Contact on sensors/.test(e.text)), "contact notice on first sight");
  const ev2 = sim.tick();
  assert(!ev2.some(e => e.kind === "notice" && e.ship === "A"), "no repeat notice while visible");
  const snap = sim.snapshotFor("A") as any;
  assert(snap.enemy?.visible === true && typeof snap.enemy.x === "number", "enemy visible in snapshot");
}

// 3. contact lost: ghost lastKnown, target-heading falls back to it
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 10000, 180, true);
  sim.tick();
  const seenX = b.x, seenY = b.y;
  b.x = 0; b.y = 19000; // off sensors but still inside the zone
  const ev = sim.tick();
  assert(ev.some(e => e.kind === "notice" && /Contact lost/.test((e as any).text)), "contact lost notice");
  const snap = sim.snapshotFor("A") as any;
  assert(snap.enemy?.visible === false && snap.enemy.lastKnown, "snapshot has lastKnown ghost");
  assert(Math.abs(snap.enemy.lastKnown.y - seenY) < 200, "lastKnown ~= position when last seen");
  // heading target=enemy_ship steers to lastKnown, not the real position
  sim.enqueue("A", [{ verb: "set_heading", params: { mode: "target", target: "enemy_ship" } }]);
  for (let i = 0; i < 20; i++) sim.tick();
  assert(Math.abs(a.facing - 0) < 25 || a.facing > 335, `steers toward last known (facing ${a.facing.toFixed(0)})`);
}

// 4. fog never leaks: snapshot JSON for A contains no live B position once lost
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 10000, 180, true);
  sim.tick();
  b.x = 12345; b.y = 23456;
  sim.tick();
  const json = JSON.stringify(sim.snapshotFor("A"));
  assert(!json.includes("12345") && !json.includes("23456"), "live enemy coords absent from snapshot");
}

// 5. drone flies a ~100 m/s circle
{
  const sim = new Sim();
  sim.addShip("A", 0, -14000, 0);
  const b = sim.addShip("B", 0, 14000, 180, true);
  const f0 = b.facing;
  sim.tick();
  assert(Math.round(Math.hypot(b.vx, b.vy)) === C.DRONE_SPEED_MPS, "drone speed 100");
  assert(Math.abs(b.facing - (f0 + C.DRONE_TURN_RATE_DPS)) < 1e-9, "drone gentle turn 3 deg/s");
  assert(b.thrust === C.DRONE_THRUST_PERCENT, "drone signature thrust 50");
}

// 6. sensor range halved outside zone
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, C.REGION_RADIUS_M + 5000, 0); // outside the zone
  assert(sim.sensorRangeOf(a) === C.SENSOR_RANGE_M * C.OUTSIDE_ZONE_SENSOR_MULT, "sensor range halved outside zone");
  // and an outside-zone ship is visible regardless of range
  const sim2 = new Sim();
  const a2 = sim2.addShip("A", 0, -14000, 0);
  const b2 = sim2.addShip("B", 0, C.REGION_RADIUS_M + 5000, 180, true); // outside zone, ~49km away
  sim2.tick();
  assert((sim2.snapshotFor("A") as any).enemy?.visible === true, "outside-zone enemy visible at any range");
}

// 7. launch flash: firing reveals the shooter regardless of sensor range,
// with the distinct notice and WITHOUT the generic contact gained/lost pair
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 20000, 180, false); // off A's sensors (20km > 12km), inside zone
  sim.tick();
  assert((sim.snapshotFor("A") as any).enemy === null, "shooter hidden before launch");
  (b as any).lock = { progress: C.LOCK_TIME_S, has: true, grace: C.LOCK_GRACE_S };
  sim.enqueue("B", [{ verb: "fire_missile", params: {} } as any]);
  const ev = sim.tick();
  assert(ev.some(e => e.kind === "notice" && e.ship === "A" && /Launch flash detected/.test((e as any).text)), "launch flash notice to the enemy");
  assert(!ev.some(e => e.kind === "notice" && e.ship === "A" && /Contact on sensors/.test((e as any).text)), "no generic contact-gained for flash-only visibility");
  let snap = sim.snapshotFor("A") as any;
  assert(snap.enemy?.visible === true, "shooter revealed during flash");
  let lostNotice = false;
  for (let i = 0; i < C.LAUNCH_FLASH_REVEAL_S + 2; i++) {
    const e2 = sim.tick();
    lostNotice ||= e2.some(e => e.kind === "notice" && e.ship === "A" && /Contact lost/.test((e as any).text));
  }
  snap = sim.snapshotFor("A") as any;
  assert(snap.enemy?.visible !== true, "flash expires — shooter hidden again");
  assert(!lostNotice, "no generic contact-lost when a flash fades");
}
console.log("done");
