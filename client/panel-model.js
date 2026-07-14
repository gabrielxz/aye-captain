// panel-model.js — pure view-model for the side panel (the "Side Panel"
// design synthesis: one panel, two states — lamps light IN PLACE, the hero
// swells, nothing reflows). A pure function of the WIRE SNAPSHOT, same law
// as music-brain.js: fog is already enforced in snapshotFor, and keeping
// this module DOM-free lets tests/panel.test.ts pin the mapping (the fixed
// 10-lamp grid, sig vocabulary, inbound counts) without a browser.
//
// cls vocabulary everywhere: "" (dim/nominal) | "good" | "warn" | "alert".

export const TIER_WORD = { 1: "FAINT", 2: "TRACK", 3: "ID" };

// Own-signature vocabulary: DISPLAY bands on our own instrument, aligned
// with the HUD color thresholds that already existed (50/100). Not a
// hearing threshold — invariant 13 governs the CHANNEL, and the exact
// number always renders beside the word.
export function sigWord(sig) {
  return sig > 100 ? "SCREAMING" : sig > 50 ? "LOUD" : "QUIET";
}

export function fmtClock(s) {
  const v = Math.max(0, Math.round(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}

// grouping digits ("1,240 m/s") — the hero number is the one big readout
export function fmtSpeed(mps) {
  return Math.round(mps).toLocaleString("en-US");
}

function hullCls(hull, hullMax) {
  const f = hull / (hullMax || 100);
  return f <= 0.35 ? "alert" : f <= 0.65 ? "warn" : "good";
}

// The annunciator: ALWAYS ten lamps, always this order — the whole point
// is that every state lives at a fixed address the eye learns.
function buildLamps(you, inboundCount) {
  const painted = you.painted ?? "none";
  const lockP = you.lock?.progress ?? 0;
  const revealS = you.ping?.revealS ?? 0;
  const coll = you.collisionWarning;
  const dry = (you.propellant ?? 0) <= 0;
  const free = (you.pdc?.posture ?? "free") === "free";
  return [
    {
      key: "lock",
      label: "LOCK",
      value: you.lock?.has ? "ON" : lockP > 0 ? `${Math.round(lockP * 100)}%` : "—",
      state: you.lock?.has ? "good" : lockP > 0 ? "warn" : "off",
    },
    {
      key: "painted",
      label: "PAINTED",
      value: painted !== "none" ? "◍" : "—",
      state: painted !== "none" ? "warn" : "off",
    },
    {
      key: "enemylock",
      label: "ENEMY LOCK",
      value:
        painted === "locked" ? ((you.lockedBy ?? 0) > 1 ? `×${you.lockedBy}` : "◤◥") : "—",
      state: painted === "locked" ? "alert" : "off",
      blink: painted === "locked",
    },
    {
      key: "inbound",
      label: "MSL INBOUND",
      value: inboundCount > 0 ? String(inboundCount) : "—",
      state: inboundCount > 0 ? "alert" : "off",
      blink: inboundCount > 0,
    },
    {
      key: "collision",
      label: "COLLISION",
      value: coll !== null && coll !== undefined ? `${coll}s` : "—",
      state: coll === null || coll === undefined ? "off" : coll <= 10 ? "alert" : "warn",
      blink: coll !== null && coll !== undefined && coll <= 10,
    },
    {
      key: "lit",
      label: "LIT / PINGED",
      value: revealS > 0 ? `${revealS}s` : "—",
      state: revealS > 0 ? "alert" : "off",
      blink: revealS > 0,
    },
    {
      key: "dust",
      label: "IN DUST",
      value: you.inDust ? "◍" : "—",
      state: you.inDust ? "warn" : "off",
    },
    {
      key: "dry",
      label: "TANKS DRY",
      value: dry ? "0" : "—",
      state: dry ? "alert" : "off",
    },
    {
      key: "guns",
      label: "GUNS FREE",
      value: free ? "ON" : "HOLD",
      state: free ? "good" : "warn",
    },
    {
      key: "shroud",
      label: "OUT SHROUD",
      value: you.insideZone ? "—" : "◍",
      state: you.insideZone ? "off" : "warn",
    },
  ];
}

// campaign mission block: the hunter line is the headline, then the gate
// solution, the closing-gate phase, and the salvage clock — server-owned
// numbers only, no client timers
function buildMission(you, snap, opts) {
  const m = you.mission;
  if (!m) return null;
  const line = m.hunterActive
    ? { text: "◤ HUNTER IN SYSTEM ◥", cls: "alert", blink: true }
    : m.spawnInS > 0
      ? { text: `Hunter wakes ${fmtClock(m.spawnInS)}`, cls: "warn", blink: false }
      : { text: "hunter gone quiet", cls: "good", blink: false };
  const sub = [];
  if (you.gate) {
    sub.push(
      you.gate.good
        ? { text: `gate · SOLUTION GOOD · ${fmtClock(you.gate.ttg)}`, cls: "good" }
        : {
            text: `gate · ttg ${fmtClock(you.gate.ttg)} · miss ${(you.gate.missM / 1000).toFixed(1)} km ${String(you.gate.side).toUpperCase()}`,
            cls: "alert",
          }
    );
  } else {
    sub.push({ text: "gate · no solution yet", cls: "" });
  }
  if (m.gateClosing) {
    sub.push(
      m.gateClosing.phase === "stable"
        ? { text: `GATE STABLE · closing in ${fmtClock(m.gateClosing.leftS)}`, cls: "warn" }
        : {
            text: `GATE CLOSING ${fmtClock(m.gateClosing.leftS)} · aperture ${m.gateClosing.aperturePct}%`,
            cls: "alert",
            blink: true,
          }
    );
  }
  if (m.salvaging) {
    sub.push({
      text: `salvage · next in ${m.salvaging.nextInS}s · ${m.salvaging.itemsLeft} left`,
      cls: "good",
    });
  } else {
    // the actable moment must be visible (Deep Black playtest)
    const rangeM = opts.salvageRangeM ?? 15000;
    const near = (snap.wrecks ?? [])
      .filter((w) => w.items !== 0 && Math.hypot(w.x - you.x, w.y - you.y) <= rangeM)
      .sort(
        (a, b) => Math.hypot(a.x - you.x, a.y - you.y) - Math.hypot(b.x - you.x, b.y - you.y)
      )[0];
    if (near) sub.push({ text: `wreck ${near.letter} in range — "salvage ${near.letter}"`, cls: "good" });
  }
  return { ...line, sub };
}

const HOLD_NAME = {
  propellant: "propellant",
  missiles: "missiles",
  pdc_ammo: "PDC ammo",
  decoys: "decoys",
  probes: "probes",
  hull: "hull repair",
  ore: "ore",
};
// cc ruling 1: the haul carries REAL module ids now (the stat-bump
// vocabulary is dead) — display names mirror server MODULES
const MODULE_NAME = {
  baffles: "baffles",
  deep_array: "deep array",
  drive_tune: "drive tune",
  armor_plate: "armor plate",
  railgun: "railgun",
  mine_layer: "mine layer",
  probe_rack: "probe rack",
};

// opts: {practice?, team?, salvageRangeM?}
export function buildPanel(snap, opts = {}) {
  if (snap.spectator) {
    // referee panel: the hulls, nothing else (the map is the show; names
    // ride along — spectators are omniscient by design, v4.2)
    return {
      spectator: (snap.ships ?? []).map((s) => ({
        label: `${(s.callsign ?? s.id).toUpperCase()}${snap.names?.[s.id] ? ` (${snap.names[s.id]})` : ""}${s.drone ? " · drone" : ""}`,
        text: `${s.hull}/${s.hullMax}`,
        cls: hullCls(s.hull, s.hullMax),
      })),
    };
  }
  const you = snap.you;
  if (!you) return null;

  const inbound = (snap.missiles ?? []).filter((m) => !m.own && !m.ally).length;
  const dry = (you.propellant ?? 0) <= 0;
  const prop = Math.round(you.propellant ?? 0);
  const sig = Math.round(you.signature ?? 0);

  const contacts = (snap.contacts ?? []).map((c) => ({
    text:
      c.tier === 3 && c.hull !== undefined
        ? `${c.label ?? "?"} · ID ${c.hull}/${c.hullMax ?? 100}`
        : `${c.label ?? "?"} · ${TIER_WORD[c.tier] ?? "?"}`,
    cls: c.tier >= 2 ? "good" : "warn",
  }));
  const ghosts = (snap.ghosts ?? (snap.ghost ? [snap.ghost] : [])).map((g) => ({
    text: `${g.label ?? "ghost"} · lost`,
    cls: "",
  }));

  return {
    spectator: null,
    identity: {
      callsign: `${you.callsign ?? "—"}`,
      archetype: you.archetype ?? "",
      context: you.mission
        ? `SYS ${you.mission.system}/8 · ${you.mission.systemName ?? ""}`
        : opts.team
          ? `TEAM ${String(opts.team).toUpperCase()}`
          : opts.practice
            ? "PRACTICE"
            : "",
    },
    // teammates ride the transponder (v5 §8 / Patch 2 §3): full state,
    // never their sensor picture. ▲ marks whoever is louder than us NOW.
    allies: (snap.allies ?? []).map((t) => {
      const km = Math.hypot(t.x - you.x, t.y - you.y) / 1000;
      const brg = Math.round((Math.atan2(t.x - you.x, t.y - you.y) * 180) / Math.PI + 360) % 360;
      const louder = (t.sig ?? 0) > (you.signature ?? 0);
      return {
        callsign: (t.callsign ?? t.id).toUpperCase(),
        hullPct: Math.round((t.hull / (t.hullMax || 100)) * 100),
        hullCls: hullCls(t.hull, t.hullMax),
        sig: t.sig ?? 0,
        louder,
        prop: t.propellant ?? 0,
        km: Math.round(km),
        brg: String(brg).padStart(3, "0"),
      };
    }),
    hero: {
      speed: fmtSpeed(you.speed ?? 0),
      sub: `HDG ${String(Math.round(you.facing ?? 0) % 360).padStart(3, "0")} · THR ${Math.round(you.thrust ?? 0)}%${dry && (you.thrust ?? 0) > 0 ? " (DRY)" : ""}`,
      subCls: dry && (you.thrust ?? 0) > 0 ? "alert" : "",
      hull: you.hull,
      hullPct: Math.max(0, Math.min(100, (100 * you.hull) / (you.hullMax || 100))),
      hullCls: hullCls(you.hull, you.hullMax),
    },
    prop: {
      value: prop,
      pct: prop, // PROPELLANT_MAX is 100 — the dial is the number
      // ⟳ = harvesting, ✕ = regen gated (throttle/zone), nothing at full
      mode: prop >= 100 ? "" : you.regen ? "⟳" : "✕",
      cls: prop <= 10 ? "alert" : prop <= 25 ? "warn" : "good",
    },
    sig: { value: sig, word: sigWord(sig), cls: sig > 100 ? "alert" : sig > 50 ? "warn" : "good" },
    mission: buildMission(you, snap, opts),
    lamps: buildLamps(you, inbound),
    contacts: contacts.length + ghosts.length > 0 ? [...contacts, ...ghosts] : [{ text: "—", cls: "" }],
    posture: {
      discipline: you.discipline ?? "standard",
      cls: you.discipline === "flank" ? "alert" : "good",
      pdc: (you.pdc?.posture ?? "free").toUpperCase(),
      pdcCls: (you.pdc?.posture ?? "free") === "free" ? "good" : "warn",
    },
    arm: {
      missiles: you.missiles ?? 0,
      tubes: (you.tubes ?? []).map((t, i) => ({
        text: t.state === "ready" ? `${i + 1}·RDY` : t.state === "reloading" ? `${i + 1}·${t.t}s` : `${i + 1}·—`,
        cls: t.state === "ready" ? "good" : t.state === "reloading" ? "warn" : "",
      })),
      // armed classes only — corvettes show the card as NOT FITTED so the
      // grid never reflows between archetypes
      rail: you.rail
        ? {
            n: you.rail.slugs,
            text: you.rail.slugs <= 0 ? "OUT" : you.rail.cooldownS > 0 ? `CHG ${you.rail.cooldownS}s` : "READY",
            cls: you.rail.slugs <= 0 ? "alert" : you.rail.cooldownS > 0 ? "warn" : "good",
          }
        : null,
      misc: [
        { label: "DECOY", value: String(you.decoys ?? 0), cls: (you.decoys ?? 0) <= 1 ? "warn" : "" },
        {
          label: "PDC",
          value: `${you.pdc?.ammoS ?? 0}s`,
          cls: (you.pdc?.ammoS ?? 0) <= 6 ? "alert" : (you.pdc?.ammoS ?? 0) <= 15 ? "warn" : "good",
        },
        {
          label: "PROBES",
          value: `${you.probes ?? 0}${(snap.probes ?? []).some((p) => p.own) ? `·${(snap.probes ?? []).filter((p) => p.own).length} out` : ""}`,
          cls: (snap.probes ?? []).some((p) => p.own) ? "good" : "",
        },
        {
          label: "PING",
          value: you.ping?.ready ? "READY" : `${you.ping?.cooldownS ?? 0}s`,
          cls: you.ping?.ready ? "good" : "",
        },
      ],
    },
    // campaign HOLD: the ledger of what this system paid — applied
    // consumables, NOT jettisonable cargo (there is no jettison; see the
    // design-review notes)
    hold: you.mission
      ? (you.mission.hold ?? []).map((it) =>
          it.kind === "module"
            ? `◆ ${MODULE_NAME[it.module] ?? it.module}`
            : `${HOLD_NAME[it.kind] ?? it.kind} +${it.n}`
        )
      : null,
    orders: (you.standingOrders ?? []).map((o) => ({
      label: o.label,
      repeat: !!o.repeat,
      armed: o.armed !== false,
    })),
  };
}
