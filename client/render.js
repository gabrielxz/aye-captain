// canvas draw loop w/ interpolation, camera (zoom/pan/follow), SVG ship
// sprites, parallax starfield, range rings, overview inset, particles
import { state } from "./main.js";

const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");

const COLORS = {
  bg: "#06090d",
  grid: "#0d1520",
  zone: "#2a4a5a",
  own: "#2dd4bf",
  enemy: "#fc8181",
  ghost: "#4a5a6a",
  rings: "#3d5468",
  star: "#9fb4c8",
};

// Which authored design to fly (candidates in client/assets/):
// "interceptor" | "gunship" | "saucer"
const SHIP_DESIGN = "interceptor";
const SHIP_LEN_M = 60; // true hull length; far below one pixel at map scale
const MIN_SHIP_PX = 22; // legibility clamp: never render smaller than this
const VECTOR_SECONDS = 10; // the vector line = this much travel at current velocity
const MIN_VECTOR_PX = 34; // legibility floor; clears the 22px hull clamp
const DRIFT_STUB_PX = 26; // drift marker radius from hull center; just outside MIN_SHIP_PX
const DRIFT_MIN_SPEED_MPS = 5; // below this: draw nothing (matches full_stop's cutoff)

// ---------- sprite loading (SVG text -> tinted blob -> Image) ----------

const TINTS = {
  own: { HULL: "#0e3f3a", ACCENT: "#2dd4bf" },
  enemy: { HULL: "#3f1518", ACCENT: "#fc8181" },
  ghost: { HULL: "#141c26", ACCENT: "#4a5a6a" },
};
const sprites = {}; // tint -> Image

fetch(`assets/${SHIP_DESIGN}.svg`)
  .then((r) => r.text())
  .then((svg) => {
    for (const [name, tint] of Object.entries(TINTS)) {
      const tinted = svg.replaceAll("HULL", tint.HULL).replaceAll("ACCENT", tint.ACCENT);
      const img = new Image();
      img.src = URL.createObjectURL(new Blob([tinted], { type: "image/svg+xml" }));
      img.onload = () => (sprites[name] = img);
    }
  })
  .catch(() => {}); // sprite-less fallback triangles still draw

function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);

// ---------- camera ----------
// World: origin at region center, +y = north (up on screen), meters.
// camera.{x,y} is the world point at screen center; zoom is px per meter.

export const camera = {
  x: 0,
  y: 0,
  zoom: 0, // set on first frame once the canvas has a size
  follow: true, // track own ship each frame
  showInset: true, // M toggles the whole-region overview
};

function regionRadius() {
  return state.config?.zoneRadius ?? 250000;
}

function zoomBounds() {
  const s = Math.min(canvas.clientWidth, canvas.clientHeight);
  return {
    min: s / 2 / (regionRadius() * 1.15), // whole region in view
    max: s / 5000, // ~5 km across
  };
}

function clampZoom(z) {
  const b = zoomBounds();
  return Math.max(b.min, Math.min(b.max, z));
}

function ensureZoom() {
  if (camera.zoom === 0 && canvas.clientWidth > 0) {
    // opening view: spectators get the whole region (referee framing);
    // players get local space around own ship, ~120 km across
    camera.zoom =
      state.role === "spectator"
        ? zoomBounds().min
        : clampZoom(Math.min(canvas.clientWidth, canvas.clientHeight) / 120000);
  }
}

function worldToScreen(x, y) {
  return [
    canvas.clientWidth / 2 + (x - camera.x) * camera.zoom,
    canvas.clientHeight / 2 - (y - camera.y) * camera.zoom,
  ];
}

// ---------- camera input (wheel zoom, drag pan, WASD pan, F/M toggles) ----------

const isTyping = () => {
  const el = document.activeElement;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
};

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    ensureZoom();
    const prev = camera.zoom;
    const next = clampZoom(prev * Math.exp(-e.deltaY * 0.0012));
    if (!camera.follow && prev > 0) {
      // keep the world point under the cursor fixed while zooming
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left - canvas.clientWidth / 2;
      const my = e.clientY - rect.top - canvas.clientHeight / 2;
      camera.x += mx / prev - mx / next;
      camera.y -= my / prev - my / next;
    }
    camera.zoom = next;
  },
  { passive: false }
);

let drag = null;
let hover = null; // pointer position over the map (canvas coords), for the bearing readout
canvas.addEventListener("pointerdown", (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  const rect = canvas.getBoundingClientRect();
  hover = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  if (!drag || camera.zoom === 0) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return; // click, not drag (yet)
  drag.moved = true;
  camera.follow = false;
  camera.x -= dx / camera.zoom;
  camera.y += dy / camera.zoom;
  drag.x = e.clientX;
  drag.y = e.clientY;
});
canvas.addEventListener("pointerup", () => (drag = null));
canvas.addEventListener("pointercancel", () => (drag = null));
canvas.addEventListener("pointerleave", () => (hover = null));

const heldKeys = new Set();
document.addEventListener("keydown", (e) => {
  if (isTyping() || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "w" || k === "a" || k === "s" || k === "d") {
    heldKeys.add(k);
    e.preventDefault();
  } else if (k === "f") {
    camera.follow = !camera.follow; // snap-to-ship happens on the next frame
  } else if (k === "m") {
    camera.showInset = !camera.showInset;
  } else if (k === "v") {
    vectorLatched = !vectorLatched; // local toggle, no XO round-trip
  }
});
document.addEventListener("keyup", (e) => heldKeys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => heldKeys.clear());

// WASD pan, called each frame with the frame delta (seconds).
function stepKeyPan(dts) {
  if (heldKeys.size === 0 || camera.zoom === 0) return;
  const px = (heldKeys.has("d") ? 1 : 0) - (heldKeys.has("a") ? 1 : 0);
  const py = (heldKeys.has("w") ? 1 : 0) - (heldKeys.has("s") ? 1 : 0);
  if (px === 0 && py === 0) return;
  camera.follow = false;
  const v = 600 / camera.zoom; // ~600 px/s of screen travel
  camera.x += px * v * dts;
  camera.y += py * v * dts;
}

// ---------- interpolation helpers ----------

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// shortest-arc angle interpolation
function lerpAngle(a, b, t) {
  const diff = ((b - a + 540) % 360) - 180;
  return a + diff * t;
}

// Interpolation factor between the last two snapshots at this frame.
function interpAlpha() {
  if (!state.prevSnap || !state.lastSnap) return 1;
  const elapsed = performance.now() - state.lastSnapAt;
  return Math.min(1, elapsed / state.snapIntervalMs);
}

// Interpolated {x, y, facing} for an entity present in both snapshots.
// pick(snap) must return the entity or null.
function interpolate(pick) {
  const last = state.lastSnap && pick(state.lastSnap);
  if (!last) return null;
  const prev = state.prevSnap && pick(state.prevSnap);
  if (!prev) return { ...last };
  const t = interpAlpha();
  return {
    ...last,
    x: lerp(prev.x, last.x, t),
    y: lerp(prev.y, last.y, t),
    facing: lerpAngle(prev.facing ?? 0, last.facing ?? 0, t),
  };
}

// ---------- velocity vector overlay (show_vector verb + V toggle) ----------

let vectorLatched = false; // V key: persistent toggle
let vectorUntil = 0; // XO-triggered: shown until this timestamp

export function showVector(ms) {
  vectorUntil = performance.now() + ms;
}

// Persistent overlays toggled through the XO (set_overlay verb). Session
// state only; reset on match start. No hotkey — deliberately reachable
// only by asking the ship.
const overlays = { drift: false };

export function setOverlay(element, on) {
  if (element in overlays) overlays[element] = on;
}

export function resetOverlays() {
  for (const k of Object.keys(overlays)) overlays[k] = false;
}

// The drift marker: a hollow chevron at a fixed screen radius from the
// hull, rotated to the velocity bearing. The sprite shows FACING; this
// shows GOING — the divergence is the game's whole Newtonian premise.
function drawDriftMarker(you) {
  if (!overlays.drift || !you) return;
  const vx = state.lastSnap?.you?.vx ?? 0;
  const vy = state.lastSnap?.you?.vy ?? 0;
  const speed = Math.hypot(vx, vy);
  if (speed < DRIFT_MIN_SPEED_MPS) return;
  const [sx, sy] = worldToScreen(you.x, you.y);
  const dx = vx / speed;
  const dy = -vy / speed; // screen y is down
  const cx = sx + dx * DRIFT_STUB_PX;
  const cy = sy + dy * DRIFT_STUB_PX;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.atan2(dy, dx) + Math.PI / 2); // chevron points along travel
  ctx.beginPath();
  ctx.moveTo(-6, 4);
  ctx.lineTo(0, -4);
  ctx.lineTo(6, 4);
  ctx.strokeStyle = COLORS.own;
  ctx.lineWidth = 1.6;
  ctx.globalAlpha = 0.85;
  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawVectorOverlay(you) {
  if (!you) return;
  if (!vectorLatched && performance.now() > vectorUntil) return;
  const vx = state.lastSnap?.you?.vx ?? 0;
  const vy = state.lastSnap?.you?.vy ?? 0;
  const speed = Math.hypot(vx, vy);
  if (speed < 1) return;

  const [sx, sy] = worldToScreen(you.x, you.y);
  // screen-space travel direction (world north = screen up)
  const dx = vx / speed;
  const dy = -vy / speed;
  // below the floor the line is a direction indicator, not a projection:
  // at that speed "where I'll be in 10 s" is approximately right here anyway
  const lenPx = Math.max(MIN_VECTOR_PX, speed * VECTOR_SECONDS * camera.zoom);
  const ex = sx + dx * lenPx;
  const ey = sy + dy * lenPx;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.strokeStyle = COLORS.own;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([6, 5]);
  ctx.stroke();
  ctx.setLineDash([]);
  // arrowhead
  const ang = Math.atan2(dy, dx);
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - 8 * Math.cos(ang - 0.4), ey - 8 * Math.sin(ang - 0.4));
  ctx.lineTo(ex - 8 * Math.cos(ang + 0.4), ey - 8 * Math.sin(ang + 0.4));
  ctx.closePath();
  ctx.fillStyle = COLORS.own;
  ctx.fill();
  ctx.font = "10px monospace";
  ctx.fillText(`+${VECTOR_SECONDS}s · ${Math.round(speed)} m/s`, ex + 8, ey);
  ctx.globalAlpha = 1;

  // projected stop point for an immediate full-stop maneuver: coast through
  // the retrograde flip, then decelerate at full burn (cheap, educational)
  const prop = state.lastSnap?.you?.propellant ?? 0;
  const accel = state.config?.accel ?? 60;
  const turnRate = state.config?.turnRate ?? 20;
  if (prop > 0) {
    const facing = state.lastSnap?.you?.facing ?? 0;
    const retro = (Math.atan2(-vx, -vy) * 180) / Math.PI;
    const flipDeg = Math.abs((((retro - facing) % 360) + 540) % 360 - 180);
    const flipS = flipDeg / turnRate;
    const stopDist = speed * flipS + (speed * speed) / (2 * accel);
    const [px, py] = worldToScreen(
      you.x + (vx / speed) * stopDist,
      you.y + (vy / speed) * stopDist
    );
    // stop glyph: a dashed bracket straddling the velocity line, opening
    // toward the ship — a wall you come to rest against, not a contact
    const nx = -dy; // perpendicular to travel, screen space
    const ny = dx;
    ctx.beginPath();
    ctx.moveTo(px + nx * 7 - dx * 4, py + ny * 7 - dy * 4);
    ctx.lineTo(px + nx * 7, py + ny * 7);
    ctx.lineTo(px - nx * 7, py - ny * 7);
    ctx.lineTo(px - nx * 7 - dx * 4, py - ny * 7 - dy * 4);
    ctx.strokeStyle = COLORS.own;
    ctx.globalAlpha = 0.8;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    const km = stopDist / 1000;
    const kmLabel = km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
    ctx.font = "10px monospace";
    ctx.fillStyle = COLORS.own;
    ctx.fillText(`all stop · ${kmLabel}`, px + 10, py + 3);
    ctx.globalAlpha = 1;
  }
}

// ---------- starfield (multi-layer parallax; subtle, navigational) ----------

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STAR_TILE = 512; // px; the pattern tiles across the screen
const STAR_PARALLAX_PX_PER_M = 0.02; // screen travel per meter of camera pan
const STAR_LAYERS = [
  { p: 0.1, count: 60, alpha: 0.3, seed: 11 },
  { p: 0.25, count: 42, alpha: 0.45, seed: 23 },
  { p: 0.5, count: 26, alpha: 0.7, seed: 47 },
].map((l) => {
  const rand = mulberry32(l.seed);
  return {
    ...l,
    stars: Array.from({ length: l.count }, () => ({
      x: rand() * STAR_TILE,
      y: rand() * STAR_TILE,
      r: rand() < 0.8 ? 1 : 2,
    })),
  };
});

function drawStars() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.fillStyle = COLORS.star;
  for (const layer of STAR_LAYERS) {
    const k = STAR_PARALLAX_PX_PER_M * layer.p;
    const offX = ((((-camera.x * k) % STAR_TILE) + STAR_TILE) % STAR_TILE);
    const offY = ((((camera.y * k) % STAR_TILE) + STAR_TILE) % STAR_TILE);
    ctx.globalAlpha = layer.alpha;
    for (let ty = -1; ty * STAR_TILE <= h; ty++) {
      for (let tx = -1; tx * STAR_TILE <= w; tx++) {
        for (const s of layer.stars) {
          const x = tx * STAR_TILE + offX + s.x;
          const y = ty * STAR_TILE + offY + s.y;
          if (x < -2 || x > w + 2 || y < -2 || y > h + 2) continue;
          ctx.fillRect(x, y, s.r, s.r);
        }
      }
    }
  }
  ctx.globalAlpha = 1;
}

// ---------- terrain (rocks + dust nebulae) ----------

// Deterministic craggy outline per rock: radial jitter on a polygon, seeded
// by rock index so it's stable frame to frame and identical for both players.
let rockShapeCache = null; // [{points: [[dx,dy],...]}] normalized to r=1
let rockShapeSeed = null;

function rockShapes() {
  const terrain = state.terrain;
  if (!terrain) return [];
  if (rockShapeCache && rockShapeSeed === terrain.seed) return rockShapeCache;
  rockShapeSeed = terrain.seed;
  rockShapeCache = terrain.rocks.map((rock, i) => {
    const rand = mulberry32(1000 + i * 7919);
    const n = rock.centerpiece ? 22 : 14;
    const points = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const jitter = 0.82 + rand() * 0.3;
      points.push([Math.cos(a) * jitter, Math.sin(a) * jitter]);
    }
    // a few craters on the bigger bodies
    const craters = [];
    if (rock.r > 4000) {
      const count = rock.centerpiece ? 4 : 2;
      for (let k = 0; k < count; k++) {
        craters.push({ x: (rand() - 0.5) * 1.1, y: (rand() - 0.5) * 1.1, r: 0.1 + rand() * 0.16 });
      }
    }
    return { points, craters };
  });
  return rockShapeCache;
}

function drawTerrain() {
  const terrain = state.terrain;
  if (!terrain) return;

  // dust first: soft nebula patches under everything else
  for (const d of terrain.dust ?? []) {
    const [sx, sy] = worldToScreen(d.x, d.y);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate((d.rot * Math.PI) / 180);
    ctx.scale(d.rx * camera.zoom, d.ry * camera.zoom);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, "rgba(96, 126, 158, 0.16)");
    grad.addColorStop(0.6, "rgba(96, 126, 158, 0.09)");
    grad.addColorStop(1, "rgba(96, 126, 158, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const shapes = rockShapes();
  (terrain.rocks ?? []).forEach((rock, i) => {
    const [sx, sy] = worldToScreen(rock.x, rock.y);
    // legibility clamp: a rock never vanishes entirely when zoomed out
    const rpx = Math.max(2, rock.r * camera.zoom);
    if (
      sx + rpx < 0 || sx - rpx > canvas.clientWidth ||
      sy + rpx < 0 || sy - rpx > canvas.clientHeight
    ) {
      return;
    }
    const shape = shapes[i];
    ctx.save();
    ctx.translate(sx, sy);
    ctx.beginPath();
    shape.points.forEach(([dx, dy], k) => {
      if (k === 0) ctx.moveTo(dx * rpx, dy * rpx);
      else ctx.lineTo(dx * rpx, dy * rpx);
    });
    ctx.closePath();
    ctx.fillStyle = rock.centerpiece ? "#1b2029" : "#171d26";
    ctx.strokeStyle = "#2c3846";
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
    if (rpx > 14) {
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      for (const c of shape.craters) {
        ctx.beginPath();
        ctx.arc(c.x * rpx, c.y * rpx, c.r * rpx, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  });
}

// ---------- particles (smoke, explosion debris) ----------

const particles = []; // {x, y, vx, vy, born, life, r0, color}
function spawnParticle(p) {
  if (particles.length > 400) particles.shift();
  particles.push({ born: performance.now(), ...p });
}

function drawParticles() {
  const now = performance.now();
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    const t = (now - p.born) / p.life;
    if (t >= 1) {
      particles.splice(i, 1);
      continue;
    }
    const [sx, sy] = worldToScreen(
      p.x + (p.vx * (now - p.born)) / 1000,
      p.y + (p.vy * (now - p.born)) / 1000
    );
    ctx.beginPath();
    ctx.arc(sx, sy, p.r0 * (1 - t * 0.5), 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = (1 - t) * 0.5;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ---------- draw primitives ----------

function drawRing(cx, cy, radiusM, color, width = 1, dash = [], alpha = 1) {
  const [sx, sy] = worldToScreen(cx, cy);
  ctx.beginPath();
  ctx.arc(sx, sy, radiusM * camera.zoom, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.globalAlpha = alpha;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

// Adaptive grid: line spacing snaps to 1/2/5 x 10^n meters so lines stay
// ~80-200 px apart at any zoom.
function drawGrid() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const targetPx = 80;
  const raw = targetPx / camera.zoom;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step =
    [1, 2, 5, 10].map((m) => m * pow).find((s) => s * camera.zoom >= targetPx) ?? 10 * pow;

  const left = camera.x - w / 2 / camera.zoom;
  const right = camera.x + w / 2 / camera.zoom;
  const bottom = camera.y - h / 2 / camera.zoom;
  const top = camera.y + h / 2 / camera.zoom;

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let m = Math.floor(left / step) * step; m <= right; m += step) {
    const [x] = worldToScreen(m, 0);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let m = Math.floor(bottom / step) * step; m <= top; m += step) {
    const [, y] = worldToScreen(0, m);
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
}

// Single range ring around own ship at 50 km — the map's only ruler, and
// (post v4.3 sensor rebase) roughly where a dark ship gets spotted. Kept
// labeled and kept AS AN ARRAY so a future playtest can re-add or delete
// rings in one line (v4.3 §4). The 10 and 100 km rings read as mystery
// circles in the playtest and are gone.
const RANGE_RINGS_M = [50000];
function drawRangeRings(you) {
  const span = Math.max(canvas.clientWidth, canvas.clientHeight);
  for (const r of RANGE_RINGS_M) {
    const rpx = r * camera.zoom;
    let alpha = 1;
    if (rpx < 60) alpha = (rpx - 25) / 35;
    else if (rpx > span * 0.75) alpha = 1 - (rpx - span * 0.75) / (span * 0.5);
    alpha = Math.max(0, Math.min(1, alpha));
    if (alpha <= 0.03) continue;
    drawRing(you.x, you.y, r, COLORS.rings, 1, [2, 6], alpha * 0.4);
    const [sx, sy] = worldToScreen(you.x, you.y);
    ctx.fillStyle = COLORS.rings;
    ctx.globalAlpha = alpha * 0.8;
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${r / 1000} km`, sx, sy - rpx - 4);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  }
}

// Thrust flare color runs cold amber -> hot blue-white with throttle.
function flareColor(pct) {
  if (pct > 80) return "#cfe8ff";
  if (pct > 45) return "#f6ad55";
  return "#b7791f";
}

function drawShip(ent, kind, { ghost = false, thrust = 0, hull = null, hullMax = 100 } = {}) {
  const [sx, sy] = worldToScreen(ent.x, ent.y);
  const sizePx = Math.max(MIN_SHIP_PX, SHIP_LEN_M * camera.zoom);
  const r = sizePx / 2;
  const rad = ((ent.facing ?? 0) * Math.PI) / 180;

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(rad); // canvas rotate is clockwise, matching compass headings

  // thrust flare scaled to output %, behind the ship
  if (!ghost && thrust > 0) {
    const flare = r * (0.5 + (thrust / 100) * 1.6);
    const grad = ctx.createLinearGradient(0, r * 0.8, 0, r * 0.8 + flare);
    grad.addColorStop(0, flareColor(thrust));
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.moveTo(-r * 0.28, r * 0.8);
    ctx.lineTo(0, r * 0.8 + flare);
    ctx.lineTo(r * 0.28, r * 0.8);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  const img = sprites[ghost ? "ghost" : kind];
  if (img) {
    if (ghost) ctx.globalAlpha = 0.55;
    ctx.drawImage(img, -r, -r, sizePx, sizePx);
    ctx.globalAlpha = 1;
  } else {
    // fallback triangle while the sprite loads
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.7, r);
    ctx.lineTo(-r * 0.7, r);
    ctx.closePath();
    ctx.strokeStyle = ghost ? COLORS.ghost : COLORS[kind];
    ctx.lineWidth = ghost ? 1 : 1.5;
    if (ghost) ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  // battle damage: smoke trail below 50% hull, heavier below 25%
  // (hull numbers live in the HUD panel, not floating on the map)
  if (!ghost && hull !== null && hull / hullMax < 0.5) {
    const heavy = hull / hullMax < 0.25;
    if (Math.random() < (heavy ? 0.5 : 0.2)) {
      spawnParticle({
        x: ent.x + (Math.random() - 0.5) * 300,
        y: ent.y + (Math.random() - 0.5) * 300,
        vx: (Math.random() - 0.5) * 120,
        vy: (Math.random() - 0.5) * 120,
        life: 1600,
        r0: heavy ? 4 : 2.5,
        color: heavy ? "#6b5747" : "#556270",
      });
    }
  }
}

// ---------- main draw ----------

let lastFrameAt = performance.now();

function draw() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const now = performance.now();
  const dts = Math.min(0.1, (now - lastFrameAt) / 1000);
  lastFrameAt = now;

  ensureZoom();
  stepKeyPan(dts);

  const you = interpolate((s) => s.you);
  if (camera.follow && you) {
    camera.x = you.x;
    camera.y = you.y;
  }

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);
  if (camera.zoom === 0) return; // canvas not sized yet

  drawStars();
  drawGrid();
  if (state.config) {
    drawRing(0, 0, state.config.zoneRadius, COLORS.zone, 1.25);
  }
  drawTerrain();
  if (you) drawRangeRings(you);

  drawParticles();
  drawFx();
  drawOrdnance();

  if (state.lastSnap?.spectator) {
    drawSpectatorShips();
  } else if (you) {
    drawShip(you, "own", {
      thrust: state.lastSnap.you.thrustOut ?? state.lastSnap.you.thrust,
      hull: state.lastSnap.you.hull,
      hullMax: 100,
    });
  }

  drawContacts();
  drawRumbles(you);
  drawDriftMarker(you);
  drawVectorOverlay(you);
  drawCursorReadout(you);
  drawInset(you);
}

// The captain's plotting table: bearing from own ship to the cursor. Makes
// blind fire, contact callouts, and dust-cloud speculation speakable.
// Always on while the pointer is over the map. (v4.3: range dropped —
// bearing is the speakable currency; range-to-empty-space invited false
// precision. The 50 km ring is the distance ruler.)
function drawCursorReadout(you) {
  if (!hover || !you || camera.zoom === 0) return;
  const wx = camera.x + (hover.x - canvas.clientWidth / 2) / camera.zoom;
  const wy = camera.y - (hover.y - canvas.clientHeight / 2) / camera.zoom;
  const dx = wx - you.x;
  const dy = wy - you.y;
  const brg = String(Math.round(((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360)).padStart(3, "0");
  const label = `BRG ${brg}`;
  ctx.font = "11px monospace";
  const w = ctx.measureText(label).width;
  let tx = hover.x + 16;
  let ty = hover.y - 12;
  if (tx + w + 8 > canvas.clientWidth) tx = hover.x - w - 16;
  if (ty < 14) ty = hover.y + 22;
  ctx.fillStyle = "rgba(6, 9, 13, 0.75)";
  ctx.fillRect(tx - 4, ty - 11, w + 8, 15);
  ctx.fillStyle = "#8fa8bf";
  ctx.fillText(label, tx, ty);
}

// v4.5 hearing: rumbles are bearing-only — a soft chevron at the edge of
// the view along the bearing from own ship, alpha scaled by loudness. It
// deliberately has NO distance information to give.
function drawRumbles(you) {
  const rumbles = state.lastSnap?.rumbles ?? [];
  if (!you || rumbles.length === 0) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const [ox, oy] = worldToScreen(you.x, you.y);
  const pad = 26; // chevron sits just inside the view edge
  for (const r of rumbles) {
    const rad = ((r.bearing ?? 0) * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad); // screen y is down
    // march from own ship to the view edge along the bearing
    let t = Infinity;
    if (dx > 0) t = Math.min(t, (w - pad - ox) / dx);
    if (dx < 0) t = Math.min(t, (pad - ox) / dx);
    if (dy > 0) t = Math.min(t, (h - pad - oy) / dy);
    if (dy < 0) t = Math.min(t, (pad - oy) / dy);
    if (!Number.isFinite(t) || t < 40) continue; // own ship at/off the edge
    const cx = ox + dx * t;
    const cy = oy + dy * t;
    const pulse = 0.45 + 0.25 * Math.sin(performance.now() / 400);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.atan2(dy, dx) + Math.PI / 2);
    ctx.beginPath(); // double chevron pointing outward, along the bearing
    ctx.moveTo(-9, 4); ctx.lineTo(0, -6); ctx.lineTo(9, 4);
    ctx.moveTo(-9, 12); ctx.lineTo(0, 2); ctx.lineTo(9, 12);
    ctx.strokeStyle = "#8fa8bf";
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = pulse * Math.max(0.35, Math.min(1, r.loud ?? 0.5));
    ctx.stroke();
    ctx.globalAlpha = Math.min(0.9, (r.loud ?? 0.5) + 0.3);
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#8fa8bf";
    ctx.fillText(`${String(Math.round(r.bearing)).padStart(3, "0")}`, 0, 24);
    ctx.textAlign = "left";
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

// Spectator (v4.2): both ships in full detail — A in own-tint, B in enemy
// tint, matching the ordnance coloring the server pre-baked into `own`.
function drawSpectatorShips() {
  for (const s of state.lastSnap.ships ?? []) {
    const ent = interpolate((sn) => (sn.ships ?? []).find((k) => k.id === s.id) ?? null);
    if (!ent) continue;
    drawShip(ent, s.id === "A" ? "own" : "enemy", {
      thrust: s.thrustOut ?? 0,
      hull: s.hull,
      hullMax: s.hullMax ?? 100,
    });
    const [sx, sy] = worldToScreen(ent.x, ent.y);
    ctx.fillStyle = s.id === "A" ? COLORS.own : COLORS.enemy;
    ctx.font = "10px monospace";
    ctx.fillText(s.id, sx + MIN_SHIP_PX / 2 + 5, sy + 3);
  }
}

// Contacts by tier: faint = a position smudge with no vector; track = full
// sprite; id = sprite + hull-state smoke. Ghost = last-known, dashed.
function drawContacts() {
  const snap = state.lastSnap;
  if (!snap) return;

  for (const c of snap.contacts ?? []) {
    if (c.tier === 1) {
      // a smudge: pulsing diffuse blob, deliberately imprecise
      const [sx, sy] = worldToScreen(c.x, c.y);
      const pulse = 10 + Math.sin(performance.now() / 300) * 3;
      const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, pulse * 2);
      grad.addColorStop(0, "rgba(252, 129, 129, 0.35)");
      grad.addColorStop(1, "rgba(252, 129, 129, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sx, sy, pulse * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLORS.enemy;
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.arc(sx, sy, pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLORS.enemy;
      ctx.font = "10px monospace";
      ctx.fillText("faint contact", sx + pulse + 6, sy + 3);
      continue;
    }
    // track/id: interpolate across consecutive snapshots, matched by the
    // stable contact id (multiple contacts may coexist — decoys deceive)
    const ent =
      interpolate((s) => {
        const p = (s.contacts ?? []).find((k) => k.cid === c.cid && k.tier >= 2);
        return p ?? null;
      }) ?? c;
    drawShip(ent, "enemy", {
      hull: c.tier === 3 ? (c.hull ?? null) : null,
      hullMax: c.hullMax ?? 100,
    });
  }

  const ghost = snap.ghost;
  if ((snap.contacts ?? []).length === 0 && ghost) {
    drawShip(ghost, "enemy", { ghost: true });
    const [sx, sy] = worldToScreen(ghost.x, ghost.y);
    const age = Math.max(0, snap.tick - ghost.t);
    ctx.fillStyle = COLORS.ghost;
    ctx.font = "10px monospace";
    ctx.fillText(`last seen ${age}s ago`, sx + 14, sy + 4);
  }
}

// ---------- overview inset (M) ----------

const INSET_PX = 170;
function drawInset(you) {
  if (!camera.showInset || !state.lastSnap) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const pad = 12;
  const x0 = pad;
  const y0 = h - INSET_PX - pad;

  ctx.save();
  ctx.fillStyle = "rgba(6, 9, 13, 0.85)";
  ctx.strokeStyle = "#1c2a38";
  ctx.fillRect(x0, y0, INSET_PX, INSET_PX);
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, INSET_PX - 1, INSET_PX - 1);
  ctx.beginPath();
  ctx.rect(x0, y0, INSET_PX, INSET_PX);
  ctx.clip();

  const R = regionRadius() * 1.12;
  const s = INSET_PX / 2 / R;
  const cx = x0 + INSET_PX / 2;
  const cy = y0 + INSET_PX / 2;
  const toInset = (wx, wy) => [cx + wx * s, cy - wy * s];

  // region ring
  ctx.beginPath();
  ctx.arc(cx, cy, regionRadius() * s, 0, Math.PI * 2);
  ctx.strokeStyle = COLORS.zone;
  ctx.globalAlpha = 0.9;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // terrain: rocks as dots, dust as faint blobs
  if (state.terrain) {
    ctx.fillStyle = "rgba(96, 126, 158, 0.18)";
    for (const d of state.terrain.dust ?? []) {
      const [dx, dy] = toInset(d.x, d.y);
      ctx.beginPath();
      ctx.ellipse(dx, dy, Math.max(2, d.rx * s), Math.max(2, d.ry * s), (d.rot * Math.PI) / 180, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#39485a";
    for (const rock of state.terrain.rocks ?? []) {
      const [rx, ry] = toInset(rock.x, rock.y);
      ctx.beginPath();
      ctx.arc(rx, ry, Math.max(1, rock.r * s), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // current viewport rectangle
  const [vcx, vcy] = toInset(camera.x, camera.y);
  const vw = (w / camera.zoom) * s;
  const vh = (h / camera.zoom) * s;
  ctx.strokeStyle = "#5c7185";
  ctx.globalAlpha = 0.8;
  ctx.strokeRect(vcx - vw / 2, vcy - vh / 2, vw, vh);
  ctx.globalAlpha = 1;

  // own ship
  if (you) {
    const [ox, oy] = toInset(you.x, you.y);
    ctx.fillStyle = COLORS.own;
    ctx.beginPath();
    ctx.arc(ox, oy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // spectator: both ships, same colors as the main view
  for (const s of state.lastSnap.ships ?? []) {
    const [px, py] = toInset(s.x, s.y);
    ctx.fillStyle = s.id === "A" ? COLORS.own : COLORS.enemy;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // known contacts: live (filled, faint = smaller) or last-known ghost (hollow)
  for (const c of state.lastSnap.contacts ?? []) {
    const [ex, ey] = toInset(c.x, c.y);
    ctx.fillStyle = COLORS.enemy;
    ctx.globalAlpha = c.tier === 1 ? 0.6 : 1;
    ctx.beginPath();
    ctx.arc(ex, ey, c.tier === 1 ? 2 : 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if ((state.lastSnap.contacts ?? []).length === 0 && state.lastSnap.ghost) {
    const g = state.lastSnap.ghost;
    const [ex, ey] = toInset(g.x, g.y);
    ctx.strokeStyle = COLORS.ghost;
    ctx.beginPath();
    ctx.arc(ex, ey, 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

// Interpolate an entity out of a per-snapshot array, matched by id.
function interpolateById(listKey, id) {
  return interpolate((s) => (s[listKey] ?? []).find((e) => e.id === id) ?? null);
}

function drawOrdnance() {
  if (!state.lastSnap) return;

  // missiles: small but loud — glow, hot dot, engine trail
  for (const m of state.lastSnap.missiles ?? []) {
    const ent = interpolateById("missiles", m.id);
    if (!ent) continue;
    const [sx, sy] = worldToScreen(ent.x, ent.y);
    const color = m.own ? COLORS.own : COLORS.enemy;
    // engine trail only while burning — a coasting torpedo is a bare dot
    if (m.burning !== false) {
      const speed = Math.hypot(m.vx, m.vy) || 1;
      const trailM = speed * 2.5; // ~2.5s of travel
      const [tx, ty] = worldToScreen(
        ent.x - (m.vx / speed) * trailM,
        ent.y - (m.vy / speed) * trailM
      );
      const grad = ctx.createLinearGradient(tx, ty, sx, sy);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, color);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(sx, sy);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // glow halo
    ctx.beginPath();
    ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.globalAlpha = 1;
    // hot core
    ctx.beginPath();
    ctx.arc(sx, sy, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx, sy, 1.4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // decoys: pulsing hollow diamonds
  const pulse = 4.2 + Math.sin(performance.now() / 180) * 1.6;
  for (const d of state.lastSnap.decoys ?? []) {
    const ent = interpolateById("decoys", d.id);
    if (!ent) continue;
    const [sx, sy] = worldToScreen(ent.x, ent.y);
    const r = pulse;
    ctx.beginPath();
    ctx.moveTo(sx, sy - r);
    ctx.lineTo(sx + r, sy);
    ctx.lineTo(sx, sy + r);
    ctx.lineTo(sx - r, sy);
    ctx.closePath();
    ctx.strokeStyle = d.own ? COLORS.own : COLORS.enemy;
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 180));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

const PDC_FX_MS = 260;
const BOOM_FX_MS = 700;
const BIG_BOOM_FX_MS = 1600;

function drawFx() {
  const now = performance.now();
  state.fxBuffer = state.fxBuffer.filter(({ fx, at }) => {
    const ttl = fx.type === "pdc" ? PDC_FX_MS : fx.big ? BIG_BOOM_FX_MS : BOOM_FX_MS;
    return now - at < ttl;
  });
  for (const entry of state.fxBuffer) {
    const { fx, at } = entry;
    const age = now - at;
    if (fx.type === "pdc") {
      // tracer stream: dashed line walking from mount to target
      const alpha = 1 - age / PDC_FX_MS;
      const [x1, y1] = worldToScreen(fx.x1, fx.y1);
      const [x2, y2] = worldToScreen(fx.x2, fx.y2);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = "#ffd28a";
      ctx.globalAlpha = alpha * 0.8;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 9]);
      ctx.lineDashOffset = -(now / 4) % 12; // tracers crawl toward the target
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    } else if (fx.type === "boom") {
      const ttl = fx.big ? BIG_BOOM_FX_MS : BOOM_FX_MS;
      const t = age / ttl;
      const [sx, sy] = worldToScreen(fx.x, fx.y);
      const maxR = fx.big ? 46 : 18;
      // flash core
      if (t < 0.25) {
        ctx.beginPath();
        ctx.arc(sx, sy, (fx.big ? 14 : 6) * (1 - t * 3), 0, Math.PI * 2);
        ctx.fillStyle = "#fff7e0";
        ctx.globalAlpha = 1 - t * 3.5;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // expanding rings
      ctx.beginPath();
      ctx.arc(sx, sy, 3 + t * maxR, 0, Math.PI * 2);
      ctx.strokeStyle = "#f6ad55";
      ctx.globalAlpha = 1 - t;
      ctx.lineWidth = fx.big ? 2.5 : 1.5;
      ctx.stroke();
      if (fx.big) {
        ctx.beginPath();
        ctx.arc(sx, sy, 2 + t * maxR * 0.6, 0, Math.PI * 2);
        ctx.strokeStyle = "#fc8181";
        ctx.globalAlpha = (1 - t) * 0.8;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // debris sparks, once at birth
      if (!entry.sparked) {
        entry.sparked = true;
        const n = fx.big ? 14 : 5;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const v = 150 + Math.random() * (fx.big ? 700 : 350);
          spawnParticle({
            x: fx.x,
            y: fx.y,
            vx: Math.cos(a) * v,
            vy: Math.sin(a) * v,
            life: 500 + Math.random() * (fx.big ? 900 : 400),
            r0: fx.big ? 2.4 : 1.6,
            color: Math.random() < 0.5 ? "#f6ad55" : "#fc8181",
          });
        }
      }
    }
  }
}

// Big terminal explosion at a world position (used on game over).
export function bigBoomAt(x, y) {
  state.fxBuffer.push({ fx: { type: "boom", big: true, x, y }, at: performance.now() });
}

export function startRenderLoop() {
  resize();
  function frame() {
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
