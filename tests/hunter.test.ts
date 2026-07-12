// Campaign Stage 0: the Hunter's brain (server/hunter.ts). hunterDecide is
// a PURE function of the Hunter's own wire snapshot + public terrain — the
// signature is the fog guarantee, so these tests drive it with fixtures.
// Sim-level fog integration is pinned in campaign.test.ts.
import { hunterDecide, initialHunterMem, type HunterSnap } from "../server/hunter.js";
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
const headingOf = (cmds: ReturnType<typeof hunterDecide>["commands"]) =>
  Number(cmds.find((c) => c.verb === "set_heading")?.params.degrees);
const thrustOf = (cmds: ReturnType<typeof hunterDecide>["commands"]) =>
  Number(cmds.find((c) => c.verb === "set_thrust")?.params.percent);

// 1. HUNT with nothing: patrols (empty terrain = region center), and emits
// ONLY helm commands — the AI cannot reference a ship it has no contact on
// because its input holds none (the firewall is the function signature)
{
  const s = snap({ you: you({ x: 100000, y: 100000 }) });
  const { commands } = hunterDecide(s, initialHunterMem(), emptyTerrain());
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
  const { commands } = hunterDecide(s, initialHunterMem(), emptyTerrain());
  assert(headingOf(commands) === 123, "chases the LOUDEST rumble bearing");

  const g = snap({ ghost: { x: 0, y: -50000 } });
  const r2 = hunterDecide(g, initialHunterMem(), emptyTerrain());
  assert(Math.abs(headingOf(r2.commands) - 180) < 1, "no rumble: flies to the last-known ghost");
}

// 3. PURSUE a contact by cid — a tier-2 contact that is secretly a decoy is
// indistinguishable here (invariant 11): the Hunter chases and designates it
{
  const s = snap({
    contacts: [{ cid: "Bravo", tier: 2, x: 0, y: 40000, vx: 0, vy: 0 }],
  });
  const { commands } = hunterDecide(s, initialHunterMem(), emptyTerrain());
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
  const r1 = hunterDecide(s, initialHunterMem(), emptyTerrain());
  assert(r1.commands.some((c) => c.verb === "fire_missile"), "locked + tube ready + in envelope: fires");
  const r2 = hunterDecide(s, r1.mem, emptyTerrain());
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
  const { commands } = hunterDecide(s, initialHunterMem(), emptyTerrain());
  assert(!commands.some((c) => c.verb === "fire_missile"), "magazine dry: no launch");
  assert(Math.abs(headingOf(commands)) < 1 && thrustOf(commands) > 0, "magazine dry: still closing (fanatical, not passive)");
}

// 6. Lead intercept: a crossing target is aimed AHEAD of its position
{
  const s = snap({
    contacts: [{ cid: "Alpha", tier: 2, x: 0, y: 100000, vx: 1000, vy: 0 }],
  });
  const { commands } = hunterDecide(s, initialHunterMem(), emptyTerrain());
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
  const r1 = hunterDecide(s, initialHunterMem(), terrain);
  assert(r1.mem.dodge !== 0, "rock ahead: dodge committed");
  assert(headingOf(r1.commands) !== 0, "rock ahead: steering off the collision line");
  assert(thrustOf(r1.commands) === 100, "rock ahead: full burn (survival outranks fuel discipline)");
  const r2 = hunterDecide(s, r1.mem, terrain);
  assert(r2.mem.dodge === r1.mem.dodge, "dodge direction holds until the path clears");
}

// 8. Fuel discipline hysteresis: below the floor it coasts in the regen
// band and stays there until RESUME
{
  const low = snap({ you: you({ propellant: C.HUNTER_FUEL_FLOOR - 5 }) });
  const r1 = hunterDecide(low, initialHunterMem(), emptyTerrain());
  assert(r1.mem.lowFuel && thrustOf(r1.commands) <= C.REGEN_MAX_THRUST_PCT, "below floor: throttles into the regen band");
  const mid = snap({ you: you({ propellant: (C.HUNTER_FUEL_FLOOR + C.HUNTER_FUEL_RESUME) / 2 }) });
  const r2 = hunterDecide(mid, r1.mem, emptyTerrain());
  assert(r2.mem.lowFuel && thrustOf(r2.commands) <= C.REGEN_MAX_THRUST_PCT, "hysteresis: still coasting below RESUME");
  const high = snap({ you: you({ propellant: C.HUNTER_FUEL_RESUME + 10 }) });
  const r3 = hunterDecide(high, r2.mem, emptyTerrain());
  assert(!r3.mem.lowFuel && thrustOf(r3.commands) === C.HUNTER_HUNT_THROTTLE, "tank recovered: back on the hunt");
}

console.log("done");
