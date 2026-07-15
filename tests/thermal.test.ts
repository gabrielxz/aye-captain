// Thermal signature memory. Cutting the drive used to make you dim on the very
// next tick; going dark was a switch, and strobing (burn a second, vanish) was
// free. Signature now floors at a decaying high-water mark of the SUSTAINED
// emission, so you can become hard to detect but cannot erase the last ten
// seconds of your own behaviour.
import { Sim } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

const FULL_BURN_SIG = C.SIG_BASE + 100; // frigate: base + 100% effective thrust

// 1. The rise is instant — you cannot hide a burn while you are making it.
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  a.thrust = 100;
  assert(
    sim.signatureOf(a) === FULL_BURN_SIG,
    "a burning ship reads its true emission with no tick required (max(), not replace)"
  );
  sim.tick();
  assert(a.thermalSig === FULL_BURN_SIG, "thermal snaps UP to the peak immediately");
}

// 2. THE POINT: the drive goes off and the hull stays hot.
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  a.thrust = 100;
  sim.tick();
  a.thrust = 0;
  assert(
    sim.sustainedEmissionOf(a) === C.SIG_BASE,
    "emission collapses with the drive (invariant 8: EFFECTIVE thrust)"
  );
  assert(
    sim.signatureOf(a) === FULL_BURN_SIG,
    "but signature does NOT — going dark is a commitment, not a switch"
  );
}

// 3. It reaches cold, on the thermal clock rather than the throttle's, and the
// time is the honest one: a full burn costs the full decay.
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  a.thrust = 100;
  sim.tick();
  a.thrust = 0;
  const wantS = Math.ceil((FULL_BURN_SIG - C.SIG_BASE) / C.THERMAL_DECAY_PER_S);
  for (let i = 0; i < wantS - 1; i++) sim.tick();
  assert(sim.signatureOf(a) > C.SIG_BASE, `still glowing one second short of cold (${wantS - 1}s)`);
  sim.tick();
  assert(
    sim.signatureOf(a) === C.SIG_BASE,
    `cold after exactly (peak-base)/rate = ${wantS}s — a rate, not a fixed window`
  );
}

// 4. A rate, not a window: a small flare glows briefly, a big one glows long.
// This is what prices a hard burn above lighting a module.
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  a.thrust = 20;
  sim.tick();
  a.thrust = 0;
  const smallCool = Math.ceil(20 / C.THERMAL_DECAY_PER_S);
  for (let i = 0; i < smallCool; i++) sim.tick();
  assert(
    sim.signatureOf(a) === C.SIG_BASE,
    `a 20% burn is cold in ${smallCool}s — proportionate, not a flat penalty`
  );
}

// 5. Strobing is dead — the actual bug. Burn one second, cut, and you are NOT
// instantly invisible; the snapshot an enemy takes right after still sees you.
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 100000, 180, false);
  b.pdcPosture = a.pdcPosture = "hold";
  a.thrust = 100;
  sim.tick();
  a.thrust = 0;
  sim.tick();
  const seen = sim.snapshotFor("B").contacts.length > 0;
  assert(seen, "a ship that burned then cut is still on the enemy board one tick later");
}

// 6. Transient weapon spikes are NOT remembered — deliberate. They carry their
// own timers and are the "you flashed" mechanic; feeding them into thermal
// would turn a 5 s launch flash into ~20 s of glow. Pin the boundary so a
// future hand does not quietly fold them in.
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  a.sigSpikeLaunch = C.SIG_SPIKE_LAUNCH_S;
  sim.tick();
  assert(
    a.thermalSig === C.SIG_BASE,
    "a launch flash leaves NO thermal trace — spikes are not sustained emission"
  );
  a.sigSpikeLaunch = 0;
  assert(
    sim.signatureOf(a) === C.SIG_BASE,
    "...so when the flash ends the ship is cold, exactly as before"
  );
}

// 7. 🔴 Invariant 13: the hearing channel is CONTINUOUS — no thresholds. A
// decaying float under a max() introduces none, but pin it: signature must
// step DOWN smoothly across the cooldown, never snap.
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  a.thrust = 100;
  sim.tick();
  a.thrust = 0;
  let prev = sim.signatureOf(a);
  let maxStep = 0;
  for (let i = 0; i < 12; i++) {
    sim.tick();
    const now = sim.signatureOf(a);
    maxStep = Math.max(maxStep, prev - now);
    prev = now;
  }
  assert(
    maxStep <= C.THERMAL_DECAY_PER_S + 1e-9,
    `signature never falls faster than the decay rate (max step ${maxStep.toFixed(2)}/s) — continuous, no cliff`
  );
}

// 8. 🔴 Invariant 20 / the music-brain law, restated at the source: thermal is
// a property of the OBSERVED hull, so it reaches every consumer through
// signatureOf and leaks nothing extra. An enemy learns we are hot only if
// their sensors can reach us — glow is not a broadcast.
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 240000, 180, false); // beyond any detection
  b.pdcPosture = a.pdcPosture = "hold";
  a.thrust = 100;
  sim.tick();
  a.thrust = 0;
  sim.tick();
  assert(
    sim.snapshotFor("B").contacts.length === 0,
    "a glowing ship 240 km away is still invisible — thermal rides the sensor rules, not around them"
  );
}
