// v4.5 §5 hearing channel: continuous, bearing-only, long-range. The fog
// invariant applies below faint: a rumble carries bearing (+ loudness for
// the client's audio) and NOTHING positional. No thresholds anywhere; no
// LOS gating — terrain blocks seeing, never hearing.
import { Sim } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

const darkDetect = C.SENSOR_BASE_M * (C.SIG_BASE / 100); // ~54 km
const darkHearing = darkDetect * C.HEARING_RANGE_MULT; // ~135 km

// 1. beyond detection, within hearing: a bearing-only rumble — and nothing else
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 100000, 180, false); // 100 km: detect 54, hearing 135
  sim.tick();
  const snap = sim.snapshotFor("A") as any;
  assert(snap.contacts.length === 0, "no contact at 100 km on a quiet ship");
  assert(snap.rumbles.length === 1 && snap.rumbles[0].cid === "r1", "rumble present (opaque per-viewer alias)");
  assert(snap.rumbles[0].bearing === 0, `rumble carries the true bearing (${snap.rumbles[0].bearing})`);
  const keys = Object.keys(snap.rumbles[0]).sort().join(",");
  assert(keys === "bearing,cid,loud", `fog leak check: rumble carries ONLY {cid,bearing,loud} (got ${keys})`);
}

// 2. continuity at the hearing boundary — no cliff, just the formula
{
  const at = (d: number) => {
    const sim = new Sim();
    sim.addShip("A", 0, 0, 0);
    sim.addShip("B", 0, d, 180, false);
    sim.tick();
    return (sim.snapshotFor("A") as any).rumbles.length;
  };
  assert(at(darkHearing - 2000) === 1, "heard just inside hearing range");
  assert(at(darkHearing + 2000) === 0, "silent just beyond hearing range");
}

// 3. terrain blocks seeing, NOT hearing: rock between -> tier 0 but rumble live
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 30000, 180, false); // well inside detection...
  sim.terrain.rocks.push({ x: 0, y: 15000, r: 6000, centerpiece: false }); // ...but occluded
  sim.tick();
  const snap = sim.snapshotFor("A") as any;
  assert(a.contactTier === 0, "rock blocks the eyes");
  assert(snap.rumbles.length === 1, "the rock does not block the ears");
}

// 4. rumble -> faint handoff is seamless: inside detection there is a
// contact and NO rumble for the same emitter (never both)
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, darkDetect * 0.9, 180, false); // faint band
  sim.tick();
  const snap = sim.snapshotFor("A") as any;
  assert(snap.contacts.length === 1, "contact at faint range");
  assert(!snap.rumbles.some((r: any) => r.cid === "sB"), "no double life: contact suppresses the rumble");
}

// 5. weapon spikes are audible at enormous range: a blind launch 400 km out
// (far beyond detection) rumbles for the enemy
{
  const sim = new Sim();
  sim.addShip("A", 0, -200000, 0);
  const b = sim.addShip("B", 0, 200000, 180, false);
  sim.tick();
  assert((sim.snapshotFor("A") as any).rumbles.length === 0, "quiet ship inaudible at 400 km");
  sim.enqueue("B", [{ verb: "fire_missile", params: { guidance: "bearing", bearing_degrees: 180 } }]);
  sim.tick();
  const snap = sim.snapshotFor("A") as any;
  assert(snap.rumbles.length === 1, "launch spike heard 400 km away");
  assert(snap.contacts.length === 0, "heard, not seen — still no contact");
}

// 6. XO announcements: new rumble, rate-limited drift, fade
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 100000, 180, false);
  let ev = sim.tick();
  assert(
    ev.some((e) => e.kind === "notice" && /Drive rumble, bearing 000/.test((e as any).text)),
    "new rumble announced with bearing"
  );
  // an immediate large shift is rate-limited (cooldown from the first line)
  b.x = 50000; b.y = 86600; // bearing 30
  ev = sim.tick();
  assert(!ev.some((e) => e.kind === "notice" && /drifted/.test((e as any).text)), "drift inside cooldown stays quiet");
  // once the cooldown expires, the standing >15 deg drift IS spoken
  let drifted = false;
  for (let i = 0; i <= C.RUMBLE_ANNOUNCE_COOLDOWN_S && !drifted; i++) {
    drifted = sim.tick().some((e) => e.kind === "notice" && /rumble's drifted to 030/.test((e as any).text));
  }
  assert(drifted, "meaningful drift announced after cooldown");
  // and the announcement re-arms the rate limit: another big move stays quiet
  b.x = 86600; b.y = 50000; // bearing 60
  ev = sim.tick();
  assert(!ev.some((e) => e.kind === "notice" && /drifted/.test((e as any).text)), "fresh cooldown after speaking");
  // fade out of hearing entirely
  b.x = 0; b.y = 400000;
  let lost = false;
  for (let i = 0; i < C.RUMBLE_ANNOUNCE_COOLDOWN_S + 2 && !lost; i++) {
    lost = sim.tick().some((e) => e.kind === "notice" && /Lost the rumble/.test((e as any).text));
  }
  assert(lost, "fade announced");
}

// 7. rumble_present standing order fires on the first rumble
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  // silent: beyond hearing but INSIDE the region (outside it a ship reads
  // signature-max and becomes a full contact, not a rumble)
  const b = sim.addShip("B", 0, 240000, 180, false);
  sim.enqueue("A", [{
    verb: "set_standing_order",
    params: {
      label: "listening watch",
      condition: { metric: "rumble_present", op: "eq", value: true },
      actions: [{ verb: "show_vector", params: {} }],
    },
  } as any]);
  let ev = sim.tick();
  ev = sim.tick();
  assert(!ev.some((e) => e.kind === "notice" && /'listening watch' triggered/.test((e as any).text)), "quiet sky: no trigger");
  b.y = 100000; // now audible
  let fired = false;
  for (let i = 0; i < 3 && !fired; i++) {
    fired = sim.tick().some((e) => e.kind === "notice" && /'listening watch' triggered/.test((e as any).text));
  }
  assert(fired, "rumble_present fires");
}

// 8. decoys rumble exactly like ships (a silent 'contact' would unmask them)
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0);
  const b = sim.addShip("B", 0, 210000, 180, false); // beyond even decoy detection (180 km)
  sim.enqueue("B", [{ verb: "deploy_decoy", params: {} }]);
  sim.tick();
  const snap = sim.snapshotFor("A") as any;
  // ship (sig 30): inaudible at 210 km. decoy (sig 100): heard to 450 km.
  // v5 §3: cids are opaque aliases — a decoy rumble must be
  // indistinguishable from a ship rumble on the wire (invariant 11)
  assert(snap.rumbles.length === 1, "the decoy rumbles on its own (mother ship inaudible)");
  assert(/^r\d+$/.test(String(snap.rumbles[0].cid)), "rumble cid is an opaque alias, not an object id");
}
console.log("done");
