// v5 §7: comms. Broadcast reach + comms spike with callsign voiceprint,
// tightbeam track requirement + teammate exemption, the decoy-dish void,
// verbatim delivery + truncation, and per-channel cooldowns.
import { Sim, type SimEvent } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};
const quiet = (sim: Sim) => {
  for (const s of (sim as any).ships.values()) s.pdcPosture = "hold";
};
const run = (sim: Sim, ticks: number): SimEvent[] => {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
};

// 1. broadcast: everyone receives it verbatim; the spike carries bearing +
// callsign to every viewer; the sender confirms
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0, false, null, "Kestrel");
  sim.addShip("B", 0, 200000, 180, false, null, "Mako");
  sim.addShip("C", 200000, 0, 270, false, null, "Sable");
  quiet(sim);
  sim.enqueue("A", [{ verb: "transmit", params: { channel: "broadcast", message: "nice decoy, very convincing" } }]);
  const evs = run(sim, 1);
  const tx = evs.find((e) => e.kind === "transmission") as any;
  assert(!!tx && tx.to === "all" && tx.fromName === "Kestrel" && tx.text === "nice decoy, very convincing",
    "broadcast reaches all, attributed, verbatim");
  assert(evs.some((e) => e.kind === "notice" && e.ship === "A" && /Transmission away/.test((e as any).text)), "sender's XO confirms");
  const snapB = sim.snapshotFor("B") as any;
  const snapC = sim.snapshotFor("C") as any;
  assert(snapB.comms.length === 1 && snapB.comms[0].callsign === "Kestrel" && snapB.comms[0].bearing === 180,
    "B gets the spike: bearing + VOICEPRINT callsign (pre-ID!)");
  assert(snapC.comms.length === 1 && snapC.comms[0].bearing === 270, "C gets its own bearing on the same spike");
  assert(!JSON.stringify(snapB.comms).match(/"x"|"y"/), "the spike is bearing-only on the wire — no position");
  const snapA = sim.snapshotFor("A") as any;
  assert(snapA.comms.length === 0, "no chevron for your own voice");
  // spike expires after COMMS_SPIKE_S
  run(sim, C.COMMS_SPIKE_S + 1);
  assert((sim.snapshotFor("B") as any).comms.length === 0, "spike fades after COMMS_SPIKE_S");
}

// 2. tightbeam: needs a current TRACK — no track is refused; with a track
// it delivers ONLY to the recipient, no spike anywhere
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0, false, null, "Kestrel");
  sim.addShip("B", 0, 8000, 180, false, null, "Mako"); // ID band: identified
  sim.addShip("C", 0, -8000, 0, false, null, "Sable");
  quiet(sim);
  sim.tick();
  sim.enqueue("A", [{ verb: "transmit", params: { channel: "tightbeam", recipient: "Mako", message: "he's behind the moonlet" } }]);
  const evs = run(sim, 1);
  const tx = evs.find((e) => e.kind === "transmission") as any;
  assert(!!tx && tx.to === "B" && tx.text === "he's behind the moonlet", "tightbeam delivers to the recipient only");
  assert((sim.snapshotFor("C") as any).comms.length === 0, "no spike: a whisper, not a flare");

  const sim2 = new Sim();
  sim2.addShip("A", 0, 0, 0, false, null, "Kestrel");
  sim2.addShip("B", 0, 150000, 180, false, null, "Mako"); // no contact at all
  quiet(sim2);
  sim2.tick();
  sim2.enqueue("A", [{ verb: "transmit", params: { channel: "tightbeam", recipient: "Mako", message: "hello?" } }]);
  const evs2 = run(sim2, 1);
  assert(evs2.some((e) => e.kind === "reject" && /No contact by that name/.test((e as any).reason)),
    "no track, no name, no dish");
}

// 3. teammates are ALWAYS tightbeamable — no track needed (fleet
// encryption), addressed by callsign
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0, false, "red", "Kestrel");
  sim.addShip("B", 0, 200000, 180, false, "red", "Mako"); // same team, invisible
  quiet(sim);
  sim.tick();
  sim.enqueue("A", [{ verb: "transmit", params: { channel: "tightbeam", recipient: "Mako", message: "rally on me" } }]);
  const evs = run(sim, 1);
  const tx = evs.find((e) => e.kind === "transmission") as any;
  assert(!!tx && tx.to === "B", "teammate reached across the map with no track");
}

// 4. the decoy dish: tightbeaming a track that is secretly a decoy is
// ACCEPTED and goes nowhere — silence is the decoy working
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0, false, null, "Kestrel");
  const b = sim.addShip("B", 0, 90000, 180, false, null, "Mako");
  quiet(sim);
  sim.enqueue("B", [{ verb: "deploy_decoy", params: {} }]);
  run(sim, 2); // decoy at ~90 km: sig 100 -> track band for A (108 km track edge)
  const letter = ["Alpha", "Bravo"].find((L) => sim.resolveContactRef("A", L)?.startsWith("d"));
  assert(!!letter, `the decoy holds a letter (${letter})`);
  sim.enqueue("A", [{ verb: "transmit", params: { channel: "tightbeam", recipient: letter!, message: "identify yourself" } }]);
  const evs = run(sim, 1);
  assert(!evs.some((e) => e.kind === "reject"), "the dish points at the 'contact' without complaint");
  assert(evs.some((e) => e.kind === "notice" && e.ship === "A" && /Transmission away/.test((e as any).text)), "sender believes it went out");
  assert(!evs.some((e) => e.kind === "transmission"), "…and nobody is home");
  void b;
}

// 5. anti-spam: per-channel cooldowns are independent; truncation at
// MESSAGE_MAX_CHARS
{
  const sim = new Sim();
  sim.addShip("A", 0, 0, 0, false, null, "Kestrel");
  sim.addShip("B", 0, 8000, 180, false, null, "Mako");
  quiet(sim);
  sim.tick();
  sim.enqueue("A", [{ verb: "transmit", params: { channel: "broadcast", message: "one" } }]);
  run(sim, 1);
  sim.enqueue("A", [{ verb: "transmit", params: { channel: "broadcast", message: "two" } }]);
  let evs = run(sim, 1);
  assert(evs.some((e) => e.kind === "reject" && /recycling/.test((e as any).reason)), "broadcast cooldown enforced");
  sim.enqueue("A", [{ verb: "transmit", params: { channel: "tightbeam", recipient: "Mako", message: "three" } }]);
  evs = run(sim, 1);
  assert(evs.some((e) => e.kind === "transmission"), "tightbeam channel has its own cooldown — still open");
  const long = "x".repeat(500);
  const sim2 = new Sim();
  sim2.addShip("A", 0, 0, 0, false, null, "Kestrel");
  sim2.addShip("B", 0, 8000, 180, false, null, "Mako");
  quiet(sim2);
  sim2.enqueue("A", [{ verb: "transmit", params: { channel: "broadcast", message: long } }]);
  evs = run(sim2, 1);
  const tx = evs.find((e) => e.kind === "transmission") as any;
  assert(!!tx && tx.text.length === C.MESSAGE_MAX_CHARS, `message capped at ${C.MESSAGE_MAX_CHARS} chars (TTS cost control)`);
}

console.log("done: comms");
