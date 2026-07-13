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

// 13. ANVIL §1a — the hard leash: an intercept solution beyond the rim is
// clamped onto the 0.9R circle (the chase bends); outward momentum that
// would carry past the rim trips boundary-AVOID (home, full burn)
{
  const R = C.REGION_RADIUS_M;
  const s = snap({
    you: you({ x: 0, y: 200000 }),
    contacts: [{ cid: "Alpha", tier: 1, x: 150000, y: 260000 }], // fix beyond the rim
  });
  const { commands } = hunterDecide(s, initialHunterMem(), emptyTerrain(), intel());
  const raw = Math.atan2(150000, 60000) * (180 / Math.PI); // ≈68° to the raw fix
  const cl = { x: 150000 * ((R * 0.9) / 300000), y: 260000 * ((R * 0.9) / 300000) };
  const want = ((Math.atan2(cl.x - 0, cl.y - 200000) * 180) / Math.PI + 360) % 360;
  assert(Math.abs(headingOf(commands) - want) < 1 && Math.abs(headingOf(commands) - raw) > 10,
    "PURSUE aim beyond the rim clamps onto the 0.9R circle — the chase bends");

  const out = snap({ you: you({ x: 0, y: R * 0.9, vx: 1200, vy: 2500 }) }); // outward NE at speed
  const r2 = hunterDecide(out, initialHunterMem(), emptyTerrain(), intel());
  assert(Math.abs(headingOf(r2.commands) - 180) < 1 && thrustOf(r2.commands) === 100,
    "boundary-AVOID: outward momentum past braking margin steers home at full burn");
}

// 14. ANVIL §1b — the datum search: a lost contact leaves a datum; the
// sweep's waypoints live INSIDE the uncertainty circle; a player who sits
// still after being seen is walked over; one who coasts away silently
// stays outside the sweep
{
  const seen = snap({ contacts: [{ cid: "Alpha", tier: 2, x: 50000, y: 50000, vx: 0, vy: 0 }] });
  let mem = hunterDecide(seen, initialHunterMem(), emptyTerrain(), intel()).mem;
  assert(mem.datum !== null && mem.datum.x === 50000 && mem.datum.ageS === 0, "a live contact keeps the datum fresh");
  const dark = snap(); // contact gone
  mem = hunterDecide(dark, mem, emptyTerrain(), intel()).mem;
  assert(mem.datum !== null && mem.datum.ageS === 1, "losing the contact starts the datum clock");

  // kinematic sweep: hunter 90 km off the datum, prey PARKED at it — the
  // spoke-0 waypoint IS the datum, so the sweep walks over a sitter
  let hx = -40000, hy = -25000; // ~90 km from the datum
  let found = false;
  let m2 = { ...initialHunterMem(), datum: { x: 50000, y: 50000, ageS: 1 } };
  for (let t = 0; t < 120 && !found; t++) {
    const r = hunterDecide(snap({ you: you({ x: hx, y: hy }) }), m2, emptyTerrain(), intel());
    m2 = r.mem;
    const h = headingOf(r.commands) * (Math.PI / 180);
    hx += Math.sin(h) * 1500; hy += Math.cos(h) * 1500; // 1500 m/s toward the order
    found = Math.hypot(hx - 50000, hy - 50000) <= C.HUNTER_PATROL_ARRIVE_M;
  }
  assert(found, "sitting still after being seen gets you found (the sweep opens ON the datum)");

  // the coaster: same start, prey slides away at 1500 m/s due east from
  // the datum — the sweep stays inside the circle and never touches it
  let px = 50000, py = 50000;
  hx = -40000; hy = -25000;
  let caught = false;
  let m3 = { ...initialHunterMem(), datum: { x: 50000, y: 50000, ageS: 1 } };
  for (let t = 0; t < 120 && !caught; t++) {
    const r = hunterDecide(snap({ you: you({ x: hx, y: hy }) }), m3, emptyTerrain(), intel());
    m3 = r.mem;
    const h = headingOf(r.commands) * (Math.PI / 180);
    hx += Math.sin(h) * 1500; hy += Math.cos(h) * 1500;
    px += 1500; // silent coast due east
    caught = Math.hypot(hx - px, hy - py) <= C.HUNTER_PATROL_ARRIVE_M;
  }
  assert(!caught, "coasting away silently rides out of the sweep — momentum you already had is safe");
  assert(m3.datum === null || m3.datum.ageS * C.MAX_SPEED_MPS <= C.HUNTER_DATUM_GIVEUP_R_M,
    "the datum goes cold once the circle covers the region");
}

// 15. ANVIL §1c — escalation by uncertainty: never a ping below the
// threshold radius; past it the sweeps come, and FASTER as r grows;
// in the probe band, ears are seeded around the datum circle
{
  // below the ping threshold: ping ready, never fired
  const ready = (over: Partial<HunterSnap["you"]> = {}) => you({ ping: { ready: true }, probes: 4, ...over });
  let m = { ...initialHunterMem(), datum: { x: 0, y: 100000, ageS: 1 }, sincePingS: 9999 };
  const below = Math.floor(C.HUNTER_DATUM_PING_R_M / C.MAX_SPEED_MPS) - 2;
  let pinged = false;
  for (let t = m.datum!.ageS; t < below && !pinged; t++) {
    const r = hunterDecide(snap({ you: ready() }), m, emptyTerrain(), intel());
    m = r.mem as typeof m;
    pinged ||= r.commands.some((c) => c.verb === "sensor_ping");
  }
  assert(!pinged, "NEVER pings below the uncertainty threshold — a sweep is priced for big circles only");

  // at the threshold with the cadence due: fires
  let m2 = { ...initialHunterMem(), datum: { x: 0, y: 100000, ageS: Math.ceil(C.HUNTER_DATUM_PING_R_M / C.MAX_SPEED_MPS) }, sincePingS: C.HUNTER_DATUM_PING_BASE_S };
  const r2 = hunterDecide(snap({ you: ready() }), m2, emptyTerrain(), intel());
  assert(r2.commands.some((c) => c.verb === "sensor_ping"), "past the threshold with the cadence due: the sweep fires");

  // frequency scales with r: at 2× the threshold radius the interval halves
  const age2x = Math.ceil((2 * C.HUNTER_DATUM_PING_R_M) / C.MAX_SPEED_MPS);
  let m3 = { ...initialHunterMem(), datum: { x: 0, y: 100000, ageS: age2x }, sincePingS: Math.round(C.HUNTER_DATUM_PING_BASE_S / 2) };
  const r3 = hunterDecide(snap({ you: ready() }), m3, emptyTerrain(), intel());
  assert(r3.commands.some((c) => c.verb === "sensor_ping"), "at 2× the radius the ping interval halves — frequency scales with uncertainty");

  // the probe band: an ear goes out toward the datum circle (inside r)
  const probeAge = Math.ceil(C.HUNTER_DATUM_PROBE_R_M / C.MAX_SPEED_MPS) + 2;
  let m4 = { ...initialHunterMem(), datum: { x: 0, y: 100000, ageS: probeAge }, sinceProbeS: C.HUNTER_DATUM_PROBE_EVERY_S };
  const r4 = hunterDecide(snap({ you: ready({ ping: { ready: false } }) }), m4, emptyTerrain(), intel());
  const probe = r4.commands.find((c) => c.verb === "launch_probe");
  assert(!!probe, "in the probe band with sweeps down: an ear is seeded");
  const rr = probeAge * C.MAX_SPEED_MPS;
  const bDatum = Math.atan2(0 - 0, 100000 - 0) * (180 / Math.PI); // hunter at origin, datum due north
  const off = Math.abs((((Number(probe!.params.bearing_degrees) - bDatum) % 360) + 540) % 360 - 180);
  assert(off <= 90, `the ear points at the datum circle, not away from it (offset ${off.toFixed(0)}°, r ${(rr / 1000).toFixed(0)} km)`);
}

// 16. ANVIL 1.1 §5b — rendezvous, not ram: a clean intercept closes to the
// engage envelope with a BOUNDED closing rate and does not yo-yo (at most
// one closure reversal). Kinematic integration against a parked target.
{
  let hx = 0, hy = -180000, hvx = 0, hvy = 0; // 180 km out, at rest
  const tgt = { cid: "Alpha", tier: 2, x: 0, y: 0, vx: 0, vy: 0 };
  let mem = initialHunterMem();
  let reversals = 0;
  let prevClosing: number | null = null;
  let atEnvelopeRate: number | null = null;
  const A = C.ARCHETYPES.corvette.accel;
  for (let t = 0; t < 400; t++) {
    const s = snap({ you: you({ x: hx, y: hy, vx: hvx, vy: hvy }) , contacts: [tgt] });
    const r = hunterDecide(s, mem, emptyTerrain(), intel());
    mem = r.mem;
    const h = headingOf(r.commands) * (Math.PI / 180);
    const thr = thrustOf(r.commands) / 100;
    hvx += Math.sin(h) * A * thr; hvy += Math.cos(h) * A * thr;
    const sp = Math.hypot(hvx, hvy);
    if (sp > C.MAX_SPEED_MPS) { hvx *= C.MAX_SPEED_MPS / sp; hvy *= C.MAX_SPEED_MPS / sp; }
    hx += hvx; hy += hvy;
    const d = Math.hypot(hx, hy);
    const closing = -(hvx * hx + hvy * hy) / Math.max(1, d);
    if (prevClosing !== null && prevClosing > 50 && closing < -50) reversals++;
    prevClosing = closing;
    if (atEnvelopeRate === null && d <= C.HUNTER_ENGAGE_RANGE_M) atEnvelopeRate = closing;
    if (d <= C.HUNTER_ENGAGE_RANGE_M * 0.5) break;
  }
  assert(atEnvelopeRate !== null, "the rendezvous reaches the engage envelope");
  assert(
    atEnvelopeRate! <= 0.85 * Math.sqrt(2 * 40 * C.HUNTER_ENGAGE_RANGE_M * 0.4) + C.HUNTER_CLOSE_RATE_FLOOR_MPS + 100,
    `…arriving with a MANAGEABLE closing rate (${atEnvelopeRate!.toFixed(0)} m/s) — a rendezvous, not a ram`
  );
  assert(reversals <= 1, `no yo-yo: at most one closure reversal in a clean intercept (saw ${reversals})`);
}

// 17. ANVIL 1.1 §5a — the leash BURNS: at max speed on an outbound radial
// vector the Hunter commands a retro burn (home, full throttle) and the
// braking math holds it inside the region. Kinematic integration.
{
  // 135 km out doing 3000: braking distance (112.5 km on the weakest
  // drive) + margin has just crossed the rim — the trigger MUST be live,
  // and physics can still recover (135 + 112.5 < 250). Closed-loop flight
  // never gets deeper than this — the trigger fires the moment
  // recoverability is at stake (pinned at sim level in campaign.test §25).
  let hx = 0, hy = 135000, hvx = 0, hvy = C.MAX_SPEED_MPS;
  let mem = initialHunterMem();
  const A = C.ARCHETYPES.cruiser.accel; // the WEAKEST drive — the floor the brake math assumes
  let maxR = 0;
  const first = hunterDecide(snap({ you: you({ x: hx, y: hy, vx: hvx, vy: hvy }) }), mem, emptyTerrain(), intel());
  assert(Math.abs(headingOf(first.commands) - 180) < 1 && thrustOf(first.commands) === 100,
    "outbound at max speed: the boundary commands a full retro burn NOW, not a heading change");
  for (let t = 0; t < 300; t++) {
    const s = snap({ you: you({ x: hx, y: hy, vx: hvx, vy: hvy }) });
    const r = hunterDecide(s, mem, emptyTerrain(), intel());
    mem = r.mem;
    const h = headingOf(r.commands) * (Math.PI / 180);
    const thr = thrustOf(r.commands) / 100;
    hvx += Math.sin(h) * A * thr; hvy += Math.cos(h) * A * thr;
    const sp = Math.hypot(hvx, hvy);
    if (sp > C.MAX_SPEED_MPS) { hvx *= C.MAX_SPEED_MPS / sp; hvy *= C.MAX_SPEED_MPS / sp; }
    hx += hvx; hy += hvy;
    maxR = Math.max(maxR, Math.hypot(hx, hy));
  }
  assert(maxR <= C.REGION_RADIUS_M,
    `never exits: max radius ${(maxR / 1000).toFixed(1)} km of ${C.REGION_RADIUS_M / 1000} — the burn-leash law holds at max speed`);
}

// ---------- Patch 2 "Two Ships" §1: loudest-signature targeting ----------

// T1. Two contacts held: he pursues the LOUDEST, not the nearest — the
// bait-play rule. Quiet ship 30 km east; loud ship 120 km north.
{
  const quiet = { cid: "a", tier: 2, loud: 0.2, x: 30000, y: 0, vx: 0, vy: 0 };
  const loud = { cid: "b", tier: 2, loud: 0.9, x: 0, y: 120000, vx: 0, vy: 0 };
  const { commands, mem } = hunterDecide(
    snap({ contacts: [quiet, loud] }), initialHunterMem(), emptyTerrain(), intel());
  assert(Math.abs(headingOf(commands) - 0) < 1, "pursues the LOUDEST contact, not the nearest");
  assert(mem.targetCid === "b", "commits to the loud one");
}

// T2. Contact on only ONE ship: that is the target regardless of loudness.
{
  const whisper = { cid: "a", tier: 2, loud: 0.05, x: 30000, y: 0, vx: 0, vy: 0 };
  const { commands, mem } = hunterDecide(
    snap({ contacts: [whisper] }), initialHunterMem(), emptyTerrain(), intel());
  assert(Math.abs(headingOf(commands) - 90) < 1, "single contact: pursued regardless of signature");
  assert(mem.targetCid === "a", "commitment recorded");
}

// T3. Hysteresis: a challenger only slightly louder NEVER steals the chase;
// a meaningfully louder one steals it on the cadence tick, not before.
{
  const cur = { cid: "a", tier: 2, loud: 0.5, x: 0, y: 60000, vx: 0, vy: 0 };
  const meh = { cid: "b", tier: 2, loud: 0.6, x: 60000, y: 0, vx: 0, vy: 0 }; // 1.2x — under the bar
  let mem = initialHunterMem();
  mem = hunterDecide(snap({ contacts: [cur] }), mem, emptyTerrain(), intel()).mem; // commit to a
  let stayed = true;
  for (let t = 0; t < C.HUNTER_RETARGET_EVERY_S * 3; t++) {
    const r = hunterDecide(snap({ contacts: [cur, meh] }), mem, emptyTerrain(), intel());
    mem = r.mem;
    if (mem.targetCid !== "a") stayed = false;
  }
  assert(stayed, "a 1.2x challenger never steals the chase (hysteresis)");
  const hot = { ...meh, cid: "c", loud: 0.8 }; // 1.6x — meaningfully louder
  let switchedAt = -1;
  for (let t = 0; t < C.HUNTER_RETARGET_EVERY_S + 2; t++) {
    const r = hunterDecide(snap({ contacts: [cur, hot] }), mem, emptyTerrain(), intel());
    mem = r.mem;
    if (mem.targetCid === "c") { switchedAt = t; break; }
  }
  assert(switchedAt >= 0, "a meaningfully louder challenger steals the chase");
  assert(switchedAt >= 1, "…on the re-evaluation cadence, not instantly");
}

// T4. No oscillation: two comparably-loud contacts trading tiny loudness
// wiggles — the target NEVER flips (the pinned §8 requirement).
{
  let mem = initialHunterMem();
  let flips = 0;
  let last: string | null = null;
  for (let t = 0; t < 40; t++) {
    const wiggle = t % 2 === 0 ? 0.05 : -0.05;
    const a = { cid: "a", tier: 2, loud: 0.5 + wiggle, x: 0, y: 70000, vx: 0, vy: 0 };
    const b = { cid: "b", tier: 2, loud: 0.5 - wiggle, x: 70000, y: 0, vx: 0, vy: 0 };
    const r = hunterDecide(snap({ contacts: [a, b] }), mem, emptyTerrain(), intel());
    mem = r.mem;
    if (last !== null && mem.targetCid !== last) flips++;
    last = mem.targetCid;
  }
  assert(flips === 0, "comparably-loud pair: zero target flips across 40 ticks (no oscillation)");
}

// T5. Meaningfully CLOSER also steals (the other hysteresis gate): same
// loudness, 0.4x the range.
{
  const far = { cid: "a", tier: 2, loud: 0.5, x: 0, y: 100000, vx: 0, vy: 0 };
  const near = { cid: "b", tier: 2, loud: 0.5, x: 35000, y: 0, vx: 0, vy: 0 };
  let mem = initialHunterMem();
  mem = hunterDecide(snap({ contacts: [far] }), mem, emptyTerrain(), intel()).mem;
  for (let t = 0; t < C.HUNTER_RETARGET_EVERY_S + 1; t++) {
    mem = hunterDecide(snap({ contacts: [far, near] }), mem, emptyTerrain(), intel()).mem;
  }
  assert(mem.targetCid === "b", "an equally-loud contact at 0.4x range steals the chase");
}

// T5b. The closer-gate breaks NEAR-TIES only: a drastically quieter
// contact never steals by proximity, no matter how the range opens —
// otherwise the bait play dies the moment the bait runs (found by the §8
// checkpoint; pinned).
{
  let mem = initialHunterMem();
  const bait0 = { cid: "a", tier: 2, loud: 0.87, x: 0, y: 150000, vx: 0, vy: 0 };
  mem = hunterDecide(snap({ contacts: [bait0] }), mem, emptyTerrain(), intel()).mem;
  for (let t = 0; t < C.HUNTER_RETARGET_EVERY_S * 4; t++) {
    const bait = { ...bait0, y: 150000 + t * 2500 }; // the bait opens the range
    const looter = { cid: "b", tier: 1, loud: 0.2, x: 60000, y: 0 };
    mem = hunterDecide(snap({ contacts: [bait, looter] }), mem, emptyTerrain(), intel()).mem;
  }
  assert(mem.targetCid === "a", "a quiet looter never steals the chase by proximity while the bait burns");
}

// T6. Losing the committed track picks fresh IMMEDIATELY (no cadence wait —
// hysteresis lives on the switch, not the pick).
{
  const a = { cid: "a", tier: 2, loud: 0.9, x: 0, y: 60000, vx: 0, vy: 0 };
  const b = { cid: "b", tier: 1, loud: 0.3, x: 50000, y: 0 };
  let mem = initialHunterMem();
  mem = hunterDecide(snap({ contacts: [a, b] }), mem, emptyTerrain(), intel()).mem;
  assert(mem.targetCid === "a", "committed to the loud track");
  const r = hunterDecide(snap({ contacts: [b] }), mem, emptyTerrain(), intel());
  assert(r.mem.targetCid === "b", "track lost: re-picks immediately from what remains");
  assert(Math.abs(headingOf(r.commands) - 90) < 1, "…and pursues it");
}

console.log("done");
