// Patches 4+5 "The Loadout" (as amended by The Unification). The 🔴 pins:
// a starting-loadout ship is BIT-IDENTICAL to the book at every throttle
// (the whole suite passing unmodified is the broad proof; this file pins
// it explicitly), power over capacity is REJECTED never auto-shed, a cold
// module contributes ZERO signature and FULL mass, the workshop rule, and
// the anti-snowball law: getting stronger always costs speed and silence.
import { Sim, massOf, accelOf, turnRateOf, reactorDraw, hullMaxOf } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

const apply = (sim: Sim, ship: any, cmd: any): string | null =>
  (sim as any).applyCommand(ship, cmd, []);

// 1. 🔴 the calibration: starting loadout + empty hold == the book, bit-identical
{
  const sim = new Sim();
  for (const arch of ["corvette", "frigate", "cruiser"] as const) {
    const s = sim.addShip(arch, 0, 0, 0, false, null, arch, arch);
    assert(accelOf(s) === C.ARCHETYPES[arch].accel, `${arch}: starting-loadout accel IS the book (${accelOf(s)})`);
    assert(turnRateOf(s) === C.ARCHETYPES[arch].turn, `${arch}: starting-loadout turn IS the book`);
    assert(sim.signatureOf(s) === C.ARCHETYPES[arch].sigBase, `${arch}: all-cold signature IS the book`);
    assert(hullMaxOf(s) === C.ARCHETYPES[arch].hull, `${arch}: hull with starting plates IS the book`);
    assert(s.probesLeft === C.ARCHETYPES[arch].probes, `${arch}: probes with starting rack IS the book`);
  }
}

// 2. mass is the limit: cargo degrades accel and turn, strictly
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  const before = { accel: accelOf(a), turn: turnRateOf(a), mass: massOf(a) };
  a.hold.push({ module: "armor_plate" }); // 5 mass of dead weight
  assert(massOf(a) === before.mass + 5, "hold mass counts in full");
  assert(accelOf(a) < before.accel && turnRateOf(a) < before.turn, "🔴 anti-snowball: more mass = strictly slower, always");
  assert(sim.signatureOf(a) === C.SIG_BASE, "cargo makes no noise — a cold hold is silent");
  const brakeBefore = (3000 * 3000) / (2 * before.accel);
  const brakeAfter = (3000 * 3000) / (2 * accelOf(a));
  assert(brakeAfter > brakeBefore, "braking distance follows v²/2a — the gate gets harder loaded");
}

// 3. 🔴 reactor: over capacity is REJECTED, never auto-shed
{
  const sim = new Sim();
  const cv = sim.addShip("A", 0, 0, 0, false, null, "A", "corvette"); // reactor 6
  cv.hold.push({ module: "deep_array" }, { module: "deep_array" });
  cv.installed.push("deep_array", "deep_array"); // bypass the workshop for the pin
  assert(apply(sim, cv, { verb: "power", params: { module: "deep_array", state: "on" } }) === null, "first array lights (4/6)");
  const err = apply(sim, cv, { verb: "power", params: { module: "deep_array", state: "on" } });
  assert(err !== null && /something has to go cold/.test(err!), `second array REJECTED, captain chooses (${err})`);
  assert(reactorDraw(cv) === 4, "draw unchanged after the rejection — nothing was shed");
}

// 4. power is instant, free, and loud: draw IS signature
{
  const sim = new Sim();
  const f = sim.addShip("A", 0, 0, 0); // frigate: railgun + probe_rack
  const dark = sim.signatureOf(f);
  assert(apply(sim, f, { verb: "power", params: { module: "railgun", state: "on" } }) === null, "railgun lights instantly at any speed");
  assert(sim.signatureOf(f) === dark + C.MODULES.railgun.power * C.POWER_TO_SIG, "lit rail: +draw×POWER_TO_SIG signature — power IS noise");
  assert(apply(sim, f, { verb: "power", params: { module: "railgun", state: "off" } }) === null, "and off again, free");
  assert(sim.signatureOf(f) === dark, "cold again: zero signature contribution, full mass");
}

// 5. baffles: −25% of the TOTAL — a net loss when quiet, an edge when loud
{
  const sim = new Sim();
  const cv = sim.addShip("A", 0, 0, 0, false, null, "A", "corvette");
  const dark = sim.signatureOf(cv); // 20
  apply(sim, cv, { verb: "power", params: { module: "baffles", state: "on" } });
  const baffledDark = sim.signatureOf(cv); // (20+8) × 0.75 = 21
  assert(baffledDark > dark, "baffles on a drifting hull are a net LOSS (their own draw is in the total)");
  cv.thrust = 100;
  sim.tick();
  const baffledLoud = sim.signatureOf(cv);
  apply(sim, cv, { verb: "power", params: { module: "baffles", state: "off" } });
  const bareLoud = sim.signatureOf(cv);
  assert(baffledLoud < bareLoud, "at full burn the baffles earn their keep");
}

// 6. deep array: seeing costs being seen — and the EARS ring grows
{
  const sim = new Sim();
  const f = sim.addShip("A", 0, 0, 0);
  f.hold.push({ module: "deep_array" });
  f.installed.push("deep_array");
  const earsBefore = sim.earsRangeM(f);
  const voiceBefore = sim.voiceRangeM(f);
  apply(sim, f, { verb: "power", params: { module: "deep_array", state: "on" } });
  assert(Math.round(sim.earsRangeM(f)) === Math.round(earsBefore * C.DEEP_ARRAY_SENSOR_MULT), "lit array: ears +60% (the ring grows)");
  assert(sim.voiceRangeM(f) > voiceBefore, "and the voice grows with it — seeing costs being seen");
}

// 7. 🔴 the workshop rule: full stop, real time, thrust aborts and loses it
{
  const sim = new Sim();
  const f = sim.addShip("A", 0, 0, 0);
  f.hold.push({ module: "armor_plate" });
  f.thrust = 40;
  let err = apply(sim, f, { verb: "install", params: { module: "armor_plate" } });
  assert(err !== null && /full stop/.test(err!), "workshop refuses under thrust");
  f.thrust = 0;
  assert(apply(sim, f, { verb: "install", params: { module: "armor_plate" } }) === null, "at rest the job starts");
  for (let i = 0; i < 10; i++) sim.tick();
  assert(f.refit !== null && f.refit.t >= 10, "the clock runs");
  f.thrust = 60; // any thrust command aborts
  const evs = sim.tick() as any[];
  assert(f.refit === null, "🔴 thrust aborts the job");
  assert(evs.some((e) => e.kind === "notice" && /job is lost/.test(e.text)), "and the progress is LOST, said out loud");
  assert(f.hold.length === 1 && !f.installed.includes("armor_plate"), "the module is still cargo");
  // do it properly (kill the drift the abort-burn left — the workshop
  // means FULL stop, and the clock knows it)
  f.thrust = 0;
  f.vx = 0;
  f.vy = 0;
  apply(sim, f, { verb: "install", params: { module: "armor_plate" } });
  for (let i = 0; i < C.MODULE_INSTALL_S; i++) sim.tick();
  assert(f.installed.includes("armor_plate") && f.hold.length === 0, "a full minute at rest installs it");
  assert(hullMaxOf(f) === C.ARCHETYPES.frigate.hull + C.ARMOR_PLATE_HULL, "the plate is live: +hull");
  assert(massOf(f) === C.ARCH_CALIB_MASS.frigate + C.MODULES.armor_plate.mass, "and it weighs what it weighs");
}

// 8. slots are the deck's edge
{
  const sim = new Sim();
  const cv = sim.addShip("A", 0, 0, 0, false, null, "A", "corvette"); // 4 slots, 1 used
  cv.installed.push("armor_plate", "armor_plate", "armor_plate"); // 4/4
  cv.hold.push({ module: "deep_array" });
  const err = apply(sim, cv, { verb: "install", params: { module: "deep_array" } });
  assert(err !== null && /slot/.test(err!), "a full deck refuses a fifth card");
}

// 9. the railgun is a module: auto-lights on the fire order, stays lit
{
  const sim = new Sim();
  const f = sim.addShip("A", 0, 0, 0);
  const evs: any[] = [];
  (sim as any).applyCommand(f, { verb: "fire_railgun", params: { mode: "bearing", bearing_degrees: 0 } }, evs);
  assert((sim as any).slugs.length === 1, "cold rail fires on the order (auto-power, §3a instant+free)");
  assert(reactorDraw(f) === C.MODULES.railgun.power, "and it STAYS lit — signature until powered down");
  // a corvette has no rail — and can loot one
  const cv = sim.addShip("B", 0, 100000, 0, false, null, "B", "corvette"); // inside the zone: no edge pull to drift the workshop
  const err = apply(sim, cv, { verb: "fire_railgun", params: { mode: "bearing", bearing_degrees: 0 } });
  assert(err !== null && /doesn't mount a railgun/.test(err!), "corvette: no rail, exactly as today");
  cv.hold.push({ module: "railgun" });
  apply(sim, cv, { verb: "install", params: { module: "railgun" } });
  for (let i = 0; i < C.MODULE_INSTALL_S; i++) sim.tick();
  assert(cv.installed.includes("railgun") && cv.railSlugs === C.RAIL_SLUGS_LOOTED, "a looted rail arrives with a magazine — that is a build; let it hurt");
}

// 10. amendment §4: salvage installs directly — slot + headroom, else hold
{
  const sim = new Sim();
  const f = sim.addShip("A", 0, 0, 0);
  assert((sim as any).landModule(f, "deep_array") === "installed", "free slot + headroom: the landing stop WAS the install");
  assert(f.installed.includes("deep_array"), "and it's part of the boat");
  f.installed.push("armor_plate", "armor_plate", "armor_plate"); // 6/6 slots
  assert((sim as any).landModule(f, "baffles") === "held", "no slot: it lands in the hold as cargo");
  assert(f.hold.some((it: any) => it.module === "baffles"), "cargo, not a system");
}

// 11. mines: IFF fuse, arming delay, the layer must be lit
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0, false, "blue");
  const b = sim.addShip("B", 0, 40000, 180, false, "blue");
  const e = sim.addShip("E", 0, 80000, 180, false, "red");
  a.pdcPosture = "hold"; b.pdcPosture = "hold"; e.pdcPosture = "hold";
  a.hold.push({ module: "mine_layer" });
  a.installed.push("mine_layer");
  a.minesLeft = C.MINE_SUPPLY;
  let err = apply(sim, a, { verb: "drop_mine", params: {} });
  assert(err !== null && /cold/.test(err!), "a cold layer drops nothing");
  apply(sim, a, { verb: "power", params: { module: "mine_layer", state: "on" } });
  assert(apply(sim, a, { verb: "drop_mine", params: {} }) === null, "lit layer lays");
  assert((sim as any).mines.length === 1, "the mine is on the board");
  const mine = (sim as any).mines[0];
  // teammate B drives straight over it
  b.x = mine.x; b.y = mine.y + 2000; b.vy = -600;
  const hullB = b.hull;
  for (let i = 0; i < C.MINE_ARM_S + 6; i++) sim.tick();
  assert(b.hull === hullB && (sim as any).mines.length === 1, "🔴 IFF: a teammate never trips the fuse (invariant 16 applies — fuses are guided)");
  // enemy E does
  e.x = mine.x; e.y = mine.y + 3000; e.vy = -500; e.vx = 0;
  const hullE = e.hull;
  for (let i = 0; i < 10 && (sim as any).mines.length > 0; i++) sim.tick();
  assert(e.hull === hullE - C.MINE_DAMAGE, `the enemy eats MINE_DAMAGE (${hullE} -> ${e.hull})`);
  assert((sim as any).mines.length === 0, "and the mine is spent");
}

// 11b. cc ruling 3: PDCs clear mines — but only FREE, and firing is loud.
// The chaser chooses: eat the mine, or tell the map where they are.
{
  const sim = new Sim();
  const layer = sim.addShip("L", 0, 0, 0, false, "blue");
  const chaser = sim.addShip("X", 0, 6000, 180, false, "red");
  layer.pdcPosture = "hold";
  (sim as any).mines.push({ id: 1, owner: "L", team: "blue", x: 0, y: 3000, armS: 0 });
  // HOLD: the field survives and the mount stays silent
  chaser.pdcPosture = "hold";
  for (let i = 0; i < 5; i++) sim.tick();
  assert((sim as any).mines.length === 1, "PDC HOLD: the mine stays (silence has a price)");
  assert(chaser.sigSpikePdc === 0, "and the chaser stays quiet");
  // FREE: the field dies, but the guns scream on the signature
  chaser.pdcPosture = "free";
  let cleared = false;
  for (let i = 0; i < 60 && !cleared; i++) {
    sim.tick();
    cleared = (sim as any).mines.length === 0;
  }
  assert(cleared, "PDC FREE clears the mine");
  assert(chaser.sigSpikePdc > 0, "🔴 and clearing it is LOUD — the mine is an information weapon");
}

// 11c. cc ruling 4: the auto-light speaks its standing cost — once, and
// only on the AUTO light (a manual power-on was asked for; no lecture)
{
  const sim = new Sim();
  const f = sim.addShip("A", 0, 0, 0);
  const evs: any[] = [];
  (sim as any).applyCommand(f, { verb: "fire_railgun", params: { mode: "bearing", bearing_degrees: 0 } }, evs);
  assert(
    evs.some((e: any) => e.kind === "notice" && /Railgun hot, Captain — and we'll stay loud/.test(e.text) && !e.silent),
    "auto-light: the price is SAID (news, spoken)"
  );
  const f2 = sim.addShip("B", 0, 100000, 0);
  const evs2: any[] = [];
  (sim as any).applyCommand(f2, { verb: "power", params: { module: "railgun", state: "on" } }, evs2);
  (sim as any).applyCommand(f2, { verb: "fire_railgun", params: { mode: "bearing", bearing_degrees: 0 } }, evs2);
  assert(
    !evs2.some((e: any) => e.kind === "notice" && /Railgun hot/.test(e.text)),
    "manual power-on then fire: no lecture — the captain chose it"
  );
}

// 12. fog: the loadout rides ONLY the owner's snapshot
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  a.thrust = 100;
  sim.addShip("B", 0, 40000, 180);
  for (let i = 0; i < 3; i++) sim.tick();
  const bSnap = sim.snapshotFor("B") as any;
  assert(bSnap.contacts.length >= 1, "B holds the loud contact");
  assert(!JSON.stringify(bSnap.contacts).includes("loadout"), "🔴 nobody's contacts carry a loadout");
  const aSnap = sim.snapshotFor("A") as any;
  assert(aSnap.you.loadout.mass === massOf(a), "the owner's ledger is live");
  assert(aSnap.you.loadout.reactor.capacity === C.ARCH_REACTOR.frigate, "reactor on the wire");
  assert(aSnap.you.loadout.modules.some((m: any) => m.id === "railgun"), "the deck is listed");
}

// 13. an enemy mine below detection range is NOT on the wire
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0, false, "red");
  const b = sim.addShip("B", 0, 60000, 180, false, "blue");
  (sim as any).mines.push({ id: 999, owner: "A", team: "red", x: 0, y: 30000, armS: 0 });
  sim.tick();
  const bSnap = sim.snapshotFor("B") as any;
  assert(!bSnap.mines.some((m: any) => m.id === 999), "a silent mine 30 km out is invisible (sig 8 ≈ knife-fight find range)");
  b.x = 0; b.y = 30000 + 10000; // 10 km out: inside 180k×0.08=14.4 km
  sim.tick();
  const near = sim.snapshotFor("B") as any;
  assert(near.mines.some((m: any) => m.id === 999), "close in, the field shows itself");
  void a;
}

// ===== The §5 + 6b leg: typed wrecks, the MP field, death hulks =========
import { Match } from "../server/match.js";

// 14. 🔴 the calibration pin SURVIVES the leg (Unification §3 — the proof
// the unification did not silently rebalance a game people already love)
{
  const sim = new Sim();
  for (const arch of ["corvette", "frigate", "cruiser"] as const) {
    const sh = sim.addShip(arch, 0, 0, 0, false, null, arch, arch);
    assert(
      accelOf(sh) === C.ARCHETYPES[arch].accel && sim.signatureOf(sh) === C.ARCHETYPES[arch].sigBase,
      `🔴 ${arch}: starting loadout + empty hold stays bit-identical to the book`
    );
  }
}

// 15. §5 typed pools: same seed = same field; loot matches the type;
// the type rides the wire for marked sites FROM t=0 at any range
{
  const wrecks = (Match as any).generateWrecks("pin-seed", new Sim("pin-seed"), true);
  assert(wrecks.length > 0 && wrecks.every((w: any) => w.marked), "MP field: every site marked (rumor semantics stay campaign)");
  assert(wrecks.every((w: any) => ["military", "survey", "smuggler", "freighter", "derelict"].includes(w.type)), "every site typed");
  for (const w of wrecks) {
    const mods = w.items.filter((i: any) => i.kind === "module").map((i: any) => i.module);
    if (w.type === "military") assert(mods.every((m: any) => ["railgun", "armor_plate", "mine_layer"].includes(m)), `military pool holds weapons (${w.letter})`);
    if (w.type === "survey") assert(mods.every((m: any) => ["deep_array", "probe_rack"].includes(m)), `survey pool holds sensors (${w.letter})`);
    if (w.type === "smuggler") assert(mods.every((m: any) => ["baffles", "drive_tune"].includes(m)), `smuggler pool holds stealth/speed (${w.letter})`);
    if (w.type === "freighter") assert(mods.length === 0 && w.items.some((i: any) => i.kind === "ore"), `freighter carries ore, no module (${w.letter})`);
  }
  const again = (Match as any).generateWrecks("pin-seed", new Sim("pin-seed"), true);
  assert(JSON.stringify(again) === JSON.stringify(wrecks), "same seed, same field — deterministic");
}

// 16. 6b: the MP field end to end — seed, see the type across the map,
// salvage, land a module
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0);
  sim.addShip("B", 0, 200000, 180);
  (sim as any).seedField([
    {
      id: 1, letter: "A", type: "survey", x: 0, y: 220000, marked: true, checked: false,
      items: [{ kind: "module", amount: 1, module: "deep_array" }],
    },
  ]);
  sim.tick();
  const snap = sim.snapshotFor("A") as any;
  assert(snap.wrecks.length === 1 && snap.wrecks[0].type === "survey", "🔴 the TYPE is on the wire at 220 km, t=0 — transit is a decision");
  // teleport alongside and salvage (the mechanics are the campaign's own)
  a.x = 0; a.y = 218000; a.vx = 0; a.vy = 0;
  const err = (sim as any).applyCommand(a, { verb: "salvage", params: { target: "A" } }, []);
  assert(err === null, `salvage verb legal in multiplayer (${err})`);
  let landed = false;
  for (let t = 0; t < 60 && !landed; t++) {
    sim.tick();
    landed = a.installed.includes("deep_array");
  }
  assert(landed, "the module lands and fits — the landing stop was the install");
}

// 17. 6b: death drops everything, in every mode — the hulk carries the deck
{
  const sim = new Sim();
  const a = sim.addShip("A", 0, 0, 0); // frigate: railgun + probe_rack
  const b = sim.addShip("B", 0, 30000, 180);
  a.hold.push({ module: "deep_array" });
  a.ore = 3;
  a.vx = 500;
  a.hull = 1;
  const evs: any[] = [];
  (sim as any).damageShip(a, 10, "missile", evs, "B");
  const hulk = (sim as any).fieldWrecks.find((w: any) => w.type === "hulk");
  assert(!!hulk, "🔴 an MP death leaves a hulk — the leader is the biggest prize");
  const mods = hulk.items.filter((i: any) => i.kind === "module").map((i: any) => i.module).sort();
  assert(
    JSON.stringify(mods) === JSON.stringify(["deep_array", "probe_rack", "railgun"]),
    `the WHOLE deck is aboard: installed + hold (${mods})`
  );
  assert(hulk.items.some((i: any) => i.kind === "ore" && i.amount === 3), "the ore too");
  assert(Math.abs(hulk.vx - 500 * C.HULK_MOMENTUM_RETENTION) < 1e-9, "0.4 momentum retention, direction preserved");
  assert(hulk.marked === true, "a death is loud — the hulk is public");
  const bSnap = sim.snapshotFor("B") as any;
  assert(bSnap.wrecks.some((w: any) => w.type === "hulk"), "and B sees the prize");
}

// 18. run-state round trip: the deck sanitizes and survives
{
  const raw = {
    system: 3,
    loadout: { installed: ["railgun", "bogus", "baffles"], hold: ["deep_array"], ore: 7.9 },
    pools: { propellant: 100, missiles: 4, decoys: 2, pdcAmmoS: 30, hull: 80 },
    totals: { huntersKilled: 2, salvaged: 9, pingsFired: 1, upgrades: 3, timeS: 600 },
  };
  const run = (Match as any).sanitizeRun(raw)!;
  assert(run.loadout.installed.join(",") === "railgun,baffles", "invalid module ids are dropped, valid ones survive");
  assert(run.loadout.ore === 8, "ore sanitizes to a finite integer");
  assert(run.totals.modules === 3, "old saves' totals.upgrades migrates to totals.modules");
  assert((Match as any).sanitizeRun({ system: 2 })!.loadout === null, "a bump-era save loses its bumps, keeps its run");
}

console.log("done: loadout");
