// Campaign Stage 0: the Hunter's brain (server/hunter.ts). hunterDecide is
// a PURE function of the Hunter's own wire snapshot + public terrain — the
// signature is the fog guarantee, so these tests drive it with fixtures.
// Sim-level fog integration is pinned in campaign.test.ts.
import { hunterDecide, initialHunterMem, type HunterSnap, type HunterIntel } from "../server/hunter.js";
import { emptyTerrain, type Terrain } from "../server/terrain.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

const you = (over: Partial<HunterSnap["you"]> = {}): HunterSnap["you"] => ({
  x: 0, y: 0, vx: 0, vy: 0, facing: 0, propellant: 100,
  lock: { has: false },
  tubes: [{ state: "ready" }],
  ...over,
});
const snap = (over: Partial<HunterSnap> = {}): HunterSnap => ({
  you: you(), contacts: [], rumbles: [], ghost: null, ...over,
});
// default intel: no sites, gate due north, not a picket
const intel = (over: Partial<HunterIntel> = {}): HunterIntel => ({
  sites: [], gate: { x: 0, y: C.REGION_RADIUS_M }, gateCamp: false, ...over,
});
const headingOf = (cmds: ReturnType<typeof hunterDecide>["commands"]) =>
  Number(cmds.find((c) => c.verb === "set_heading")?.params.degrees);
const thrustOf = (cmds: ReturnType<typeof hunterDecide>["commands"]) =>
  Number(cmds.find((c) => c.verb === "set_thrust")?.params.percent);

// 1. HUNT with nothing: patrols (empty terrain = region center), and emits
// ONLY helm commands — the AI cannot reference a ship it has no contact on
// because its input holds none (the firewall is the function signature)
{
  const s = snap({ you: you({ x: 100000, y: 100000 }) });
  const { commands } = hunterDecide(s, initialHunterMem(), emptyTerrain(), intel());
  const verbs = commands.map((c) => c.verb).sort();
  assert(verbs.join(",") === "set_heading,set_thrust", "no contact: helm commands only");
  assert(Math.abs(headingOf(commands) - 225) < 1, "no contact: patrols toward region center");
  assert(thrustOf(commands) === C.HUNTER_HUNT_THROTTLE, "no contact: hunt throttle (regen band)");
}

// 2. HUNT priorities: loudest rumble bearing beats the ghost
{
  const s = snap({
    rumbles: [{ bearing: 45, loud: 0.2 }, { bearing: 123, loud: 0.7 }],
    ghost: { x: 0, y: -50000 },
  });
  const { commands } = hunterDecide(s, initialHunterMem(), emptyTerrain(), intel());
  assert(headingOf(commands) === 123, "chases the LOUDEST rumble bearing");

  const g = snap({ ghost: { x: 0, y: -50000 } });
  const r2 = hunterDecide(g, initialHunterMem(), emptyTerrain(), intel());
  assert(Math.abs(headingOf(r2.commands) - 180) < 1, "no rumble: flies to the last-known ghost");
}

// 3. PURSUE a contact by cid — a tier-2 contact that is secretly a decoy is
// indistinguishable here (invariant 11): the Hunter chases and designates it
{
  const s = snap({
    contacts: [{ cid: "Bravo", tier: 2, x: 0, y: 40000, vx: 0, vy: 0 }],
  });
  const { commands } = hunterDecide(s, initialHunterMem(), emptyTerrain(), intel());
  assert(Math.abs(headingOf(commands)) < 1, "pursues the contact's bearing");
  const lockCmd = commands.find((c) => c.verb === "set_lock_target");
  assert(lockCmd !== undefined && lockCmd.params.contact === "Bravo", "designates by cid (decoys included — that's the design)");
}

// 4. ENGAGE: fires on a held lock, then respects the cadence
{
  const s = snap({
    you: you({ lock: { has: true } }),
    contacts: [{ cid: "Alpha", tier: 2, x: 0, y: 30000, vx: 0, vy: 0 }],
  });
  const r1 = hunterDecide(s, initialHunterMem(), emptyTerrain(), intel());
  assert(r1.commands.some((c) => c.verb === "fire_missile"), "locked + tube ready + in envelope: fires");
  const r2 = hunterDecide(s, r1.mem, emptyTerrain(), intel());
  assert(!r2.commands.some((c) => c.verb === "fire_missile"), "cooldown holds the next bird");
  assert(r2.mem.fireCooldownS === C.HUNTER_FIRE_COOLDOWN_S - 1, "cadence counts down per tick");
}

// 5. WATCH ITEM — the dry Hunter stays fanatical: no missiles, no fire, but
// the pursuit continues at full commit (never passive; spec §2.2)
{
  const s = snap({
    you: you({ lock: { has: true }, tubes: [{ state: "empty" }] }),
    contacts: [{ cid: "Alpha", tier: 2, x: 0, y: 30000, vx: 0, vy: 0 }],
  });
  const { commands } = hunterDecide(s, initialHunterMem(), emptyTerrain(), intel());
  assert(!commands.some((c) => c.verb === "fire_missile"), "magazine dry: no launch");
  assert(Math.abs(headingOf(commands)) < 1 && thrustOf(commands) > 0, "magazine dry: still closing (fanatical, not passive)");
}

// 6. Lead intercept: a crossing target is aimed AHEAD of its position
{
  const s = snap({
    contacts: [{ cid: "Alpha", tier: 2, x: 0, y: 100000, vx: 1000, vy: 0 }],
  });
  const { commands } = hunterDecide(s, initialHunterMem(), emptyTerrain(), intel());
  const h = headingOf(commands);
  assert(h > 10 && h < 90, `leads a crossing target (heading ${h.toFixed(1)} east of the fix)`);
}

// 7. AVOID: a rock on the vector overrides pursuit; the dodge direction
// commits (hysteresis) and throttle goes to full
{
  const terrain: Terrain = { ...emptyTerrain(), rocks: [{ x: 500, y: 8000, r: 2000 }] };
  const s = snap({
    you: you({ vy: 1000 }),
    contacts: [{ cid: "Alpha", tier: 2, x: 0, y: 60000, vx: 0, vy: 0 }],
  });
  const r1 = hunterDecide(s, initialHunterMem(), terrain, intel());
  assert(r1.mem.dodge !== 0, "rock ahead: dodge committed");
  assert(headingOf(r1.commands) !== 0, "rock ahead: steering off the collision line");
  assert(thrustOf(r1.commands) === 100, "rock ahead: full burn (survival outranks fuel discipline)");
  const r2 = hunterDecide(s, r1.mem, terrain, intel());
  assert(r2.mem.dodge === r1.mem.dodge, "dodge direction holds until the path clears");
}

// 8. Fuel discipline hysteresis: below the floor it coasts in the regen
// band and stays there until RESUME
{
  const low = snap({ you: you({ propellant: C.HUNTER_FUEL_FLOOR - 5 }) });
  const r1 = hunterDecide(low, initialHunterMem(), emptyTerrain(), intel());
  assert(r1.mem.lowFuel && thrustOf(r1.commands) <= C.REGEN_MAX_THRUST_PCT, "below floor: throttles into the regen band");
  const mid = snap({ you: you({ propellant: (C.HUNTER_FUEL_FLOOR + C.HUNTER_FUEL_RESUME) / 2 }) });
  const r2 = hunterDecide(mid, r1.mem, emptyTerrain(), intel());
  assert(r2.mem.lowFuel && thrustOf(r2.commands) <= C.REGEN_MAX_THRUST_PCT, "hysteresis: still coasting below RESUME");
  const high = snap({ you: you({ propellant: C.HUNTER_FUEL_RESUME + 10 }) });
  const r3 = hunterDecide(high, r2.mem, emptyTerrain(), intel());
  assert(!r3.mem.lowFuel && thrustOf(r3.commands) === C.HUNTER_HUNT_THROTTLE, "tank recovered: back on the hunt");
}

// 9. §4.3/§4.4: with no contact and no rumble, the Hunter patrols the
// SALVAGE SITES — and its intel struct carries marked sites only (the
// sim-side filter is pinned in campaign.test.ts; here we pin that sites
// win over the generic rock patrol)
{
  const s = snap({ you: you({ x: -100000, y: 0 }) });
  const { commands } = hunterDecide(s, initialHunterMem(), emptyTerrain(), intel({
    sites: [{ x: 100000, y: 0 }],
  }));
  assert(Math.abs(headingOf(commands) - 90) < 1, "HUNT patrols the salvage sites — waiting where it knows you'll come");
}

// 10. §3 the Picket: a gateCamp Hunter holds station at the gate and is
// deliberately deaf to rumbles — the door is the job. A contact still
// pulls it into a fight (PURSUE outranks the camp).
{
  const far = snap({ you: you({ x: 0, y: 0 }), rumbles: [{ bearing: 180, loud: 0.9 }] });
  const r1 = hunterDecide(far, initialHunterMem(), emptyTerrain(), intel({ gateCamp: true }));
  assert(Math.abs(headingOf(r1.commands)) < 1, "picket ignores the rumble and makes for the gate station");
  const onStation = snap({ you: you({ x: 0, y: C.REGION_RADIUS_M - 20000 }) });
  const r2 = hunterDecide(onStation, initialHunterMem(), emptyTerrain(), intel({ gateCamp: true }));
  assert(thrustOf(r2.commands) <= 15, "on station: a quiet loiter — the picket barely breathes");
  const contact = snap({
    you: you({ x: 0, y: C.REGION_RADIUS_M - 20000 }),
    contacts: [{ cid: "Alpha", tier: 2, x: 0, y: C.REGION_RADIUS_M - 120000, vx: 0, vy: 0 }],
  });
  const r3 = hunterDecide(contact, initialHunterMem(), emptyTerrain(), intel({ gateCamp: true }));
  assert(Math.abs(headingOf(r3.commands) - 180) < 5, "a real contact pulls the picket off station");
}

// 11. THE SOFT LEASH: beyond 0.9R, a rumble bearing pointing OUTWARD bends
// home (noises carry no range; hunters were marching off the map) — but an
// inward bearing is followed as heard
{
  const out = snap({
    you: you({ x: 0, y: C.REGION_RADIUS_M * 0.95 }),
    rumbles: [{ bearing: 0, loud: 0.5 }], // due north = outward
  });
  const r1 = hunterDecide(out, initialHunterMem(), emptyTerrain(), intel());
  assert(Math.abs(headingOf(r1.commands) - 180) < 1, "outward rumble beyond the leash: heading bends home");
  const inw = snap({
    you: you({ x: 0, y: C.REGION_RADIUS_M * 0.95 }),
    rumbles: [{ bearing: 170, loud: 0.5 }], // inward-ish
  });
  const r2 = hunterDecide(inw, initialHunterMem(), emptyTerrain(), intel());
  assert(headingOf(r2.commands) === 170, "inward rumble: followed as heard");
}

// 12. ESCALATION: a long dry spell spends a PING; with transducers down it
// spends a PROBE (gate first, then the last bearing it heard); any signal
// resets the clock
{
  const dry = snap({ you: you({ x: 0, y: 0, ping: { ready: true }, probes: 4 }) });
  let mem = initialHunterMem();
  let pinged = false;
  for (let t = 0; t < C.HUNTER_DRY_SPELL_S + 2 && !pinged; t++) {
    const r = hunterDecide(dry, mem, emptyTerrain(), intel());
    mem = r.mem;
    pinged = r.commands.some((c) => c.verb === "sensor_ping");
  }
  assert(pinged && mem.dryS === 0, "a full dry spell: the Hunter PINGS — and screams its position doing it");
  // transducers recharging: the next spell spends a probe toward the GATE
  const dryNoPing = snap({ you: you({ x: 0, y: 0, ping: { ready: false }, probes: 4 }) });
  let probed: any = null;
  for (let t = 0; t < C.HUNTER_DRY_SPELL_S + 2 && !probed; t++) {
    const r = hunterDecide(dryNoPing, mem, emptyTerrain(), intel());
    mem = r.mem;
    probed = r.commands.find((c) => c.verb === "launch_probe") ?? null;
  }
  assert(!!probed && mem.gateProbed, "next spell, ping down: a probe goes out");
  assert(Math.abs(Number(probed.params.bearing_degrees) - 0) < 1, "…toward the GATE first (due north here) — the player must come there eventually");
  // a rumble resets the clock
  mem.dryS = C.HUNTER_DRY_SPELL_S - 5;
  const heard = snap({ you: you({ ping: { ready: true }, probes: 3 }), rumbles: [{ bearing: 90, loud: 0.4 }] });
  const r3 = hunterDecide(heard, mem, emptyTerrain(), intel());
  assert(r3.mem.dryS === 0 && r3.mem.lastSignalBearing === 90, "any signal resets the dry clock and is remembered");
}

console.log("done");
