// Side-panel view-model tests — panel-model.js is a PURE function of the
// wire snapshot (same law as music-brain.js: fog is enforced server-side;
// the panel may only re-arrange what the wire already granted). Pins:
// the FIXED ten-lamp annunciator (states light in place, nothing reflows),
// the inbound count excluding own/ally birds (friendly paint, no alarm),
// the sig vocabulary bands, decoy-contact indistinguishability at the
// panel, and the server's mission.hold ledger aggregation.
import { buildPanel, sigWord, fmtClock, fmtSpeed } from "../client/panel-model.js";
import { Sim, type Mission } from "../server/sim.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseYou = (over: Record<string, unknown> = {}): any => ({
  callsign: "KESTREL", archetype: "frigate", hull: 100, hullMax: 100,
  x: 0, y: 0, facing: 116, thrust: 20, thrustOut: 20, speed: 1240,
  propellant: 84, regen: true, signature: 30, missiles: 6,
  tubes: [{ state: "ready", t: 0 }, { state: "ready", t: 0 }],
  lock: { has: false, progress: 0 }, painted: "none", lockedBy: 0,
  decoys: 4, pdc: { posture: "free", ammoS: 60 }, rail: { slugs: 20, cooldownS: 0 },
  probes: 2, ping: { ready: true, cooldownS: 0, revealS: 0 },
  insideZone: true, inDust: false, collisionWarning: null,
  discipline: "standard", standingOrders: [],
  ...over,
});
const snapOf = (you: any, extra: Record<string, unknown> = {}): any => ({
  tick: 0, you, contacts: [], missiles: [], probes: [], ...extra,
});

// ---- 1. the fixed annunciator grid ----
{
  const calm = buildPanel(snapOf(baseYou()))!;
  assert(calm.lamps.length === 10, "annunciator is exactly ten lamps");
  assert(
    calm.lamps.filter((l: any) => l.state !== "off").length === 1 &&
      calm.lamps.find((l: any) => l.key === "guns").state === "good",
    "cruising nominal: every lamp dark except GUNS FREE"
  );
  const hot = buildPanel(
    snapOf(baseYou({ painted: "locked", lockedBy: 2, ping: { ready: false, cooldownS: 23, revealS: 7 } }), {
      missiles: [
        { id: 1, own: false }, { id: 2, own: false },
        { id: 3, own: true }, { id: 4, own: false, ally: true },
      ],
    })
  )!;
  assert(
    hot.lamps.map((l: any) => l.key).join(",") === calm.lamps.map((l: any) => l.key).join(","),
    "under fire the grid is IDENTICAL — same lamps, same order, states light in place"
  );
  const lamp = (m: any, k: string) => m.lamps.find((l: any) => l.key === k);
  assert(lamp(hot, "enemylock").state === "alert" && lamp(hot, "enemylock").blink === true, "ENEMY LOCK lights red and blinks");
  assert(lamp(hot, "enemylock").value === "×2", "two lockers read ×2 (v5.1 §2.2 count, nothing else)");
  assert(lamp(hot, "painted").state === "warn", "locked implies PAINTED lit");
  assert(lamp(hot, "inbound").value === "2", "MSL INBOUND counts hostile birds ONLY — own and ally birds excluded (friendly paint, no alarm)");
  assert(lamp(hot, "lit").value === "7s" && lamp(hot, "lit").state === "alert", "LIT lamp is the revealS countdown");
}

// ---- 2. lamp semantics on the quiet half ----
{
  const m = buildPanel(
    snapOf(
      baseYou({
        propellant: 0, insideZone: false, inDust: true, collisionWarning: 14,
        pdc: { posture: "hold", ammoS: 22 }, lock: { has: false, progress: 0.5 },
      })
    )
  )!;
  const lamp = (k: string) => m.lamps.find((l: any) => l.key === k);
  assert(lamp("dry")!.state === "alert", "TANKS DRY lights on zero propellant");
  assert(lamp("shroud")!.state === "warn", "OUT SHROUD lights outside the region");
  assert(lamp("dust")!.state === "warn", "IN DUST lights in dust");
  assert(lamp("collision")!.state === "warn" && lamp("collision")!.value === "14s", "COLLISION amber above 10 s, carries the countdown");
  assert(lamp("guns")!.state === "warn" && lamp("guns")!.value === "HOLD", "PDCs on hold: the GUNS lamp says so");
  assert(lamp("lock")!.value === "50%", "our own lock in progress reads as a percentage");
  const near = buildPanel(snapOf(baseYou({ collisionWarning: 6 })))!;
  assert(near.lamps.find((l: any) => l.key === "collision").state === "alert", "COLLISION red at/below 10 s");
}

// ---- 3. signature vocabulary (display bands on our own instrument;
// the exact number always renders beside the word) ----
{
  assert(sigWord(30) === "QUIET" && sigWord(50) === "QUIET", "sig 30/50 = QUIET");
  assert(sigWord(51) === "LOUD" && sigWord(100) === "LOUD", "sig 51/100 = LOUD");
  assert(sigWord(128) === "SCREAMING", "sig 128 = SCREAMING");
  const m = buildPanel(snapOf(baseYou({ signature: 128 })))!;
  assert(m.sig.value === 128 && m.sig.word === "SCREAMING" && m.sig.cls === "alert", "panel carries number AND word");
}

// ---- 4. decoys stay indistinguishable at the panel (invariant 11/15):
// a decoy contact arrives with the same wire shape as a quiet hull, and
// the model may only use label + tier — identical treatment is structural
{
  const shipC = { cid: "B", label: "B", tier: 2, loud: 0.3, x: 1, y: 1, vx: 0, vy: 0, facing: 0 };
  const decoyC = { cid: "B", label: "B", tier: 2, loud: 0.3, x: 9, y: 9, vx: 0, vy: 0, facing: 0 };
  const a = buildPanel(snapOf(baseYou(), { contacts: [shipC] }))!;
  const b = buildPanel(snapOf(baseYou(), { contacts: [decoyC] }))!;
  assert(JSON.stringify(a.contacts) === JSON.stringify(b.contacts), "ship track and decoy track render identically below ID");
  assert(a.contacts[0].text === "B · TRACK", "contact row keeps the tier vocabulary (v4.7.2 anchor)");
  const id = buildPanel(
    snapOf(baseYou(), { contacts: [{ ...shipC, tier: 3, label: "VAGRANT", hull: 62, hullMax: 100 }] })
  )!;
  assert(id.contacts[0].text === "VAGRANT · ID 62/100", "ID tier earns callsign + hull readout");
  const ghost = buildPanel(snapOf(baseYou(), { ghosts: [{ x: 0, y: 0, facing: 0, t: 1, label: "C" }] }))!;
  assert(ghost.contacts[0].text === "C · lost", "ghosts read as lost tracks");
}

// ---- 5. the mission block ----
{
  const you = baseYou({
    mission: { system: 1, systemName: "The Drifter", spawnInS: 236, hunterActive: false, hold: [], salvaging: null, gateClosing: null },
    gate: null,
  });
  const m = buildPanel(snapOf(you))!;
  assert(m.mission!.text === "Hunter wakes 3:56" && m.mission!.cls === "warn", "the countdown is the mission headline");
  assert(m.mission!.sub[0].text === "gate · no solution yet", "no solution reads as itself");
  assert(m.identity.context === "SYS 1/8 · The Drifter", "identity carries the system");
  assert(m.hold !== null && m.hold.length === 0, "campaign: HOLD section present, empty");

  const hot = buildPanel(
    snapOf(
      baseYou({
        mission: {
          system: 1, systemName: "The Drifter", spawnInS: 0, hunterActive: true,
          hold: [{ kind: "missiles", n: 2 }, { kind: "module", module: "deep_array", n: 1 }],
          salvaging: { nextInS: 12, itemsLeft: 3 },
          gateClosing: { phase: "closing", leftS: 134, aperturePct: 61, apertureW: 2196 },
        },
        gate: { good: false, ttg: 95, missM: 5200, side: "port" },
      })
    )
  )!;
  assert(hot.mission!.text === "◤ HUNTER IN SYSTEM ◥" && hot.mission!.blink === true, "hunter in system swells and blinks");
  assert(hot.mission!.sub.some((s: any) => s.text === "GATE CLOSING 2:14 · aperture 61%"), "closing gate carries countdown + live aperture");
  assert(hot.mission!.sub.some((s: any) => /salvage · next in 12s · 3 left/.test(s.text)), "the transfer clock stays visible");
  assert(hot.mission!.sub.some((s: any) => /miss 5.2 km PORT/.test(s.text)), "a bad solution says how bad and which side");
  assert(hot.hold!.join("|") === "missiles +2|◆ deep array", "HOLD ledger: aggregated consumables, named modules");
}

// ---- 6. non-campaign: campaign furniture is absent, grid unchanged ----
{
  const m = buildPanel(snapOf(baseYou()), { team: "red" })!;
  assert(m.mission === null && m.hold === null, "FFA/teams: no mission block, no hold");
  assert(m.identity.context === "TEAM RED", "teams: the context slot names the team");
  assert(m.lamps.length === 10, "the lamp grid does not shrink outside the campaign");
}

// ---- 7. hero + allies + orders ----
{
  const m = buildPanel(
    snapOf(baseYou({ speed: 1240, thrust: 60, propellant: 0 }), {
      allies: [{ id: "B", callsign: "Mako", x: 60000, y: 60000, hull: 78, hullMax: 100, propellant: 40, sig: 112 }],
    })
  )!;
  assert(m.hero.speed === "1,240", "hero speed groups digits");
  assert(/THR 60% \(DRY\)/.test(m.hero.sub), "dry tanks flag the throttle line");
  const a = m.allies[0];
  assert(a.callsign === "MAKO" && a.hullPct === 78 && a.louder === true, "teammate strip: transponder data, ▲ when louder than us");
  const o = buildPanel(
    snapOf(baseYou({ standingOrders: [{ label: "missile defense", repeat: true, armed: false }] }))
  )!;
  assert(o.orders[0].label === "missile defense" && o.orders[0].repeat && !o.orders[0].armed, "standing orders map label/repeat/cooling");
  assert(fmtClock(236) === "3:56" && fmtSpeed(2410) === "2,410", "formatters");
}

// ---- 8. referee spectator keeps the hull list ----
{
  const m = buildPanel({
    spectator: true,
    ships: [{ id: "A", callsign: "Kestrel", hull: 34, hullMax: 100 }],
    names: { A: "Gabriel" },
  } as any)!;
  assert(m.spectator!.length === 1 && /KESTREL \(Gabriel\)/.test(m.spectator![0].label), "spectator rows carry callsign + revealed name");
  assert(m.spectator![0].cls === "alert", "hull coloring survives");
}

// ---- 9. the wire: mission.hold is the aggregated haul ledger ----
{
  const sim = new Sim();
  sim.addShip("A", 0, -C.SPAWN_RING_RADIUS_M, 0);
  sim.mission = {
    playerIds: ["A"],
    system: 2,
    systemName: "Sharp Ears",
    gate: { x: 0, y: C.REGION_RADIUS_M, apertureW: C.APERTURE_W_M },
    hunterSpawnS: 100,
    hunterSpawned: false,
    hunterIds: [],
    hunters: [{ archetype: "corvette", sensorMult: 1.4, sigMult: 0.75, gateCamp: false }],
    spawnLine: "x",
    wrecks: [],
    salvaging: {},
    cleared: false,
    stats: { huntersKilled: 0, salvaged: 0, pingsFired: 0, modules: 0 },
    haul: [
      { kind: "missiles", amount: 2 },
      { kind: "missiles", amount: 1 },
      { kind: "module", amount: 1, module: "deep_array" },
    ],
    decoyTaught: false,
    solGood: {},
    solCooldownS: {},
  } satisfies Mission;
  const snap = sim.snapshotFor("A") as any;
  const hold = snap.you.mission.hold;
  assert(Array.isArray(hold) && hold.length === 2, "mission.hold aggregates the haul");
  assert(hold[0].kind === "missiles" && hold[0].n === 3, "consumables sum by kind");
  assert(hold[1].kind === "module" && hold[1].module === "deep_array", "modules keep their identity");
  // and the view-model formats it
  const pm = buildPanel(snap)!;
  assert(pm.hold!.join("|") === "missiles +3|◆ deep array", "panel HOLD line reads the ledger");
}

console.log("panel.test done");
