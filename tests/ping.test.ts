// v4.5 §6 active ping: 5s TRACK grant inside 150 km (LOS-gated at ping
// time), 10s map-wide no-LOS ID reveal of the pinger, 30s cooldown. A ping
// FINDS ships; it cannot complete a missile lock by itself.
import { Sim } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};
const ping = (sim: Sim, id: "A" | "B") =>
  sim.enqueue(id, [{ verb: "sensor_ping", params: {} } as any]);

// 1. grant + reveal: a dark ship beyond passive range snaps to TRACK for
// the pinger; the pinger reads ID to the enemy map-wide, rock or no rock
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 100000, 180, false); // dark at 100 km: passives blind (54 km)
  sim.terrain.rocks.push({ x: 0, y: 50000, r: 5000, centerpiece: false }); // rock BETWEEN them
  sim.tick();
  assert(a.contactTier === 0 && b.contactTier === 0, "both blind before the ping");
  // clear LOS for the ping itself (move the rock aside), keep the reveal test honest later
  sim.terrain.rocks.length = 0;
  ping(sim, "A");
  const ev = sim.tick();
  assert(a.contactTier === 2, `ping grants TRACK on the dark ship (tier ${a.contactTier})`);
  assert(b.contactTier === 3, "the pinger is revealed at ID to the enemy");
  assert(
    ev.some((e) => e.kind === "notice" && e.ship === "B" && /Active ping — he's lit himself up\. Bearing 180/.test((e as any).text)),
    "enemy XO calls the ping with a bearing"
  );
  const snap = sim.snapshotFor("A") as any;
  assert(snap.contacts[0]?.tier === 2 && typeof snap.contacts[0].vx === "number", "granted track carries vector data");

  // decay: grant expires back to passive silence...
  for (let i = 0; i < C.PING_TRACK_S; i++) sim.tick();
  assert(a.contactTier === 0, "grant decays to what passives sustain (nothing)");
  // ...the reveal lasts longer, then also fades
  assert(b.contactTier === 3, "reveal outlives the grant");
  for (let i = 0; i < C.PING_REVEAL_S - C.PING_TRACK_S + 1; i++) sim.tick();
  assert(b.contactTier === 0, "reveal fades after PING_REVEAL_S");
}

// 2. reveal ignores LOS entirely — a rock hides you from eyes, not from a scream
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 100000, 180, false);
  sim.terrain.rocks.push({ x: 0, y: 50000, r: 8000, centerpiece: false });
  sim.tick();
  ping(sim, "A");
  sim.tick();
  assert(b.contactTier === 3, "map-wide reveal punches through terrain");
}

// 3. the ping itself IS LOS-gated and range-gated
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 100000, 180, false);
  sim.terrain.rocks.push({ x: 0, y: 50000, r: 8000, centerpiece: false }); // occlude the target
  sim.tick();
  ping(sim, "A");
  sim.tick();
  assert(a.contactTier === 0, "occluded target: the ping returns nothing");

  const sim2 = new Sim();
  const a2 = sim2.addShip("A", 0, -30000, 0);
  sim2.addShip("B", 0, C.PING_RANGE_M - 10000, 180, false); // 170 km away: beyond PING_RANGE_M
  sim2.tick();
  ping(sim2, "A");
  sim2.tick();
  assert(a2.contactTier === 0, "target beyond ping range: no grant");
}

// 4. cooldown: an immediate second ping is rejected with the stock line;
// ready again after PING_COOLDOWN_S
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 100000, 180, false);
  sim.tick();
  ping(sim, "A");
  sim.tick();
  ping(sim, "A");
  const ev = sim.tick();
  assert(
    ev.some((e) => e.kind === "reject" && /Transducers recharging, Captain\./.test((e as any).reason)),
    "cooldown rejection line"
  );
  for (let i = 0; i < C.PING_COOLDOWN_S; i++) sim.tick();
  assert(a.pingCooldownS <= 0, "transducers recharged");
  ping(sim, "A");
  const ev2 = sim.tick();
  assert(!ev2.some((e) => e.kind === "reject"), "ping accepted after cooldown");
}

// 5. THE design constraint: a ping cannot complete a lock on a target
// passive sensors can't sustain — grant expires, lock breaks after grace
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 60000, 180, false); // dark at 60 km: in lock range/cone, but passives blind
  a.pdcPosture = "hold";
  sim.tick();
  ping(sim, "A");
  let everLocked = false;
  let maxProgress = 0;
  for (let i = 0; i < C.PING_COOLDOWN_S; i++) {
    sim.tick();
    everLocked ||= a.lock.has;
    maxProgress = Math.max(maxProgress, a.lock.progress);
  }
  assert(maxProgress > 0, `lock progress accrued during the grant (${maxProgress})`);
  assert(!everLocked, "a ping FINDS ships — it never completes the lock by itself");
}

// 6. pinged ordnance: a coasting torpedo far beyond its passive detection
// range shows for the window, then vanishes again
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  (sim as any).missiles.push({
    id: 9300, owner: "B", x: 0, y: 50000, prevX: 0, prevY: 50000,
    launchX: 0, launchY: 200000, course: 180, speed: 0, vx: 0, vy: 0,
    age: 10, fuel: 0, burning: false, guidance: "autonomous", cmdBearing: null, lock: null,
  });
  sim.tick();
  assert(!(sim.snapshotFor("A") as any).missiles.some((m: any) => !m.own), "coasting bird at 50 km: passives blind");
  ping(sim, "A");
  sim.tick();
  assert((sim.snapshotFor("A") as any).missiles.some((m: any) => !m.own), "ping paints the coasting bird");
  for (let i = 0; i < C.PING_TRACK_S; i++) sim.tick();
  assert(!(sim.snapshotFor("A") as any).missiles.some((m: any) => !m.own), "and it fades with the grant");
}

// 7. pinged decoys read as ordinary TRACK contacts — a ping never resolves
// a decoy (that stays ID-only); the lie survives the sweep
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 210000, 180, false);
  sim.enqueue("B", [{ verb: "deploy_decoy", params: {} } as any]);
  sim.tick();
  // decoy drifts at B's position, 210 km out: beyond passive decoy detection (180 km)
  const sim1snap = sim.snapshotFor("A") as any;
  assert(!sim1snap.contacts.some((c: any) => String(c.cid).startsWith("d")), "decoy unseen passively at 210 km");
  // move the decoy inside ping range and sweep
  (sim as any).decoys[0].x = 0;
  (sim as any).decoys[0].y = 100000;
  ping(sim, "A");
  sim.tick();
  const snap = sim.snapshotFor("A") as any;
  const dc = snap.contacts.find((c: any) => String(c.cid).startsWith("d"));
  assert(dc?.tier === 2, "pinged decoy shows as an ordinary TRACK contact");
  assert(!snap.decoys.some((d: any) => !d.own), "the snapshot never labels it a decoy below ID");
}
console.log("done");
