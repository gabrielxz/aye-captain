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
  assert(Math.abs(s.vy - 15) < 1e-9 && s.vx === 0, "1 tick full thrust north => vy=15");
  for (let i = 0; i < 40; i++) sim.tick();
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

// 5. target tracking re-resolves each tick
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 10000, 0, 0); // due east of A
  sim.enqueue("A", [{ verb: "set_heading", params: { mode: "target", target: "enemy_ship" } }]);
  for (let i = 0; i < 10; i++) sim.tick();
  assert(Math.abs(angDiff(a.facing, 90)) < 6, `A tracks toward B due east (facing ${a.facing.toFixed(1)})`);
}

// 6. angle helpers
assert(norm360(-10) === 350, "norm360(-10)=350");
assert(angDiff(350, 10) === 20, "angDiff shortest arc across north");
console.log("done");
