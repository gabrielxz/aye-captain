// v4.7 §3a: the ping fx — emission, occlusion mask, routing, reveal
// ownership. Ping MECHANICS are pinned in ping.test.ts, which this release
// must leave unchanged and green.
import { Sim } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

// 1. emission: exactly one ping fx, full mask, every entry within range
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  sim.enqueue("A", [{ verb: "sensor_ping", params: {} }]);
  sim.tick();
  const fx = (sim.snapshotFor("A").fx as any[]).filter((f) => f.type === "ping");
  assert(fx.length === 1, "a sensor_ping produces exactly one ping fx");
  const p = fx[0];
  assert(p.x === 0 && p.y === 0, "fx origin is the pinger");
  assert(p.r === C.PING_RANGE_M, "fx r is PING_RANGE_M");
  assert(Array.isArray(p.mask) && p.mask.length === C.PING_SHADOW_SAMPLES, `mask has ${C.PING_SHADOW_SAMPLES} entries`);
  assert(p.mask.every((m: number) => m >= 0 && m <= C.PING_RANGE_M), "every mask entry within [0, PING_RANGE_M]");
  assert(p.mask.every((m: number) => m === C.PING_RANGE_M), "empty terrain: every bearing clear to full range");
}

// 2. the shadow is real: a rock due north shortens that bearing to its near
//    face; a bearing 90 degrees away stays clear
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  const rock = { x: 0, y: 50000, r: 4000 }; // due north (bearing 000), 50 km out
  sim.terrain.rocks.push(rock);
  sim.enqueue("A", [{ verb: "sensor_ping", params: {} }]);
  sim.tick();
  const p = (sim.snapshotFor("A").fx as any[]).find((f) => f.type === "ping");
  const north = p.mask[0]; // entry 0 = bearing 000
  const east = p.mask[Math.floor(C.PING_SHADOW_SAMPLES / 4)]; // bearing 090
  assert(Math.abs(north - (50000 - 4000)) < 50, `north bearing stops at the rock's near face (${north.toFixed(0)} m)`);
  assert(east === C.PING_RANGE_M, "bearing 090 still reaches full range");
}

// 3. dust also tears the ring
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  sim.terrain.dust.push({ x: 40000, y: 0, rx: 10000, ry: 10000, rot: 0 }); // due east
  sim.enqueue("A", [{ verb: "sensor_ping", params: {} }]);
  sim.tick();
  const p = (sim.snapshotFor("A").fx as any[]).find((f) => f.type === "ping");
  const east = p.mask[Math.floor(C.PING_SHADOW_SAMPLES / 4)];
  assert(Math.abs(east - 30000) < 50, `east bearing stops at the dust's near edge (${east.toFixed(0)} m)`);
}

// 4. routing: the fx reaches the pinger, the enemy, and spectators
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180, false);
  sim.enqueue("A", [{ verb: "sensor_ping", params: {} }]);
  sim.tick();
  const inA = (sim.snapshotFor("A").fx as any[]).some((f) => f.type === "ping");
  const inB = (sim.snapshotFor("B").fx as any[]).some((f) => f.type === "ping");
  const inSpec = (sim.snapshotSpectator().fx as any[]).some((f) => f.type === "ping");
  assert(inA, "ping fx reaches the pinger");
  assert(inB, "ping fx reaches the enemy (the scream is map-wide)");
  assert(inSpec, "ping fx reaches spectators");
}

// 5. reveal ownership: pingRevealS drives the pinger's own LIT countdown and
//    never appears in the enemy's snapshot of the pinger
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 100000, 180, false);
  sim.enqueue("A", [{ verb: "sensor_ping", params: {} }]);
  sim.tick();
  const youA = sim.snapshotFor("A").you as any;
  assert(youA.ping.revealS > 0 && youA.ping.revealS <= C.PING_REVEAL_S, `pinger sees own revealS (${youA.ping.revealS})`);
  const snapB = sim.snapshotFor("B") as any;
  assert((snapB.you.ping.revealS ?? 0) === 0, "enemy's OWN revealS stays 0");
  for (const c of snapB.contacts ?? []) {
    assert(!("ping" in c) && !("revealS" in c) && !("pingRevealS" in c), `no reveal fields on enemy contact ${c.cid}`);
  }
  // belt and braces: the word never appears anywhere in B's snapshot except B's own you.ping
  const scrubbed = JSON.stringify({ ...snapB, you: { ...snapB.you, ping: undefined } });
  assert(!/reveal/i.test(scrubbed), "no reveal field anywhere else in the enemy snapshot");
}

console.log("done");
