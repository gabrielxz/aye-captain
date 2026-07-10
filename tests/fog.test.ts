// Fog of war under the v4 contact-tier model. Detection range scales with
// the TARGET's signature: quiet ship (sig 10) seen at 16.5 km; tiers at
// <=30% (id), <=60% (track), <=100% (faint) of that.
import { Sim } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

const quietDetect = C.SENSOR_BASE_M * (C.SIG_BASE / 100); // 16.5 km

// 1. spawn distance: dark ships see nothing — no contacts, no ghost
{
  const sim = new Sim();
  sim.addShip("A", 0, -C.SPAWN_DIST_FROM_CENTER_M, 0);
  sim.addShip("B", 0, C.SPAWN_DIST_FROM_CENTER_M, 180, true);
  sim.tick();
  const snap = sim.snapshotFor("A") as any;
  assert(snap.contacts.length === 0 && snap.ghost === null, "300 km apart: no contact data at all");
}

// 2. tier ladder against a quiet ship: faint -> track -> id, with XO lines
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, quietDetect * 0.9, 180, false); // faint band
  const ev1 = sim.tick();
  assert(a.contactTier === 1, `faint band => tier 1 (got ${a.contactTier})`);
  assert(ev1.some(e => e.kind === "notice" && e.ship === "A" && /Faint contact/.test((e as any).text)), "faint contact XO line");
  let snap = sim.snapshotFor("A") as any;
  assert(snap.contacts[0].tier === 1, "snapshot carries tier 1");
  assert(snap.contacts[0].vx === undefined && snap.contacts[0].facing === undefined, "NO vector data at faint");
  const noise = Math.hypot(snap.contacts[0].x - b.x, snap.contacts[0].y - b.y);
  assert(noise <= C.FAINT_POS_NOISE_M + 1, `faint position within noise radius (${noise.toFixed(0)} m)`);

  b.y = quietDetect * 0.5; // track band
  const ev2 = sim.tick();
  assert(a.contactTier === 2, `track band => tier 2 (got ${a.contactTier})`);
  assert(ev2.some(e => e.kind === "notice" && /firming up — I have a track/.test((e as any).text)), "track XO line");
  snap = sim.snapshotFor("A") as any;
  assert(typeof snap.contacts[0].vx === "number" && typeof snap.contacts[0].facing === "number", "vector data at track");
  assert(snap.contacts[0].hull === undefined, "no hull detail at track");

  b.y = quietDetect * 0.25; // id band
  const ev3 = sim.tick();
  assert(a.contactTier === 3, `id band => tier 3 (got ${a.contactTier})`);
  assert(ev3.some(e => e.kind === "notice" && /Close-range ID/.test((e as any).text)), "id XO line");
  snap = sim.snapshotFor("A") as any;
  assert(typeof snap.contacts[0].hull === "number", "hull detail at id");
}

// 3. faint fixes refresh only every FAINT_UPDATE_INTERVAL_S
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, quietDetect * 0.85, 180, false);
  b.vx = 100; // sliding sideways so the true position keeps moving
  sim.tick();
  const fix1 = { ...(sim.snapshotFor("A") as any).contacts[0] };
  sim.tick();
  const fix2 = (sim.snapshotFor("A") as any).contacts[0];
  assert(fix1.x === fix2.x && fix1.y === fix2.y, "faint fix frozen between updates");
  for (let i = 0; i < C.FAINT_UPDATE_INTERVAL_S; i++) sim.tick();
  const fix3 = (sim.snapshotFor("A") as any).contacts[0];
  assert(fix3.x !== fix1.x || fix3.y !== fix1.y, "faint fix refreshes after the interval");
}

// 4. a burning ship is visible far beyond a quiet one
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 100000, 180, false); // 100 km out
  sim.tick();
  assert(a.contactTier === 0, "quiet ship invisible at 100 km");
  b.thrust = 100;
  b.propellant = C.PROPELLANT_MAX;
  sim.tick();
  assert(a.contactTier >= 1, `full burn (sig 110, detect ~181 km) seen at 100 km (tier ${a.contactTier})`);
}

// 5. contact lost: ghost lastKnown + steering falls back to it
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 8000, 180, false); // track band
  sim.tick();
  const seenY = b.y;
  b.y = 200000; // gone
  const ev = sim.tick();
  assert(ev.some(e => e.kind === "notice" && /Track lost — last known bearing/.test((e as any).text)), "track lost XO line");
  const snap = sim.snapshotFor("A") as any;
  assert(snap.contacts.length === 0 && snap.ghost, "ghost lastKnown in snapshot");
  assert(Math.abs(snap.ghost.y - seenY) < 200, "ghost ~= position when last tracked");
  sim.enqueue("A", [{ verb: "set_heading", params: { mode: "target", target: "enemy_ship" } }]);
  for (let i = 0; i < 20; i++) sim.tick();
  assert(Math.abs(a.facing - 0) < 25 || a.facing > 335, `steers toward last known (facing ${a.facing.toFixed(0)})`);
}

// 6. fog never leaks: no live coords once the contact is gone
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 8000, 180, false);
  sim.tick();
  b.x = 61237; b.y = 71243; // far off sensors but still INSIDE the region
  sim.tick();
  const json = JSON.stringify(sim.snapshotFor("A"));
  assert(!json.includes("61237") && !json.includes("71243"), "live enemy coords absent from snapshot");
}

// 6b. faint tier never leaks vector or exact position
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, quietDetect * 0.9, 180, false);
  b.vx = 777.125; // distinctive velocity value
  sim.tick();
  const json = JSON.stringify(sim.snapshotFor("A"));
  assert(!json.includes("777.125"), "faint contact leaks no velocity");
}

// 7. outside the region: signature-max, tier ID at any range
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, C.REGION_RADIUS_M + 5000, 180, false); // 255 km away, outside
  sim.tick();
  assert(a.contactTier === 3, `outside-region ship is tier ID at any range (got ${a.contactTier})`);
}

// 8. launch spike: a dark shooter lights up when it fires, then fades
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 100000, 180, false); // dark at 100 km: invisible
  sim.tick();
  assert(a.contactTier === 0, "shooter hidden before launch");
  (b as any).lock = { progress: C.LOCK_TIME_S, has: true, grace: C.LOCK_GRACE_S };
  sim.enqueue("B", [{ verb: "fire_missile", params: {} }]);
  const ev = sim.tick();
  assert(ev.some(e => e.kind === "notice" && e.ship === "A" && /Launch flash detected/.test((e as any).text)), "launch flash notice");
  assert(a.contactTier >= 1, `spike makes the shooter detectable (tier ${a.contactTier})`);
  for (let i = 0; i < C.SIG_SPIKE_LAUNCH_S + 2; i++) sim.tick();
  assert(a.contactTier === 0, "spike expires — shooter dark again");
}

// 9. lock requires TIER_TRACK: a faint contact in the cone accrues nothing
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0); // facing north, enemy dead ahead
  const b = sim.addShip("B", 0, quietDetect * 0.9, 180, false); // faint band, well inside 80 km lock range
  for (let i = 0; i < C.LOCK_TIME_S + 2; i++) sim.tick();
  assert(a.contactTier === 1 && !a.lock.has && a.lock.progress === 0, "no lock progress on a faint contact");
  b.y = quietDetect * 0.5; // track band
  for (let i = 0; i < C.LOCK_TIME_S + 1; i++) sim.tick();
  assert(a.lock.has, "lock acquires once the contact firms to track");
}

// 10. drone flies a ~100 m/s circle (unchanged)
{
  const sim = new Sim();
  sim.addShip("A", 0, -14000, 0);
  const b = sim.addShip("B", 0, 14000, 180, true);
  const f0 = b.facing;
  sim.tick();
  assert(Math.round(Math.hypot(b.vx, b.vy)) === C.DRONE_SPEED_MPS, "drone speed 100");
  assert(Math.abs(b.facing - (f0 + C.DRONE_TURN_RATE_DPS)) < 1e-6, "drone gentle turn 3 deg/s");
  assert(b.thrust === C.DRONE_THRUST_PERCENT, "drone signature thrust 50");
}
console.log("done");
