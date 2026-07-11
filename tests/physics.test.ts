import { Sim, angDiff, norm360 } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

// 1. thrust accel + speed clamp
{
  const sim = new Sim();
  const s = sim.addShip("A", 0, 0, 0);
  sim.enqueue("A", [{ verb: "set_thrust", params: { percent: 100 } }]);
  sim.tick();
  assert(
    Math.abs(s.vy - C.ACCEL_FULL_THRUST_MPS2) < 1e-9 && s.vx === 0,
    `1 tick full thrust north => vy=${C.ACCEL_FULL_THRUST_MPS2}`
  );
  for (let i = 0; i < Math.ceil(C.MAX_SPEED_MPS / C.ACCEL_FULL_THRUST_MPS2) + 2; i++) sim.tick();
  assert(Math.hypot(s.vx, s.vy) <= C.MAX_SPEED_MPS + 1e-9, "speed clamped to MAX_SPEED");
  assert(Math.abs(Math.hypot(s.vx, s.vy) - C.MAX_SPEED_MPS) < 1e-9, "reaches exactly MAX_SPEED");
}

// 2. turn rate clamp, no overshoot
{
  const sim = new Sim();
  const s = sim.addShip("A", 0, 0, 0);
  sim.enqueue("A", [{ verb: "set_heading", params: { mode: "absolute", degrees: 90 } }]);
  sim.tick();
  assert(s.facing === 20, `turn clamped to 20 deg/tick (got ${s.facing})`);
  for (let i = 0; i < 10; i++) sim.tick();
  assert(s.facing === 90, `settles exactly on goal (got ${s.facing})`);
}

// 3. relative port turn = CCW
{
  const sim = new Sim();
  const s = sim.addShip("A", 0, 0, 10);
  sim.enqueue("A", [{ verb: "set_heading", params: { mode: "relative", direction: "port", degrees: 40 } }]);
  for (let i = 0; i < 5; i++) sim.tick();
  assert(s.facing === 330, `port 40 from 010 => 330 (got ${s.facing})`);
}

// 4. drift: rotation does not change velocity
{
  const sim = new Sim();
  const s = sim.addShip("A", 0, 0, 0);
  sim.enqueue("A", [{ verb: "set_thrust", params: { percent: 100 } }]);
  for (let i = 0; i < 5; i++) sim.tick();
  const [vx0, vy0] = [s.vx, s.vy];
  sim.enqueue("A", [
    { verb: "set_thrust", params: { percent: 0 } },
    { verb: "set_heading", params: { mode: "absolute", degrees: 180 } },
  ]);
  for (let i = 0; i < 20; i++) sim.tick();
  assert(s.facing === 180, "flipped to 180");
  assert(s.vx === vx0 && s.vy === vy0, "velocity unchanged while rotating at 0 thrust (drift)");
}

// 5. target headings TRACK CONTINUOUSLY (v5 §1, deliberate reversal of the
// v4 snapshot rule): the helm re-resolves the bearing every tick until the
// order is replaced. Target in the TRACK band — 8 km on a quiet ship — so
// the helm steers by the true position, not a noisy faint fix.
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 8000, 0, 0); // due east of A, track band
  sim.tick(); // let sensors see B
  sim.enqueue("A", [{ verb: "set_heading", params: { mode: "target", target: "enemy_ship" } }]);
  for (let i = 0; i < 6; i++) sim.tick();
  assert(Math.abs(angDiff(a.facing, 90)) < 1e-9, `tracking heading points at B's bearing (facing ${a.facing.toFixed(1)})`);
  // B relocates; the SAME order follows without being re-issued
  b.x = 0; b.y = -8000; // now due south
  for (let i = 0; i < 12; i++) sim.tick();
  assert(Math.abs(angDiff(a.facing, 180)) < 1e-9, `helm follows the moving target — continuous tracking (facing ${a.facing.toFixed(1)})`);
  // an explicit heading order replaces the track goal and tracking stops
  sim.enqueue("A", [{ verb: "set_heading", params: { mode: "absolute", degrees: 0 } }]);
  for (let i = 0; i < 20; i++) sim.tick();
  b.x = 8000; b.y = 0; // move B again; nose must NOT follow anymore
  for (let i = 0; i < 10; i++) sim.tick();
  assert(Math.abs(angDiff(a.facing, 0)) < 1e-9, `a new heading order replaces tracking (facing ${a.facing.toFixed(1)})`);
}

// 5b. tracking falls back to LAST KNOWN when the contact drops below faint,
// and the XO announces the loss exactly once (edge, not spam)
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 8000, 0, 0); // due east, track band
  sim.tick();
  sim.enqueue("A", [{ verb: "set_heading", params: { mode: "target", target: "enemy_ship" } }]);
  for (let i = 0; i < 6; i++) sim.tick();
  // B vanishes beyond detection (quiet ship ~54 km band; 200 km is gone)
  b.x = 0; b.y = 200000;
  const lostNotices: string[] = [];
  for (let i = 0; i < 10; i++) {
    for (const e of sim.tick()) {
      if (e.kind === "notice" && e.ship === "A" && /helm's holding/i.test(e.text)) lostNotices.push(e.text);
    }
  }
  assert(lostNotices.length === 1, `lost-contact fallback announced exactly once (got ${lostNotices.length})`);
  // helm holds the last-known bearing (east, where B was when last seen)
  assert(Math.abs(angDiff(a.facing, 90)) < 1e-9, `helm holds last known bearing after losing the contact (facing ${a.facing.toFixed(1)})`);
}

// 5c. nearest_rumble points the nose down the rumble's bearing (a bearing-
// only reference: hearing reaches 2.5x detection, so a burning ship at
// 240 km is heard but not seen)
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 240000, 0, 0); // due east, beyond detection
  b.thrust = 100; // burn hard: sig maxes, hearing reaches, detection doesn't
  sim.tick(); // let hearing pick up the rumble
  sim.enqueue("A", [{ verb: "set_heading", params: { mode: "target", target: "nearest_rumble" } }]);
  for (let i = 0; i < 6; i++) sim.tick();
  assert(Math.abs(angDiff(a.facing, 90)) < 1e-9, `nose points down the rumble bearing (facing ${a.facing.toFixed(1)})`);
}

// 5d. pointing at a rumble with nothing audible is rejected, not silently
// accepted
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  sim.tick();
  sim.enqueue("A", [{ verb: "set_heading", params: { mode: "target", target: "nearest_rumble" } }]);
  const rejected = sim.tick().some((e) => e.kind === "reject" && e.verb === "set_heading");
  assert(rejected, "nearest_rumble with no rumble audible is rejected");
}

// 6. angle helpers
assert(norm360(-10) === 350, "norm360(-10)=350");
assert(angDiff(350, 10) === 20, "angDiff shortest arc across north");

// 7. v4.4: relative turns honor the commanded direction and full magnitude
// (they used to collapse to an absolute goal + shortest arc: "starboard
// 270" went port 90, and a 360 was a silent no-op)
{
  // starboard 270 goes STARBOARD through 180, not the short way port
  const sim = new Sim();
  const s = sim.addShip("A", 0, 0, 0);
  sim.enqueue("A", [{ verb: "set_heading", params: { mode: "relative", direction: "starboard", degrees: 270 } }]);
  for (let i = 0; i < 5; i++) sim.tick();
  assert(s.facing === 100, `mid-turn heading on the STARBOARD path (got ${s.facing})`);
  for (let i = 0; i < 15; i++) sim.tick();
  assert(s.facing === 270, `settles exactly on 270 (got ${s.facing})`);

  // full 360 pirouette: really rotates, ends where it began, goal consumed
  const sim2 = new Sim();
  const s2 = sim2.addShip("A", 0, 0, 45);
  sim2.enqueue("A", [{ verb: "set_heading", params: { mode: "relative", direction: "starboard", degrees: 360 } }]);
  let sawOpposite = false;
  for (let i = 0; i < 25; i++) {
    sim2.tick();
    if (Math.abs(angDiff(s2.facing, 225)) < 1e-9) sawOpposite = true;
  }
  assert(sawOpposite, "pirouette passes through the opposite heading (really turned)");
  assert(s2.facing === 45, `pirouette ends back on the original heading (got ${s2.facing})`);
  assert(s2.goal === null, "completed turn goal is consumed");

  // port turns still go CCW under the new bookkeeping
  const sim3 = new Sim();
  const s3 = sim3.addShip("A", 0, 0, 0);
  sim3.enqueue("A", [{ verb: "set_heading", params: { mode: "relative", direction: "port", degrees: 200 } }]);
  for (let i = 0; i < 5; i++) sim3.tick();
  assert(s3.facing === 260, `port 200 turns CCW past the shortest arc (got ${s3.facing})`);
  for (let i = 0; i < 10; i++) sim3.tick();
  assert(s3.facing === 160, `port 200 from 000 settles on 160 (got ${s3.facing})`);

  // a fresh heading order still replaces a turn in progress
  const sim4 = new Sim();
  const s4 = sim4.addShip("A", 0, 0, 0);
  sim4.enqueue("A", [{ verb: "set_heading", params: { mode: "relative", direction: "starboard", degrees: 360 } }]);
  sim4.tick(); sim4.tick(); // 40 deg into the spin
  sim4.enqueue("A", [{ verb: "set_heading", params: { mode: "absolute", degrees: 0 } }]);
  for (let i = 0; i < 5; i++) sim4.tick();
  assert(s4.facing === 0, `new absolute order overrides the spin (got ${s4.facing})`);
}
console.log("done");
