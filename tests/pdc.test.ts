// §6 PDCs: posture command, missile attrition, ammo budget, warnings,
// LOS gating, signature spike.
import { Sim, pdcShares, type Ship, type Missile } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};
const grantLock = (ship: Ship) => {
  ship.lock = { progress: C.LOCK_TIME_S, has: true, grace: C.LOCK_GRACE_S };
};

// A slow inbound missile that will sit in the PDC envelope (test dummy).
function injectSlowMissile(sim: Sim, owner: "A" | "B", x: number, y: number): Missile {
  const m: Missile = {
    id: 9000, owner, x, y, prevX: x, prevY: y,
    launchX: x, launchY: y + 200000, // armed: launched far away
    course: 0, speed: 0, vx: 0, vy: 0,
    age: 10, fuel: 0, burning: false,
    guidance: "autonomous", cmdBearing: null, lock: null,
  };
  (sim as any).missiles.push(m);
  return m;
}

// 1. defaults + verb validation
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  assert(a.pdcPosture === "free" && a.pdcAmmoS === C.PDC_AMMO_S, "spawns free with a full ammo budget");
  sim.enqueue("A", [{ verb: "set_pdc", params: { posture: "hold" } }]);
  sim.tick();
  assert(a.pdcPosture === "hold", "set_pdc hold applies");
  sim.enqueue("A", [{ verb: "set_pdc", params: { posture: "sideways" } }]);
  const ev = sim.tick();
  assert(ev.some((e) => e.kind === "reject"), "bad posture rejected");
}

// 2. missile attrition: a loitering missile dies to sustained fire; ammo
// drains 1s per second of firing; signature spikes while firing
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  injectSlowMissile(sim, "B", 0, 4000); // parked inside PDC_RANGE_M
  let killed = false;
  let sawSpike = false;
  let ticks = 0;
  for (; ticks < 40 && !killed; ticks++) {
    const ev = sim.tick();
    if (sim.signatureOf(a) > C.SIG_BASE) sawSpike = true;
    killed = ev.some((e) => e.kind === "notice" && /PDC splash/.test((e as any).text));
  }
  assert(killed, `sustained PDC fire kills a loitering missile (${ticks} ticks; 25%/s)`);
  assert(sawSpike, "firing spikes our signature");
  assert(
    Math.abs(C.PDC_AMMO_S - a.pdcAmmoS - ticks) < 1.5,
    `ammo drains ~1s per second of fire (spent ${(C.PDC_AMMO_S - a.pdcAmmoS).toFixed(1)} in ${ticks}s)`
  );
}

// 3. ammo is finite: dry mounts don't fire, with staged warnings on the way
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  const warnings: string[] = [];
  // an endless supply of parked missiles keeps the guns firing
  for (let i = 0; i < 80; i++) {
    if ((sim as any).missiles.length === 0) injectSlowMissile(sim, "B", 0, 4000);
    for (const e of sim.tick()) {
      if (e.kind === "notice" && /PDC (ammunition|magazines)/.test((e as any).text)) {
        warnings.push((e as any).text);
      }
    }
  }
  assert(a.pdcAmmoS === 0, "ammo exhausts with no regeneration");
  assert(
    warnings.length === 4 &&
      /one-half/.test(warnings[0]) &&
      /one-quarter/.test(warnings[1]) &&
      /critical/.test(warnings[2]) &&
      /dry/.test(warnings[3]),
    `staged ammo warnings 50/25/10/dry (got ${warnings.length})`
  );
  // dry: a parked missile is safe forever
  (sim as any).missiles = [];
  injectSlowMissile(sim, "B", 0, 4000);
  for (let i = 0; i < 10; i++) sim.tick();
  assert((sim as any).missiles.length === 1, "dry mounts don't fire");
}

// 4. LOS gates the PDCs: a missile behind a rock is safe
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  sim.terrain.rocks.push({ x: 0, y: 2000, r: 800 });
  injectSlowMissile(sim, "B", 0, 4000); // in range, but shadowed by the rock
  for (let i = 0; i < 20; i++) sim.tick();
  assert((sim as any).missiles.length === 1, "no LOS, no engagement");
  assert(a.pdcAmmoS === C.PDC_AMMO_S, "no ammo wasted on a shadowed target");
}

// 5. saturation leaks by design. v4.5 kinematics: a full-speed (2400 m/s)
// torpedo spends ~3.3s crossing the envelope — single-missile kill is now
// ~55-60% (the spec's intent), so leaks drop but never vanish. The assert
// brackets the binomial spread; don't tighten it to "always dies".
{
  let leaked = 0;
  const trials = 30;
  for (let t = 0; t < trials; t++) {
    const sim = new Sim();
    const a = sim.addShip("A", 0, 0, 0);
    const b = sim.addShip("B", 0, 100000, 180, false);
    b.pdcPosture = "hold";
    grantLock(b);
    // torpedo at full speed just outside the envelope, boring straight in
    const m = injectSlowMissile(sim, "B", 0, 8500);
    m.course = 180;
    m.speed = C.MISSILE_MAX_SPEED_MPS;
    let struck = false;
    for (let i = 0; i < 5 && !struck; i++) {
      struck = sim.tick().some((e) => e.kind === "notice" && /Missile strike/.test((e as any).text));
    }
    if (struck) leaked++;
  }
  assert(
    leaked >= trials * 0.15 && leaked <= trials * 0.7,
    `torpedoes still leak, but die more often than not (${leaked}/${trials} got through)`
  );
}

// ===== Throughput: one mount, finite rate (audit §2.7) =====================
// Until 2026-07-15 a single mount rolled an INDEPENDENT full-rate kill chance
// at every eligible missile, probe and mine at once, while ammo drained once
// per substep either way — unlimited simultaneous defense for the same cost.
// None of the tests above noticed, because they are all single-target. That
// silence was the finding, so these pin the property directly.

// 9. The single-target case is UNTOUCHED — the whole point of dividing the
// rate rather than capping channels. If this moves, the ~57% single-missile
// envelope kill (block 5's "the spec's intent") moved with it.
{
  for (const ch of [1, 2, 3]) {
    const s = pdcShares(ch, 1, 0, 0);
    assert(s.missile === 1, `1 missile vs ${ch} channel(s): full rate, nothing changes`);
  }
}

// 10. Saturation is real: past the channel count the mounts time-slice, so
// TOTAL kill throughput is capped instead of scaling with the target count.
{
  const one = pdcShares(1, 2, 0, 0);
  assert(one.missile === 0.5, "1 channel vs 2 missiles: each engaged at half rate");
  const two = pdcShares(2, 4, 0, 0);
  assert(two.missile === 0.5, "2 channels vs 4 missiles: half rate each — throughput, not count");
  // the invariant behind both: rate x targets never exceeds the channels
  for (const ch of [1, 2, 3]) {
    for (let n = 1; n <= 8; n++) {
      const s = pdcShares(ch, n, 0, 0);
      assert(
        s.missile * n <= ch + 1e-9,
        `${ch} channels vs ${n} missiles: total throughput ${(s.missile * n).toFixed(2)} never exceeds ${ch}`
      );
    }
  }
}

// 11. Not a cliff. The audit asked for hard channels, which never engage the
// 2nd missile at all on a corvette — it would live every time. Every target
// in an engaged class gets a real, non-zero share.
{
  const s = pdcShares(1, 4, 0, 0);
  assert(s.missile > 0, "the 4th missile vs 1 channel is still shot at (0.25), not ignored");
}

// 12. Guns go to what kills you soonest. A minefield must not dilute
// anti-missile fire — mines and probes get only what the missiles left.
{
  const busy = pdcShares(1, 1, 6, 2);
  assert(busy.missile === 1, "one inbound missile takes the corvette's whole mount, at full rate");
  assert(busy.mine === 0 && busy.probe === 0, "...and the minefield gets nothing while it flies");
  const calm = pdcShares(1, 0, 4, 0);
  assert(calm.mine === 0.25, "with nothing inbound the mount works the minefield again");
  const cruiser = pdcShares(3, 1, 4, 0);
  assert(cruiser.missile === 1, "cruiser: missile served first at full rate");
  assert(cruiser.mine === 0.5, "...and 2 spare channels still work the mines (4 mines, half rate)");
}

// 13. Ordering is strict, not proportional: a class is served only from what
// is left. Pin it so nobody "improves" this into a weighted split.
{
  const s = pdcShares(2, 3, 5, 5);
  assert(s.missile * 3 === 2, "3 missiles consume BOTH channels outright");
  assert(s.mine === 0 && s.probe === 0, "nothing is left for mines or probes — strict priority");
}

// 14. End to end: the shares are actually WIRED to the roll, not just a pure
// function sitting in a corner. A corvette (1 channel) facing 4 birds kills
// meaningfully fewer of them than it would at the old unlimited full rate.
// Statistical, so the bound is generous — the exact rate is block 5's job.
{
  const trials = 220;
  let killed = 0;
  let total = 0;
  for (let t = 0; t < trials; t++) {
    const sim = new Sim();
    const a = sim.addShip("A", 0, 0, 0, false, null, undefined, "corvette");
    a.pdcPosture = "free";
    const b = sim.addShip("B", 0, 200000, 180, false);
    b.pdcPosture = "hold";
    for (let i = 0; i < 4; i++) {
      sim.missiles.push({
        id: 9000 + i, owner: "B", team: null, x: (i - 1.5) * 200, y: 6000,
        vx: 0, vy: -C.MISSILE_MAX_SPEED_MPS, course: 180, speed: C.MISSILE_MAX_SPEED_MPS,
        fuel: 0, burning: false, guidance: "bearing", target: null, ageS: 0, armed: true,
      } as Missile);
    }
    const before = sim.missiles.length;
    sim.tick();
    total += before;
    killed += before - sim.missiles.filter((m) => m.id >= 9000).length;
  }
  const rate = killed / total;
  // 1 channel split 4 ways ~= a quarter of the old per-missile hazard.
  assert(
    rate < 0.16,
    `a 1-channel corvette cannot shred a 4-bird salvo at full rate each (${(rate * 100).toFixed(1)}% killed in one second)`
  );
  assert(rate > 0, "...but it is still shooting — every bird is engaged, just slower");
}

console.log("done");
