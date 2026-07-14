// Patch 3.5 — the two rings' view-model. A PURE function of the wire
// snapshot (same law as music-brain.js and panel-model.js: fog is enforced
// server-side in snapshotFor; this module may only re-arrange what the
// wire already granted). The function signature IS the fog guarantee —
// it sees `you` and the fogged `contacts[]`, so the voice ring CANNOT
// react to an undetected ship inside it (addendum §6, pinned in
// tests/rings.test.ts). Never hand this a Sim.
//
// States, weakest to hottest:
//   "quiet"     — voice inside ears: we hear them before they hear us
//   "crossover" — voice outside ears: they hear us first (the danger state)
//   "contact"   — a KNOWN contact is inside our voice ring right now
export function ringState(you, contacts) {
  const rings = you?.rings;
  if (!rings || !(rings.voiceM >= 0) || !(rings.earsM >= 0)) return null;
  const hot = (contacts ?? []).some(
    (c) =>
      typeof c.x === "number" &&
      typeof c.y === "number" &&
      Math.hypot(c.x - you.x, c.y - you.y) <= rings.voiceM
  );
  return {
    voiceM: rings.voiceM,
    earsM: rings.earsM,
    state: hot ? "contact" : rings.voiceM > rings.earsM ? "crossover" : "quiet",
  };
}
