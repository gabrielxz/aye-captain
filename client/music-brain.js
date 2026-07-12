// Campaign adaptive score — the BRAIN only (pure; the oscillators live in
// audio.js). 🔴 THE FOG INVARIANT APPLIES TO MUSIC (spec §7.1): everything
// here derives from the player's WIRE SNAPSHOT, never the sim's truth —
// if the score swelled because the Hunter is near, the music would be a
// sensor. The scariest moment in the game — the Hunter closing,
// undetected — is scored with SILENCE. That is not a compromise; that is
// Jaws. tests/music.test.ts pins it (mandatory-green).
//
// Shape: one scalar, `intensity` ∈ [0,1], drives five continuous layers
// (§7.3): BED (always) · PULSE (≥0.25) · ARP (≥0.45) · PAD (≥0.65) ·
// PERC (≥0.80). intensity = max(perceivedThreat, gateRun, damageStress)
// (§7.4). The driver smooths it (§7.2); discrete events (`sting`) snap.

export const GATE_RUN_TTG_MAX_S = 90; // gateRun starts ramping here (mirrors server constant)
const LAYER_AT = { pulse: 0.25, arp: 0.45, pad: 0.65, perc: 0.8 };
// a bad solution caps the climb JUST under the top layer: the score
// climbs but does not resolve — the soundtrack is telling you whether
// you're going to make it (§7.5)
const NO_COMMIT_CAP = LAYER_AT.perc - 0.02;

// Distill the wire snapshot into the ONLY fields the score may know.
// Deliberately a whitelist — anything not extracted here cannot leak in.
// NOTE: no bearings, no positions, no identities survive the extraction;
// ranges survive only for contacts the sensors have EARNED.
export function musicView(snap) {
  const you = snap?.you ?? null;
  if (!you) return null;
  const contacts = (snap.contacts ?? []).map((c) => ({
    tier: c.tier,
    rangeM: Math.hypot((c.x ?? 0) - you.x, (c.y ?? 0) - you.y),
  }));
  return {
    spawnInS: you.mission ? you.mission.spawnInS : null, // the clock is on the HUD — fair game
    hunterActive: !!you.mission?.hunterActive,
    salvaging: !!you.mission?.salvaging,
    contacts,
    rumbleLoud: (snap.rumbles ?? []).reduce((a, r) => Math.max(a, r.loud ?? 0), 0),
    painted: you.painted ?? "none",
    lockedBy: you.lockedBy ?? 0,
    missilesInbound: (snap.missiles ?? []).filter((m) => !m.own && !m.ally).length,
    hullFrac: (you.hull ?? 100) / (you.hullMax ?? 100),
    gate: you.gate ?? null, // {ttg, good} — own-state projection, zero fog
  };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
// gain crossfade around a layer threshold (no hard steps — §7.3)
const fade = (intensity, at) => clamp01((intensity - at) / 0.12);

// view (+ the previous view, for edge-triggered stings) -> the driver's
// whole input. Pure and deterministic: identical views MUST produce
// identical output — that determinism IS the fog law, because an
// undetected Hunter at 20 km and one at 200 km produce identical views.
export function computeMusic(view, prevView = null) {
  if (!view) return { intensity: 0, layers: { bed: 1, pulse: 0, arp: 0, pad: 0, perc: 0 }, sting: null, phase: "quiet" };

  // §7.4 perceivedThreat — from the snapshot's own contact picture
  let threat = 0;
  for (const c of view.contacts) {
    if (c.tier >= 2) {
      threat = Math.max(threat, 0.55 + 0.3 * (1 - Math.min(c.rangeM, 150000) / 150000));
    } else if (c.tier === 1) {
      threat = Math.max(threat, 0.4);
    }
  }
  if (view.rumbleLoud > 0) {
    // the RUMBLE, never its source (§7.1 table)
    threat = Math.max(threat, 0.15 + 0.3 * clamp01(view.rumbleLoud));
  }
  if (view.painted === "acquiring") threat = Math.max(threat, 0.6);
  if (view.lockedBy > 0) threat = Math.max(threat, 0.8);
  if (view.missilesInbound > 0) threat = Math.max(threat, 0.92);
  // race phase (§7.6): before the clock runs out nothing hunts you — the
  // board reads open, even beautiful. The contrast IS the point.
  if (view.spawnInS !== null && view.spawnInS > 0) threat = Math.min(threat, 0.25);

  // §7.4 damageStress — you know your own hull
  const damage = clamp01((1 - view.hullFrac) * 0.7);

  // §7.5 gateRun — ttg is derived from YOUR velocity: burn harder and the
  // music surges; blow the line and it deflates. A bad solution withholds
  // the top layer — it climbs but does not resolve.
  let gateRun = 0;
  if (view.gate && typeof view.gate.ttg === "number") {
    gateRun = clamp01(1 - view.gate.ttg / GATE_RUN_TTG_MAX_S);
    if (!view.gate.good) gateRun = Math.min(gateRun, NO_COMMIT_CAP);
  }

  const intensity = Math.max(threat, damage, gateRun, 0.04); // 0.04: the bed never fully dies mid-run
  const phase =
    view.spawnInS !== null && view.spawnInS > 0
      ? "race"
      : gateRun >= threat && gateRun >= damage && gateRun > 0.2
        ? "gate"
        : "hunt";

  // discrete events snap the ramp (§7.3): the spawn is A STING — the
  // phase inversion made audible, and it carries NO bearing (§7.6)
  let sting = null;
  if (prevView && prevView.spawnInS !== null && prevView.spawnInS > 0 && view.spawnInS === 0) {
    sting = "spawn";
  }

  return {
    intensity,
    layers: {
      bed: 1,
      pulse: fade(intensity, LAYER_AT.pulse),
      arp: fade(intensity, LAYER_AT.arp),
      pad: fade(intensity, LAYER_AT.pad),
      perc: fade(intensity, LAYER_AT.perc),
    },
    sting,
    phase,
  };
}
