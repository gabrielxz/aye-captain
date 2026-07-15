// 🔴 THE MUSIC FOG TEST — mandatory-green (HANDOFF-CAMPAIGN §7.1/§13).
// LAW: the score is a function of the player's SNAPSHOT, never the sim's
// TRUTH. An undetected Hunter close aboard and an undetected Hunter across
// the map MUST sound identical — if the music knew, it would be a sensor,
// and every hour spent on fog-of-war would leak through the soundtrack.
import { musicView, computeMusic, GATE_RUN_TTG_MAX_S } from "../client/music-brain.js";
import { Sim, type Mission } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

const missionSim = (): Sim => {
  const sim = new Sim();
  sim.addShip("A", 0, -C.SPAWN_RING_RADIUS_M, 0);
  sim.mission = {
    playerIds: ["A"],
    system: 2,
    systemName: "Sharp Ears",
    gate: { x: 0, y: C.REGION_RADIUS_M, apertureW: C.APERTURE_W_M },
    hunterSpawnS: 1,
    hunterSpawned: false,
    hunterIds: [],
    hunters: [{ archetype: "corvette", sensorMult: 1.4, sigMult: 0.75, gateCamp: false }],
    spawnLine: "Clock's run out, Captain — a drive just lit off in-system.",
    wrecks: [],
    salvaging: {},
    cleared: false,
    stats: { huntersKilled: 0, salvaged: 0, pingsFired: 0, modules: 0 },
    haul: [],
    decoyTaught: false,
    solGood: {},
    solCooldownS: {},
  } satisfies Mission;
  return sim;
};

// 1. 🔴 THE FOG PIN, sim level: two sims, identical except for the TRUE
// distance of a dark, undetected, un-heard Hunter (both beyond the
// hearing radius — a rumble is EARNED information the score may use, so
// the pin uses truly silent placements). The wire snapshots must distill
// to identical views, and identical views to identical intensity.
{
  const place = (distM: number): unknown => {
    const sim = missionSim();
    sim.tick(); // spawn the Hunter (far away by the no-pop-in law)
    const h = sim.ships.get("H")!;
    const a = sim.ships.get("A")!;
    h.x = a.x;
    h.y = a.y + distM;
    h.thrust = 0; // dark
    // ...and COLD. Thermal memory made "dark" a state you reach rather than a
    // switch you flip: the Hunter spawned hot, so thrust=0 alone leaves it
    // glowing (~130 sig) and audible at 80 km but not at 190 km — which would
    // fail this pin for a reason that has nothing to do with fog. Zero the
    // glow for the same reason the lines below zero velocity and the AI: the
    // pin is about DISTANCE, nothing else.
    h.thermalSig = 0;
    h.hunterAI = false; // hold it still: the pin is about DISTANCE, nothing else
    h.vx = h.vy = 0;
    sim.tick();
    return musicView(sim.snapshotFor("A"));
  };
  // dark corvette (sigMult 0.75): heard to ~2.5 × detection ≈ 68 km.
  // 80 km and 190 km are both silent — different truths, same snapshot.
  const near = place(80000);
  const far = place(190000);
  assert(JSON.stringify(near) === JSON.stringify(far), "undetected Hunter at 80 km and at 190 km distill to IDENTICAL music views — the score cannot know");
  const iNear = computeMusic(near as any).intensity;
  const iFar = computeMusic(far as any).intensity;
  assert(iNear === iFar, `…and to identical intensity (${iNear} === ${iFar}) — silence. That is Jaws.`);
}

// 2. determinism is the law's other half: same view, same output, always
{
  const v = { spawnInS: 0, hunterActive: true, salvaging: false, contacts: [], rumbleLoud: 0.4, painted: "none", lockedBy: 0, missilesInbound: 0, hullFrac: 1, gate: null };
  const a = computeMusic(v as any);
  const b = computeMusic(v as any);
  assert(JSON.stringify(a) === JSON.stringify(b), "computeMusic is pure — identical views, identical output");
}

// 3. what the music MAY respond to (§7.1 table), and in the right order
{
  const base = { spawnInS: 0, hunterActive: true, salvaging: false, contacts: [], rumbleLoud: 0, painted: "none", lockedBy: 0, missilesInbound: 0, hullFrac: 1, gate: null };
  const silent = computeMusic(base as any).intensity;
  const rumble = computeMusic({ ...base, rumbleLoud: 0.6 } as any).intensity;
  const track = computeMusic({ ...base, contacts: [{ tier: 2, rangeM: 60000 }] } as any).intensity;
  const locked = computeMusic({ ...base, lockedBy: 1 } as any).intensity;
  const inbound = computeMusic({ ...base, missilesInbound: 2 } as any).intensity;
  assert(silent < rumble && rumble < track && track < locked && locked < inbound, `the ladder of dread: silence ${silent.toFixed(2)} < rumble ${rumble.toFixed(2)} < track ${track.toFixed(2)} < locked ${locked.toFixed(2)} < inbound ${inbound.toFixed(2)}`);
}

// 4. the spawn STING: edge-triggered off the HUD clock (fair game), and
// the output shape carries no bearing anywhere (assert the whitelist)
{
  const pre = { spawnInS: 3, hunterActive: false, salvaging: false, contacts: [], rumbleLoud: 0, painted: "none", lockedBy: 0, missilesInbound: 0, hullFrac: 1, gate: null };
  const post = { ...pre, spawnInS: 0, hunterActive: true };
  const out = computeMusic(post as any, pre as any);
  assert(out.sting === "spawn", "clock-zero fires the sting");
  assert(computeMusic(post as any, post as any).sting === null, "the sting is an edge, not a state");
  const keys = Object.keys(out).sort().join(",");
  assert(keys === "intensity,layers,phase,sting", `output shape is the whitelist (${keys}) — no bearing can ride along`);
}

// 5. race phase is LIGHT (§7.6: open, even beautiful — the contrast is
// the point): threats are capped pre-spawn
{
  const race = computeMusic({ spawnInS: 120, hunterActive: false, salvaging: false, contacts: [{ tier: 2, rangeM: 40000 }], rumbleLoud: 0, painted: "none", lockedBy: 0, missilesInbound: 0, hullFrac: 1, gate: null } as any);
  assert(race.intensity <= 0.25 && race.phase === "race", "pre-spawn the board reads open — no dread before the clock says so");
}

// 6. §7.5 the gate run: the music counts you down, sags when you blow the
// line, and WITHHOLDS the top layer unless the solution is good
{
  const base = { spawnInS: 0, hunterActive: true, salvaging: false, contacts: [], rumbleLoud: 0, painted: "none", lockedBy: 0, missilesInbound: 0, hullFrac: 1 };
  const at = (ttg: number, good: boolean) => computeMusic({ ...base, gate: { ttg, missM: good ? 100 : 4000, side: "left", good } } as any);
  assert(at(20, true).intensity > at(60, true).intensity, "closer to the gate, higher the score — ttg is the driver");
  assert(at(60, true).intensity > at(GATE_RUN_TTG_MAX_S + 10, true).intensity, "outside the ramp window the gate is quiet");
  const committed = at(5, true);
  const wide = at(5, false);
  assert(committed.layers.perc > 0, "solution good at the wire: the score COMMITS (top layer in)");
  assert(wide.layers.perc === 0 && wide.intensity < committed.intensity, "solution bad: it climbs but does not resolve — the soundtrack says you won't make it");
}

// 7. layer thresholds enter in §7.3 order
{
  const base = { spawnInS: 0, hunterActive: true, salvaging: false, contacts: [], rumbleLoud: 0, painted: "none", lockedBy: 0, missilesInbound: 0, hullFrac: 1, gate: null };
  const mid = computeMusic({ ...base, contacts: [{ tier: 2, rangeM: 120000 }] } as any); // ~0.6
  assert(mid.layers.pulse > 0 && mid.layers.arp > 0 && mid.layers.pad === 0 && mid.layers.perc === 0, "mid intensity: pulse + arp in, pad + perc waiting");
  const high = computeMusic({ ...base, missilesInbound: 1 } as any); // 0.92
  assert(high.layers.pad > 0 && high.layers.perc > 0, "missiles inbound: everything is in");
}

// 8. an empty board is SILENT — no floor, no bed. The file's own doctrine
// ("the Hunter closing, undetected, is scored with SILENCE") was a lie while
// intensity floored at 0.04: it left a sawtooth drone under every quiet
// moment. Playtest 2026-07-14: it read as an alarm, not as space.
{
  const empty = { spawnInS: 0, hunterActive: true, salvaging: false, contacts: [], rumbleLoud: 0, painted: "none", lockedBy: 0, missilesInbound: 0, hullFrac: 1, gate: null };
  const out = computeMusic(empty as any);
  assert(out.intensity === 0, `nothing detected, nothing scored: intensity ${out.intensity} === 0`);
  assert(
    Object.values(out.layers).every((v) => v === 0),
    `…and every layer silent, the bed included (${JSON.stringify(out.layers)})`
  );
  // an undetected Hunter is exactly this view, so silence is the fog law too
  const hunted = computeMusic({ ...empty, hunterActive: true } as any);
  assert(hunted.intensity === 0, "an undetected Hunter is scored with silence — that is Jaws");
  // but the moment anything is knowable, the bed is there to carry it
  const heard = computeMusic({ ...empty, rumbleLoud: 0.6 } as any);
  assert(heard.layers.bed === 1, "a rumble brings the bed in full — the bottom layer still exists");
  assert(computeMusic(null as any).layers.bed === 0, "no view, no bed");
}

console.log("done: music");
