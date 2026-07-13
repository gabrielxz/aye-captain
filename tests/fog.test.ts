// Fog of war under the v4 contact-tier model. Detection range scales with
// the TARGET's signature: quiet ship (sig 30 post-v4.3) seen at ~54 km;
// tiers at <=30% (id), <=60% (track), <=100% (faint) of that.
import { Sim } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

const quietDetect = C.SENSOR_BASE_M * (C.SIG_BASE / 100); // ~54 km at v4.3 values

// 1. spawn distance: dark ships see nothing — no contacts, no ghost
{
  const sim = new Sim();
  sim.addShip("A", 0, -C.SPAWN_RING_RADIUS_M, 0);
  sim.addShip("B", 0, C.SPAWN_RING_RADIUS_M, 180, true);
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
  assert(ev1.some(e => e.kind === "notice" && e.ship === "A" && /New contact — designating .*Faint/.test((e as any).text)), "faint contact XO line (designated)");
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
  assert(a.contactTier >= 1, `full burn (sig ${C.SIG_BASE + 100}) seen at 100 km (tier ${a.contactTier})`);
}

// 4b. v4.3 sensor rebase: the compressed spread, pinned at its boundaries.
// Dark is an edge, not an off-switch: a drifter is contact-visible at ~54 km
// but not lockable (track) until ~32 km, not ID'd until ~16 km.
{
  const dark = C.SENSOR_BASE_M * (C.SIG_BASE / 100);
  const mk = (distM: number, thrust: number) => {
    const sim = new Sim();
    const a = sim.addShip("A", 0, 0, 0);
    const b = sim.addShip("B", 0, distM, 180, false);
    b.thrust = thrust;
    sim.tick();
    return a.contactTier;
  };
  assert(dark === 54000, `dark detect is 54 km (got ${dark / 1000})`);
  assert(mk(dark - 1000, 0) === 1, "dark drifter faint just inside 54 km");
  assert(mk(dark + 2000, 0) === 0, "dark drifter invisible beyond 54 km");
  assert(mk(dark * C.TIER_TRACK_FRAC - 1000, 0) === 2, "dark drifter TRACKABLE inside ~32 km");
  assert(mk(dark * C.TIER_ID_FRAC - 1000, 0) === 3, "dark drifter IDs inside ~16 km");
  const cruise = C.SENSOR_BASE_M * ((C.SIG_BASE + 50) / 100);
  assert(cruise === 144000, `50% cruise detect is 144 km (got ${cruise / 1000})`);
  assert(mk(cruise - 2000, 50) >= 1, "50% cruise faint just inside 144 km");
  // spawn spot-check (v4.3 §5): even a full-burner (detect 234 km) is dark
  // at the 300 km spawn separation — the first move still precedes first
  // contact, the opening hunt survives the rebase
  const flank = C.SENSOR_BASE_M * ((C.SIG_BASE + 100) / 100);
  assert(flank === 234000, `flank detect is 234 km (got ${flank / 1000})`);
  assert(2 * C.SPAWN_RING_RADIUS_M > flank, "spawn separation exceeds flank detect");
  {
    // real spawn geometry (both ships INSIDE the region — outside it the
    // signature-max rule would light anything up)
    const sim = new Sim();
    const a = sim.addShip("A", 0, -C.SPAWN_RING_RADIUS_M, 0);
    const b = sim.addShip("B", 0, C.SPAWN_RING_RADIUS_M, 180, false);
    b.thrust = 100;
    sim.tick();
    assert(a.contactTier === 0, "full-burner still invisible at spawn range");
  }
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
  assert(ev.some(e => e.kind === "notice" && /Track lost on .+ — last known bearing/.test((e as any).text)), "track lost XO line (designated)");
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
// 11. v4.7 ping fx: no leak — the payload is exactly {type, x, y, r, mask}.
// The mask derives from terrain (public) + pinger position (public for
// PING_REVEAL_S as the ping's price). Assert the KEY SET, not a happy path:
// any new field is a fog review, not a merge.
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 100000, 180, false);
  sim.enqueue("A", [{ verb: "sensor_ping", params: {} }]);
  sim.tick();
  for (const viewer of ["A", "B"] as const) {
    const p = (sim.snapshotFor(viewer).fx as any[]).find((f) => f.type === "ping");
    assert(!!p, `ping fx present in ${viewer}'s snapshot`);
    const keys = Object.keys(p).sort().join(",");
    assert(keys === "mask,r,type,x,y", `ping fx keys are exactly {type,x,y,r,mask} for ${viewer} (got ${keys})`);
    assert(p.mask.every((v: unknown) => typeof v === "number"), `mask is pure numbers for ${viewer}`);
  }
}

// v5.1 §2.2: the snapshot carries HOW MANY hostiles hold a lock on you —
// a bare count. You already know THAT you're painted (the RWR); the count
// adds multiplicity only. Nothing may ride along: no identity, no bearing.
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 30000, 180, false);
  const c = sim.addShip("C", 30000, 0, 270, false);
  sim.tick();
  assert((sim.snapshotFor("A") as any).you.lockedBy === 0, "lockedBy 0 while nobody holds a lock");
  b.lock.target = "A";
  b.lock.has = true;
  assert((sim.snapshotFor("A") as any).you.lockedBy === 1, "one locker -> lockedBy 1");
  c.lock.target = "A";
  c.lock.has = true;
  const snap = sim.snapshotFor("A") as any;
  assert(snap.you.lockedBy === 2, "two lockers -> lockedBy 2");
  assert(typeof snap.you.lockedBy === "number", "the count is a bare number — no identity, no bearing");
  // acquiring (progress without hold) does not count as a locker
  c.lock.has = false;
  c.lock.progress = 2;
  assert((sim.snapshotFor("A") as any).you.lockedBy === 1, "acquiring is not a held lock");
}

// Patch 2 §1a: every contact carries `loud` — SIGNATURE-derived (the same
// scalar the hearing channel broadcasts below faint), NEVER range-derived,
// and a decoy contact's loudness is exactly a sig-DECOY_SIGNATURE hull's
// (invariant 11: nothing may unmask a decoy below ID).
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const burner = sim.addShip("B", 0, 40000, 180, false);
  const coaster = sim.addShip("C", 20000, 0, 270, false);
  burner.thrust = 100;
  coaster.thrust = 0;
  sim.tick();
  const contacts = (sim.snapshotFor("A") as any).contacts;
  const cb = contacts.find((c: any) => c.x === burner.x && c.y === burner.y) ??
    contacts.find((c: any) => Math.hypot(c.x - burner.x, c.y - burner.y) < 3000);
  const cc = contacts.find((c: any) => Math.hypot(c.x - coaster.x, c.y - coaster.y) < 3000);
  assert(!!cb && !!cc, "both hostiles held (setup real)");
  assert(typeof cb.loud === "number" && typeof cc.loud === "number", "contacts carry loud");
  assert(cb.loud > cc.loud, "the burner is louder than the coaster — signature-derived");
  assert(Math.abs(cc.loud - Math.min(1, sim.signatureOf(coaster) / C.LOUD_SIG_REF)) < 1e-9,
    "loud is exactly min(1, sig/LOUD_SIG_REF) — never range-derived (the nearer coaster is the quiet one)");
  // decoy contact loudness matches its signature class, not its identity:
  // a quiet ship 120 km out is invisible, but its decoy (sig 100) reads
  // as an ordinary FAINT contact carrying a sig-100 hull's loudness
  const sim2 = new Sim();
  sim2.addShip("A", 0, 0, 0);
  const far = sim2.addShip("D", 0, 120000, 180, false);
  far.thrust = 0;
  sim2.enqueue("D", [{ verb: "deploy_decoy", params: {} }]);
  for (let t = 0; t < 3; t++) sim2.tick();
  const withDecoy = (sim2.snapshotFor("A") as any).contacts;
  const dLoud = Math.min(1, C.DECOY_SIGNATURE / C.LOUD_SIG_REF);
  assert(withDecoy.length === 1, "only the decoy is a contact (the quiet owner stays dark)");
  assert(Math.abs(withDecoy[0].loud - dLoud) < 1e-9,
    "a decoy contact's loud is exactly DECOY_SIGNATURE/LOUD_SIG_REF — indistinguishable from a cruising hull");
}

console.log("done");
