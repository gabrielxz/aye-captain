// Seeded terrain: rocks (solid, block LOS) + dust (sensor-only, blocks LOS
// both ways). Pure geometry lives here — the sim decides what LOS gates.
import * as C from "./constants.js";

export interface Rock {
  x: number;
  y: number;
  r: number;
  centerpiece?: boolean; // the one big body; cosmetic distinction only
}

// Ellipse: rx/ry are semi-axes (m), rot in degrees (compass, like everything).
export interface Dust {
  x: number;
  y: number;
  rx: number;
  ry: number;
  rot: number;
}

export interface Terrain {
  seed: string;
  rocks: Rock[];
  dust: Dust[];
}

export function emptyTerrain(): Terrain {
  return { seed: "", rocks: [], dust: [] };
}

// ---------- seeded PRNG ----------

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- generation ----------

// Spawn points must stay clear (see Match: ships spawn at ±SPAWN_DIST on y).
const SPAWN_POINTS = [
  { x: 0, y: -C.SPAWN_DIST_FROM_CENTER_M },
  { x: 0, y: C.SPAWN_DIST_FROM_CENTER_M },
];

export function generateTerrain(seed: string): Terrain {
  const rand = mulberry32(hashSeed(seed));
  const rocks: Rock[] = [];

  const clearOfSpawns = (x: number, y: number, r: number) =>
    SPAWN_POINTS.every((s) => Math.hypot(x - s.x, y - s.y) > r + C.ROCK_SPAWN_CLEAR_M);
  const clearOfRocks = (x: number, y: number, r: number) =>
    rocks.every((o) => Math.hypot(x - o.x, y - o.y) > r + o.r + C.ROCK_MIN_GAP_M);

  // the centerpiece: one big cracked moonlet somewhere in the middle third
  for (let tries = 0; tries < 500; tries++) {
    const ang = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * (C.REGION_RADIUS_M / 3);
    const x = Math.cos(ang) * d;
    const y = Math.sin(ang) * d;
    if (!clearOfSpawns(x, y, C.CENTERPIECE_RADIUS_M)) continue;
    rocks.push({ x, y, r: C.CENTERPIECE_RADIUS_M, centerpiece: true });
    break;
  }

  // the field
  for (let i = 0; i < C.ROCK_COUNT; i++) {
    for (let tries = 0; tries < 500; tries++) {
      const ang = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * (C.REGION_RADIUS_M * 0.95);
      const x = Math.cos(ang) * d;
      const y = Math.sin(ang) * d;
      const r = C.ROCK_RADIUS_MIN_M + rand() * (C.ROCK_RADIUS_MAX_M - C.ROCK_RADIUS_MIN_M);
      if (!clearOfSpawns(x, y, r) || !clearOfRocks(x, y, r)) continue;
      rocks.push({ x, y, r });
      break;
    }
  }

  // dust: elliptical sensor shadows, free to overlap anything
  const dust: Dust[] = [];
  for (let i = 0; i < C.DUST_COUNT; i++) {
    const ang = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * (C.REGION_RADIUS_M * 0.85);
    dust.push({
      x: Math.cos(ang) * d,
      y: Math.sin(ang) * d,
      rx: (C.DUST_SIZE_MIN_M + rand() * (C.DUST_SIZE_MAX_M - C.DUST_SIZE_MIN_M)) / 2,
      ry: (C.DUST_SIZE_MIN_M + rand() * (C.DUST_SIZE_MAX_M - C.DUST_SIZE_MIN_M)) / 2,
      rot: rand() * 180,
    });
  }

  return { seed, rocks, dust };
}

// ---------- raycast geometry ----------

// Earliest parameter t in [0,1] where the segment (x1,y1)->(x2,y2) enters the
// circle, or null. A segment starting inside the circle returns 0.
export function segCircleHitT(
  x1: number, y1: number, x2: number, y2: number,
  cx: number, cy: number, r: number
): number | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const fx = x1 - cx;
  const fy = y1 - cy;
  if (fx * fx + fy * fy <= r * r) return 0; // starts inside
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

// Segment-vs-ellipse: map the ellipse to the unit circle and reuse the
// circle test (affine maps preserve intersection).
export function segHitsDust(
  x1: number, y1: number, x2: number, y2: number, d: Dust
): boolean {
  const rad = (d.rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const local = (x: number, y: number): [number, number] => {
    const tx = x - d.x;
    const ty = y - d.y;
    return [(tx * cos + ty * sin) / d.rx, (-tx * sin + ty * cos) / d.ry];
  };
  const [ax, ay] = local(x1, y1);
  const [bx, by] = local(x2, y2);
  return segCircleHitT(ax, ay, bx, by, 0, 0, 1) !== null;
}

export function insideDust(x: number, y: number, terrain: Terrain): boolean {
  return terrain.dust.some((d) => segHitsDust(x, y, x, y, d));
}

// Earliest rock the segment hits, if any.
export function firstRockHit(
  x1: number, y1: number, x2: number, y2: number, terrain: Terrain
): { rock: Rock; t: number } | null {
  let best: { rock: Rock; t: number } | null = null;
  for (const rock of terrain.rocks) {
    const t = segCircleHitT(x1, y1, x2, y2, rock.x, rock.y, rock.r);
    if (t !== null && (!best || t < best.t)) best = { rock, t };
  }
  return best;
}

// A sensor/seeker/lock ray is clear when it crosses no rock and no dust.
// Dust is binary and bidirectional: inside a cloud you are blind and unseen.
export function losClear(
  x1: number, y1: number, x2: number, y2: number, terrain: Terrain
): boolean {
  if (firstRockHit(x1, y1, x2, y2, terrain)) return false;
  return !terrain.dust.some((d) => segHitsDust(x1, y1, x2, y2, d));
}
