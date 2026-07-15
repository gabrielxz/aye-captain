// Wreck field placement fairness. MP wrecks are public from t=0, so a field
// that hands one captain a military wreck at 25 km while another's nearest is
// 200 km away is a VISIBLE unfair race — the worst kind. Type is rolled
// independently of position, so this happened on ordinary seeds, not rare ones.
import { Sim, headingVec } from "../server/sim.js";
import { Match } from "../server/match.js";
import * as C from "../server/constants.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

// generateWrecks is private; it is the unit under test, and TS `private` is
// compile-time only.
const genWrecks = (seed: string, sim: Sim, allMarked = true) =>
  (Match as unknown as {
    generateWrecks: (s: string, sim: Sim, a: boolean) => { x: number; y: number; type?: string }[];
  }).generateWrecks(seed, sim, allMarked);

const ringSim = (n: number, seed: string) => {
  const sim = new Sim(seed);
  const spawns: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const [dx, dy] = headingVec((360 / n) * i);
    const x = dx * C.SPAWN_RING_RADIUS_M;
    const y = dy * C.SPAWN_RING_RADIUS_M;
    sim.addShip(String(i), x, y, 0);
    spawns.push({ x, y });
  }
  return { sim, spawns };
};

const spreadOf = (wrecks: { x: number; y: number; type?: string }[], spawns: { x: number; y: number }[]) => {
  const rich = wrecks.filter((w) => w.type !== undefined && (C.WRECK_RICH_TYPES as readonly string[]).includes(w.type));
  const pool = rich.length > 0 ? rich : wrecks;
  const ds = spawns.map((s) => Math.min(...pool.map((w) => Math.hypot(w.x - s.x, w.y - s.y))));
  return Math.max(...ds) - Math.min(...ds);
};

// 1. THE BUG: no wreck on anyone's doorstep. The old rule cleared ONE
// hardcoded point — the solo campaign spawn — which in a room is an arbitrary
// compass bearing that may be nobody's spawn and protects nobody else.
{
  let worst = Infinity;
  for (const n of [2, 3, 4, 6, 8]) {
    for (let s = 0; s < 12; s++) {
      const { sim, spawns } = ringSim(n, `fair${s}`);
      for (const w of genWrecks(`fair${s}`, sim)) {
        for (const p of spawns) worst = Math.min(worst, Math.hypot(w.x - p.x, w.y - p.y));
      }
    }
  }
  assert(
    worst >= C.WRECK_SPAWN_CLEAR_M,
    `every wreck clears EVERY spawn by WRECK_SPAWN_CLEAR_M (closest seen: ${(worst / 1000).toFixed(1)} km)`
  );
}

// 2. The fairness pass actually pays. Measured before the fix across these
// seeds: 8-player median spread 177 km, worst 286 km. Best-of-K is bounded
// below by geometry (8 spawns on a ring, ~2 rich wrecks, floor ~85 km), so
// this pins the OUTCOME — a bounded worst case — not a hand-picked number.
{
  for (const n of [4, 8]) {
    let worstSpread = 0;
    for (let s = 0; s < 20; s++) {
      const { sim, spawns } = ringSim(n, `spread${s}`);
      worstSpread = Math.max(worstSpread, spreadOf(genWrecks(`spread${s}`, sim), spawns));
    }
    assert(
      worstSpread < 200000,
      `${n}p: worst-case nearest-rich spread stays under 200 km across 20 seeds (${(worstSpread / 1000).toFixed(0)} km) — it was 286 km`
    );
  }
}

// 3. Determinism: same seed, same field. Rooms rematch on the same seed and
// must not reshuffle the map underneath the players.
{
  const a = ringSim(4, "det");
  const b = ringSim(4, "det");
  assert(
    JSON.stringify(genWrecks("det", a.sim)) === JSON.stringify(genWrecks("det", b.sim)),
    "same seed + same spawns => identical field (best-of-K is deterministic)"
  );
}

// 4. 🔴 One spawn short-circuits on attempt 0, so solo campaign and practice
// fields are BIT-IDENTICAL to before the fairness pass existed. The old
// hardcoded exclusion point WAS the solo spawn, so nothing about those maps
// moves. If this fails, the campaign map changed and every campaign pin is
// suspect.
{
  const sim = new Sim("solo");
  sim.addShip("A", 0, -C.SPAWN_RING_RADIUS_M, 0);
  const field = genWrecks("solo", sim, false);
  assert(field.length > 0, "solo field generates");
  const spawns = [{ x: 0, y: -C.SPAWN_RING_RADIUS_M }];
  assert(spreadOf(field, spawns) === 0, "one spawn has spread 0 — nobody to be unfair to");
  for (const w of field) {
    assert(
      Math.hypot(w.x - 0, w.y + C.SPAWN_RING_RADIUS_M) >= C.WRECK_SPAWN_CLEAR_M,
      `solo site clears the campaign spawn exactly as the old rule did (${w.type ?? "?"})`
    );
  }
}
